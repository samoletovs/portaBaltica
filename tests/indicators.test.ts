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
      'services_inflation', 'goods_inflation', 'admin_prices', 'home_energy_inflation',
      'employment_rate', 'online_shoppers', 'air_passengers', 'ghg_emissions',
      'business_registrations', 'bankruptcies',
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

  it('gives the one biennial series an allowance that does not depend on a default', () => {
    // `freq` is the cube's dimension code, not the publication cadence, and for
    // exactly one of the sixty-six they disagree: sdg_04_70 says A and
    // publishes 2021, 2023, 2025 with no 2022 or 2024 coordinate at all.
    // Measured across the cycle, the newest observation's age runs 8 months
    // after publication to 30 just before the next — which is precisely the
    // annual default, so it sits on the boundary rather than inside it.
    const def = INDICATORS.digital_skills;

    expect(def.freq, 'the query still needs freq=A').toBe('A');
    expect(def.params).toContain('freq=A');

    expect(
      def.maxAgeMonths,
      'a biennial series on the shared annual allowance goes falsely stale on a ' +
        "one-month publication slip, and breaks outright if anyone tightens it"
    ).toBeGreaterThan(30);
  });

  it('leaves every genuinely annual series on the shared allowance', () => {
    // Guarding the guard: an override is a claim that this series is unusual.
    // If they spread, the default stops meaning anything and a real freeze
    // hides behind a generous number.
    const overridden = entries
      .filter(([, def]) => typeof (def as { maxAgeMonths?: number }).maxAgeMonths === 'number')
      .map(([id]) => id);

    expect(
      overridden,
      'only sdg_04_70 publishes off its declared cadence; a second override needs the same evidence'
    ).toEqual(['digital_skills']);
  });

  it('does not price industrial electricity off the emptiest code in the cube', () => {
    // A code can be present, valid, correctly parsed and in-band while carrying
    // almost no observations. Measured across the ten half-years to 2025-S2,
    // nrg_pc_205's aggregate is the *worst*-covered code it offers:
    //
    //   TOT_KWH          LV= 3  EE= 9  LT= 4
    //   MWH_LT20         LV=10  EE=10  LT=10
    //   MWH20-499        LV=10  EE=10  LT=10
    //   MWH500-1999      LV=10  EE=10  LT=10
    //   MWH2000-19999    LV=10  EE=10  LT=10
    //   MWH20000-69999   LV=10  EE=10  LT=10
    //   MWH70000-149999  LV=10  EE=10  LT=10
    //
    // So the "total" drew Latvia with three points in ten beside a nearly
    // complete Estonia, which reads as Latvia having stopped reporting rather
    // than as us having asked the wrong question. Six complete bands sit one
    // parameter away.
    //
    // Households are the opposite case and deliberately untouched: TOT_KWH in
    // nrg_pc_204 is complete for all three, so the aggregate is the right pick
    // there. The lesson is per-cube, not per-code.
    expect(
      INDICATORS.elec_price_industry.params,
      'TOT_KWH carries 3 of 10 periods for Latvia in nrg_pc_205'
    ).not.toContain('nrg_cons=TOT_KWH');
    expect(INDICATORS.elec_price_industry.params).toMatch(/nrg_cons=MWH[\d-]+/);
  });

  it('names the consumption band it prices, because a band is not a total', () => {
    // Once the series is one band rather than every consumer, the title has to
    // say so — otherwise the chart claims a national industrial price and shows
    // a medium consumer's. This is the same fault as a characterisation the
    // data does not carry, one level up.
    const { title, params } = INDICATORS.elec_price_industry;
    const band = params.match(/nrg_cons=MWH(\d+)-(\d+)/);

    expect(band, 'the industry price should pin a numbered band').not.toBeNull();

    // The lower bound is exact. The upper is not asserted digit-for-digit
    // because Eurostat itself describes this band as "500 MWh <= consumption
    // < 2 000 MWh", so a title reading 2000 for a code reading 1999 is the
    // source's own rounding rather than a discrepancy.
    expect(title, 'the title must name the band it prices').toContain(band![1]);
    expect(title, 'the title must give the band as a range').toMatch(/\d+\s*[\u2013-]\s*\d+/);
    expect(title, 'the title must not still read as an all-consumer total')
      .not.toMatch(/^Electricity price \(industry\)$/);
  });


  it('does not source HICP from the frozen ECOICOP ver.1 tables', () => {
    // Eurostat migrated HICP to ECOICOP ver.2 and froze the ver.1 tables on
    // 2026-02-06 with 2025-12 as their final period. They still answer HTTP 200,
    // still list every old code, and still return plausible numbers — so all
    // four inflation charts stayed green while going eight months stale.
    const frozen = /^prc_hicp_(manr|midx|mmor|cann|cind)$/;
    const offenders = entries.filter(([, def]) => frozen.test(def.dataset));
    expect(
      offenders.map(([id]) => id),
      'these datasets stopped being updated when HICP moved to ECOICOP ver.2; use prc_hicp_minr'
    ).toEqual([]);
  });

  it('queries HICP with the ECOICOP ver.2 dimension and a pinned unit', () => {
    const hicp = entries.filter(([, def]) => def.dataset === 'prc_hicp_minr');
    expect(hicp.length, 'the dashboard renders at least one inflation series').toBeGreaterThan(0);
    for (const [id, def] of hicp) {
      // ver.2 renamed the classification dimension and folded the index and the
      // rates of change into one cube. Leaving `unit` open would let the parser
      // pick an index and render it under a "% YoY" label.
      expect(def.params, `${id} must select on coicop18, not the ver.1 coicop`).toMatch(/coicop18=/);
      expect(def.params, `${id} still uses the ver.1 coicop dimension`).not.toMatch(/(^|&)coicop=/);
      expect(def.params, `${id} must pin unit=RCH_A to get an annual rate of change`).toMatch(/unit=RCH_A/);
    }
  });
});

