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
  maxAgeMonths?: number;
};

type Point = { period: string; value: number | null };

const GEOS = ['LV', 'EE', 'LT'];
const entries = Object.entries(INDICATORS) as [string, IndicatorDef][];

describe('Eurostat indicator contracts (live)', () => {
  it.each(entries)('%s returns plausible data for all three countries', async (id, def) => {
    const url = es.buildUrl(def, 5, GEOS);
    const raw = await es.httpJson(url, { deadlineMs: 30_000 });
    const parsed = es.parseJsonStat(raw, GEOS);

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
        (best, p) => (best === null || es.periodToMonthIndex(p) > es.periodToMonthIndex(best) ? p : best),
        null
      );

    expect(newest, `${id} produced no datable period`).not.toBeNull();
    const age = es.monthsSincePeriod(newest, new Date());
    expect(age, `${id} returned an unparseable period label "${newest}"`).not.toBeNull();

    const allowed = es.maxAgeMonths(def);
    expect(
      age,
      `${id} (${def.dataset}) has not advanced past ${newest} — about ${age} months ago, against a ` +
        `${allowed}-month allowance for ${def.freq}-frequency data. Every other assertion here passes, ` +
        'which is exactly what a dataset that has been frozen in place looks like: check whether Eurostat ' +
        'has migrated it to a successor table, as it did moving HICP to ECOICOP ver.2.'
    ).toBeLessThanOrEqual(allowed);
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
