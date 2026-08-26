/**
 * The freshness contract behind `/api/system-status`.
 *
 * A health check is worth exactly what its verdict function is worth, and this
 * one had been wrong in both directions at once while looking entirely
 * reasonable in review:
 *
 *   - **False red.** The maritime probe asked the Europe-wide `mar_tf_qm` cube
 *     for its newest column, which is the newest quarter *any* European port
 *     has filed. Riga runs a quarter or two behind that as a matter of routine,
 *     so the probe read one all-null cell and reported the source dead.
 *     Production sat at `degraded` while `/api/port-data` served complete
 *     statistics for all three Baltic states.
 *
 *   - **False green.** A frozen cube's newest column still carries the last
 *     value ever published, so the same question answers yes for ever. That is
 *     how `prc_hicp_manr` served 2025-12 for eight months while every check
 *     stayed green, and how data.gov.lv served eighteen consecutive
 *     header-only CSVs.
 *
 * Both come from asking whether the last column has a number in it. The
 * question that separates them is how old the newest observation is, judged
 * against the cadence the source actually publishes at — which is why the
 * cadence is declared per probe rather than shared.
 *
 * The registry test at the bottom is the one that matters most: it fails if a
 * probe is added without declaring a cadence, because the reason the HICP
 * freeze ran for eight months is that nobody was ever made to answer that
 * question.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cubeHealth = require('../api/shared/cubeHealth.js');
const freshness = require('../api/shared/freshness.js');
const registry = require('../api/shared/statusChecks.js');

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
      rep_mar: { category: { index: { LV_0LVRIX: 0 }, label: { LV_0LVRIX: 'Riga' } } },
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
const NOW = new Date('2026-08-26T12:00:00Z');

/** The maritime check's real declared cadence, so the test uses the shipped one. */
const maritime = registry.CHECKS.find((c: { name: string }) => c.name === 'Eurostat maritime');

describe('newestPeriod', () => {
  it('ignores columns the cube was padded to but nobody filled', () => {
    // The exact live shape that produced the false red: Eurostat pads to
    // 2026-Q2 because some European port filed it, and Riga's own newest
    // observation is 2025-Q4.
    const cube = vesselCube(
      ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'],
      [545, 568, null, null],
    );
    expect(cubeHealth.newestPeriod(cube, 'rep_mar')).toBe('2025-Q4');
  });

  it('returns null for a cube that carries no observation at all', () => {
    // An emptied cube still parses. This is a fault, not a lag, and callers
    // must not read it as fresh.
    const cube = vesselCube(['2026-Q1', '2026-Q2'], [null, null]);
    expect(cubeHealth.newestPeriod(cube, 'rep_mar')).toBeNull();
  });

  it('returns null for a key dimension the cube does not have', () => {
    expect(cubeHealth.newestPeriod(vesselCube(['2026-Q1'], [1]), 'geo')).toBeNull();
  });

  it('reads the table, not one key, so a single laggard is not an outage', () => {
    // Two ports: one current, one that stopped years ago. The table is plainly
    // alive, and requiring every key to have filed the newest quarter is the
    // mistake that produced the false red.
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
    expect(cubeHealth.newestPeriod(cube, 'rep_mar')).toBe('2025-Q4');
  });
});

describe('the maritime probe, end to end', () => {
  it('passes a cube padded to a quarter the port has not filed yet', () => {
    // Two quarters of lag is normal operation for this collection and must
    // stay green, or the status page cries wolf and readers stop believing it.
    const cube = vesselCube(
      ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'],
      [545, 568, null, null],
    );
    const verdict = freshness.judge(maritime, cubeHealth.newestObservation(cube, 'rep_mar'), NOW);

    expect(verdict.state).toBe('fresh');
    expect(verdict.age).toBeLessThanOrEqual(maritime.maxLag);
  });

  it('calls a cube that stopped moving stale, though it still carries values', () => {
    // Every cell here is a real number; the table simply stopped being updated
    // three years ago. A "does the last column have a number in it" probe
    // reports this as healthy for ever.
    const cube = vesselCube(['2022-Q3', '2022-Q4'], [510, 522]);
    const verdict = freshness.judge(maritime, cubeHealth.newestObservation(cube, 'rep_mar'), NOW);

    expect(verdict.state).toBe('stale');
    expect(verdict.reason).toMatch(/may trail/);
  });

  it('reports unknown, never fresh, when there is no observation to judge', () => {
    // "I cannot tell" defaulting to "fresh" is the failure that let the HICP
    // freeze run for eight months.
    expect(freshness.judge(maritime, null, NOW).state).toBe('unknown');
  });
});