describe('period freshness', () => {
  it('resolves a period label to the last month it covers', () => {
    // Comparing granularities on one axis: an annual observation for 2025 is
    // not complete until December 2025.
    expect(es.periodToMonthIndex('2026-07')).toBe(2026 * 12 + 7);
    expect(es.periodToMonthIndex('2026-Q1')).toBe(2026 * 12 + 3);
    expect(es.periodToMonthIndex('2026Q1')).toBe(2026 * 12 + 3);
    expect(es.periodToMonthIndex('2025-S2')).toBe(2025 * 12 + 12);
    expect(es.periodToMonthIndex('2025')).toBe(2025 * 12 + 12);
  });

  it('refuses to guess at a label it does not recognise', () => {
    // Returning 0 here would read as "brand new" and hide a frozen series.
    expect(es.periodToMonthIndex('last week')).toBeNull();
    expect(es.periodToMonthIndex('2026-Q5')).toBeNull();
    expect(es.periodToMonthIndex(undefined)).toBeNull();
    expect(es.monthsSincePeriod('nonsense', new Date('2026-08-25T00:00:00Z'))).toBeNull();
  });

  it('measures age in months from the end of the period', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    expect(es.monthsSincePeriod('2026-07', now)).toBe(1);
    expect(es.monthsSincePeriod('2025-12', now)).toBe(8); // the frozen HICP case
    expect(es.monthsSincePeriod('2026-Q2', now)).toBe(2);
    // A period still open reads as negative rather than as stale.
    expect(es.monthsSincePeriod('2026', now)).toBe(-4);
  });

  it('reads the PxWeb period vocabulary as well as the Eurostat one', () => {
    // CSP writes 2026M07 / 2026Q1 / 2025H2 for what Eurostat calls
    // 2026-07 / 2026-Q1 / 2025-S2. Understanding only one dialect meant every
    // national series answered "cannot tell", which is the answer that lets a
    // frozen table through unnoticed — CSP's unemployment table sat at 2025M12.
    expect(es.periodToMonthIndex('2026M07')).toBe(es.periodToMonthIndex('2026-07'));
    expect(es.periodToMonthIndex('2026Q1')).toBe(es.periodToMonthIndex('2026-Q1'));
    expect(es.periodToMonthIndex('2025H2')).toBe(es.periodToMonthIndex('2025-S2'));
  });

  it('infers cadence from the period label', () => {
    expect(es.periodCadence('2026M07')).toBe('M');
    expect(es.periodCadence('2026-07')).toBe('M');
    expect(es.periodCadence('2026Q1')).toBe('Q');
    expect(es.periodCadence('2025H2')).toBe('S');
    expect(es.periodCadence('2025')).toBe('A');
    expect(es.periodCadence('whenever')).toBeNull();
  });

  it('flags a series whose newest observation has stopped moving', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const monthly = (last: string) => [{ period: last, value: 7 }];

    expect(es.isSeriesStale(monthly('2025M12'), now)).toMatchObject({
      period: '2025M12', cadence: 'M', stale: true,
    });
    expect(es.isSeriesStale(monthly('2026M07'), now)).toMatchObject({
      cadence: 'M', stale: false,
    });
  });

  it('ignores trailing nulls when deciding how current a series is', () => {
    // PxWeb pads the tail of a table with nulls. Reading the last row rather
    // than the last *observation* would call a live series stale and trigger a
    // pointless failover.
    const now = new Date('2026-08-25T00:00:00Z');
    const padded = [
      { period: '2026M06', value: 6.8 },
      { period: '2026M07', value: null },
      { period: '2026M08', value: null },
    ];
    expect(es.isSeriesStale(padded, now)).toMatchObject({ period: '2026M06', stale: false });
  });

  it('says "cannot tell" rather than guessing on unusable input', () => {
    // null must not read as stale (needless failover) or as fresh (hidden freeze).
    const now = new Date('2026-08-25T00:00:00Z');
    expect(es.isSeriesStale([], now)).toBeNull();
    expect(es.isSeriesStale(null, now)).toBeNull();
    expect(es.isSeriesStale([{ period: '2026M06', value: null }], now)).toBeNull();
    expect(es.isSeriesStale([{ period: 'sometime', value: 3 }], now)).toBeNull();
  });

  it('allows a slower upstream to declare its own tolerance', () => {
    expect(es.maxAgeMonths({ freq: 'M' })).toBe(es.MAX_AGE_MONTHS.M);
    expect(es.maxAgeMonths({ freq: 'A' })).toBe(es.MAX_AGE_MONTHS.A);
    expect(es.maxAgeMonths({ freq: 'M', maxAgeMonths: 40 })).toBe(40);
  });

  it('would have failed the frozen HICP tables at a monthly cadence', () => {
    // The regression this guard exists for, stated as an assertion.
    const now = new Date('2026-08-25T00:00:00Z');
    expect(es.monthsSincePeriod('2025-12', now)).toBeGreaterThan(es.maxAgeMonths({ freq: 'M' }));
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
