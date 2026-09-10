import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { BalticCompareBatchResponse } from '../src/api';

const require = createRequire(import.meta.url);
type ApiResponse = { status: number; headers: Record<string, string>; body: string };
type Handler = (context: { res?: ApiResponse }, request: { query: Record<string, unknown>; headers: Record<string, string> }) => Promise<void>;
const single: Handler = require('../api/baltic-compare/index.js');
const batch: Handler = require('../api/baltic-compare-batch/index.js');
const es: {
  httpJson: (url: string, options: { deadlineMs: number }) => Promise<unknown>;
  buildUrl: (definition: object, years: number, geos: string[]) => string;
} = require('../api/shared/eurostat.js');
const registry: Record<string, { dataset: string; euAggregation: string }> = require('../api/shared/indicators.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const rateLimit: { reset: () => void; getStats: () => { limitPerMin: number } } = require('../api/shared/rateLimit.js');
const limits: { MAX_BATCH_SIZE: number; MAX_YEARS: number; CACHE_OPTIONS: { ttlMs: number; graceMs: number } } =
  require('../api/shared/balticCompare.js');
const work: { MAX_ACTIVE: number; MAX_QUEUED: number; DEADLINE_MS: number; run: (fetcher: (deadline: number) => Promise<unknown>) => Promise<unknown> } =
  require('../api/shared/comparisonWork.js');
const ids = Object.keys(registry);
let api: typeof import('../src/api');
const fetchMock = vi.fn<typeof fetch>();
const upstream = vi.fn<typeof es.httpJson>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function cube(url: string) {
  const geos = new URL(url).searchParams.getAll('geo');
  const seed = [...url].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    id: ['geo', 'time'], size: [geos.length, 3],
    dimension: {
      geo: { category: { index: Object.fromEntries(geos.map((geo, index) => [geo, index])) } },
      time: { category: { index: { '2026-Q1': 0, '2026-Q2': 1, '2026-Q3': 2 } } },
    },
    value: geos.flatMap((_, index) => [index === 0 ? 0 : seed + index, seed + index + 1, null]),
  };
}

async function call(handler: Handler, query: Record<string, unknown>, ip = '192.0.2.20') {
  const context: { res?: ApiResponse } = {};
  await handler(context, { query, headers: { 'x-forwarded-for': ip } });
  if (!context.res) throw new Error('No handler response');
  return context.res;
}

async function items(indicators: string[], years = '5') {
  const response = await call(batch, { indicators: indicators.join(','), years });
  return { ...response, body: JSON.parse(response.body) as BalticCompareBatchResponse };
}

function success(indicator: string, years = 5, ageSeconds = 0) {
  return {
    indicator, years, status: 200 as const,
    data: {
      indicator, years, title: indicator, unit: '%', countries: {
        LV: { label: 'Latvia', series: [{ period: '2026-Q1', value: 0 }, { period: '2026-Q2', value: null }] },
      }, source: 'Eurostat', assumptions: [], reference: null, fetchedAt: '2026-09-10T08:00:00Z',
    },
    cache: { ageSeconds, state: 'hit' as const },
  };
}

function mockBatchResponse(input: RequestInfo | URL) {
  const url = new URL(String(input), 'https://example.test');
  return Response.json({
    results: url.searchParams.get('indicators')!.split(',').map(id => success(id, Number(url.searchParams.get('years')))),
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));
  cache.clear();
  rateLimit.reset();
  localStorage.clear();
  upstream.mockReset().mockImplementation(async url => cube(url));
  vi.spyOn(es, 'httpJson').mockImplementation(upstream);
  fetchMock.mockReset().mockImplementation(async input => mockBatchResponse(input));
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  api = await import('../src/api');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cache.clear();
  rateLimit.reset();
  localStorage.clear();
});

