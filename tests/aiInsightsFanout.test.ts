/**
 * Proves /api/ai-insights fans its upstream calls out in parallel.
 *
 * Why this test exists
 * --------------------
 * The four upstream calls (Elering, ECB, Open-Meteo air, Open-Meteo weather)
 * used to be awaited one after another, each with its own 10-15s timeout, so
 * the worst case was the SUM of those timeouts (~55s) rather than the longest
 * one. That is what made the endpoint intermittently exceed the 15s budget in
 * tests/api-contracts.test.ts against production.
 *
 * The test asserts elapsed time is close to the SLOWEST stub rather than their
 * total. It is written to FAIL against the sequential implementation: with four
 * 300ms stubs, sequential takes ~1200ms and parallel ~300ms, so the 700ms
 * ceiling sits unambiguously between the two. A test that merely asserted "it
 * returns insights" would have passed before the fix and after it, and proved
 * nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';

const STUB_DELAY_MS = 300;
const UPSTREAM_COUNT = 4;

/** Minimal stand-in for the IncomingMessage the handler consumes. */
function fakeResponse(body) {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.resume = () => {};
  setTimeout(() => {
    res.emit('data', body);
    res.emit('end');
  }, 0);
  return res;
}

function bodyFor(url) {
  if (url.includes('elering')) {
    const ts = Math.floor(Date.now() / 1000);
    return JSON.stringify({ data: { lv: [{ timestamp: ts, price: 42 }], ee: [{ timestamp: ts, price: 42 }] } });
  }
  if (url.includes('ecb.europa.eu')) {
    return "<Cube currency='USD' rate='1.0850'/>";
  }
  if (url.includes('air-quality')) {
    return JSON.stringify({ current: { european_aqi: 20, pm2_5: 4.2 } });
  }
  return JSON.stringify({ current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 1 } });
}

describe('ai-insights upstream fan-out', () => {
  let handler;
  let started;

  beforeEach(async () => {
    started = [];
    vi.spyOn(https, 'get').mockImplementation((url, _opts, cb) => {
      started.push({ url, at: Date.now() });
      const req = new EventEmitter();
      req.destroy = () => {};
      setTimeout(() => cb(fakeResponse(bodyFor(url))), STUB_DELAY_MS);
      return req;
    });
    const mod = await import('../api/ai-insights/index.js');
    handler = mod.default || mod;
  });

  afterEach(() => vi.restoreAllMocks());

  it('issues all upstream requests before any response is awaited', async () => {
    const context = {};
    await handler(context, { query: { country: 'lv' } });

    expect(started).toHaveLength(UPSTREAM_COUNT);

    // If the calls were sequential, each would start roughly STUB_DELAY_MS
    // after the previous one. Parallel dispatch means they all start together.
    const first = started[0].at;
    const spread = Math.max(...started.map((s) => s.at)) - first;
    expect(spread).toBeLessThan(STUB_DELAY_MS);
  });

  it('completes in about the slowest upstream, not the sum of them', async () => {
    const begin = Date.now();
    await handler({}, { query: { country: 'lv' } });
    const elapsed = Date.now() - begin;

    // Sequential would be ~1200ms for four 300ms stubs; parallel ~300ms.
    expect(elapsed).toBeLessThan(STUB_DELAY_MS * (UPSTREAM_COUNT - 1));
  });

  it('still degrades one insight at a time when a single upstream fails', async () => {
    vi.restoreAllMocks();
    vi.spyOn(https, 'get').mockImplementation((url, _opts, cb) => {
      const req = new EventEmitter();
      req.destroy = () => {};
      if (url.includes('elering')) {
        setTimeout(() => req.emit('error', new Error('upstream down')), 10);
        return req;
      }
      setTimeout(() => cb(fakeResponse(bodyFor(url))), 10);
      return req;
    });
    const mod = await import('../api/ai-insights/index.js');
    const h = mod.default || mod;

    const context = {};
    await h(context, { query: { country: 'lv' } });

    expect(context.res.status).toBe(200);
    const payload = JSON.parse(context.res.body);
    // The other three sources still produce insights; only electricity is lost.
    expect(payload.insights.length).toBeGreaterThan(0);
    expect(payload.insights.some((i) => i.headline.includes('Electricity'))).toBe(false);
  });
});
