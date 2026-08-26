/**
 * The parser and the definitions behind `/api/port-data`.
 *
 * Two failures are being pinned down here, both of which produce a page that
 * looks completely normal:
 *
 *   1. `parseJsonStat` insisted on a `geo` dimension. Eurostat's maritime
 *      tables have no `geo` at all — they are keyed on `rep_mar`, the
 *      reporting port — so every one of them parsed to an empty cube and the
 *      panels rendered their "no data" state against a perfectly healthy API.
 *
 *   2. Eurostat's `cargo` dimension interleaves levels: `LBK` is liquid bulk
 *      and `LBK_ROIL` is refined oil *within* it. Charting the dimension as
 *      delivered counts every tonne two or three times, and the resulting bars
 *      still add up to something and still sort plausibly.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const eurostat = require('../api/shared/eurostat.js');
const ports = require('../api/shared/ports.js');

/**
 * A JSON-stat 2.0 cube keyed on `rep_mar`, shaped exactly like
 * `mar_go_qm_lv`: dimension order freq, direct, cargo, unit, par_mar,
 * rep_mar, time, with everything except rep_mar and time of size 1.
 */
function portCube(portCodes: string[], periods: string[], values: (number | null)[]) {
  const index = (codes: string[]) =>
    Object.fromEntries(codes.map((c, i) => [c, i]));

  return {
    id: ['freq', 'direct', 'cargo', 'unit', 'par_mar', 'rep_mar', 'time'],
    size: [1, 1, 1, 1, 1, portCodes.length, periods.length],
    dimension: {
      freq: { category: { index: { Q: 0 }, label: { Q: 'Quarterly' } } },
      direct: { category: { index: { TOTAL: 0 }, label: { TOTAL: 'Total' } } },
      cargo: { category: { index: { TOTAL: 0 }, label: { TOTAL: 'Total' } } },
      unit: { category: { index: { THS_T: 0 }, label: { THS_T: 'Thousand tonnes' } } },
      par_mar: { category: { index: { TOTAL: 0 }, label: { TOTAL: 'Total' } } },
      rep_mar: {
        category: {
          index: index(portCodes),
          label: Object.fromEntries(portCodes.map(c => [c, c])),
        },
      },
      time: { category: { index: index(periods), label: Object.fromEntries(periods.map(p => [p, p])) } },
    },
    value: values,
  };
}

describe('parseJsonStatDim', () => {
  it('reads a cube keyed on rep_mar, which has no geo dimension at all', () => {
    const cube = portCube(
      ['LV_0LVRIX', 'LV_0LVVNT'],
      ['2025-Q3', '2025-Q4'],
      [3930, 4237, 1818, 1843],
    );

    const parsed = eurostat.parseJsonStatDim(cube, 'rep_mar', null);

    expect(Object.keys(parsed.series).sort()).toEqual(['LV_0LVRIX', 'LV_0LVVNT']);
    expect(parsed.series.LV_0LVRIX.series).toEqual([
      { period: '2025-Q3', value: 3930 },
      { period: '2025-Q4', value: 4237 },
    ]);
    expect(parsed.series.LV_0LVVNT.series[1]).toEqual({ period: '2025-Q4', value: 1843 });
  });

  it('reports no assumptions when every other dimension is pinned', () => {
    // A non-empty `assumptions` means a slice was chosen for us, which is how
    // a chart ends up confidently plotting a different statistic.
    const cube = portCube(['LV_0LVRIX'], ['2025-Q4'], [4237]);
    expect(eurostat.parseJsonStatDim(cube, 'rep_mar', null).assumptions).toEqual([]);
  });

  it('keeps nulls as nulls rather than turning them into zero', () => {
    const cube = portCube(['LV_0LVRIX'], ['2025-Q3', '2025-Q4'], [null, 4237]);
    const parsed = eurostat.parseJsonStatDim(cube, 'rep_mar', null);
    expect(parsed.series.LV_0LVRIX.series[0].value).toBeNull();
  });

  it('filters to the requested codes when asked, and keeps all of them otherwise', () => {
    const cube = portCube(['LV', 'LV_0LVRIX'], ['2025-Q4'], [7828, 4237]);

    expect(Object.keys(eurostat.parseJsonStatDim(cube, 'rep_mar', ['LV_0LVRIX']).series))
      .toEqual(['LV_0LVRIX']);
    expect(Object.keys(eurostat.parseJsonStatDim(cube, 'rep_mar', null).series).sort())
      .toEqual(['LV', 'LV_0LVRIX']);
  });

  it('returns an empty result for a key dimension the cube does not have', () => {
    const cube = portCube(['LV_0LVRIX'], ['2025-Q4'], [4237]);
    expect(eurostat.parseJsonStatDim(cube, 'geo', null).series).toEqual({});
  });

  it('still parses a geo-keyed cube, so the Baltic comparison charts are unaffected', () => {
    const cube = {
      id: ['freq', 'unit', 'geo', 'time'],
      size: [1, 1, 2, 2],
      dimension: {
        freq: { category: { index: { Q: 0 } } },
        unit: { category: { index: { PC: 0 } } },
        geo: { category: { index: { LV: 0, EE: 1 }, label: { LV: 'Latvia', EE: 'Estonia' } } },
        time: { category: { index: { '2025-Q3': 0, '2025-Q4': 1 } } },
      },
      value: [1, 2, 3, 4],
    };

    const parsed = eurostat.parseJsonStat(cube, ['LV', 'EE']);
    expect(parsed.countries.LV.label).toBe('Latvia');
    expect(parsed.countries.LV.series).toEqual([
      { period: '2025-Q3', value: 1 },
      { period: '2025-Q4', value: 2 },
    ]);
    expect(parsed.countries.EE.series[1].value).toBe(4);
  });
});

