/**
 * A weekly cadence, and the two things that break when one arrives.
 *
 * Every indicator in this registry was monthly or slower until `demo_r_mwk_ts`,
 * and the shared layer's whole notion of time was a month index. Two failures
 * follow from that, and both are silent:
 *
 *   1. **A month index cannot locate a week.** Four or five of them share one
 *      index, so an age derived from it is quantised to a month — 4.3 cadence
 *      units for a weekly series. Measured on the live cube, Latvia's newest
 *      observation `2026-W28` is 1.53 months old and the month path says 1.
 *   2. **A frequency absent from `MAX_AGE_MONTHS` falls through `|| 30`** to
 *      the annual allowance, so a weekly series would have been permitted
 *      thirty months of staleness before the freshness gate spoke. That is not
 *      a hypothetical: `api/shared/eurostat.js` named this exact case in a
 *      comment before any weekly series existed.
 *
 * The third assertion here has nothing to do with weeks. `sts_cobp_q` backs
 * three definitions differing only in `cpa2_1` and `nrg_pc_20x` backs three
 * differing only in `nrg_cons` — the shape that put a bankruptcy figure under a
 * registrations headline in the newsroom. So the registry is checked for two
 * definitions that would issue the same request, using the same `buildUrl` the
 * handler calls rather than a restatement of it.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const es = require_('../api/shared/eurostat.js');
const freshness = require_('../api/shared/freshness.js');
const INDICATORS = require_('../api/shared/indicators.js');

type IndicatorDef = { dataset: string; params: string; freq: string; title: string };

const entries = Object.entries(INDICATORS) as [string, IndicatorDef][];

/** Fixed so a passing suite today is a passing suite next August. */
const NOW = new Date('2026-08-28T13:30:00Z');

describe('ISO week labels', () => {
  it('reads a week as the Sunday that closes it', () => {
    // Checked against the calendar rather than against the implementation:
    // ISO week 28 of 2026 runs Monday 6 July to Sunday 12 July.
    expect(new Date(es.periodEndMs('2026-W28')).toISOString())
      .toBe('2026-07-12T23:59:59.999Z');
    expect(new Date(es.periodEndMs('2026-W01')).toISOString())
      .toBe('2026-01-04T23:59:59.999Z');
  });

  it('counts real weeks, so a year boundary is one step and not fifty-one', () => {
    // Subtracting the `-Www` suffixes gives 1 - 52 = -51 across new year. A
    // detector reading that as a gap drops every run spanning the turn of the
    // year, and says nothing about having dropped it.
    expect(es.periodToWeekIndex('2026-W01') - es.periodToWeekIndex('2025-W52')).toBe(1);

    // 2020 is a 53-week ISO year, which is where an off-by-one lives if the
    // arithmetic assumes 52.
    expect(es.periodToWeekIndex('2021-W01') - es.periodToWeekIndex('2020-W53')).toBe(1);
    expect(es.periodToWeekIndex('2020-W53') - es.periodToWeekIndex('2020-W52')).toBe(1);
  });

  it('accepts Eurostat spelling and refuses everything else', () => {
    expect(es.periodToWeekIndex('2026-W28')).toBe(es.periodToWeekIndex('2026W28'));
    expect(es.periodToWeekIndex('2026-07')).toBeNull();
    expect(es.periodToWeekIndex('2026-Q2')).toBeNull();
    expect(es.periodToWeekIndex('whenever')).toBeNull();
    expect(es.periodToWeekIndex(null)).toBeNull();
  });

  it('names the cadence, so a weekly series is not aged as a monthly one', () => {
    expect(es.periodCadence('2026-W28')).toBe('W');
    // The control. If this pattern had swallowed the label the assertion above
    // would still pass on a broken parser that answered 'W' to everything.
    expect(es.periodCadence('2026-07')).toBe('M');
  });

  it('places a week in the month that contains its end', () => {
    // 2026-W28 ends 12 July, so July — the same rule quarters and half-years
    // already follow. Lossy on purpose and documented as such: W53 of 2026 and
    // W01 of 2027 both end in January 2027 and share an index, which is the
    // whole reason an age must not be computed from one.
    expect(es.periodToMonthIndex('2026-W28')).toBe(2026 * 12 + 7);
    expect(es.periodToMonthIndex('2026-W53')).toBe(es.periodToMonthIndex('2027-W01'));
  });

  it('bounds a weekly request in weeks', () => {
    // `2000W01` answers HTTP 400 from Eurostat and `2000-W01` answers 200,
    // measured against demo_r_mwk_ts. A bare year is also accepted, which is
    // why the absence of this branch was invisible.
    const year = new Date().getFullYear() - 5;
    expect(es.sincePeriod('W', 5)).toBe(`${year}-W01`);
    expect(es.sincePeriod('W', 5)).toMatch(/^\d{4}-W01$/);
  });
});