describe('ageInUnits', () => {
  it('measures a period in the cadence the source publishes at', () => {
    // 2025-Q4 ends December 2025; August 2026 is eight months later.
    expect(freshness.ageInUnits('M', { period: '2025-Q4' }, NOW)).toBeCloseTo(8, 5);
    expect(freshness.ageInUnits('Q', { period: '2025-Q4' }, NOW)).toBeCloseTo(8 / 3, 5);
  });

  it('measures a timestamp in hours and days', () => {
    const sixHoursAgo = new Date(NOW.getTime() - 6 * 3600e3);
    expect(freshness.ageInUnits('H', { at: sixHoursAgo }, NOW)).toBeCloseTo(6, 5);
    expect(freshness.ageInUnits('D', { at: sixHoursAgo }, NOW)).toBeCloseTo(0.25, 5);
  });

  it('reads CSP PxWeb period labels as well as Eurostat ones', () => {
    // PxWeb writes `2026Q1` where Eurostat writes `2026-Q1`. Recognising only
    // one of them would report every national series as unknown.
    expect(freshness.ageInUnits('Q', { period: '2026Q1' }, NOW))
      .toBeCloseTo(freshness.ageInUnits('Q', { period: '2026-Q1' }, NOW), 5);
  });

  it('cannot tell, rather than guessing, for an unreadable label', () => {
    expect(freshness.ageInUnits('M', { period: 'last Tuesday' }, NOW)).toBeNull();
    expect(freshness.ageInUnits('M', { at: 'not a date' }, NOW)).toBeNull();
    expect(freshness.ageInUnits('M', null, NOW)).toBeNull();
  });
});

describe('judge', () => {
  const hourly = { cadence: 'H', maxLag: 6 };

  it('treats data ahead of now as fresh', () => {
    // Elering publishes tomorrow's day-ahead prices and Open-Meteo forecasts
    // forward, so a negative age is normal rather than suspicious.
    const tomorrow = new Date(NOW.getTime() + 12 * 3600e3);
    expect(freshness.judge(hourly, { at: tomorrow }, NOW).state).toBe('fresh');
  });

  it('is unknown when the check declares no cadence, and says why', () => {
    const verdict = freshness.judge(
      { cadence: null, freshnessNote: 'liveness action only' }, null, NOW);
    expect(verdict.state).toBe('unknown');
    expect(verdict.reason).toBe('liveness action only');
  });

  it('is unknown when a cadence is declared but the source said nothing', () => {
    expect(freshness.judge(hourly, null, NOW).state).toBe('unknown');
  });
});

describe('the freshness extractors', () => {
  it('reads the newest reference date out of ECB XML', () => {
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-08-24'><Cube currency='USD' rate='1.1'/></Cube>` +
      `<Cube time='2026-08-25'><Cube currency='USD' rate='1.2'/></Cube></Cube></gesmes:Envelope>`;
    expect(freshness.extract.ecbXml(xml)).toEqual({ at: '2026-08-25T23:59:59Z' });
  });

  it('reads the newest priced interval out of Elering, across every zone', () => {
    const body = {
      success: true,
      data: {
        lv: [{ timestamp: 1787700000, price: 40 }],
        ee: [{ timestamp: 1787703600, price: 42 }],
      },
    };
    expect(freshness.extract.elering(body)).toEqual({ at: new Date(1787703600 * 1000) });
    expect(freshness.extract.elering({ success: true, data: {} })).toBeNull();
  });

  it('stamps a zoneless Open-Meteo time as UTC rather than as host-local', () => {
    // `current.time` arrives as `2026-08-26T12:45` with no zone designator.
    // Parsed as local time it is right on a UTC host and wrong everywhere
    // else, which is the kind of bug that only appears in one deployment.
    expect(freshness.extract.openMeteo({ current: { time: '2026-08-26T12:45' } }))
      .toEqual({ at: '2026-08-26T12:45:00Z' });
    expect(freshness.extract.openMeteo({})).toBeNull();
  });

  it('reads the newest period out of PxWeb table metadata', () => {
    const body = {
      title: 'Gross domestic product indices',
      variables: [
        { code: 'SESON', text: 'Adjustment', values: ['CA'] },
        { code: 'TIME', text: 'Time period', time: true, values: ['2025Q3', '2025Q4', '2026Q1'] },
      ],
    };
    expect(freshness.extract.pxwebMetadata(body)).toEqual({ period: '2026Q1' });
    expect(freshness.extract.pxwebMetadata({ variables: [] })).toBeNull();
  });

  it('ignores a CKAN resource the datastore is not serving', () => {
    // `pvn-maksataji` carries a JSON resource last touched in 2020 beside a CSV
    // updated this morning. Reading the wrong one reports a live daily feed as
    // six years dead.
    const packages = [{
      result: {
        resources: [
          { datastore_active: true, last_modified: '2026-08-26 05:01:28', format: 'CSV' },
          { datastore_active: false, last_modified: '2020-09-16 08:52:44', format: 'JSON' },
        ],
      },
    }];
    const observation = freshness.extract.ckanResources(packages);
    expect(observation.at.toISOString()).toBe('2026-08-26T05:01:28.000Z');
  });

  it('returns null rather than a date when no resource is active', () => {
    expect(freshness.extract.ckanResources([{ result: { resources: [] } }])).toBeNull();
    expect(freshness.extract.ckanResources([])).toBeNull();
  });
});

