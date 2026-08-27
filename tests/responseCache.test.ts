/**
 * The response cache, and the three properties that make it safe to have.
 *
 * A cache in front of a public data API is easy to get subtly wrong in ways
 * that look fine. This project has already paid for one: a key that ignored the
 * query string published five articles carrying real Eurostat figures attached
 * to metrics they did not measure. Nothing was malformed, so nothing caught it.
 *
 * So the assertions here are about identity (does this key mean this request),
 * about what is worth remembering (a 200 and nothing else), and about honesty
 * (an answer served from memory says how old it is).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withCache, responseKey, etagFor, matchesEtag } = require('../api/shared/responseCache.js');
const cache = require('../api/shared/cache.js');
const rateLimit = require('../api/shared/rateLimit.js');

beforeEach(() => { cache.clear(); rateLimit.reset(); });

/** A handler that records how many times it actually ran. */
function countingHandler(bodyFor: (req: { query?: Record<string, string> }) => string) {
  const state = { runs: 0 };
  const handler = async (context: { res?: unknown }, req: { query?: Record<string, string> }) => {
    state.runs++;
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: bodyFor(req),
    };
  };
  return { handler, state };
}

type WrappedHandler = (
  context: { res?: { status: number; headers: Record<string, string>; body: string } },
  req: { query?: Record<string, string>; headers?: Record<string, string> },
) => Promise<void>;

const call = async (wrapped: WrappedHandler, query = {}, headers = {}) => {
  const context: { res?: { status: number; headers: Record<string, string>; body: string } } = {};
  await wrapped(context, { query, headers });
  return context.res!;
};

describe('the response cache', () => {
  it('runs the handler once and serves the rest from memory', async () => {
    const { handler, state } = countingHandler(() => JSON.stringify({ v: 1 }));
    const wrapped = withCache(handler, { name: 't', keyOn: [], ttlMs: 60_000 });

    await call(wrapped);
    await call(wrapped);
    await call(wrapped);

    expect(state.runs, 'three requests, one computation').toBe(1);
  });

  it('runs the handler once for concurrent requests, not once each', async () => {
    // The defect this exists to prevent, and the one that scales with the
    // audience: measured against the previous cache, twenty concurrent
    // requests for a single key produced twenty upstream calls, because the
    // entry was only written after the fetch resolved.
    let runs = 0;
    const slow = async (context: { res?: unknown }) => {
      runs++;
      await new Promise((r) => setTimeout(r, 50));
      context.res = { status: 200, headers: {}, body: '{}' };
    };
    const wrapped = withCache(slow, { name: 'burst', keyOn: [], ttlMs: 60_000 });

    await Promise.all(Array.from({ length: 20 }, () => call(wrapped)));

    expect(runs, 'twenty concurrent readers must not become twenty fetches').toBe(1);
  });

  it('keeps requests apart by every parameter the handler reads', async () => {
    // `?country=EE` must never be answered with Latvia's payload. This is the
    // newsroom's published-wrong-figures bug in its dashboard form.
    const { handler } = countingHandler((req) => JSON.stringify({ c: req.query!.country }));
    const wrapped = withCache(handler, { name: 'geo', keyOn: ['country'], ttlMs: 60_000 });

    const lv = await call(wrapped, { country: 'LV' });
    const ee = await call(wrapped, { country: 'EE' });

    expect(JSON.parse(lv.body).c).toBe('LV');
    expect(JSON.parse(ee.body).c).toBe('EE');
  });

  it('refuses to wrap a handler that has not declared its parameters', () => {
    // There is no safe default. A missing `keyOn` would silently collapse every
    // variant of an endpoint onto one entry, which is precisely how one
    // country's figures end up under another's heading.
    expect(() => withCache(async () => {}, { name: 'x' } as never))
      .toThrow(/keyOn/);
  });

  it('does not remember anything that is not a 200', async () => {
    // A 502 is an upstream failure. Caching it would turn a blip into a fixed
    // outage for the length of the TTL.
    let runs = 0;
    const failing = async (context: { res?: unknown }) => {
      runs++;
      context.res = { status: 502, headers: {}, body: JSON.stringify({ error: 'upstream' }) };
    };
    const wrapped = withCache(failing, { name: 'bad', keyOn: [], ttlMs: 60_000 });

    const first = await call(wrapped);
    const second = await call(wrapped);

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    expect(runs, 'a failure must be retried, not remembered').toBe(2);
  });

  it('passes a 400 straight through, body and all', async () => {
    const rejecting = async (context: { res?: unknown }) => {
      context.res = { status: 400, headers: {}, body: JSON.stringify({ error: 'Unknown indicator' }) };
    };
    const wrapped = withCache(rejecting, { name: 'four', keyOn: [], ttlMs: 60_000 });

    const res = await call(wrapped);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Unknown indicator');
  });

  it('serves the last good answer when upstream fails inside the grace', async () => {
    // Elering was measured returning five consecutive HTTP 503 in one burst and
    // then twelve clean calls. Handing the reader a 502 for that is worse than
    // handing them data whose own `fetchedAt` says how old it is.
    let mode: 'ok' | 'fail' = 'ok';
    const flaky = async (context: { res?: unknown }) => {
      context.res = mode === 'ok'
        ? { status: 200, headers: {}, body: JSON.stringify({ price: 42 }) }
        : { status: 502, headers: {}, body: JSON.stringify({ error: 'down' }) };
    };
    const wrapped = withCache(flaky, { name: 'flaky', keyOn: [], ttlMs: 0, graceMs: 60_000 });

    const good = await call(wrapped);
    expect(JSON.parse(good.body).price).toBe(42);

    mode = 'fail';
    const degraded = await call(wrapped);

    expect(degraded.status).toBe(200);
    expect(JSON.parse(degraded.body).price).toBe(42);
    expect(degraded.headers['X-Cache'], 'and it must say so, not pretend').toBe('stale');
  });

  it('says nothing comforting once the grace has run out', async () => {
    // Past the bound we genuinely do not know, and "I don't know" must never
    // render as "fine".
    let mode: 'ok' | 'fail' = 'ok';
    const flaky = async (context: { res?: unknown }) => {
      context.res = mode === 'ok'
        ? { status: 200, headers: {}, body: '{"v":1}' }
        : { status: 503, headers: {}, body: '{"error":"down"}' };
    };
    const wrapped = withCache(flaky, { name: 'expiry', keyOn: [], ttlMs: 0, graceMs: 0 });

    await call(wrapped);
    mode = 'fail';
    const res = await call(wrapped);

    expect(res.status).toBe(503);
  });
});

