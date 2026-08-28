/**
 * Contract test: every indicator definition still returns real data.
 *
 * This is the test whose absence let nine charts ship empty and three ship
 * mislabelled. Eurostat retires and rebases codes without notice — CLV10_EUR_HAB
 * disappeared when chain-linked volumes were rebased to 2020, BS-CSMCI-BAL was
 * split into an indicator and a unit, JOBRATE became JVR — and each of those
 * still returns HTTP 200 with a structurally valid, entirely empty cube. Only a
 * call to the live API can tell the difference.
 *
 * Two assertions per indicator, and both matter:
 *
 *   - points > 0 catches a retired code.
 *   - the latest value inside the declared `sanity` band catches the quieter
 *     failure, where a definition names a real dataset that measures something
 *     else. "Income inequality (Gini)" was sourced from a balance-of-payments
 *     table and rendered 8.9 for Latvia; a Gini index cannot be 8.9, and the
 *     [20, 45] band says so.
 *
 * A third assertion was added after both of those passed for eight months on a
 * dataset that had stopped moving: when HICP migrated to ECOICOP ver.2, the
 * ver.1 tables kept serving well-formed, in-band, fully pinned values from
 * 2025-12 and never advanced again. Freshness is the only property that
 * distinguishes a live series from a fossil.
 *
 * It lives in the live suite because it depends on Eurostat being reachable,
 * and a gate that red-lights a correct pull request because a European
 * statistics API was slow teaches people to bypass gates.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { measureReferenceScale, MIN_AXIS_RETENTION } from '../src/utils/referenceScale';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js');
const es = require_('../api/shared/eurostat.js');
const compare = require_('../api/baltic-compare/index.js');

type IndicatorDef = {
  dataset: string;
  params: string;
  freq: 'A' | 'S' | 'Q' | 'M' | 'W';
  title: string;
  unit: string;
  sanity: [number, number];
  maxAgeMonths?: number;
};

type Point = { period: string; value: number | null };

const GEOS = ['LV', 'EE', 'LT'];

/**
 * How many of the newest observations must be contiguous.
 *
 * Eight covers two years of quarterly data and four years of half-yearly, which
 * is where the sparse-pin defect actually lives. It is weakest on annual
 * indicators, where a five-year window leaves as few as three observations to
 * look at — a real limitation, and the reason this is a floor rather than a
 * proof.
 */
const RECENT_RUN = 8;

/**
 * One step between consecutive periods, in the frequency's **own** unit:
 * weeks for `W`, months for everything else.
 *
 * It was months for all of them until a weekly series arrived, and months
 * cannot express a week — four or five of them share a month index, so the
 * modal step for a healthy weekly cube computes as **0**. Writing `W: 0` would
 * have made this pass while asserting nothing, which is the failure mode this
 * whole file exists to avoid. `periodStep` below reads the series in the unit
 * the definition declares instead.
 *
 * Two units means two of these numbers are `1` meaning different things, and
 * that collision is not hypothetical: a plant declaring `demo_r_mwk_ts` as
 * `freq: 'M'` passed this check, because its weekly labels stepped by 1 week
 * and `EXPECTED_STEP.M` is 1 month. `theCadenceOfTheLabels` closes it by
 * pinning the granularity before the step is ever measured.
 *
 * Keyed on the union rather than on `string`, so adding a frequency fails the
 * compiler here instead of silently yielding `undefined` and demanding a
 * `maxAgeMonths` override for every series that carries it. The runtime list
 * lives in `api/shared/eurostat.js` and `tests/indicators.test.ts` asserts the
 * two agree; this is the type-level half of the same partition.
 */
const EXPECTED_STEP: Record<IndicatorDef['freq'], number> = { W: 1, M: 1, Q: 3, S: 6, A: 12 };

/**
 * A period's ordinal in the unit the *definition* declares.
 *
 * Deliberately driven by `def.freq` rather than by the shape of the label. If
 * it read the label, a cube whose granularity disagrees with its declaration
 * would be measured in its own unit and silently agree with the wrong
 * expectation.
 */
function periodStep(period: string, freq: IndicatorDef['freq']): number | null {
  return freq === 'W' ? es.periodToWeekIndex(period) : es.periodToMonthIndex(period);
}

const entries = Object.entries(INDICATORS) as [string, IndicatorDef][];