describe('the cargo mix definition', () => {
  it('names only categories that partition the total exactly once', () => {
    // Eurostat also publishes LBK_ROIL, DBK_COAL, LCNT_40 and two dozen more,
    // every one of them already counted inside one of these six.
    expect(ports.CARGO_MIX.map((c: { code: string }) => c.code))
      .toEqual(['LBK', 'DBK', 'LCNT', 'RO_MSP', 'RO_MNSP', 'OTH']);
  });

  it('picks no category that is a subdivision of another', () => {
    const codes: string[] = ports.CARGO_MIX.map((c: { code: string }) => c.code);
    const nested = codes.filter(code =>
      codes.some(other => other !== code && code.startsWith(other + '_')));
    expect(nested).toEqual([]);
  });

  it('sums to the reported total, checked against a real quarter', () => {
    // Latvia 2025-Q4 as published: the six categories against TOTAL = 7828.
    // The one-unit gap is rounding in thousand-tonne units.
    const observed: Record<string, number> = {
      LBK: 1554, DBK: 3644, LCNT: 1175, RO_MSP: 348, RO_MNSP: 164, OTH: 942,
    };
    const sum = ports.CARGO_MIX.reduce(
      (acc: number, c: { code: string }) => acc + observed[c.code], 0);

    expect(sum).toBeGreaterThan(7828 * 0.999);
    expect(sum).toBeLessThanOrEqual(7828);
  });
});

describe('the series definitions', () => {
  it('pins every dimension of every cube', () => {
    // An unpinned dimension is what `assumptions` reports and what the live
    // test fails on; catching it here does not need the network.
    const required: Record<string, string[]> = {
      goods: ['freq=Q', 'direct=TOTAL', 'cargo=TOTAL', 'unit=THS_T', 'par_mar=TOTAL'],
      passengers: ['freq=Q', 'natvessr=TOTAL', 'direct=TOTAL', 'unit=THS', 'par_mar=TOTAL'],
      vessels: ['freq=Q', 'tonnage=TOTAL', 'vessel=TOTAL', 'unit=NR'],
      // `cargo` is deliberately open here: it is the axis being read.
      cargoMix: ['freq=Q', 'direct=TOTAL', 'unit=THS_T', 'par_mar=TOTAL', 'rep_mar=LV'],
    };

    const urls = ports.seriesUrls('LV');
    for (const [series, params] of Object.entries(required)) {
      for (const param of params) {
        expect(urls[series], `${series} must pin ${param}`).toContain(param);
      }
    }
  });

  it('asks the passenger table for THS, the unit that actually carries data', () => {
    // `THS_PASF` is the tempting one — its label even says "excluding cruise
    // passengers" — and across Latvia 2024-Q1..2025-Q4 it carries exactly one
    // value against THS's eight. The table already excludes cruise passengers
    // by title, so THS is both correct and populated.
    const urls = ports.seriesUrls('LV');
    expect(urls.passengers).toContain('unit=THS&');
    expect(urls.passengers).not.toContain('THS_PASF');
  });

  it('pins rep_mar on the Europe-wide vessel cube, which 413s without it', () => {
    const urls = ports.seriesUrls('LV');
    expect(urls.vessels).toContain('rep_mar=LV_0LVRIX');
    // The per-country goods table is small enough to fetch whole, and must not
    // pin rep_mar — that is how a country published only at national level is
    // discovered rather than assumed.
    expect(urls.goods).not.toContain('rep_mar=');
  });

  it('covers all three Baltic states, which the data.gov.lv feed never did', () => {
    expect(ports.COUNTRIES).toEqual(['LV', 'EE', 'LT']);
    for (const country of ports.COUNTRIES) {
      expect(ports.PORTS[country].length).toBeGreaterThan(0);
      const urls = ports.seriesUrls(country);
      expect(urls.goods).toContain('mar_go_qm_' + country.toLowerCase());
      expect(urls.passengers).toContain('mar_pa_qm_' + country.toLowerCase());
    }
  });

  it('reads no data.gov.lv maritime dataset anywhere', () => {
    // The three datasets behind the old panels have published header-only CSVs
    // since 2026-03-08. Reintroducing one would silently pin the tile to a
    // frozen March snapshot again.
    const urls = Object.values(ports.seriesUrls('LV')).join(' ');
    expect(urls).not.toContain('data.gov.lv');
    for (const dead of ['REJVESLS', 'PSNGFERRY', 'LOADCRG', 'CRGTURNBYTYPEYEAR']) {
      expect(urls).not.toContain(dead);
    }
  });
});

describe('the port registry', () => {
  it('excludes the "other ports" bucket Eurostat mixes in with the named ones', () => {
    // `mar_pa_qm_lv` returns LV, LV_0LVRIX, LV_0LVVNT *and* LV_0LV888 —
    // "Latvia, other ports", which is all zeroes every quarter. It is not a
    // port, it has no name a reader would recognise, and charting it puts an
    // empty bar under a made-up label. `loadPortSeries` intersects the cube's
    // codes with this registry, which is what keeps it out; a change to that
    // filter would let it back in silently.
    const codes = ports.PORTS.LV.map((p: { code: string }) => p.code);
    expect(codes).not.toContain('LV_0LV888');
    expect(codes).not.toContain('LV');

    for (const country of ports.COUNTRIES) {
      for (const port of ports.PORTS[country]) {
        expect(port.code, `${port.code} must be a specific port, not an aggregate`)
          .not.toMatch(/888$/);
        expect(port.code).not.toBe(country);
        expect(port.name.length).toBeGreaterThan(0);
      }
    }
  });
});
