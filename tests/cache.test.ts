/**
 * The cache in front of Open-Meteo, and why it is not a way of hiding a failure.
 *
 * Measured against production: roughly half of all calls from the Static Web
 * App's egress address hang for the full probe deadline and are rescued by the
 * retry, and about one in four has both attempts hang — which took the whole
 * site to `degraded` about a third of the time. The same endpoint answered a
 * laptop in 110–302ms, six times out of six. That is a throttle on a shared
 * egress address, and it is not something a client can out-wait.
 *
 * Retrying harder is knocking louder at a door held shut on purpose, and makes
 * us more of the cause. Demoting the source hides real outages with the false
 * ones. Caching is the only option that addresses why it is happening:
 * Open-Meteo publishes **hourly**, and we were asking it for fresh data several
 * times a minute.
 *
 * The part that needs pinning down is the behaviour under failure. Serving a
 * remembered answer is right here because the thing being reported — how
 * current the weather data is — does not change when our socket is dropped. But
 * it must be bounded, it must carry its age, and past the bound it must give up
 * and say so. "I don't know" rendering as "fine" is the failure this whole
 * workstream exists to remove.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cache = require('../api/shared/cache.js');

const TTL = 5 * 60 * 1000;
const GRACE = 25 * 60 * 1000;
const T0 = 1_787_000_000_000;

beforeEach(() => cache.clear());

describe('memo', () => {
  it('asks once, then serves the answer without asking again', async () => {
    // Open-Meteo publishes hourly. Asking on every status request could not be
    // right even if every call succeeded.
    let calls = 0;
    const fetcher = () => { calls++; return Promise.resolve({ reading: calls }); };

    const first = await cache.memo('k', TTL, GRACE, fetcher, T0);
    const second = await cache.memo('k', TTL, GRACE, fetcher, T0 + 60_000);

    expect(calls).toBe(1);
    expect(second.value).toEqual({ reading: 1 });
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
  });

  it('asks again once the answer is older than its TTL', async () => {
    let calls = 0;
    const fetcher = () => { calls++; return Promise.resolve({ reading: calls }); };

    await cache.memo('k', TTL, GRACE, fetcher, T0);
    const later = await cache.memo('k', TTL, GRACE, fetcher, T0 + TTL + 1);

    expect(calls).toBe(2);
    expect(later.value).toEqual({ reading: 2 });
  });

  it('holds the last good answer when a fetch fails, and says it did', async () => {
    // The production case: the socket is dropped, the weather has not changed.
    await cache.memo('k', TTL, GRACE, () => Promise.resolve({ reading: 'good' }), T0);

    const result = await cache.memo('k', TTL, GRACE,
      () => Promise.reject(new Error('Deadline 3000ms exceeded')), T0 + TTL + 1);

    expect(result.value).toEqual({ reading: 'good' });
    expect(result.servedAfterFailure).toBe(true);
    expect(result.error).toMatch(/Deadline/);
    expect(result.ageMs).toBe(TTL + 1);
  });

  it('gives up once the grace has run out, rather than claiming all is well', async () => {
    // Past this point we genuinely do not know, and a stale "healthy" would be
    // exactly the false green this codebase keeps finding.
    await cache.memo('k', TTL, GRACE, () => Promise.resolve('good'), T0);

    await expect(cache.memo('k', TTL, GRACE,
      () => Promise.reject(new Error('Deadline 3000ms exceeded')), T0 + GRACE + 1))
      .rejects.toThrow(/Deadline/);
  });

  it('raises the error when there is nothing remembered at all', async () => {
    await expect(cache.memo('cold', TTL, GRACE,
      () => Promise.reject(new Error('Deadline 3000ms exceeded')), T0))
      .rejects.toThrow(/Deadline/);
  });

  it('always reports how old the answer is', async () => {
    // So a caller can say "as of four minutes ago" without asking twice.
    await cache.memo('k', TTL, GRACE, () => Promise.resolve('v'), T0);
    const hit = await cache.memo('k', TTL, GRACE, () => Promise.resolve('v'), T0 + 90_000);
    expect(hit.ageMs).toBe(90_000);
  });

  it('keeps entries apart by key', async () => {
    await cache.memo('a', TTL, GRACE, () => Promise.resolve('A'), T0);
    await cache.memo('b', TTL, GRACE, () => Promise.resolve('B'), T0);
    const a = await cache.memo('a', TTL, GRACE, () => Promise.resolve('X'), T0 + 1000);
    expect(a.value).toBe('A');
  });

  it('recovers as soon as the source answers again', async () => {
    await cache.memo('k', TTL, GRACE, () => Promise.resolve('old'), T0);
    await cache.memo('k', TTL, GRACE, () => Promise.reject(new Error('hang')), T0 + TTL + 1);

    const recovered = await cache.memo('k', TTL, GRACE,
      () => Promise.resolve('new'), T0 + TTL + 2000);

    expect(recovered.value).toBe('new');
    expect(recovered.servedAfterFailure).toBe(false);
    expect(recovered.ageMs).toBe(0);
  });

  it('does not grow without bound', async () => {
    // The key space is a handful of URLs, but an unbounded map in a long-lived
    // worker is a leak waiting for someone to add a per-request key.
    for (let i = 0; i < cache.MAX_ENTRIES + 10; i++) {
      await cache.memo('key-' + i, TTL, GRACE, () => Promise.resolve(i), T0 + i);
    }
    // The oldest are evicted; the newest survive.
    const newest = await cache.memo('key-' + (cache.MAX_ENTRIES + 9), TTL, GRACE,
      () => Promise.resolve('refetched'), T0 + cache.MAX_ENTRIES + 9);
    expect(newest.cached).toBe(true);
  });

  it('asks once when twenty callers arrive together, not twenty times', async () => {
    // The defect that scales with the audience. The entry used to be written
    // only after the fetch resolved, so every request arriving during a fetch
    // saw an empty store and started its own. Measured on that version: twenty
    // concurrent callers, twenty upstream calls.
    //
    // At one visitor a minute that is invisible. At a hundred concurrent
    // readers on a cold key it is a hundred simultaneous calls to Eurostat from
    // one address — which is how this project got throttled by Open-Meteo in
    // the first place. A remedy for "we ask too often" cannot multiply asking
    // by the number of readers.
    let calls = 0;
    const slow = () => {
      calls++;
      return new Promise((resolve) => setTimeout(() => resolve('v'), 40));
    };

    const answers = await Promise.all(
      Array.from({ length: 20 }, () => cache.memo('herd', TTL, GRACE, slow))
    );

    expect(calls).toBe(1);
    expect(answers.every((a) => a.value === 'v')).toBe(true);
  });

  it('lets every waiter fall back when the shared fetch fails', async () => {
    // Sharing the fetch must not mean sharing one caller's error handling: each
    // still applies the grace rule against what it can see.
    await cache.memo('shared', TTL, GRACE, () => Promise.resolve('good'), T0);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        cache.memo('shared', TTL, GRACE,
          () => Promise.reject(new Error('hang')), T0 + TTL + 1))
    );

    expect(results.every((r) => r.value === 'good')).toBe(true);
    expect(results.every((r) => r.servedAfterFailure)).toBe(true);
  });

  it('does not wedge a key when the fetcher throws synchronously', async () => {
    // A synchronous throw never produces a promise, so a naive in-flight map
    // would keep an entry that never settles and the key would be dead for the
    // life of the process.
    await expect(cache.memo('sync', TTL, GRACE, () => { throw new Error('boom'); }, T0))
      .rejects.toThrow(/boom/);

    const recovered = await cache.memo('sync', TTL, GRACE, () => Promise.resolve('ok'), T0 + 1);
    expect(recovered.value).toBe('ok');
  });

  it('keeps the entry that is read, not the one that was written recently', async () => {
    // Eviction used to run on write time, which targets exactly the entries
    // earning their place: a key read on every request is by definition one
    // whose value was written a while ago. Measured on that version, a key read
    // every round was still re-fetched four times over three rounds.
    let clock = T0;
    const put = (k: string) =>
      cache.memo(k, 9e9, 9e9, () => Promise.resolve(k), clock++);

    for (let i = 0; i < cache.MAX_ENTRIES; i++) await put('fill-' + i);

    let refetches = 0;
    for (let round = 0; round < 50; round++) {
      await cache.memo('hot', 9e9, 9e9,
        () => { refetches++; return Promise.resolve('hot'); }, clock++);
      await put('cold-' + round);
    }

    // 'hot' was written before all fifty cold keys, so insertion-order eviction
    // would have discarded it repeatedly. One fetch is the initial miss.
    expect(refetches, 'the key being read every round must survive').toBe(1);
  });
});

describe('stale while revalidating', () => {
  it('answers immediately from a lapsed entry and refreshes behind it', async () => {
    // Without this the unlucky reader who arrives as a TTL lapses pays the full
    // upstream latency — 1.3 to 2.2 seconds measured on /api/economy-data — on
    // behalf of everyone arriving after them.
    let calls = 0;
    const fetcher = () => { calls++; return Promise.resolve('v' + calls); };

    await cache.memo('swr', 100, GRACE, fetcher, T0);
    const served = await cache.memo('swr', 100, GRACE, fetcher,
      { now: T0 + 5_000, staleWhileRevalidate: true });

    expect(served.value, 'the reader is not made to wait').toBe('v1');
    expect(served.revalidating).toBe(true);

    await served.revalidation;
    const next = await cache.memo('swr', 100, GRACE, fetcher, T0 + 5_001);
    expect(next.value, 'and the refresh did land').toBe('v2');
  });

  it('is off unless asked for, so nothing changes for callers that did not opt in', async () => {
    let calls = 0;
    const fetcher = () => { calls++; return Promise.resolve('v' + calls); };

    await cache.memo('plain', 100, GRACE, fetcher, T0);
    const served = await cache.memo('plain', 100, GRACE, fetcher, T0 + 5_000);

    expect(served.value).toBe('v2');
    expect(served.revalidating).toBeUndefined();
  });

  it('keeps serving the remembered answer when the refresh fails', async () => {
    await cache.memo('swrfail', 100, GRACE, () => Promise.resolve('good'), T0);

    const served = await cache.memo('swrfail', 100, GRACE,
      () => Promise.reject(new Error('hang')),
      { now: T0 + 5_000, staleWhileRevalidate: true });

    expect(served.value).toBe('good');
    // A failed background refresh must not surface as an unhandled rejection.
    await expect(served.revalidation).resolves.toBeUndefined();
  });
});

describe('the Open-Meteo probe bounds', () => {
  it('re-reads far more often than the source can change', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve('api/system-status/index.js'), 'utf8');

    const ttl = /OPEN_METEO_TTL_MS = (\d+) \* 60 \* 1000/.exec(source);
    const grace = /OPEN_METEO_GRACE_MS = (\d+) \* 60 \* 1000/.exec(source);
    expect(ttl, 'the probe must declare a TTL').not.toBeNull();
    expect(grace, 'the probe must declare a grace').not.toBeNull();

    // Hourly data, so anything under an hour loses nothing; and a genuine
    // outage has to surface in a time a person would still call prompt.
    expect(Number(ttl![1])).toBeLessThan(60);
    expect(Number(grace![1])).toBeLessThanOrEqual(30);
    expect(Number(grace![1])).toBeGreaterThan(Number(ttl![1]));
  });
});

describe('requestKey', () => {
  /**
   * The newsroom's Python collector keyed its HTTP cache on the URL with the
   * query string dropped. Eurostat's URL is built from the cube name and the
   * parameters are passed separately, so every definition sharing a cube
   * collided: the first was fetched, and every later one inside the TTL was
   * served *its* payload under a different metric label. Five wrong articles
   * were published, three carrying the identical figure under three different
   * names.
   *
   * Nothing was malformed. Every value was a real value, correctly parsed,
   * from the wrong slice — which is why nothing caught it.
   */
  it('separates two requests that differ only by a query parameter', () => {
    const a = cache.requestKey('es', 'https://x.test/d?unit=THS_T&geo=LV');
    const b = cache.requestKey('es', 'https://x.test/d?unit=MIO_TKM&geo=LV');
    expect(a).not.toBe(b);
  });

  it('treats the same request written in a different order as one key', () => {
    expect(cache.requestKey('es', 'https://x.test/d?a=1&b=2'))
      .toBe(cache.requestKey('es', 'https://x.test/d?b=2&a=1'));
  });

  it('keeps namespaces apart even for an identical URL', () => {
    expect(cache.requestKey('one', 'https://x.test/d'))
      .not.toBe(cache.requestKey('two', 'https://x.test/d'));
  });

  it('excludes only the parameters named as volatile', () => {
    // `/api/live-grid` asks for a sliding twelve-hour window, so `start` and
    // `end` move on every call and keying on them would mean never reading the
    // cache at all.
    const one = cache.requestKey('g', 'https://x.test/s?start=1&end=2', ['start', 'end']);
    const two = cache.requestKey('g', 'https://x.test/s?start=9&end=9', ['start', 'end']);
    expect(one).toBe(two);
  });

  it('still separates a parameter that was not declared volatile', () => {
    // The point of naming exclusions rather than inferring them: a parameter
    // added later cannot be silently ignored.
    const ee = cache.requestKey('g', 'https://x.test/s?start=1&end=2&area=EE', ['start', 'end']);
    const lv = cache.requestKey('g', 'https://x.test/s?start=1&end=2&area=LV', ['start', 'end']);
    expect(ee).not.toBe(lv);
  });

  it('keys an unparseable URL whole rather than loosely', () => {
    // Too specific only costs a cache miss. Too loose serves the wrong answer
    // under the right label.
    expect(cache.requestKey('n', 'not a url')).toContain('not a url');
  });
});

