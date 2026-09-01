/**
 * Two stale horizons, because `graceMs` was answering two questions.
 *
 * WHAT WAS WRONG
 * --------------
 * `cache.js` documented `graceMs` as "how long a stale answer stands once
 * fetches FAIL". The stale-while-revalidate branch used the same number for a
 * different question — how far past the TTL a WORKING fetch may be anticipated —
 * and nothing said so. One name, two questions, and while that was true the code
 * could not express the case where they want opposite values.
 *
 * They do want opposite values on the syndication feeds. A long failure grace is
 * protective: a blob that stops answering must not take `/rss.xml` down. A long
 * revalidate horizon is the reverse, because it is precisely how long a body
 * built BEFORE a correction may still go out. Measured on 2026-09-01, three
 * corrections applied at 14:49 left both feeds unmarked while the article page,
 * `/corrections`, the front page, `/weekly` and the share card all showed them —
 * and the feeds' horizon was an hour, not the fifteen minutes their TTL suggests.
 *
 * The exposure is worst on a QUIET feed, which is the opposite of the intuition:
 * revalidation is request-triggered, so the reader arriving after a long silence
 * is the one served the withdrawn headline.
 *
 * THE FOUR THINGS THIS HAS TO SHOW
 * --------------------------------
 *   1. the horizon shrank             — a body past it is refetched, not served
 *   2. the FAILURE GRACE DID NOT      — the dangerous half; an outage must still
 *                                       yield the last good body for the full hour
 *   3. nothing changed by default     — the other eighteen callers are untouched
 *   4. it is visible from outside     — `X-Cache: revalidating` names the state
 *
 * (2) is the one that could do real harm, so it is asserted at both levels and
 * at the exact age that distinguishes the two horizons: past the revalidate
 * horizon, inside the failure grace. Before the split that age did not exist.
 *
 * `memo` takes a pinned clock, so the horizon assertions are deterministic
 * rather than timed. The `withCache` ones use real timers with millisecond
 * budgets, because the header is what a reader actually receives and mocking the
 * clock would be measuring a proxy for it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cache = require('../api/shared/cache.js');
const { withCache } = require('../api/shared/responseCache.js');
const rateLimit = require('../api/shared/rateLimit.js');

beforeEach(() => { cache.clear(); rateLimit.reset(); });

const T0 = 1_756_000_000_000;
const TTL = 60_000;
const GRACE = 3_600_000;
const HORIZON = 120_000;

/** An age that is past the revalidate horizon and well inside the failure grace. */
const BETWEEN = T0 + 600_000;

interface MemoResult<T> {
  value: T;
  ageMs: number;
  cached: boolean;
  servedAfterFailure: boolean;
  revalidating?: boolean;
  revalidation?: Promise<unknown>;
}

type Memo = <T>(
  key: string, ttlMs: number, graceMs: number,
  fetcher: () => Promise<T>,
  opts?: number | { now?: number; staleWhileRevalidate?: boolean; staleWhileRevalidateMs?: number },
) => Promise<MemoResult<T>>;

const memo = cache.memo as Memo;

const swr = (now: number, horizon?: number) => ({
  now,
  staleWhileRevalidate: true,
  ...(horizon === undefined ? {} : { staleWhileRevalidateMs: horizon }),
});

// ─── 1. the horizon shrank ─────────────────────────────────────────────────

describe('the revalidate horizon', () => {
  it('still serves a stale body INSIDE the horizon, and refreshes behind it', async () => {
    await memo('a', TTL, GRACE, async () => 'first', swr(T0, HORIZON));

    const result = await memo('a', TTL, GRACE, async () => 'second', swr(T0 + 90_000, HORIZON));

    // 90s: past the 60s TTL, inside the 120s horizon. This is what
    // stale-while-revalidate is for and the split must not have cost it.
    expect(result.value, 'the stale body was not served inside the horizon').toBe('first');
    expect(result.revalidating, 'no refresh was started behind it').toBe(true);
  });

  it('refetches PAST the horizon rather than serving a body it knows is old', async () => {
    await memo('b', TTL, GRACE, async () => 'first', swr(T0, HORIZON));

    const result = await memo('b', TTL, GRACE, async () => 'second', swr(BETWEEN, HORIZON));

    // 600s: past the 120s horizon, far inside the 3600s grace. Before the split
    // this age was inside `graceMs` and would have been served stale.
    expect(result.value, 'a body past the horizon was still served').toBe('second');
    expect(result.cached, 'it came from memory rather than the fetcher').toBe(false);
    expect(result.revalidating, 'it claimed to be revalidating').toBeUndefined();
  });

  it('would have served the stale body at that age before the split', async () => {
    // The control that makes the assertion above mean something. Same key, same
    // age, same fetcher — the ONLY difference is that no horizon is declared, so
    // it falls back to `graceMs`, which is the old behaviour exactly.
    await memo('c', TTL, GRACE, async () => 'first', swr(T0));

    const result = await memo('c', TTL, GRACE, async () => 'second', swr(BETWEEN));

    expect(result.value, 'the old behaviour did not reproduce, so the comparison is empty').toBe('first');
    expect(result.revalidating, 'the old behaviour did not revalidate').toBe(true);
  });
});

