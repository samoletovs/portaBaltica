/**
 * Guards for the Eurostat indicator layer.
 *
 * These run in the PR gate and make no network calls. They exist because nine
 * of the dashboard's charts were empty and three were plotting a different
 * statistic than their label claimed, and every one of those shipped through a
 * green build. Nothing asserted that an indicator was fully specified, and the
 * parser filled the gap by silently reading category index 0 of any dimension
 * the query had left open.
 *
 * The parser tests below are written to FAIL against that old behaviour: each
 * feeds a cube whose index-0 slice is empty or wrong, and asserts the parser
 * both finds the populated slice and reports that it had to.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js');
const es = require_('../api/shared/eurostat.js');

type IndicatorDef = {
  dataset: string;
  params: string;
  freq: 'A' | 'S' | 'Q' | 'M';
  title: string;
  unit: string;
  sanity: [number, number];
};

const entries = Object.entries(INDICATORS) as [string, IndicatorDef][];

/**
 * Build a JSON-stat 2.0 cube. `live` names the coordinate on each extra
 * dimension that actually carries data; every other coordinate is null.
 */
function cube(opts: {
  extraDims: Record<string, string[]>;
  live: Record<string, string>;
  geos: string[];
  times: string[];
  valueFor: (geo: string, time: string) => number;
}) {
  const dimIds = [...Object.keys(opts.extraDims), 'geo', 'time'];
  const catsFor = (codes: string[]) => {
    const index: Record<string, number> = {};
    codes.forEach((c, i) => { index[c] = i; });
    return { category: { index, label: Object.fromEntries(codes.map((c) => [c, c])) } };
  };

  const dimension: Record<string, unknown> = {};
  for (const [id, codes] of Object.entries(opts.extraDims)) dimension[id] = catsFor(codes);
  dimension.geo = catsFor(opts.geos);
  dimension.time = catsFor(opts.times);

  const size = dimIds.map((id) =>
    id === 'geo' ? opts.geos.length : id === 'time' ? opts.times.length : opts.extraDims[id].length);

  const strides: number[] = new Array(dimIds.length);
  let mult = 1;
  for (let d = dimIds.length - 1; d >= 0; d--) { strides[d] = mult; mult *= size[d]; }

  const value: Record<string, number> = {};
  for (let g = 0; g < opts.geos.length; g++) {
    for (let t = 0; t < opts.times.length; t++) {
      let idx = 0;
      let onLiveSlice = true;
      for (let d = 0; d < dimIds.length; d++) {
        const id = dimIds[d];
        if (id === 'geo') { idx += g * strides[d]; continue; }
        if (id === 'time') { idx += t * strides[d]; continue; }
        const pos = opts.extraDims[id].indexOf(opts.live[id]);
        if (pos < 0) onLiveSlice = false;
        idx += Math.max(0, pos) * strides[d];
      }
      if (onLiveSlice) value[idx] = opts.valueFor(opts.geos[g], opts.times[t]);
    }
  }

  return { version: '2.0', class: 'dataset', id: dimIds, size, dimension, value };
}

describe('indicator registry', () => {
  it('exposes every indicator the dashboard renders', () => {
    // Charts and cards reference these by id; a rename silently blanks a tile.
    const referenced = [
      'gdp', 'unemployment', 'inflation', 'house_prices', 'interest_rate', 'gov_debt_gdp',
      'construction', 'consumer_confidence', 'salary', 'retail', 'population', 'tourism',
      'industrial', 'ppi', 'gov_revenue', 'exports', 'imports', 'vehicles', 'renewables',
      'wages_mfg', 'wages_it', 'job_vacancy', 'current_account', 'elec_production',
      'gdp_per_capita', 'inequality', 'youth_unemployment', 'trade_balance', 'gov_deficit',
      'life_expectancy', 'elec_price_household', 'hotel_occupancy', 'economic_sentiment',
    ];
    for (const id of referenced) {
      expect(INDICATORS, `indicator "${id}" is referenced by a component`).toHaveProperty(id);
    }
  });

  it.each(entries)('%s is fully specified', (_id, def) => {
    expect(def.dataset).toMatch(/^[a-z0-9_]+$/);
    expect(def.params.length).toBeGreaterThan(0);
    expect(def.title.length).toBeGreaterThan(0);
    expect(def.unit.length).toBeGreaterThan(0);
    expect(['A', 'S', 'Q', 'M']).toContain(def.freq);
  });

  it.each(entries)('%s declares a usable sanity band', (_id, def) => {
    expect(Array.isArray(def.sanity)).toBe(true);
    expect(def.sanity).toHaveLength(2);
    expect(def.sanity[0]).toBeLessThan(def.sanity[1]);
    expect(Number.isFinite(def.sanity[0])).toBe(true);
    expect(Number.isFinite(def.sanity[1])).toBe(true);
  });

  it.each(entries)('%s states the same frequency in freq and params', (_id, def) => {
    // sincePeriod() is driven by `freq`; a mismatch sends a quarterly bound to
    // an annual dataset.
    const inParams = def.params.match(/freq=([ASQM])/);
    if (inParams) expect(inParams[1]).toBe(def.freq);
  });

  it('does not use codes Eurostat has retired', () => {
    // Each of these produced a valid HTTP 200 containing no data.
    const retired: [string, RegExp][] = [
      ['CLV10_EUR_HAB', /CLV10_EUR_HAB/],
      ['BS-CSMCI-BAL as an indic code', /indic=BS-CSMCI-BAL/],
      ['JOBRATE', /indic_em=JOBRATE/],
      ['nace_r2=B-D36', /nace_r2=B-D36/],
    ];
    for (const [label, pattern] of retired) {
      const offenders = entries.filter(([, def]) => pattern.test(def.params));
      expect(offenders.map(([id]) => id), `${label} is no longer served by Eurostat`).toEqual([]);
    }
  });

  it('does not source an inequality measure from a balance-of-payments table', () => {
    // tipsii20 is net FDI as a share of GDP. It rendered as "Income inequality
    // (Gini)" showing 8.9 for Latvia, whose actual Gini is around 35.
    expect(INDICATORS.inequality.dataset).not.toBe('tipsii20');
    expect(INDICATORS.inequality.sanity[0]).toBeGreaterThanOrEqual(20);
    expect(INDICATORS.inequality.sanity[1]).toBeLessThanOrEqual(50);
  });

  it('measures life expectancy at birth rather than at age one', () => {
    expect(INDICATORS.life_expectancy.params).toContain('age=Y_LT1');
    expect(INDICATORS.life_expectancy.params).not.toMatch(/age=Y1(&|$)/);
  });
});

