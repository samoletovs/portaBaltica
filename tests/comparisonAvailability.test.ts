import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
interface ApiResponse { status: number; headers: Record<string, string>; body: string }
type Handler = (context: { res?: ApiResponse }, req: { query: Record<string, string>; headers: object }) => Promise<void>;
interface Comparison {
  fetchedAt: string;
  countries: Record<string, { series: { period: string; value: number | null }[] }>;
}
interface BatchItem {
  indicator: string; status: number; data?: Comparison; error?: string;
  cache?: { ageSeconds: number; state: string };
}
const es: { httpJson: (url: string, options: { deadlineMs: number }) => Promise<unknown> } =
  require('../api/shared/eurostat.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const rateLimit: { reset: () => void } = require('../api/shared/rateLimit.js');
const { CACHE_OPTIONS }: { CACHE_OPTIONS: { ttlMs: number; graceMs: number } } =
  require('../api/shared/balticCompare.js');

function cube(values: Record<string, number | null>) {
  return {
    id: ['geo', 'time'], size: [4, 2],
    dimension: {
      geo: { category: { index: { EE: 0, LV: 1, LT: 2, EU27_2020: 3 } } },
      time: { category: { index: { '2026-06': 0, '2026-07': 1 } } },
    },
    value: values,
  };
}

async function call(name: string, query: Record<string, string>) {
  const handler: Handler = require(`../api/${name}/index.js`);
  const context: { res?: ApiResponse } = {};
  await handler(context, { query, headers: {} });
  if (!context.res) throw new Error('Handler did not respond');
  return context.res;
}

async function batch() {
  const response = await call('baltic-compare-batch', { indicators: 'unemployment', years: '5' });
  const body = JSON.parse(response.body) as { results: BatchItem[] };
  return body.results[0];
}

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  vi.spyOn(es, 'httpJson').mockResolvedValue(cube({ 0: 7, 2: 0, 4: null, 6: 6 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cache.clear();
  rateLimit.reset();
});

describe('comparison availability is measured on Baltic observations', () => {
  it.each([
    ['empty response', {}],
    ['all-null cube', cube({})],
    ['EU-only readings', cube({ 6: 6, 7: 5.9 })],
  ])('refuses %s in real single, batch and export handlers without caching it', async (_name, payload) => {
    vi.mocked(es.httpJson).mockResolvedValue(payload);
    const direct = await call('baltic-compare', { indicator: 'unemployment', years: '5' });
    const grouped = await batch();
    const exported = await call('data-export', { indicator: 'unemployment', years: '5', format: 'json' });
    expect(direct.status).toBe(502);
    expect(grouped.status).toBe(502);
    expect(grouped).not.toHaveProperty('data');
    expect(exported.status).toBe(502);
    expect(es.httpJson).toHaveBeenCalledTimes(3);
  });

  it('accepts a measured zero and keeps missing countries and trailing periods missing', async () => {
    vi.mocked(es.httpJson).mockResolvedValue(cube({ 2: 0, 6: 6 }));
    const result = await batch();
    expect(result.status).toBe(200);
    expect(result.data?.countries.LV.series).toEqual([
      { period: '2026-06', value: 0 }, { period: '2026-07', value: null },
    ]);
    expect(result.data?.countries.EE.series.every(point => point.value === null)).toBe(true);
    expect(result.data?.countries.LT.series.every(point => point.value === null)).toBe(true);
  });

  it('isolates an empty item while the other comparison succeeds', async () => {
    vi.mocked(es.httpJson).mockImplementation(async url => url.includes('/une_rt_m?') ? cube({}) : cube({ 2: 0 }));
    const response = await call('baltic-compare-batch', { indicators: 'unemployment,gdp', years: '5' });
    const body = JSON.parse(response.body) as { results: BatchItem[] };
    expect(response.status).toBe(200);
    expect(body.results.map(item => [item.indicator, item.status])).toEqual([['unemployment', 502], ['gdp', 200]]);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('does not replace a last-good comparison during empty HTTP-200 revalidation', async () => {
    const first = await batch();
    expect(first.status).toBe(200);
    vi.mocked(es.httpJson).mockResolvedValue(cube({ 6: 6 }));
    vi.setSystemTime(Date.now() + CACHE_OPTIONS.ttlMs + 1000);
    expect(await batch()).toMatchObject({ status: 200, data: first.data, cache: { state: 'revalidating' } });
    await vi.advanceTimersByTimeAsync(0);
    const afterRevalidation = await call('baltic-compare', { indicator: 'unemployment', years: '5' });
    expect(afterRevalidation.status).toBe(200);
    expect(JSON.parse(afterRevalidation.body)).toEqual(first.data);
    expect(Number(afterRevalidation.headers.Age)).toBeGreaterThanOrEqual(3601);
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(new Date('2026-09-11T12:00:00Z').getTime() + CACHE_OPTIONS.graceMs + 1);
    expect((await batch()).status).toBe(502);
  });

  it('recovers a failed item on the next request rather than retaining an empty success', async () => {
    vi.mocked(es.httpJson).mockResolvedValue(cube({}));
    expect((await batch()).status).toBe(502);
    vi.mocked(es.httpJson).mockResolvedValue(cube({ 2: 0 }));
    expect(await batch()).toMatchObject({ status: 200, cache: { state: 'miss' } });
    expect(es.httpJson).toHaveBeenCalledTimes(2);
  });
});