// ─── 2. the failure grace did NOT shrink ───────────────────────────────────

describe('the failure grace', () => {
  it('still serves the last good body when the fetch fails PAST the horizon', async () => {
    await memo('d', TTL, GRACE, async () => 'good', swr(T0, HORIZON));

    // Caught rather than awaited bare, so that a regression is a NAMED failure
    // instead of an anonymous rethrow. Narrowing the failure branch to the
    // horizon makes `memo` reject here, and a bare `await` would surface that as
    // "upstream down" — the planted fault's own words, which say nothing about
    // which invariant broke.
    let result: MemoResult<string> | null = null;
    let threw: string | null = null;
    try {
      result = await memo('d', TTL, GRACE, async () => { throw new Error('upstream down'); },
        swr(BETWEEN, HORIZON));
    } catch (error) {
      threw = String(error);
    }

    // THE ASSERTION THAT MATTERS. At 600s the revalidate horizon has lapsed, so
    // the refetch happens in the foreground — and it fails. The failure grace is
    // a separate hour and must still catch it. If splitting the two had
    // shortened the failure path, an upstream outage would 500 the feed here.
    expect(threw, 'an outage past the horizon threw instead of serving the last good body').toBeNull();
    expect(result!.value, 'an outage past the horizon lost the last good body').toBe('good');
    expect(result!.servedAfterFailure, 'it was not reported as served after a failure').toBe(true);
    expect(result!.ageMs, 'the age was not reported honestly').toBe(600_000);
  });

  it('serves it right up to the edge of the grace, horizon or no horizon', async () => {
    await memo('e', TTL, GRACE, async () => 'good', swr(T0, HORIZON));

    const result = await memo('e', TTL, GRACE, async () => { throw new Error('still down'); },
      swr(T0 + GRACE - 1, HORIZON));

    expect(result.value, 'the grace ended early').toBe('good');
    expect(result.servedAfterFailure).toBe(true);
  });

  it('still gives up once the grace itself has run out', async () => {
    await memo('f', TTL, GRACE, async () => 'good', swr(T0, HORIZON));

    // The negative control. Without it, "the grace still works" is consistent
    // with a grace that never ends, which would be a different defect.
    await expect(
      memo('f', TTL, GRACE, async () => { throw new Error('gone'); }, swr(T0 + GRACE, HORIZON)),
    ).rejects.toThrow('gone');
  });

  it('is unaffected by a horizon LONGER than itself', async () => {
    // A caller could declare a horizon beyond the grace. `graceMs` is documented
    // as how long a stale answer stands, so it has to remain the ceiling: the
    // horizon may TIGHTEN the window and can never widen it.
    //
    // This assertion failed when first written, and the failure was the finding.
    // The revalidate branch is tested before the failure branch and swallows its
    // own background rejection, so an over-long horizon went on serving stale
    // bodies past the grace with nothing to stop it. `cache.js` now clamps.
    await memo('g', TTL, GRACE, async () => 'good', swr(T0, GRACE * 2));

    await expect(
      memo('g', TTL, GRACE, async () => { throw new Error('gone'); }, swr(T0 + GRACE, GRACE * 2)),
    ).rejects.toThrow('gone');
  });

  it('clamps an over-long horizon rather than honouring it', async () => {
    // The positive half of the same rule, so the clamp is not merely inferred
    // from a rejection. One millisecond inside the grace it still revalidates;
    // the assertion above shows it stops exactly at the grace and not later.
    await memo('g2', TTL, GRACE, async () => 'good', swr(T0, GRACE * 2));

    const inside = await memo('g2', TTL, GRACE, async () => 'fresh', swr(T0 + GRACE - 1, GRACE * 2));

    expect(inside.value, 'the clamp cut the window short of the grace').toBe('good');
    expect(inside.revalidating).toBe(true);
  });
});