describe('the age of a weekly observation', () => {
  it('is measured to the week, not rounded to the month', () => {
    // The live figures on the day this was written: Latvia had filed 2026-W28
    // and Estonia and Lithuania 2026-W27, a week apart. A month index reports
    // the same age for both and understates each by about a third.
    expect(es.monthsSincePeriod('2026-W28', NOW)).toBeCloseTo(1.53, 2);
    expect(es.monthsSincePeriod('2026-W27', NOW)).toBeCloseTo(1.76, 2);

    // Distinguishable at all, which the month path could not manage: both
    // weeks end in July.
    expect(es.monthsSincePeriod('2026-W27', NOW))
      .toBeGreaterThan(es.monthsSincePeriod('2026-W28', NOW));
  });

  it('leaves the calendar grid on whole months, exactly as before', () => {
    // The companion to the case above. Precision was added for sub-month
    // labels only; making the month grid exact too would have moved every
    // existing verdict slightly, in the loosening direction, for no gain.
    expect(es.monthsSincePeriod('2026-07', NOW)).toBe(1);
    expect(es.monthsSincePeriod('2025-12', NOW)).toBe(8);
    expect(es.monthsSincePeriod('2026-Q2', NOW)).toBe(2);
    expect(es.monthsSincePeriod('2025-S2', NOW)).toBe(8);
    // Negative while the period is still open, which is normal rather than
    // suspicious: `earn_mw_cur` carries 2026-S2 today because a minimum wage
    // is legislated before it takes effect.
    expect(es.monthsSincePeriod('2026', NOW)).toBe(-4);
  });

  it('has an allowance of its own rather than inheriting the annual default', () => {
    expect(es.MAX_AGE_MONTHS.W).toBe(3);

    // What it would have been without the rung. `maxAgeMonths` falls through
    // `|| 30` for a frequency the table does not know, so the gate would have
    // tolerated thirty months — about 130 missing weekly observations — on a
    // series that publishes 52 a year.
    expect(es.maxAgeMonths({ freq: 'W' })).toBe(3);
    expect(es.maxAgeMonths({ freq: 'not-a-frequency' })).toBe(30);
  });

  it('judges the real lag comfortably and a freeze not at all', () => {
    const allowed = es.maxAgeMonths({ freq: 'W' });
    expect(es.monthsSincePeriod('2026-W28', NOW)).toBeLessThanOrEqual(allowed);

    // Sixteen weeks of silence on a weekly feed is a freeze, and this is the
    // assertion that says so. Under the annual fallback it would have passed.
    expect(es.monthsSincePeriod('2026-W12', NOW)).toBeGreaterThan(allowed);
  });
});

describe('freshness reads a weekly period in weeks', () => {
  it('answers in cadence units rather than in quantised months', () => {
    // Before `periodToMonthIndex` learned the label this returned null and the
    // verdict was an honest `unknown`. Teaching it the label without teaching
    // `ageInUnits` the precision would have replaced that with a number 36%
    // too small — the worse of the two failures, because it is confident.
    const weeks = freshness.ageInUnits('W', { period: '2026-W28' }, NOW);
    expect(weeks).toBeCloseTo(6.65, 1);

    // What the month path would have said: 1 month of 30.44 days is 4.35
    // weeks, and the observation is 46.6 days old.
    expect(weeks).toBeGreaterThan(5);
  });

  it('leaves month-grid labels exactly where they were', () => {
    expect(freshness.ageInUnits('M', { period: '2025-Q4' }, NOW)).toBeCloseTo(8, 5);
    expect(freshness.ageInUnits('Q', { period: '2025-Q4' }, NOW)).toBeCloseTo(8 / 3, 5);
  });

  it('calls a frozen weekly feed stale', () => {
    const check = { cadence: 'W', maxLag: 8 };
    expect(freshness.judge(check, { period: '2026-W28' }, NOW).state).toBe('fresh');
    expect(freshness.judge(check, { period: '2026-W12' }, NOW).state).toBe('stale');
  });

  it('reads one month, in one place', () => {
    // The average month was written twice — here and in eurostat.js — as the
    // same literal with nothing comparing them.
    expect(freshness.UNIT_MS.M).toBe(es.AVG_MONTH_MS);
    expect(freshness.UNIT_MS.W).toBe(es.WEEK_MS);
  });
});

