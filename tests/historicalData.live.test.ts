/**
 * Contract test: every Latvian indicator /api/historical-data advertises still
 * resolves to a current series.
 *
 * This registry had no live test at all, and it is the one with the quietest
 * failure mode in the app. When a source produces nothing the endpoint answers
 * HTTP 200 with `series: []` and the error tucked into a field nobody reads, so
 * a dead indicator renders as a blank card rather than as an outage.
 *
 * Staleness was quieter still. CSP's unemployment table stopped at 2025M12 and
 * kept answering successfully for eight months. The series was non-empty, so
 * the Eurostat fallback — already wired, already fresh, sitting in the same
 * process — never fired, because the only question ever asked was "is there
 * data" and never "is it from this year".
 *
 * The test drives the real handler rather than the deployed site: it is the
 * indicator *definitions* that rot, and they rot whether or not a deployment
 * happened. Each call gets its own client IP so the shared per-IP rate limiter
 * cannot turn a 24-indicator sweep into a cascade of 429s.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const handler = require_('../api/historical-data/index.js');
const es = require_('../api/shared/eurostat.js');

/** Every id the endpoint advertises, and the dashboard renders a card for. */
const INDICATORS = [
  'gdp', 'salary', 'cpi', 'unemployment', 'house_prices', 'retail_sales',
  'industrial', 'population', 'hotel_occupancy', 'tourist_arrivals',
  'gov_revenue', 'gov_debt', 'exports', 'imports', 'biz_confidence',
  'construction_output', 'new_vehicles', 'wages_industry', 'wages_it',
  'energy_price_gas', 'building_permits', 'renewable_share', 'ppi',
  'trade_balance',
];

type Point = { period: string; value: number | null };
type Body = {
  indicator: string;
  source: string;
  series: Point[];
  error?: string;
  freshness: { period: string; age: number; cadence: string; allowed: number; stale: boolean } | null;
};

async function call(indicator: string): Promise<Body> {
  const context: { res?: { status: number; body: string } } = {};
  await handler(context, {
    query: { indicator },
    headers: { 'x-forwarded-for': `test-${indicator}` },
  });
  expect(context.res?.status, `${indicator} did not produce a response`).toBe(200);
  return JSON.parse(context.res!.body) as Body;
}

describe('Latvian indicator contracts (live)', () => {
  it.each(INDICATORS)('%s resolves to a non-empty series', async (id) => {
    const body = await call(id);

    expect(
      body.series.length,
      `${id} came back empty from ${body.source}${body.error ? ` — ${body.error}` : ''}. ` +
        'The endpoint answers 200 for this, so it renders as a blank card rather than an outage.'
    ).toBeGreaterThan(0);

    const observed = body.series.filter((p) => p.value !== null);
    expect(observed.length, `${id} returned only nulls from ${body.source}`).toBeGreaterThan(0);
  }, 45_000);

  it.each(INDICATORS)('%s is still being published', async (id) => {
    const body = await call(id);

    expect(
      body.freshness,
      `${id} served a series whose period labels could not be dated, so nothing can ` +
        'tell whether it is current'
    ).not.toBeNull();

    const { period, age, cadence, allowed, stale } = body.freshness!;
    expect(
      stale,
      `${id} has not advanced past ${period} — about ${age} months ago, against a ` +
        `${allowed}-month allowance for ${cadence}-frequency data, and it is being served ` +
        `from ${body.source}. Either the national table has stopped (give it an ` +
        'eurostatFallback) or the fallback is stale too.'
    ).toBe(false);
  }, 45_000);

  it('serves unemployment from a source that is still publishing', async () => {
    // The regression this failover exists for. CSP NBB150m froze at 2025M12;
    // Eurostat une_rt_m kept going. Asserted as behaviour rather than as
    // configuration, so it stays true whichever provider is ahead today.
    const body = await call('unemployment');
    expect(body.freshness).not.toBeNull();
    expect(body.freshness!.stale).toBe(false);
    expect(es.monthsSincePeriod(body.freshness!.period, new Date())).toBeLessThanOrEqual(
      es.MAX_AGE_MONTHS.M
    );

    const latest = body.series.filter((p) => p.value !== null).pop();
    // An unemployment rate, whoever supplied it.
    expect(latest!.value).toBeGreaterThan(0);
    expect(latest!.value).toBeLessThan(30);
  }, 45_000);

  it('rejects an indicator it does not serve', async () => {
    const context: { res?: { status: number; body: string } } = {};
    await handler(context, { query: { indicator: 'unicorn' }, headers: { 'x-forwarded-for': 'test-unicorn' } });
    expect(context.res?.status).toBe(400);
  }, 30_000);
});