// ─── 3. nothing changed for callers that did not ask ───────────────────────

describe('the default', () => {
  it('is graceMs, which is what the horizon silently was', async () => {
    await memo('h', TTL, GRACE, async () => 'first', swr(T0));

    // One millisecond inside the grace, with no horizon declared. Identical to
    // the behaviour before the split, which is what the other eighteen callers
    // rely on without knowing they do.
    const inside = await memo('h', TTL, GRACE, async () => 'second', swr(T0 + GRACE - 1));
    expect(inside.value, 'an undeclared horizon changed behaviour').toBe('first');
    expect(inside.revalidating).toBe(true);
  });

  it('stops at graceMs when undeclared, rather than running forever', async () => {
    await memo('i', TTL, GRACE, async () => 'first', swr(T0));

    const outside = await memo('i', TTL, GRACE, async () => 'second', swr(T0 + GRACE));

    expect(outside.value, 'the undeclared horizon outlived the grace').toBe('second');
    expect(outside.revalidating).toBeUndefined();
  });

  it('ignores a non-numeric horizon rather than treating it as zero', async () => {
    await memo('j', TTL, GRACE, async () => 'first', swr(T0));
    const result = await memo('j', TTL, GRACE, async () => 'second', {
      now: T0 + 90_000,
      staleWhileRevalidate: true,
      staleWhileRevalidateMs: undefined,
    });

    // `undefined` must fall back to `graceMs`. Coercing it to 0 would silently
    // disable stale-while-revalidate for every caller that omits the option —
    // absence resolving to a behaviour change nobody asked for.
    expect(result.value, 'an absent horizon disabled revalidation').toBe('first');
    expect(result.revalidating).toBe(true);
  });
});

// ─── 4. what a reader actually receives ────────────────────────────────────

describe('X-Cache, which is how this is observable from outside', () => {
  type Res = { status: number; headers: Record<string, string>; body: string };
  type Wrapped = (c: { res?: Res }, r: { query?: object; headers?: object }) => Promise<void>;

  const call = async (wrapped: Wrapped): Promise<Res> => {
    const context: { res?: Res } = {};
    await wrapped(context, { query: {}, headers: {} });
    return context.res!;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** A handler whose body changes, so a stale answer is identifiable by content. */
  function versioned() {
    const state = { n: 0 };
    const handler = async (context: { res?: Res }) => {
      state.n++;
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n: state.n }),
      };
    };
    return { handler, state };
  }

  it('says "revalidating" inside the horizon', async () => {
    const { handler } = versioned();
    const wrapped = withCache(handler, {
      name: 'swr-inside', keyOn: [], ttlMs: 30, graceMs: 60_000,
      staleWhileRevalidate: true, staleWhileRevalidateMs: 5_000,
    }) as Wrapped;

    await call(wrapped);
    await sleep(60);
    const res = await call(wrapped);

    // Past the 30ms TTL, well inside the 5s horizon.
    expect(res.headers['X-Cache'], 'the state a reader can see').toBe('revalidating');
    expect(JSON.parse(res.body).n, 'a fresh body was served instead of the stale one').toBe(1);
  });

  it('does NOT say "revalidating" past the horizon, and the body is fresh', async () => {
    const { handler } = versioned();
    const wrapped = withCache(handler, {
      name: 'swr-outside', keyOn: [], ttlMs: 30, graceMs: 60_000,
      staleWhileRevalidate: true, staleWhileRevalidateMs: 50,
    }) as Wrapped;

    await call(wrapped);
    await sleep(120);
    const res = await call(wrapped);

    // Past both the TTL and the 50ms horizon, but far inside the 60s grace —
    // which is exactly the window that used to serve a stale body and now does
    // not. This is the shrink, observed at the response rather than asserted.
    expect(res.headers['X-Cache'], 'a body past the horizon was still served from memory').toBe('miss');
    expect(JSON.parse(res.body).n, 'the reader got the old body').toBe(2);
  });

  it('still says "stale" and serves the last good body when the handler fails', async () => {
    let fail = false;
    const handler = async (context: { res?: Res }) => {
      if (fail) { context.res = { status: 502, headers: {}, body: 'upstream' }; return; }
      context.res = { status: 200, headers: {}, body: JSON.stringify({ n: 1 }) };
    };
    const wrapped = withCache(handler, {
      name: 'swr-fail', keyOn: [], ttlMs: 30, graceMs: 60_000,
      staleWhileRevalidate: true, staleWhileRevalidateMs: 50,
    }) as Wrapped;

    await call(wrapped);
    await sleep(120);
    fail = true;
    const res = await call(wrapped);

    // The end-to-end form of the assertion that matters: past the horizon, so
    // the refetch is in the foreground; it fails; the failure grace catches it
    // and the reader gets the last good body rather than a 502.
    expect(res.status, 'an outage past the horizon reached the reader').toBe(200);
    expect(res.headers['X-Cache'], 'the response did not admit it was stale').toBe('stale');
    expect(JSON.parse(res.body).n, 'the last good body was lost').toBe(1);
  });
});