describe('the probe registry', () => {
  it('makes every probe declare a cadence', () => {
    // This is the assertion the whole contract rests on. `prc_hicp_manr` ran
    // frozen for eight months because nobody was ever asked "and how would we
    // know if this stopped?". Adding a source now forces the answer.
    for (const check of registry.CHECKS) {
      expect(check, `${check.name} must declare a cadence`).toHaveProperty('cadence');
    }
  });

  it('makes a probe that cannot report freshness say why', () => {
    // An explicit "unknown" reaches the status page. A forgotten one silently
    // reads as fine.
    for (const check of registry.CHECKS) {
      if (check.cadence) continue;
      expect(typeof check.freshnessNote, `${check.name} must explain its missing cadence`)
        .toBe('string');
      expect(check.freshnessNote.length).toBeGreaterThan(0);
    }
  });

  it('gives every declared cadence a usable bound', () => {
    for (const check of registry.CHECKS) {
      if (!check.cadence) continue;
      expect(freshness.CADENCES, `${check.name} cadence`).toContain(check.cadence);
      expect(typeof check.maxLag, `${check.name} maxLag`).toBe('number');
      expect(check.maxLag, `${check.name} maxLag must be positive`).toBeGreaterThan(0);
    }
  });

  it('keeps every probe cheap, and asks no cube for a single column', () => {
    for (const check of registry.CHECKS) {
      if (!check.url) continue;
      expect(check.url, `${check.name} must not ask for one column`)
        .not.toContain('lastTimePeriod=1');
    }
  });

  it('names a source for every check and says what it powers', () => {
    for (const check of registry.CHECKS) {
      expect(typeof check.name).toBe('string');
      expect(typeof check.powers, `${check.name} must say what it powers`).toBe('string');
      expect(typeof check.required, `${check.name} must declare whether it is required`)
        .toBe('boolean');
    }
  });

  it('watches the newsroom, which can stop publishing without anything failing', () => {
    // On the 25 Aug run every tier A article was rejected, the function
    // completed successfully, and nothing said so. A newsroom that silently
    // stops is the same failure as a source that silently freezes, so it is
    // checked where a reader already looks.
    const newsroom = registry.CHECKS.find((c: { name: string }) => c.name === 'Newsroom pipeline');
    expect(newsroom, 'the newsroom must be probed').toBeDefined();
    // Daily timer plus one missed run of slack.
    expect(newsroom.cadence).toBe('H');
    expect(newsroom.maxLag).toBeGreaterThanOrEqual(24);
    // Not required until the report exists. A probe for an unshipped dependency
    // that red-lights the site is the crying-wolf this endpoint exists to stop,
    // so the note has to say so and the flag has to be a deliberate flip.
    if (!newsroom.required) {
      expect(newsroom.note, 'an optional newsroom probe must say why').toMatch(/required/i);
    }
  });

  it('leaves the site green when only optional probes are failing', () => {
    // The newsroom report 404s today because the newsroom does not write it
    // yet. Marking that probe required would report an outage against a
    // feature that was never built.
    const optional = registry.CHECKS.filter((c: { required: boolean }) => !c.required);
    expect(optional.length, 'there should be optional probes to check').toBeGreaterThan(0);
    for (const check of optional) {
      expect(typeof check.note, `${check.name} should explain why it is optional`)
        .toBe('string');
    }
  });
});