describe('no two indicator definitions issue the same request', () => {
  /**
   * The failure this prevents shipped once, on the newsroom side, and every
   * editorial gate passed while it did: five articles carried real Eurostat
   * figures attached to metrics they did not measure, including a piece
   * headlined "business bankruptcy declarations" carrying the *registrations*
   * value. The contract protects figures, not subjects.
   *
   * `sts_cobp_q` now backs three definitions differing only in `cpa2_1`, and
   * `nrg_pc_202`/`nrg_pc_204`/`nrg_pc_205` are the same shape one dimension
   * over, so this is not a theoretical guard here.
   *
   * It asks `buildUrl` rather than restating what a key ought to contain,
   * because a guard that rebuilds the logic it guards is a second
   * implementation that can disagree with the first.
   */
  const GEOS = ['LV', 'EE', 'LT'];

  it('never builds one URL for two indicators', () => {
    const byUrl = new Map<string, string[]>();
    for (const [id, def] of entries) {
      const url = es.buildUrl(def, 5, GEOS);
      byUrl.set(url, [...(byUrl.get(url) ?? []), id]);
    }

    const collisions = [...byUrl.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([url, ids]) => `${ids.join(' = ')} → ${url}`);

    expect(
      collisions,
      'these definitions request identical data under different names, so anything ' +
        'keyed on the request serves one metric\u2019s payload under another\u2019s label'
    ).toEqual([]);
  });

  it('is looking at a registry that really does share cubes', () => {
    // Guard the guard. The assertion above passes trivially if every indicator
    // reads its own dataset — there would be nothing for a key to confuse. It
    // is only meaningful because several cubes are read several times.
    const perDataset = new Map<string, number>();
    for (const [, def] of entries) {
      perDataset.set(def.dataset, (perDataset.get(def.dataset) ?? 0) + 1);
    }
    const shared = [...perDataset.entries()].filter(([, n]) => n > 1);

    expect(shared.length, 'no cube is read twice, so the check above proves nothing')
      .toBeGreaterThan(3);
    expect(perDataset.get('sts_cobp_q'), 'the building permit composition').toBe(3);
  });

  it('separates the building permit composition by cpa2_1 alone', () => {
    // Residential and non-residential are the halves of the total. If any two
    // were served each other's payload the composition would be arithmetically
    // impossible and nothing else in the suite would notice.
    const permits = entries.filter(([id]) => id.startsWith('building_permits'));
    const codes = permits.map(([, def]) => /cpa2_1=([A-Z0-9_]+)/.exec(def.params)?.[1]);

    expect(codes.sort()).toEqual(['CPA_F41001', 'CPA_F41001_41002', 'CPA_F41002']);
    expect(new Set(permits.map(([, d]) => d.params)).size).toBe(3);
  });

  it('does not price gas off the emptiest code in its cube', () => {
    // `TOT_GJ` looks like the safe default and is the worst-covered code in
    // nrg_pc_202: measured across the twenty half-years to 2025-S2 it carries
    // LV=1, EE=1, LT=3 observations and stops at 2024-S1, while all three real
    // consumption bands carry 20 and reach 2025-S2. Same trap as TOT_KWH in
    // nrg_pc_205, one cube over — and the lesson is per-cube, since TOT_KWH in
    // nrg_pc_204 is complete and correctly used.
    expect(INDICATORS.gas_price_household.params).not.toContain('nrg_cons=TOT_GJ');
    expect(INDICATORS.gas_price_household.params).toMatch(/nrg_cons=GJ[\d_A-Z-]+/);
    // A band is not a total, so the title has to say which band.
    expect(INDICATORS.gas_price_household.title).toMatch(/GJ/);
  });

  it('does not use the building permit code that answers 200 with nothing', () => {
    // `indic_bt=PSQM` is the obvious guess. Measured 2026-08-28: HTTP 200,
    // zero observations across 42 quarters for all three countries, which is
    // indistinguishable from a working query on a quiet cube.
    const permits = entries.filter(([, def]) => def.dataset === 'sts_cobp_q');
    expect(permits.length).toBeGreaterThan(0);
    for (const [id, def] of permits) {
      expect(def.params, `${id} uses PSQM, which returns no data`).not.toContain('indic_bt=PSQM');
      expect(def.params).toContain('indic_bt=BPRM_SQM');
    }
  });
});
