/**
 * A guard whose false branch is a claim.
 *
 * This is a distinct shape from "absence rendered as a value by accident", and
 * it is worse, because the guard makes the code *look* defended. Every
 * `x ? real : fallback` where the fallback is a number rather than a dash has
 * it available.
 *
 * `fetchElectricityPrices` had two:
 *
 *   current: currentEntry ? currentEntry.price : 0     // no matching hour
 *   catch (e) { return { prices: [], current: 0 }; }   // the whole fetch failed
 *
 * **Zero is not an absurd electricity price.** Nord Pool clears at zero and
 * goes negative when the wind is up, and `EconomyTile` carries a "Negative
 * price" badge for exactly that — so a fabricated zero was indistinguishable
 * from a reading, and the dashboard printed "€0.00/MWh" as its headline figure
 * on the strength of a request that never completed. A NaN at least looks
 * broken; this looked like news.
 *
 * The catch is not theoretical: Elering was measured returning five consecutive
 * `HTTP 503 no available server` from its Cloudflare edge in one burst, then
 * twelve clean calls at 75-217ms.
 *
 * Every consumer already coped with `null` and always did — `EconomyTile` reads
 * it through `fixed()` and `DataTicker` through `finite()`. They were written
 * defensively and this one function was the only thing defeating them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Minimal stand-in for the IncomingMessage the handler consumes. */
function fakeResponse(body: string, statusCode = 200) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
  res.statusCode = statusCode;
  res.resume = () => {};
  setTimeout(() => { res.emit('data', body); res.emit('end'); }, 0);
  return res;
}

/** One priced interval, at the hour the handler will look for. */
function eleringPayload(opts: { includeCurrentHour: boolean; price?: number | null }) {
  const now = new Date();
  const rows = [];
  for (let h = 0; h < 24; h++) {
    // The handler matches on the host-local hour, so build the timestamps the
    // same way rather than assuming the host runs on UTC.
    const at = new Date(now);
    at.setHours(h, 0, 0, 0);
    if (!opts.includeCurrentHour && h === now.getHours()) continue;
    rows.push({
      timestamp: Math.floor(at.getTime() / 1000),
      // `??` would swallow an explicit null, which is the case under test.
      price: h === now.getHours()
        ? (opts.price === undefined ? 87.5 : opts.price)
        : 50,
    });
  }
  return JSON.stringify({ data: { lv: rows, ee: rows, lt: rows } });
}

async function callEconomy(eleringBody: string | null) {
  // Both entry points, and the second one is why this suite used to be flaky.
  //
  // Only `https.get` was stubbed. `api/economy-data/index.js:149` reaches CSP
  // PxWeb through `https.request`, so four real POSTs went to
  // `data.stat.gov.lv` on every one of these cases — a host `AGENTS.md` records
  // as taking 1–12s per table, under a 5000ms test timeout, from an
  // Azure-hosted runner. Measured with a socket probe before this was fixed: 28
  // escaping requests from this file alone.
  vi.spyOn(https, 'request').mockImplementation((() => {
    const req = new EventEmitter() as EventEmitter & {
      destroy: () => void;
      end: () => void;
      write: () => void;
    };
    req.destroy = () => {};
    req.end = () => {};
    req.write = () => {};
    // PxWeb is not what this suite is about; the handler logs the failure and
    // carries on, which is the branch these cases already exercised by
    // accident. It does it in a microtask now instead of over the internet.
    process.nextTick(() => req.emit('error', new Error('PxWeb disabled for this test')));
    return req;
  }) as never);

  vi.spyOn(https, 'get').mockImplementation(((url: string, _o: unknown, cb: (r: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    if (String(url).includes('elering')) {
      if (eleringBody === null) {
        // What a Cloudflare 503 burst actually looks like from this host.
        setTimeout(() => cb(fakeResponse('no available server', 503)), 0);
      } else {
        setTimeout(() => cb(fakeResponse(eleringBody)), 0);
      }
    } else {
      // Everything else answers emptily; this suite is only about the price.
      setTimeout(() => cb(fakeResponse('{}')), 0);
    }
    return req;
  }) as never);

  const mod = require('../api/economy-data/index.js');
  const handler = mod.default ?? mod;
  const context: { res?: { body: string } } = {};
  await handler(context, { headers: {}, query: { country: 'lv' } });
  return JSON.parse(context.res!.body);
}

describe('a failed price fetch does not report a price', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // `/api/economy-data` now serves a remembered response for thirty minutes.
    // Each case stubs a different upstream answer, so the cache must be empty
    // or the second case is handed the first case's prices.
    require('../api/shared/cache.js').clear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports null, not zero, when the upstream fails outright', async () => {
    // The assertion that fails without the change. Zero here is a price, and a
    // plausible one — it is what the tile would print as its headline.
    const body = await callEconomy(null);
    expect(body.electricityCurrent).toBeNull();
    expect(body.electricityCurrent, 'zero is a Nord Pool price, not a sentinel').not.toBe(0);
    expect(body.electricityPrices).toEqual([]);
  });

  it('reports null when the feed answers but carries no interval for this hour', async () => {
    const body = await callEconomy(eleringPayload({ includeCurrentHour: false }));
    expect(body.electricityCurrent).toBeNull();
    // The rest of the day is still returned, so the chart still draws.
    expect(body.electricityPrices.length).toBeGreaterThan(0);
  });

  it('reports null when the interval exists but carries no price', async () => {
    // A published interval with a null price is an ordinary thing for a
    // day-ahead feed to contain, and `currentEntry` being truthy said nothing
    // about whether it held a number.
    const body = await callEconomy(eleringPayload({ includeCurrentHour: true, price: null }));
    expect(body.electricityCurrent).toBeNull();
  });

  it('refuses a price that arrived as a string rather than coercing it', async () => {
    // The case that is actually observable, and therefore the one that binds.
    // `NaN` and `Infinity` both serialise to `null` through `JSON.stringify`,
    // so they reach the client as absence whether or not this function guards
    // them — but a string survives serialisation intact, and `"50"` shipped as
    // `electricityCurrent` would break the declared contract while looking
    // right in the payload.
    const body = await callEconomy(
      eleringPayload({ includeCurrentHour: true, price: '50' as unknown as number }),
    );
    expect(body.electricityCurrent).toBeNull();
    expect(typeof body.electricityCurrent).not.toBe('string');
  });

  it('still reports a real price, including a genuine zero', async () => {
    // The other direction, so "never zero" cannot quietly become "zero is
    // always absence". Nord Pool really does clear at zero.
    const priced = await callEconomy(eleringPayload({ includeCurrentHour: true, price: 87.5 }));
    expect(priced.electricityCurrent).toBe(87.5);

    vi.restoreAllMocks();
    // Two calls to the same endpoint with the same parameters inside one case:
    // the second is a cache hit by design, and would be handed 87.5 again. The
    // clear is what makes this a second observation rather than an echo of the
    // first.
    require('../api/shared/cache.js').clear();
    const free = await callEconomy(eleringPayload({ includeCurrentHour: true, price: 0 }));
    expect(free.electricityCurrent, 'a real zero must survive').toBe(0);
  });

  it('still reports a negative price, which the tile has a badge for', async () => {
    const body = await callEconomy(eleringPayload({ includeCurrentHour: true, price: -3.2 }));
    expect(body.electricityCurrent).toBe(-3.2);
  });
});
