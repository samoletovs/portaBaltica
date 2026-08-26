/**
 * The verdict function behind the `/api/system-status` maritime probe.
 *
 * This exists because the probe it replaces was wrong in *both* directions at
 * once, and neither was visible without asking the network:
 *
 *   - It reported an outage against a healthy feature. `mar_tf_qm` is
 *     Europe-wide, so `lastTimePeriod=1` returns the newest quarter *any*
 *     European port has filed. Riga runs a quarter or two behind that as a
 *     matter of routine, so the probe fetched a single all-null cell and called
 *     the source dead. Production sat at `degraded` while `/api/port-data`
 *     served complete statistics for Latvia, Estonia and Lithuania.
 *
 *   - It would have reported health against a dead one. A frozen cube's newest
 *     period still carries the last value ever published, so the same probe
 *     would have gone green and stayed green — which is exactly how
 *     data.gov.lv served eighteen consecutive header-only CSVs without tripping
 *     a check.
 *
 * A probe that can invert silently is worse than no probe, because a status
 * page is only worth what readers believe it is. Both directions are pinned
 * here so this cannot happen again unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cubeHealth = require('../api/shared/cubeHealth.js');

/**
 * A cube shaped like `mar_tf_qm` filtered to one port: dimension order freq,
 * tonnage, vessel, unit, rep_mar, time, with everything but time of size 1.
 */
function vesselCube(periods: string[], values: (number | null)[]) {
  return {
    id: ['freq', 'tonnage', 'vessel', 'unit', 'rep_mar', 'time'],
    size: [1, 1, 1, 1, 1, periods.length],
    dimension: {
      freq: { category: { index: { Q: 0 } } },
      tonnage: { category: { index: { TOTAL: 0 } } },
      vessel: { category: { index: { TOTAL: 0 } } },
      unit: { category: { index: { NR: 0 } } },
      rep_mar: {
        category: { index: { LV_0LVRIX: 0 }, label: { LV_0LVRIX: 'Riga' } },
      },
      time: {
        category: {
          index: Object.fromEntries(periods.map((p, i) => [p, i])),
          label: Object.fromEntries(periods.map(p => [p, p])),
        },
      },
    },
    value: values,
  };
}

/** Fixed "now" so these assertions do not rot with the wall clock. */
const NOW = new Date('2026-08-26T00:00:00Z');

describe('judgeCube', () => {
  it('passes a cube padded to a quarter the port has not filed yet', () => {
    // The exact live shape that produced the false red: Eurostat pads the
    // Europe-wide cube to 2026-Q2 because some European port filed it, and
    // Riga's own newest observation is 2025-Q4. That is a normal publication
    // lag, and the tile renders perfectly from it.
    const cube = vesselCube(
      ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'],
      [545, 568, null, null],
    );

    const verdict = cubeHealth.judgeCube(cube, 'rep_mar', { now: NOW });

    expect(verdict.ok).toBe(true);
    expect(verdict.period).toBe('2025-Q4');
    expect(verdict.reason).toBeNull();
  });

  it('fails a cube that has stopped moving, even though it still carries values', () => {
    // The other direction, and the one that actually kills a data feed
    // unnoticed. Every cell here is a real number; the table simply stopped
    // being updated three years ago. A "does the last column have a number in
    // it" probe reports this as healthy forever.
    const cube = vesselCube(['2022-Q3', '2022-Q4'], [510, 522]);

    const verdict = cubeHealth.judgeCube(cube, 'rep_mar', { now: NOW });

    expect(verdict.ok).toBe(false);
    expect(verdict.period).toBe('2022-Q4');
    expect(verdict.reason).toMatch(/2022-Q4/);
    expect(verdict.reason).toMatch(/months old/);
  });

  it('fails a cube that answers with no observation at all', () => {
    // An emptied cube still parses. This is the failure that ended the
    // data.gov.lv maritime feed.
    const cube = vesselCube(['2026-Q1', '2026-Q2'], [null, null]);

    const verdict = cubeHealth.judgeCube(cube, 'rep_mar', { now: NOW });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/no observation/);
  });

  it('fails a cube with no series on the key dimension', () => {
    const verdict = cubeHealth.judgeCube({}, 'rep_mar', { now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/no rep_mar series/);
  });

  it('judges the table, not one port, so a single laggard is not an outage', () => {
    // Two ports: one current, one that stopped years ago. The table is plainly
    // alive. Requiring every key to have filed the newest quarter is the
    // mistake that produced the false red in the first place.
    const cube = {
      id: ['freq', 'unit', 'rep_mar', 'time'],
      size: [1, 1, 2, 3],
      dimension: {
        freq: { category: { index: { Q: 0 } } },
        unit: { category: { index: { NR: 0 } } },
        rep_mar: { category: { index: { LV_0LVRIX: 0, LV_0LVVNT: 1 } } },
        time: { category: { index: { '2021-Q4': 0, '2025-Q3': 1, '2025-Q4': 2 } } },
      },
      value: [120, null, null, 40, 52, 56],
    };

    const verdict = cubeHealth.judgeCube(cube, 'rep_mar', { now: NOW });

    expect(verdict.ok).toBe(true);
    expect(verdict.period).toBe('2025-Q4');
  });

  it('reports the quarter it judged even when healthy', () => {
    // So the status page can show which observation the verdict rests on. A
    // threshold nobody can see is a threshold nobody can question.
    const cube = vesselCube(['2026-Q1'], [612]);
    expect(cubeHealth.judgeCube(cube, 'rep_mar', { now: NOW }).period).toBe('2026-Q1');
  });
});

describe('the maritime probe definition', () => {
  it('asks for a window of quarters, never a single newest column', () => {
    // `lastTimePeriod=1` is the question that cannot distinguish "not filed
    // yet" from "stopped", because it only ever returns one column.
    const source = readFileSync(resolve('api/system-status/index.js'), 'utf8');

    const block = source.slice(source.indexOf("name: 'Eurostat maritime'"));
    // The URL expression only — the comment above it names the old parameter
    // precisely so nobody reintroduces it, and must not itself trip this.
    const url = block.slice(block.indexOf('url:'), block.indexOf('type:'));

    expect(url).toContain('sinceTimePeriod=');
    expect(url).not.toContain('lastTimePeriod');
  });
});
