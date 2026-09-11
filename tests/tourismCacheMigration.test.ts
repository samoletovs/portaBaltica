import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BalticCompareData } from '../src/api';

let api: typeof import('../src/api');
const fetchMock = vi.fn<typeof fetch>();

function comparison(indicator: string, dataset: string, years = 5): BalticCompareData {
  return {
    indicator, dataset, years, title: 'Tourist arrivals', unit: 'persons',
    countries: { LV: { label: 'Latvia', series: [{ period: '2026-06', value: 313942 }] } },
    source: `Eurostat (${dataset})`,
  };
}

function cache(data: BalticCompareData) {
  localStorage.setItem(`portabaltica_baltic_compare-${data.indicator}-${data.years}`,
    JSON.stringify({ data, timestamp: Date.now() }));
}

beforeEach(async () => {
  localStorage.clear();
  fetchMock.mockReset().mockImplementation(async input => {
    const url = new URL(String(input), 'https://example.test');
    const years = Number(url.searchParams.get('years'));
    return Response.json({
      results: url.searchParams.get('indicators')!.split(',').map(indicator => ({
        indicator, years, status: 200,
        data: comparison(indicator, 'tour_occ_arm', years),
        cache: { ageSeconds: 0, state: 'miss' },
      })),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  api = await import('../src/api');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('tourism browser-cache definition migration', () => {
  it.each([5, 10])('replaces warm nights-based %i-year tourism through the bounded transport', async years => {
    cache(comparison('tourism', 'tour_occ_nim', years));
    const [first, second] = await Promise.all([
      api.fetchBalticCompare('tourism', years),
      api.fetchBalticCompare('tourism', years),
    ]);
    expect(first?.dataset).toBe('tour_occ_arm');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/baltic-compare-batch?');
    const saved = JSON.parse(localStorage.getItem(`portabaltica_baltic_compare-tourism-${years}`)!);
    expect(saved.data.dataset).toBe('tour_occ_arm');
    await api.fetchBalticCompare('tourism', years);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not assume an older cache without a dataset identifies arrivals', async () => {
    const old = comparison('tourism', 'tour_occ_nim');
    delete old.dataset;
    cache(old);
    expect((await api.fetchBalticCompare('tourism'))?.dataset).toBe('tour_occ_arm');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retains correct arrivals and separately named overnight-stay caches', async () => {
    const arrivals = comparison('tourism', 'tour_occ_arm');
    const nights = {
      ...comparison('tourism_foreign', 'tour_occ_nim'),
      title: 'Nights spent by foreign visitors', unit: 'nights',
    };
    cache(arrivals);
    cache(nights);
    expect(await api.fetchBalticCompare('tourism')).toEqual(arrivals);
    expect(await api.fetchBalticCompare('tourism_foreign')).toEqual(nights);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed migration rather than falling back to a different statistic', async () => {
    cache(comparison('tourism', 'tour_occ_nim'));
    fetchMock.mockRejectedValue(new Error('Source unavailable'));
    await expect(api.fetchBalticCompare('tourism')).rejects.toThrow('Source unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('isolates an older API worker response without caching its nights as arrivals', async () => {
    fetchMock.mockResolvedValue(Response.json({
      results: [
        { indicator: 'tourism', years: 5, status: 200,
          data: comparison('tourism', 'tour_occ_nim'), cache: { ageSeconds: 0, state: 'miss' } },
        { indicator: 'tourism_foreign', years: 5, status: 200,
          data: { ...comparison('tourism_foreign', 'tour_occ_nim'), unit: 'nights' },
          cache: { ageSeconds: 0, state: 'miss' } },
      ],
    }));
    const [arrivals, nights] = await Promise.allSettled([
      api.fetchBalticCompare('tourism'), api.fetchBalticCompare('tourism_foreign'),
    ]);
    expect(arrivals.status).toBe('rejected');
    expect(nights.status).toBe('fulfilled');
    expect(localStorage.getItem('portabaltica_baltic_compare-tourism-5')).toBeNull();
    expect(localStorage.getItem('portabaltica_baltic_compare-tourism_foreign-5')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