describe('conditional requests', () => {
  it('answers 304 with no body when the client already holds this copy', async () => {
    // `/api/power-prices` is 21KB. A revalidation that transfers it again is
    // 21KB spent to say "unchanged".
    const { handler } = countingHandler(() => JSON.stringify({ big: 'payload' }));
    const wrapped = withCache(handler, { name: 'etag', keyOn: [], ttlMs: 60_000 });

    const first = await call(wrapped);
    expect(first.headers.ETag).toBeTruthy();

    const second = await call(wrapped, {}, { 'if-none-match': first.headers.ETag });

    expect(second.status).toBe(304);
    expect(second.body).toBe('');
  });

  it('sends the body when the client holds a different copy', async () => {
    const { handler } = countingHandler(() => JSON.stringify({ v: 1 }));
    const wrapped = withCache(handler, { name: 'etag2', keyOn: [], ttlMs: 60_000 });

    const res = await call(wrapped, {}, { 'if-none-match': '"something-else"' });

    expect(res.status).toBe(200);
    expect(res.body).toContain('"v":1');
  });

  it('reports the age of what it served', async () => {
    const { handler } = countingHandler(() => '{}');
    const wrapped = withCache(handler, { name: 'age', keyOn: [], ttlMs: 60_000 });

    const res = await call(wrapped);
    expect(res.headers.Age).toBeDefined();
    expect(Number(res.headers.Age)).toBeGreaterThanOrEqual(0);
  });

  it('gives different bodies different tags, and identical bodies the same one', () => {
    expect(etagFor('{"a":1}')).not.toBe(etagFor('{"a":2}'));
    expect(etagFor('{"a":1}')).toBe(etagFor('{"a":1}'));
  });

  it('compares tags weakly, as the specification requires', () => {
    // A `W/` prefix on either side is not a mismatch, and `*` matches anything.
    expect(matchesEtag('W/"abc"', '"abc"')).toBe(true);
    expect(matchesEtag('"abc"', 'W/"abc"')).toBe(true);
    expect(matchesEtag('*', '"abc"')).toBe(true);
    expect(matchesEtag('"x", "abc"', '"abc"')).toBe(true);
    expect(matchesEtag('"x"', '"abc"')).toBe(false);
    expect(matchesEtag('', '"abc"')).toBe(false);
  });
});

describe('the cache key', () => {
  it('is stable regardless of the order parameters arrive in', () => {
    expect(responseKey('n', { a: '1', b: '2' }, ['a', 'b']))
      .toBe(responseKey('n', { b: '2', a: '1' }, ['b', 'a']));
  });

  it('separates a missing parameter from an empty one only when it must', () => {
    // Both mean "not supplied" to a handler reading `req.query.country`, so
    // collapsing them is correct rather than a loss.
    expect(responseKey('n', {}, ['country'])).toBe(responseKey('n', { country: '' }, ['country']));
  });

  it('never lets two endpoints share an entry', () => {
    expect(responseKey('economy-data', {}, [])).not.toBe(responseKey('property-data', {}, []));
  });
});

describe('the limit still applies at the boundary', () => {
  it('rejects past the limit without ever reaching the handler', async () => {
    const { handler, state } = countingHandler(() => '{}');
    const wrapped = withCache(handler, { name: 'rl', keyOn: [], ttlMs: 60_000 });
    const headers = { 'x-forwarded-for': '203.0.113.9' };

    const limit = rateLimit.getStats().limitPerMin;
    let rejected = 0;
    for (let i = 0; i < limit + 5; i++) {
      const res = await call(wrapped, {}, headers);
      if (res.status === 429) rejected++;
    }

    expect(rejected, 'the wrapper must limit, not just cache').toBeGreaterThan(0);
    // And a cache hit is still a request: being cheap for us is not the same as
    // being free, and the SWA request quota is consumed either way.
    expect(state.runs).toBe(1);
  });
});
