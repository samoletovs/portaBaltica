import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBalticCompare, type BalticCompareData } from '../src/api';
import { fetchChartComparison } from '../src/utils/chartRequest';

function data(value: number | null): BalticCompareData {
  return {
    indicator: 'gdp', title: 'GDP growth', source: 'Eurostat', unit: '% YoY',
    countries: { LV: { label: 'Latvia', series: [{ period: '2026-Q2', value }] } },
  };
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function deferredResponse() {
  let resolve: (value: Response) => void = () => {};
  const promise = new Promise<Response>((settle) => { resolve = settle; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an explicit chart retry repairs the shared cached response', () => {
  it('replaces cached empty readings for the next ordinary consumer without a third network request', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(data(null)))
      .mockResolvedValueOnce(response(data(4.1))));
    expect(await fetchBalticCompare('gdp')).toEqual(data(null));
    expect(await fetchChartComparison('gdp', 5, true)).toEqual(data(4.1));
    expect(await fetchBalticCompare('gdp')).toEqual(data(4.1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls).toEqual([
      ['/api/baltic-compare?indicator=gdp&years=5'],
      ['/api/baltic-compare?indicator=gdp&years=5', { cache: 'no-cache' }],
    ]);
    expect(localStorage.length).toBe(1);
  });

  it.each(['HTTP failure', 'network failure', 'invalid JSON'])('keeps the last good cached response after a %s on refresh', async (kind) => {
    const network = vi.fn().mockResolvedValueOnce(response(data(4.1)));
    if (kind === 'HTTP failure') network.mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    if (kind === 'network failure') network.mockRejectedValueOnce(new TypeError('Network unavailable'));
    if (kind === 'invalid JSON') network.mockResolvedValueOnce(new Response('{'));
    vi.stubGlobal('fetch', network);
    await fetchBalticCompare('gdp', 5);
    await expect(fetchBalticCompare('gdp', 5, { forceRefresh: true })).rejects.toThrow();
    expect(await fetchBalticCompare('gdp', 5)).toEqual(data(4.1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(1);
  });

  it('keeps omitted and false options cacheable and shares the existing normalized key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response(data(4.1))));
    await fetchBalticCompare('gdp');
    await fetchBalticCompare('gdp', 5, { forceRefresh: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchBalticCompare('gdp', -1, { forceRefresh: true });
    await fetchBalticCompare('gdp', Number.NaN);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(1);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === '/api/baltic-compare?indicator=gdp&years=5')).toBe(true);
  });

  it('deduplicates ordinary concurrent reads as before', async () => {
    const pending = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    const first = fetchBalticCompare('gdp', 5);
    const second = fetchBalticCompare('gdp', 5);
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(response(data(4.1)));
    expect(await Promise.all([first, second])).toEqual([data(4.1), data(4.1)]);
  });

  it.each(['ordinary first', 'refresh first'] as const)('keeps the forced response authoritative when an older ordinary request settles %s', async (order) => {
    const ordinary = deferredResponse();
    const forced = deferredResponse();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(ordinary.promise)
      .mockReturnValueOnce(forced.promise));
    const original = fetchBalticCompare('gdp', 5);
    const refresh = fetchBalticCompare('gdp', 5, { forceRefresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    if (order === 'ordinary first') {
      ordinary.resolve(response(data(null)));
      expect(await original).toEqual(data(null));
      // Completing the old request must not clear the new in-flight request.
      const follower = fetchBalticCompare('gdp', 5);
      expect(fetch).toHaveBeenCalledTimes(2);
      forced.resolve(response(data(4.1)));
      expect(await follower).toEqual(data(4.1));
      expect(await refresh).toEqual(data(4.1));
    } else {
      forced.resolve(response(data(4.1)));
      expect(await refresh).toEqual(data(4.1));
      ordinary.resolve(response(data(null)));
      expect(await original).toEqual(data(null));
    }
    expect(await fetchBalticCompare('gdp', 5)).toEqual(data(4.1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(1);
  });

  it('does not let a slower first refresh overwrite a later refresh', async () => {
    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise));
    const first = fetchBalticCompare('gdp', 5, { forceRefresh: true });
    const second = fetchBalticCompare('gdp', 5, { forceRefresh: true });
    secondResponse.resolve(response(data(4.1)));
    expect(await second).toEqual(data(4.1));
    firstResponse.resolve(response(data(1.2)));
    expect(await first).toEqual(data(1.2));
    expect(await fetchBalticCompare('gdp', 5)).toEqual(data(4.1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