describe('Eurostat indicator contracts (live)', () => {
  it.each(entries)('%s returns plausible data for all three countries', async (id, def) => {
    // The request the handler makes, asked of the handler rather than restated.
    // A probe that rebuilds the query it is checking is a second implementation
    // that can disagree with the first — which is how the maritime status check
    // came to watch one Latvian port while the app read four.
    const wantReference: boolean = compare.referenceIsComparable(def);
    const requested = wantReference ? [...GEOS, compare.REFERENCE_GEO] : GEOS;

    const url = es.buildUrl(def, 5, requested);
    const raw = await es.httpJson(url, { deadlineMs: 30_000 });
    const parsed = es.parseJsonStat(raw, requested);

    // An unpinned dimension means the parser chose a slice on our behalf. The
    // choice may even be right, but nobody declared it — pin it in
    // api/shared/indicators.js instead.
    expect(
      parsed.assumptions,
      `${id} (${def.dataset}) left a dimension unpinned: ` +
        parsed.assumptions.map((a: { dimension: string; chosen: string }) => `${a.dimension}=${a.chosen}`).join(', ')
    ).toEqual([]);

    for (const geo of GEOS) {
      const series: Point[] = parsed.countries[geo]?.series ?? [];
      const points = series.filter((p) => p.value !== null);

      expect(
        points.length,
        `${id} (${def.dataset}?${def.params}) returned no data for ${geo} — the query is valid but empty, ` +
          'which is what a retired Eurostat code looks like'
      ).toBeGreaterThan(0);

      const latest = points[points.length - 1];
      expect(
        latest.value,
        `${id} latest value for ${geo} is ${latest.value} at ${latest.period}, outside the plausible range ` +
          `[${def.sanity[0]}, ${def.sanity[1]}] for "${def.title}" (${def.unit}) — the dataset probably ` +
          'measures something other than the label claims'
      ).toBeGreaterThanOrEqual(def.sanity[0]);
      expect(latest.value).toBeLessThanOrEqual(def.sanity[1]);

      // The body of the series, not its tip.
      //
      // Every assertion above reads the newest observation, and #141 found a
      // definition where that was the only populated one worth having:
      // `elec_price_industry` pinned `TOT_KWH`, the *emptiest* code in
      // nrg_pc_205, carrying LV=3 EE=9 LT=4 of ten half-years while all six
      // numbered consumption bands carried 10/10/10. The newest period was
      // populated for all three, so the sanity band passed, the freshness check
      // passed, and this file was green — while the chart drew Latvia from
      // three points in ten beside a nearly complete Estonia, which a reader
      // parses as Latvia having stopped reporting.
      //
      // Coverage across the window is a third question, separate from liveness
      // and from freshness, and this is the only assertion that asks it.
      //
      // It reads back from each country's *own* last observation, so a slower
      // statistics office is not penalised, and it ignores anything before that
      // country's first observation — Estonia genuinely began reporting
      // long-term interest rates seventeen months into the window, and a
      // leading gap is data rather than a defect.
      //
      // What it does not tolerate is a hole *between* two real readings, which
      // is the signature of a pin selecting a code the country does not
      // populate. Against the pre-#141 definition this reports 5 holes in the
      // newest 8 for both Latvia and Lithuania and none for Estonia — and that
      // asymmetry is exactly why nobody saw it.
      const last = series.reduce((best, p, i) => (p.value !== null ? i : best), -1);
      const window = series.slice(Math.max(0, last - RECENT_RUN + 1), last + 1);
      const holes = window.filter((p) => p.value === null);

      expect(
        holes.map((p) => p.period),
        `${id} (${def.dataset}?${def.params}) has gaps inside ${geo}'s most recent ` +
          `${window.length} observations. A country that started late leaves a leading gap, which is data; ` +
          'a hole between two real readings usually means the pinned code is one this country barely ' +
          'populates, while a sibling code measuring the same thing is complete. The test worth running ' +
          'is whether repinning fixes it without changing what the number means.'
      ).toEqual([]);
    }

    // Freshness is measured on the country that is furthest ahead: one national
    // statistics office reporting late is normal, all three stopping at the same
    // period is a dataset Eurostat has retired in place.
    const newest = GEOS
      .map((geo) => {
        const points = (parsed.countries[geo]?.series ?? []).filter((p: Point) => p.value !== null);
        return points.length ? points[points.length - 1].period : null;
      })
      .filter((p): p is string => p !== null)
      .reduce<string | null>(
        // Compared in the series' own unit. A month index cannot order two
        // weeks inside one month, and `demo_r_mwk_ts` is exactly that case:
        // Latvia files a week ahead of Estonia and Lithuania, so on a month
        // index LV 2026-W28 and EE 2026-W27 are indistinguishable and which
        // one is called newest depends on iteration order.
        (best, p) => (best === null || (periodStep(p, def.freq) ?? -Infinity) > (periodStep(best, def.freq) ?? -Infinity) ? p : best),
        null
      );

    expect(newest, `${id} produced no datable period`).not.toBeNull();
    const age = es.monthsSincePeriod(newest, new Date());
    expect(age, `${id} returned an unparseable period label "${newest}"`).not.toBeNull();

    const allowed = es.maxAgeMonths(def);
    expect(
      age,
      `${id} (${def.dataset}) has not advanced past ${newest} — about ${(age as number).toFixed(1)} months ago, ` +
        `against a ${allowed}-month allowance for ${def.freq}-frequency data. Every other assertion here passes, ` +
        'which is exactly what a dataset that has been frozen in place looks like: check whether Eurostat ' +
        'has migrated it to a successor table, as it did moving HICP to ECOICOP ver.2.'
    ).toBeLessThanOrEqual(allowed);

    // Does it publish at the cadence it declares?
    //
    // `freq` is the cube's *dimension code*, and everything downstream — the
    // allowance just above, the since-bound in `buildUrl` — reads it as a
    // publication cadence. For seventy of seventy-one those are the same
    // thing. `sdg_04_70` says A and publishes every twenty-four months, with
    // no 2022 or 2024 coordinate in the cube at all.
    //
    // **The contiguity assertion above cannot see this**, and is right not to:
    // there is no null to find, because the missing period is not represented.
    // The two checks catch different shapes and neither subsumes the other —
    // that one catches a pin selecting a code a country barely populates, this
    // one catches a cadence the definition does not actually have. The
    // newsroom reached the same conclusion from the prose side on the same day.
    //
    // The rule is not an exception list. An off-cadence series must carry an
    // explicit `maxAgeMonths`, so **the override is the declaration**: a
    // definition that publishes off its stated frequency has to say so in the
    // one field that makes the freshness check correct anyway.
    const labels: string[] = (parsed.countries.LV?.series ?? []).map((p: Point) => p.period);

    // Is the cube even published at the granularity the definition claims?
    //
    // This has to come first, because the step comparison below is measured in
    // the unit `freq` names — and `EXPECTED_STEP` holds a 1 for weeks and a 1
    // for months, so a weekly cube declared monthly steps by "1" and agrees
    // with the wrong expectation. Planted and confirmed: `weekly_deaths` with
    // `freq: 'M'` passed every other assertion in this file.
    //
    // `periodCadence` reads the label's own shape, which is the one thing a
    // definition cannot misdeclare, and everything downstream — the since-bound
    // in `buildUrl`, the freshness allowance, the step below — reads `freq`.
    const labelCadence = labels.map((p) => es.periodCadence(p)).filter(Boolean);
    if (labelCadence.length > 0) {
      const shape = [...new Set(labelCadence)].sort().join('/');
      expect(
        shape,
        `${id} (${def.dataset}) declares freq=${def.freq} but its period labels are ${shape}-shaped ` +
          `(${labels.slice(-2).join(', ')}). Everything downstream reads freq as the granularity: the ` +
          'since-bound sent to Eurostat, the staleness allowance, and the cadence check just below. A ' +
          'mismatch makes all three answer a question about a different unit of time.'
      ).toBe(def.freq);
    }

    const months = labels.map((p) => periodStep(p, def.freq)).filter((n): n is number => n !== null);

    if (months.length >= 3) {
      const steps: number[] = [];
      for (let i = 1; i < months.length; i += 1) steps.push(months[i] - months[i - 1]);

      const tally = new Map<number, number>();
      for (const step of steps) tally.set(step, (tally.get(step) ?? 0) + 1);
      const modal = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

      if (modal !== EXPECTED_STEP[def.freq]) {
        expect(
          typeof (def as { maxAgeMonths?: number }).maxAgeMonths,
          `${id} (${def.dataset}) declares freq=${def.freq}, which everything downstream reads as ` +
            `${EXPECTED_STEP[def.freq]} ${def.freq === 'W' ? 'week(s)' : 'months'}, but Eurostat publishes it ` +
            `every ${modal}. That is not ` +
            'necessarily wrong — freq is the cube\u2019s dimension code and the query may well need it — ' +
            'but the freshness allowance is then computed from a cadence the series does not have, and ' +
            'it will read a healthy gap as a freeze. Declare an explicit maxAgeMonths covering the real ' +
            'publication interval, with the measurement in a comment.'
        ).toBe('number');
      }
    }

    // Does the benchmark this indicator claims to support actually fit?
    //
    // `euAggregation` is a hand-written classification of sixty-six indicators,
    // and every check above would pass whether or not it is true of any of
    // them: the EU slice is a different geography, so a mis-declaration shows
    // up in none of the sanity, coverage, freshness or cadence assertions. What
    // it shows up in is the rendered chart, where a benchmark one to two orders
    // of magnitude away prices the axis in EU units and presses the three into
    // a single line along the bottom — measured at 0.2% of the axis for
    // tourist arrivals, which is what a reader reported as "useless".
    //
    // So the declaration is held against the property it stands for, using the
    // same function the chart uses. A `sum` declared `average` fails here, by
    // name, with the number.
    if (wantReference) {
      const eu: Point[] = parsed.countries[compare.REFERENCE_GEO]?.series ?? [];
      const three = GEOS.flatMap((geo) => (parsed.countries[geo]?.series ?? []).map((p: Point) => p.value));
      const scale = measureReferenceScale(three, eu.map((p) => p.value));

      // A cube that carries no EU figure at all is not a fault — `minimum_wage`
      // has none because not every member state has one — and `buildReference`
      // already returns null for it, so there is no line to withhold.
      if (scale !== null) {
        expect(
          scale.retention,
          `${id} (${def.dataset}) declares euAggregation=average, but its EU27 series leaves the three ` +
            `only ${(scale.retention * 100).toFixed(1)}% of the y-axis they would have alone — ` +
            `LV/EE/LT span ${scale.bandWith < 0.01 ? '<1' : (scale.bandWith * 100).toFixed(1)}% of the ` +
            'drawn range once it is added. That is the signature of a sum containing the three rather ' +
            'than an average beside them. The chart withholds the line at runtime, so nothing is ' +
            'mis-drawn; the declaration is what needs correcting.'
        ).toBeGreaterThanOrEqual(MIN_AXIS_RETENTION);
      }
    }
  }, 45_000);
});

