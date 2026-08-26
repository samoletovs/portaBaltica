/**
 * Two endpoints that answered confidently with things they did not know.
 *
 * `/api/power-prices` fetched two days and described them as one. The window is
 * correct and deliberate — "day-ahead" means tomorrow, and Nord Pool publishes
 * it around 13:00 CET — but every aggregate on top of it spanned both days
 * while the card said "today". Measured live: 184 intervals across 2026-08-26
 * and 2026-08-27, reported as "52% of intervals decoupled today" when today is
 * 96 of them. Elering also moved to 15-minute resolution, so `totalIntervals`
 * quietly stopped meaning hours.
 *
 * `/api/environment-data` invented readings. A failed air-quality fetch
 * returned `status: 'good', label: 'Good'` with three zeroes — a clean-air
 * reading manufactured from a request that never completed, rendered in the
 * same green as a real one.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Elering's shape: unix-second timestamps per bidding zone. */
function eleringPayload(intervals: { ts: number; ee: number; lv: number; lt: number }[]) {
  const zone = (id: 'ee' | 'lv' | 'lt') =>
    intervals.map(i => ({ timestamp: i.ts, price: i[id] }));
  return { success: true, data: { ee: zone('ee'), lv: zone('lv'), lt: zone('lt'), fi: zone('ee') } };
}

/** Midnight UTC today, which is where the endpoint's own window starts. */
function midnightUtc(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

async function callPowerPrices(payload: unknown) {
  const es = require('../api/shared/eurostat.js');
  const original = es.httpJson;
  es.httpJson = async () => payload;
  try {
    delete require.cache[require.resolve('../api/power-prices/index.js')];
    const handler = require('../api/power-prices/index.js');
    const ctx: { res?: { body: string } } = {};
    await handler(ctx, { query: {}, headers: {} });
    return JSON.parse(ctx.res!.body);
  } finally {
    es.httpJson = original;
  }
}

describe('power prices, across a two-day window', () => {
  const t0 = midnightUtc();
  const HOUR = 3600;

  it('counts decoupling over today, not over today plus tomorrow', async () => {
    // Today: 2 of 2 intervals coupled. Tomorrow: 2 of 2 decoupled. Reported
    // across both days that is 50%; the honest answer for "today" is 0%.
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 40, lv: 40, lt: 40 },
      { ts: t0 + HOUR, ee: 41, lv: 41, lt: 41 },
      { ts: t0 + 24 * HOUR, ee: 90, lv: 40, lt: 65 },
      { ts: t0 + 25 * HOUR, ee: 95, lv: 42, lt: 70 },
    ]));

    expect(body.totalIntervals, 'today only').toBe(2);
    expect(body.decoupledIntervals).toBe(0);
    expect(body.tomorrowOutlook.totalIntervals).toBe(2);
    expect(body.tomorrowOutlook.decoupledIntervals).toBe(2);
  });

  it('keeps both days in the series, because day-ahead is the point', async () => {
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 40, lv: 40, lt: 40 },
      { ts: t0 + 24 * HOUR, ee: 90, lv: 40, lt: 65 },
    ]));

    expect(body.series).toHaveLength(2);
    expect(new Set(body.series.map((s: { day: string }) => s.day)).size).toBe(2);
  });

  it('names the day every "today" figure describes', async () => {
    // So the client never infers it from the server's clock, and so a label
    // like 00:00 can be attributed to the right date.
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 40, lv: 40, lt: 40 },
      { ts: t0 + 24 * HOUR, ee: 90, lv: 40, lt: 65 },
    ]));

    const today = new Date(t0 * 1000).toISOString().slice(0, 10);
    expect(body.today).toBe(today);
    expect(body.tomorrow).not.toBe(today);
    expect(body.series[0].day).toBe(today);
  });

  it('scopes each zone range to today and reports tomorrow separately', async () => {
    // The range under a zone said "today" while spanning both days, so a calm
    // day beside a volatile tomorrow showed a range neither of them had.
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 40, lv: 40, lt: 40 },
      { ts: t0 + HOUR, ee: 50, lv: 50, lt: 50 },
      { ts: t0 + 24 * HOUR, ee: 200, lv: 200, lt: 200 },
    ]));

    const lv = body.zones.find((z: { id: string }) => z.id === 'lv');
    expect(lv.min).toBe(40);
    expect(lv.max, 'tomorrow must not widen today').toBe(50);
    expect(lv.tomorrow.max).toBe(200);
  });

  it('says tomorrow is unpublished rather than implying a quiet day', async () => {
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 40, lv: 40, lt: 40 },
    ]));

    expect(body.tomorrow).toBeNull();
    expect(body.tomorrowOutlook).toBeNull();
    const lv = body.zones.find((z: { id: string }) => z.id === 'lv');
    expect(lv.tomorrow).toBeNull();
  });

  it('keeps the widest spread inside the day it is attributed to', async () => {
    const body = await callPowerPrices(eleringPayload([
      { ts: t0, ee: 45, lv: 40, lt: 42 },
      { ts: t0 + 24 * HOUR, ee: 300, lv: 40, lt: 100 },
    ]));

    // The 260 spread belongs to tomorrow and must not be reported as today's.
    expect(body.widestSpread.spread).toBe(5);
    expect(body.tomorrowOutlook.widestSpread.spread).toBe(260);
  });
});