describe('bounded comparison handler', () => {
  it('returns the single route data exactly, including nulls, zeros, reference and freshness', async () => {
    for (const indicator of ['gdp', 'population']) {
      const original = await call(single, { indicator });
      const result = await items([indicator]);
      const item = result.body.results[0];
      expect(item.status).toBe(200);
      if (item.status !== 200) throw new Error(item.error);
      expect(item.data).toEqual(JSON.parse(original.body));
      expect(item.data.countries.LV.series[0].value).toBe(0);
      expect(item.data.countries.LV.series[2].value).toBeNull();
      expect(item.data.countries.LV).toHaveProperty('freshness');
      expect(item.data.assumptions).toEqual([]);
      expect(Object.keys(item.data.countries)).not.toContain('EU27_2020');
      expect(Boolean(item.data.reference)).toBe(registry[indicator].euAggregation === 'average');
    }
    expect(upstream).toHaveBeenCalledTimes(2);
    for (const [url, options] of upstream.mock.calls) {
      const indicator = url.includes(registry.gdp.dataset) ? 'gdp' : 'population';
      const geos = registry[indicator].euAggregation === 'average' ? ['LV', 'EE', 'LT', 'EU27_2020'] : ['LV', 'EE', 'LT'];
      expect(url).toBe(es.buildUrl(registry[indicator], 5, geos));
      expect(options.deadlineMs).toBe(20000);
    }
  });

  it('warms the same single-item keys from batches without mixing a shared cube or year span', async () => {
    const first = await items(['trade_balance', 'goods_balance'], '5');
    const ten = await items(['goods_balance'], '10');
    for (const item of [...first.body.results, ...ten.body.results]) {
      const direct = await call(single, { indicator: item.indicator, years: String(item.years) });
      expect(direct.headers['X-Cache']).toBe('hit');
      if (item.status !== 200) throw new Error(item.error);
      expect(JSON.parse(direct.body)).toEqual(item.data);
    }
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(new Set(upstream.mock.calls.map(([url]) => url)).size).toBe(3);
  });

  it('isolates an upstream failure and unknown IDs and retries only failed items', async () => {
    upstream.mockImplementation(async url => {
      if (url.includes(registry.gdp.dataset)) throw Object.assign(new Error('Eurostat unavailable'), { status: 503 });
      return cube(url);
    });
    const first = await items(['population', 'gdp', 'not_an_indicator', 'constructor', '__proto__']);
    // Invalid syntax is an envelope error; unknown but well-formed names below
    // are item errors. No invalid envelope starts even its valid work.
    expect(first.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const partial = await items(['population', 'gdp', 'not_an_indicator', 'constructor']);
    expect(partial.body.results.map(item => item.status)).toEqual([200, 502, 400, 400]);
    expect(partial.headers['Cache-Control']).toBe('no-store');
    expect(partial.body.results[1]).not.toHaveProperty('data');
    upstream.mockImplementation(async url => cube(url));
    const retried = await items(['gdp', 'population']);
    expect(retried.body.results.map(item => item.indicator)).toEqual(['gdp', 'population']);
    expect(retried.body.results.map(item => item.status)).toEqual([200, 200]);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it.each([
    {}, { indicators: '' }, { indicators: 'gdp,gdp' }, { indicators: ids.slice(0, 9).join(',') },
    { indicators: 'gdp, inflation' }, { indicators: ['gdp'] }, { indicators: 'https://example.test' },
    { indicators: 'gdp', years: '0' }, { indicators: 'gdp', years: '31' },
    { indicators: 'gdp', years: '5.5' }, { indicators: 'gdp', years: '-1' },
    { indicators: 'gdp', years: ['5'] }, { indicators: 'gdp', years: '5&years=10' },
    { indicators: 'gdp', list: '1' },
  ])('rejects malformed/beyond-bound input before upstream: %j', async query => {
    const result = await call(batch, query);
    expect(result.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(result.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('keeps the maximum batch and history valid, and metadata separate', async () => {
    const list = await call(single, { list: '1', indicator: 'gdp', years: '30' });
    expect(JSON.parse(list.body).indicators.map((item: { id: string }) => item.id)).toEqual(ids);
    expect(upstream).not.toHaveBeenCalled();
    const result = await items(ids.slice(0, limits.MAX_BATCH_SIZE), String(limits.MAX_YEARS));
    expect(result.status).toBe(200);
    expect(result.body.results).toHaveLength(8);
    expect(result.body.results.every(item => item.status === 200 && item.years === 30)).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(8);
  });

  it.each(['single', 'batch'])('coalesces in-flight errors started by %s without changing the other route status', async first => {
    const blocked = deferred<unknown>();
    upstream.mockReturnValue(blocked.promise);
    const singleCall = () => call(single, { indicator: 'gdp', years: '5' });
    const batchCall = () => items(['gdp']);
    const pending = first === 'single' ? [singleCall(), batchCall()] : [batchCall(), singleCall()];
    await Promise.resolve();
    blocked.reject(new Error('same upstream failure'));
    const results = await Promise.all(pending);
    const direct = results.find(result => typeof result.body === 'string')!;
    const grouped = results.find(result => typeof result.body !== 'string')!;
    expect(direct.status).toBe(502);
    expect((grouped.body as BalticCompareBatchResponse).results[0].status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('retains per-item TTL, stale revalidation and the hard grace ceiling', async () => {
    const original = (await items(['gdp'])).body.results[0];
    vi.setSystemTime(Date.now() + limits.CACHE_OPTIONS.ttlMs - 1000);
    const warm = (await items(['gdp'])).body.results[0];
    expect(warm).toMatchObject({ cache: { ageSeconds: 3599, state: 'hit' } });
    upstream.mockRejectedValue(new Error('offline'));
    vi.setSystemTime(Date.now() + 2000);
    const stale = (await items(['gdp'])).body.results[0];
    expect(stale).toMatchObject({ data: original.status === 200 ? original.data : undefined, cache: { state: 'revalidating', ageSeconds: 3601 } });
    await Promise.resolve();
    vi.setSystemTime(new Date('2026-09-10T08:00:00Z').getTime() + limits.CACHE_OPTIONS.graceMs);
    expect((await items(['gdp'])).body.results[0].status).toBe(502);
  });

  it('includes time spent waiting for another item in the delivered cache age', async () => {
    await items(['gdp']);
    const slow = deferred<unknown>();
    upstream.mockImplementation(() => slow.promise);
    const pending = items(['gdp', 'population']);
    await vi.advanceTimersByTimeAsync(2000);
    slow.resolve(cube(es.buildUrl(registry.population, 5, ['LV', 'EE', 'LT'])));
    const result = await pending;
    expect(result.body.results[0]).toMatchObject({ cache: { state: 'hit', ageSeconds: 2 } });
    expect(result.body.results[1]).toMatchObject({ cache: { state: 'miss', ageSeconds: 0 } });
  });

  it('charges one existing-limit hit per batch, including warm batches', async () => {
    for (let index = 0; index < rateLimit.getStats().limitPerMin; index++) {
      expect((await items(['gdp', 'population'])).status).toBe(200);
    }
    const refused = await items(['gdp']);
    expect(refused.status).toBe(429);
    expect(refused.headers['Retry-After']).toBeTruthy();
    expect(refused.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('bounds active and queued work, with queueing inside the upstream deadline', async () => {
    const gates = Array.from({ length: work.MAX_ACTIVE }, () => deferred<unknown>());
    const active = gates.map(gate => work.run(async () => gate.promise));
    const deadlines: number[] = [];
    const queued = Array.from({ length: work.MAX_QUEUED }, () => work.run(async deadline => { deadlines.push(deadline); return 'done'; }));
    await expect(work.run(async () => 'not started')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(100);
    gates.forEach(gate => gate.resolve('done'));
    await Promise.all([...active, ...queued]);
    expect(deadlines).toHaveLength(work.MAX_QUEUED);
    expect(deadlines.every(deadline => deadline === work.DEADLINE_MS - 100)).toBe(true);
  });

  it('applies the worker bound across concurrent real batch handlers', async () => {
    let active = 0;
    let peak = 0;
    const gates: { url: string; gate: ReturnType<typeof deferred<unknown>> }[] = [];
    upstream.mockImplementation(url => {
      const gate = deferred<unknown>();
      gates.push({ url, gate });
      peak = Math.max(peak, ++active);
      return gate.promise.finally(() => { active--; });
    });
    const pending = [0, 8, 16].map(start => items(ids.slice(start, start + 8)));
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(work.MAX_ACTIVE);
    for (let index = 0; index < 24; index++) {
      const { url, gate } = gates[index];
      gate.resolve(cube(url));
      await vi.advanceTimersByTimeAsync(0);
    }
    const results = await Promise.all(pending);
    expect(results.every(result => result.body.results.every(item => item.status === 200))).toBe(true);
    expect(peak).toBe(work.MAX_ACTIVE);
    expect(upstream).toHaveBeenCalledTimes(24);
  });

  it('does not start queued work once its total deadline expired', async () => {
    const gates = Array.from({ length: work.MAX_ACTIVE }, () => deferred<unknown>());
    const active = gates.map(gate => work.run(async () => gate.promise));
    const waiting = vi.fn(async () => 'too late');
    const queued = work.run(waiting);
    const failure = expect(queued).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(work.DEADLINE_MS);
    await failure;
    expect(waiting).not.toHaveBeenCalled();
    gates.forEach(gate => gate.resolve('done'));
    await Promise.all(active);
  });

  it('does not let an expired queue head strand a later task while a worker slot is free', async () => {
    const startedAt = Date.now();
    const gates = Array.from({ length: work.MAX_ACTIVE }, () => deferred<unknown>());
    const active = gates.map(gate => work.run(async () => gate.promise));
    const expired = work.run(async () => 'too late').catch(error => error);
    vi.setSystemTime(startedAt + work.DEADLINE_MS / 2);
    const waiting = vi.fn(async () => 'still within budget');
    const later = work.run(waiting);
    vi.setSystemTime(startedAt + work.DEADLINE_MS + 1);
    try {
      gates[0].resolve('done');
      await vi.advanceTimersByTimeAsync(0);
      expect(await expired).toMatchObject({ status: 503 });
      expect(waiting).toHaveBeenCalledOnce();
    } finally {
      gates.forEach(gate => gate.resolve('done'));
      await Promise.all([...active, later]);
    }
  });

  it('reports worker capacity as an independent retryable item failure', async () => {
    const gates = Array.from({ length: work.MAX_ACTIVE }, () => deferred<unknown>());
    const active = gates.map(gate => work.run(async () => gate.promise));
    const queued = Array.from({ length: work.MAX_QUEUED }, () => work.run(async () => 'done'));
    const response = await items(['gdp', 'not_an_indicator']);
    expect(response.status).toBe(200);
    expect(response.body.results.map(item => item.status)).toEqual([503, 400]);
    expect(response.body.results.every(item => !('data' in item))).toBe(true);
    expect(upstream).not.toHaveBeenCalled();
    gates.forEach(gate => gate.resolve('done'));
    await Promise.all([...active, ...queued]);
    expect((await items(['gdp'])).body.results[0].status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('browser comparison delivery', () => {
  it('delivers 61 distinct comparisons in eight requests with unchanged per-item data', async () => {
    expect(ids.length).toBeGreaterThanOrEqual(61);
    // Exercise the browser queue against the real handler and parser.
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'https://example.test');
      expect(url.pathname).toBe('/api/baltic-compare-batch');
      const result = await call(batch, Object.fromEntries(url.searchParams));
      return new Response(result.body, { status: result.status, headers: result.headers });
    });
    const requested = ids.slice(0, 61);
    const reads = requested.map(id => api.fetchBalticCompare(id));
    await vi.advanceTimersByTimeAsync(20);
    const data = await Promise.all(reads);
    expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(61 / limits.MAX_BATCH_SIZE));
    expect(upstream).toHaveBeenCalledTimes(61);
    for (let index = 0; index < requested.length; index++) {
      const direct = await call(single, { indicator: requested[index], years: '5' }, `198.51.100.${index}`);
      expect(data[index]).toEqual(JSON.parse(direct.body));
    }
    expect(upstream).toHaveBeenCalledTimes(61);
    expect(fetchMock.mock.calls.length + 13 + 1).toBeLessThan(rateLimit.getStats().limitPerMin);
  });

  it('coalesces duplicate readers and separates years, also with storage denied', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    const reads = [api.fetchBalticCompare('gdp'), api.fetchBalticCompare('gdp'), api.fetchBalticCompare('gdp', 10)];
    await vi.advanceTimersByTimeAsync(20);
    const data = await Promise.all(reads);
    expect(data[0]).toBe(data[1]);
    expect(data.map(item => item?.years)).toEqual([5, 5, 10]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps HTTP concurrency at two and batch cardinality at eight', async () => {
    const gates: { input: RequestInfo | URL; gate: ReturnType<typeof deferred<Response>> }[] = [];
    fetchMock.mockImplementation(input => {
      const gate = deferred<Response>();
      gates.push({ input, gate });
      return gate.promise;
    });
    const reads = ids.slice(0, 25).map(id => api.fetchBalticCompare(id));
    await vi.advanceTimersByTimeAsync(20);
    expect(gates).toHaveLength(2);
    gates[0].gate.resolve(mockBatchResponse(gates[0].input));
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(3);
    gates[1].gate.resolve(mockBatchResponse(gates[1].input));
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(4);
    gates.slice(2).forEach(({ input, gate }) => gate.resolve(mockBatchResponse(input)));
    await Promise.all(reads);
    expect(gates.map(({ input }) => new URL(String(input), 'https://example.test').searchParams.get('indicators')!.split(',').length))
      .toEqual([8, 8, 8, 1]);
  });

  it('routes out-of-order items by identity and retries one failed item without its successful peer', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ results: [
      { indicator: 'population', years: 5, status: 502, error: 'offline' }, success('gdp'),
    ] }));
    const reads = Promise.allSettled([api.fetchBalticCompare('gdp'), api.fetchBalticCompare('population')]);
    await vi.advanceTimersByTimeAsync(20);
    expect(await reads).toMatchObject([{ status: 'fulfilled', value: success('gdp').data }, { status: 'rejected' }]);
    expect(localStorage.getItem('portabaltica_baltic_compare-population-5')).toBeNull();
    const retry = Promise.all([api.fetchBalticCompare('gdp'), api.fetchBalticCompare('population')]);
    await vi.advanceTimersByTimeAsync(20);
    await retry;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'https://example.test');
    expect(url.searchParams.get('indicators')).toBe('population');
  });

  it('releases stalled HTTP slots at the client deadline so queued comparisons can proceed', async () => {
    let requests = 0;
    fetchMock.mockImplementation((input, init) => {
      if (++requests > 2) return Promise.resolve(mockBatchResponse(input));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const pending = Promise.allSettled(ids.slice(0, 17).map(id => api.fetchBalticCompare(id)));
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(25000);
    const results = await pending;
    expect(results.slice(0, 16).every(result => result.status === 'rejected' && /timed out/.test(String(result.reason)))).toBe(true);
    expect(results[16].status).toBe('fulfilled');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['missing', 'duplicate', 'wrong year', 'wrong data', 'bad age'])('rejects a %s item without losing a good peer', async fault => {
    const bad = success('gdp');
    if (fault === 'wrong year') bad.years = 10;
    if (fault === 'wrong data') bad.data.indicator = 'population';
    if (fault === 'bad age') bad.cache.ageSeconds = -1;
    fetchMock.mockResolvedValueOnce(Response.json({ results: [
      success('population'), ...(fault === 'missing' ? [] : fault === 'duplicate' ? [bad, bad] : [bad]),
    ] }));
    const results = Promise.allSettled([api.fetchBalticCompare('gdp'), api.fetchBalticCompare('population')]);
    await vi.advanceTimersByTimeAsync(20);
    expect(await results).toMatchObject([{ status: 'rejected' }, { status: 'fulfilled' }]);
    expect(localStorage.getItem('portabaltica_baltic_compare-gdp-5')).toBeNull();
  });

  it('propagates an unavailable batch route, never expanding to individual requests', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Not deployed' }, { status: 404 }));
    const results = Promise.allSettled(ids.slice(0, 61).map(id => api.fetchBalticCompare(id)));
    await vi.advanceTimersByTimeAsync(20);
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/baltic-compare-batch?'))).toBe(true);
    fetchMock.mockImplementation(async input => mockBatchResponse(input));
    const retry = api.fetchBalticCompare('gdp');
    await vi.advanceTimersByTimeAsync(20);
    expect((await retry)?.indicator).toBe('gdp');
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('uses the existing per-item cache, and does not renew server age on receipt', async () => {
    const existing = success('gdp').data;
    localStorage.setItem('portabaltica_baltic_compare-gdp-5', JSON.stringify({ data: existing, timestamp: Date.now() }));
    expect(await api.fetchBalticCompare('gdp')).toEqual(existing);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ results: [success('population', 5, 3599)] }));
    const first = api.fetchBalticCompare('population');
    await vi.advanceTimersByTimeAsync(20);
    await first;
    vi.setSystemTime(Date.now() + 1001);
    const next = api.fetchBalticCompare('population');
    await vi.advanceTimersByTimeAsync(20);
    await next;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels one subscriber without cancelling shared readers or a sibling item', async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);
    const controller = new AbortController();
    const cancelled = api.fetchBalticCompare('gdp', 5, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const other = api.fetchBalticCompare('gdp');
    const sibling = api.fetchBalticCompare('population');
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    gate.resolve(mockBatchResponse(fetchMock.mock.calls[0][0]));
    expect((await other)?.indicator).toBe('gdp');
    expect((await sibling)?.indicator).toBe('population');
  });

  it('drops unstarted cancelled items and allows their immediate retry', async () => {
    const controller = new AbortController();
    const first = api.fetchBalticCompare('gdp', 5, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).not.toHaveBeenCalled();
    const retry = api.fetchBalticCompare('gdp');
    await vi.advanceTimersByTimeAsync(20);
    expect((await retry)?.indicator).toBe('gdp');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('withholds a cancelled item without aborting its still-observed sibling', async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValueOnce(gate.promise);
    const controller = new AbortController();
    const cancelled = api.fetchBalticCompare('gdp', 5, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const sibling = api.fetchBalticCompare('population');
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    gate.resolve(mockBatchResponse(fetchMock.mock.calls[0][0]));
    expect((await sibling)?.indicator).toBe('population');
    expect(localStorage.getItem('portabaltica_baltic_compare-gdp-5')).toBeNull();
  });

  it('aborts a batch with no remaining readers and cannot overwrite a newer retry', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const controller = new AbortController();
    const first = api.fetchBalticCompare('gdp', 5, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const retry = api.fetchBalticCompare('gdp');
    await vi.advanceTimersByTimeAsync(20);
    expect((await retry)?.indicator).toBe('gdp');
    const stale = success('gdp');
    stale.data.title = 'old request';
    old.resolve(Response.json({ results: [stale] }));
    await vi.advanceTimersByTimeAsync(0);
    expect((await api.fetchBalticCompare('gdp'))?.title).toBe('gdp');
  });

  it('rejects invalid IDs and excessive years without starting transport', async () => {
    await expect(api.fetchBalticCompare('gdp&years=30')).rejects.toThrow('indicator');
    await expect(api.fetchBalticCompare('gdp', 31)).rejects.toThrow('30 years');
    const controller = new AbortController();
    controller.abort();
    await expect(api.fetchBalticCompare('gdp', 5, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