describe('sincePeriod', () => {
  const year = new Date().getFullYear();

  it('expresses the bound in the granularity of the dataset', () => {
    expect(es.sincePeriod('M', 5)).toBe(`${year - 5}-01`);
    expect(es.sincePeriod('Q', 5)).toBe(`${year - 5}-Q1`);
    expect(es.sincePeriod('S', 5)).toBe(`${year - 5}-S1`);
    expect(es.sincePeriod('A', 5)).toBe(String(year - 5));
  });

  it('does not send a quarterly bound to an annual dataset', () => {
    // The old code inferred "monthly or quarterly" from a substring of the
    // query string, so every annual indicator asked for `YYYY-Q1`.
    const annual = entries.filter(([, def]) => def.freq === 'A');
    expect(annual.length).toBeGreaterThan(0);
    for (const [id, def] of annual) {
      expect(es.sincePeriod(def.freq, 5), `${id} is annual`).not.toContain('-Q');
    }
  });
});

describe('parseJsonStat', () => {
  it('reads a fully pinned cube', () => {
    const data = cube({
      extraDims: { unit: ['PC'] },
      live: { unit: 'PC' },
      geos: ['LV', 'EE'],
      times: ['2024', '2025'],
      valueFor: (geo, time) => (geo === 'LV' ? 10 : 20) + Number(time.slice(-1)),
    });
    const out = es.parseJsonStat(data, ['LV', 'EE']);
    expect(out.assumptions).toEqual([]);
    expect(out.countries.LV.series).toEqual([
      { period: '2024', value: 14 },
      { period: '2025', value: 15 },
    ]);
  });

  it('finds the populated slice when a dimension is left open', () => {
    // sector index 0 is S1 and carries nothing; the data lives on S13. The old
    // parser read index 0 and produced an empty chart — this is gov_debt_gdp.
    const data = cube({
      extraDims: { sector: ['S1', 'S13', 'S1311'] },
      live: { sector: 'S13' },
      geos: ['LV'],
      times: ['2024', '2025'],
      valueFor: () => 46.9,
    });
    const out = es.parseJsonStat(data, ['LV']);
    expect(out.countries.LV.series.map((p: { value: number | null }) => p.value)).toEqual([46.9, 46.9]);
  });

  it('reports every dimension it had to choose for', () => {
    const data = cube({
      extraDims: { sector: ['S1', 'S13'], s_adj: ['NSA', 'SA'] },
      live: { sector: 'S13', s_adj: 'NSA' },
      geos: ['LV'],
      times: ['2025'],
      valueFor: () => 1,
    });
    const out = es.parseJsonStat(data, ['LV']);
    expect(out.assumptions).toHaveLength(2);
    expect(out.assumptions.map((a: { dimension: string }) => a.dimension).sort()).toEqual(['s_adj', 'sector']);
    expect(out.assumptions.find((a: { dimension: string }) => a.dimension === 'sector').chosen).toBe('S13');
  });

  it('returns no countries rather than nulls when the cube has no geo dimension', () => {
    const out = es.parseJsonStat({ id: ['time'], size: [1], value: { 0: 1 }, dimension: {} }, ['LV']);
    expect(out.countries).toEqual({});
    expect(out.assumptions).toEqual([]);
  });

  it('keeps gaps as null instead of shifting later periods forward', () => {
    const data = cube({
      extraDims: { unit: ['PC'] },
      live: { unit: 'PC' },
      geos: ['LV'],
      times: ['2023', '2024', '2025'],
      valueFor: (_geo, time) => (time === '2024' ? 5 : 7),
    });
    delete (data.value as Record<string, number>)['0']; // 2023 unreported
    const out = es.parseJsonStat(data, ['LV']);
    expect(out.countries.LV.series).toEqual([
      { period: '2023', value: null },
      { period: '2024', value: 5 },
      { period: '2025', value: 7 },
    ]);
  });
});