describe('the indicators that share a Eurostat cube', () => {
  const INDICATORS = require('../api/shared/indicators.js');
  const es = require('../api/shared/eurostat.js');

  /** Every pair of indicators reading the same dataset. */
  function sharedPairs(): [string, string, string][] {
    const byDataset: Record<string, string[]> = {};
    for (const [id, def] of Object.entries(INDICATORS) as [string, { dataset: string }][]) {
      (byDataset[def.dataset] = byDataset[def.dataset] || []).push(id);
    }
    const pairs: [string, string, string][] = [];
    for (const [dataset, ids] of Object.entries(byDataset)) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) pairs.push([dataset, ids[i], ids[j]]);
      }
    }
    return pairs;
  }

  it('is a real and large population, not a hypothetical one', () => {
    // The count is DERIVED and reported, not written down. The comment here
    // read "thirty-four of sixty-five" until 2026-08-28, when #189 took the
    // registry to seventy-one and the prose stayed put — measured then at 37
    // of 71 across 11 cubes, with `bop_c6_q` serving ten and `prc_hicp_minr`
    // eight. A hardcoded figure in a comment is a claim nobody re-checks; the
    // floor below is the part that has to stay true, and it scales because the
    // population comes from INDICATORS itself.
    const pairs = sharedPairs();
    // Ids only. `sharedPairs` yields [dataset, idA, idB] triples, so a flat
    // set over them counts the eleven cube names as if they were indicators
    // and reports 48 where the answer is 37 — which is exactly the class of
    // wrong number this edit exists to remove, and it was in the first draft
    // of this line.
    const sharing = new Set(pairs.flatMap(([, a, b]) => [a, b])).size;
    const cubes = new Set(pairs.map(([dataset]) => dataset)).size;
    expect(
      pairs.length,
      `only ${pairs.length} same-cube pairs from ${sharing} indicators across ${cubes} cubes — ` +
        'the population this guard exists for has shrunk, so check the registry ' +
        'rather than lowering the floor',
    ).toBeGreaterThan(50);
  });

  it('gives every such pair a distinct cache key', () => {
    // The assertion that would have caught the newsroom bug. `road_freight`
    // and `road_freight_tkm` are the sharpest case: they differ by nothing but
    // `unit`, and confusing them makes the freight modal split read tonnes
    // lifted rather than tonne-kilometres — Latvia's rail share at about 4%
    // instead of 18.9%, a chart that looks fine and says the opposite.
    const collisions: string[] = [];

    for (const [dataset, a, b] of sharedPairs()) {
      const urlA = es.buildUrl(INDICATORS[a], 5, ['LV', 'EE', 'LT']);
      const urlB = es.buildUrl(INDICATORS[b], 5, ['LV', 'EE', 'LT']);
      if (cache.requestKey('eurostat', urlA) === cache.requestKey('eurostat', urlB)) {
        collisions.push(`${dataset}: ${a} and ${b}`);
      }
    }

    expect(collisions, 'these indicators would be served each other\u2019s data').toEqual([]);
  });

  it('would flag a key that ignored the query string, which is the actual bug', () => {
    // Guarding the guard: if `requestKey` ever stopped covering parameters,
    // the test above must fail rather than quietly pass. This proves the
    // dataset-only key it replaces really does collide.
    const naive = (url: string) => new URL(url).pathname;
    const [, a, b] = sharedPairs()[0];
    const urlA = es.buildUrl(INDICATORS[a], 5, ['LV']);
    const urlB = es.buildUrl(INDICATORS[b], 5, ['LV']);

    expect(naive(urlA), 'a path-only key collides, which is the newsroom bug')
      .toBe(naive(urlB));
    expect(cache.requestKey('eurostat', urlA)).not.toBe(cache.requestKey('eurostat', urlB));
  });
});