describe('non-Eurostat sources (live)', () => {
  it('data.gov.lv answers the CKAN action we actually call', async () => {
    // `site_read` was removed from the portal; it returns HTTP 400 with
    // "Action name not known" and was recorded as an outage for months.
    const res = await fetch('https://data.gov.lv/dati/api/3/action/status_show');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
  }, 30_000);

  it('Elering returns every Baltic bidding zone in one response', async () => {
    // The power-market card computes a spread across zones; it needs them all
    // from a single call or the intervals will not line up.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const res = await fetch(
      'https://dashboard.elering.ee/api/nps/price' +
        `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    for (const zone of ['ee', 'lv', 'lt', 'fi']) {
      expect(Array.isArray(body.data?.[zone]), `Elering is missing zone ${zone}`).toBe(true);
      expect(body.data[zone].length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('CSP PxWeb serves its catalogue root quickly', async () => {
    // The health check used to POST an empty query here, which materialises a
    // whole table and took 13 seconds to answer "are you up".
    const started = Date.now();
    const res = await fetch('https://data.stat.gov.lv/api/v1/en/OSP_PUB');
    expect(res.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});

describe('indicators that share a cube return different data (live)', () => {
  /**
   * The strongest available check that a cache or a query is not confusing two
   * definitions of the same cube, because it is arithmetic rather than a
   * comparison against a remembered number.
   *
   * `trade_balance`, `goods_balance` and `services_balance` all read
   * `bop_c6_q`, differing only in their `bop_item` parameter, and goods plus
   * services must equal the total by construction. If any two were served each
   * other's payload — the newsroom collector's failure, where a params-blind
   * cache key made three articles carry one figure under three names — this
   * identity breaks immediately, while every individual value still looks
   * entirely plausible.
   */
  async function latestFor(indicator: string, geo: string): Promise<number> {
    const def = (INDICATORS as Record<string, IndicatorDef>)[indicator];
    const url = es.buildUrl(def, 3, [geo]);
    const raw = await es.httpJson(url, { deadlineMs: 20_000, retries: 1 });
    const parsed = es.parseJsonStat(raw, [geo]);
    const series = (parsed.countries[geo]?.series ?? [])
      .filter((p: { value: number | null }) => p.value !== null);
    expect(series.length, `${indicator} returned no values for ${geo}`).toBeGreaterThan(0);
    return series[series.length - 1].value as number;
  }

  it('reconciles goods and services against the trade balance', async () => {
    for (const geo of ['LV', 'EE', 'LT']) {
      const [total, goods, services] = await Promise.all([
        latestFor('trade_balance', geo),
        latestFor('goods_balance', geo),
        latestFor('services_balance', geo),
      ]);

      // Rounding in million-euro units, not a tolerance for being wrong: a
      // collision would put these hundreds or thousands apart.
      expect(Math.abs(goods + services - total),
        `${geo}: goods ${goods} + services ${services} should equal trade balance ${total}`)
        .toBeLessThan(Math.max(5, Math.abs(total) * 0.02));
    }
  }, 60_000);

  it('does not serve two same-cube indicators one identical series', async () => {
    // `road_freight` and `road_freight_tkm` differ by nothing but `unit`, and
    // confusing them puts Latvia's rail share of freight at about 4% rather
    // than 18.9% — a chart that looks fine and says the opposite.
    const tonnes = await latestFor('road_freight', 'LV');
    const tonneKm = await latestFor('road_freight_tkm', 'LV');
    expect(tonnes).not.toBe(tonneKm);
  }, 60_000);
});
