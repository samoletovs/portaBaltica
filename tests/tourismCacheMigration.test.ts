import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BalticCompareData } from '../src/api';

let api: typeof import('../src/api');
const fetchMock = vi.fn<typeof fetch>();

function comparison(indicator: string, dataset: string, years = 5): BalticCompareData {
  return {
    indicator, dataset, years, title: 'Overnight stays', unit: 'nights',
    countries: { LV: { label: 'Latvia', series: [{ period: '2026-06', value: 528988 }] } },
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
        data: comparison(indicator, 'tour_occ_nim', years),
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
  it.each([5, 10])('replaces warm arrivals-based %i-year tourism through the bounded transport', async years => {
    cache({ ...comparison('tourism', 'tour_occ_arm', years), title: 'Tourist arrivals', unit: 'persons' });
    const [first, second] = await Promise.all([
      api.fetchBalticCompare('tourism', years),
      api.fetchBalticCompare('tourism', years),
    ]);
    expect(first?.dataset).toBe('tour_occ_nim');
    expect(first?.unit).toBe('nights');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/baltic-compare-batch?');
    const saved = JSON.parse(localStorage.getItem(`portabaltica_baltic_compare-tourism-${years}`)!);
    expect(saved.data.dataset).toBe('tour_occ_nim');
    await api.fetchBalticCompare('tourism', years);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not assume an older cache without a dataset identifies nights', async () => {
    const old = comparison('tourism', 'tour_occ_nim');
    delete old.dataset;
    cache(old);
    expect((await api.fetchBalticCompare('tourism'))?.dataset).toBe('tour_occ_nim');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retains correctly identified total and foreign overnight-stay caches', async () => {
    const total = comparison('tourism', 'tour_occ_nim');
    const nights = {
      ...comparison('tourism_foreign', 'tour_occ_nim'),
      title: 'Nights spent by foreign visitors', unit: 'nights',
    };
    cache(total);
    cache(nights);
    expect(await api.fetchBalticCompare('tourism')).toEqual(total);
    expect(await api.fetchBalticCompare('tourism_foreign')).toEqual(nights);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed migration rather than falling back to a different statistic', async () => {
    cache(comparison('tourism', 'tour_occ_arm'));
    fetchMock.mockRejectedValue(new Error('Source unavailable'));
    await expect(api.fetchBalticCompare('tourism')).rejects.toThrow('Source unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('isolates an older worker whose night counts still claim a persons unit', async () => {
    fetchMock.mockResolvedValue(Response.json({
      results: [
        { indicator: 'tourism', years: 5, status: 200,
          data: { ...comparison('tourism', 'tour_occ_nim'), title: 'Tourist arrivals', unit: 'persons' },
          cache: { ageSeconds: 0, state: 'miss' } },
        { indicator: 'tourism_foreign', years: 5, status: 200,
          data: { ...comparison('tourism_foreign', 'tour_occ_nim'), unit: 'nights' },
          cache: { ageSeconds: 0, state: 'miss' } },
      ],
    }));
    const [total, nights] = await Promise.allSettled([
      api.fetchBalticCompare('tourism'), api.fetchBalticCompare('tourism_foreign'),
    ]);
    expect(total.status).toBe('rejected');
    expect(nights.status).toBe('fulfilled');
    expect(localStorage.getItem('portabaltica_baltic_compare-tourism-5')).toBeNull();
    expect(localStorage.getItem('portabaltica_baltic_compare-tourism_foreign-5')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('replaces the pre-release nights cache that was labelled as arrivals', async () => {
    cache({ ...comparison('tourism', 'tour_occ_nim'), title: 'Tourist arrivals', unit: 'persons' });
    const data = await api.fetchBalticCompare('tourism');
    expect(data).toMatchObject({ title: 'Overnight stays', unit: 'nights', dataset: 'tour_occ_nim' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