// ─── the declarations themselves ───────────────────────────────────────────

describe('what the endpoints declare', () => {
  const API_DIR = resolve('api');

  /**
   * Source with comments removed.
   *
   * Because the sweep below reads text, and this repository has already paid for
   * a content check that counted a symbol inside a comment as the symbol itself
   * — measured there at 88% wrong on the name that had been explained most
   * carefully. `api/news-sitemap/index.js` now carries a comment saying it
   * deliberately declares no horizon, and that comment names the field. Reading
   * raw text, the better that absence is explained the more present it looks.
   *
   * The `[^:]` guard is what stops `https://` being read as a line comment.
   */
  const codeOnly = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const source = (name: string) =>
    codeOnly(readFileSync(resolve(API_DIR, name, 'index.js'), 'utf-8'));
  const numberOf = (text: string, field: string) => {
    const found = new RegExp(`${field}:\\s*(\\d+)`).exec(text);
    return found ? Number(found[1]) : null;
  };
  /** Every `api/<name>/index.js` that exists, which is the population here. */
  const endpoints = () =>
    readdirSync(API_DIR).filter((name) => existsSync(resolve(API_DIR, name, 'index.js')));

  it('does not read a commented-out declaration as a declaration', () => {
    // The control for the helper above, on a literal rather than on a file, so
    // it keeps working when the real files change.
    const commented = codeOnly('  // staleWhileRevalidateMs: 960000,\n  ttlMs: 900000,\n');
    const real = codeOnly('  staleWhileRevalidateMs: 960000,\n');

    expect(numberOf(commented, 'staleWhileRevalidateMs'), 'a comment was read as configuration').toBeNull();
    expect(numberOf(real, 'staleWhileRevalidateMs'), 'a real declaration was stripped').toBe(960000);
    expect(codeOnly('const u = "https://x/y";'), 'a URL was mistaken for a comment')
      .toContain('https://x/y');
  });

  it('gives both feeds the same horizon', () => {
    const rss = numberOf(source('news-rss'), 'staleWhileRevalidateMs');
    const json = numberOf(source('news-jsonfeed'), 'staleWhileRevalidateMs');

    // The two feeds must not disagree about how long a withdrawn headline may
    // keep going out, any more than they may disagree about who was corrected.
    expect(rss, 'the RSS feed declares no horizon').not.toBeNull();
    expect(json, 'the JSON feed declares no horizon').toBe(rss);
  });

  it('keeps every declared horizon above its own TTL', () => {
    // A horizon at or below the TTL is dead configuration: the TTL branch
    // answers first, so the option would read as protection while doing nothing.
    // Swept over every endpoint rather than the two I happen to have edited.
    const offenders = endpoints()
      .map((name) => ({ name, text: source(name) }))
      .map(({ name, text }) => ({
        name,
        horizon: numberOf(text, 'staleWhileRevalidateMs'),
        ttl: numberOf(text, 'ttlMs'),
      }))
      .filter((e) => e.horizon !== null && e.ttl !== null && e.horizon <= e.ttl)
      .map((e) => `${e.name}: horizon ${e.horizon} <= ttl ${e.ttl}`);

    expect(offenders, 'these horizons are unreachable behind their own TTL').toEqual([]);
  });

  it('finds the horizons it claims to check, so the sweep is not vacuous', () => {
    // An equality, not a floor. The sweep above passes trivially if it walks an
    // empty set, and an empty set is what a wrong path or a changed field name
    // produces. This is also what makes the next endpoint to adopt a horizon a
    // deliberate decision rather than a silent one.
    const declared = endpoints()
      .filter((name) => numberOf(source(name), 'staleWhileRevalidateMs') !== null)
      .sort();

    expect(declared, 'the sweep found the wrong set of declarations')
      .toEqual(['news-jsonfeed', 'news-rss']);
  });

  it('sweeps a plausible number of endpoints', () => {
    expect(endpoints().length, 'the endpoint sweep found almost nothing').toBeGreaterThan(15);
  });
});
