import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider, useFilter, YEAR_OPTIONS } from '../src/FilterContext';
import { IndicatorCard, IndicatorChart } from '../src/components/IndicatorCard';
import { IndicatorPage } from '../src/components/IndicatorPage';
import { BalticCompareChart } from '../src/components/BalticCompareChart';
import { EconomyTile } from '../src/components/EconomyTile';
import { fetchBalticCompare, type BalticCompareData } from '../src/api';
import type { EconomyData } from '../src/types';
import { toCsv, toJson, type SeriesExport } from '../src/utils/exportSeries';

const downloads = new Map<string, SeriesExport>();
vi.mock('../src/components/DownloadMenu', () => ({
  DownloadMenu: ({ data }: { data: SeriesExport }) => {
    downloads.set(data.title, data);
    return null;
  },
}));

let chartWidth = 312;
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  function Sized({ children, onResize }: ComponentProps<typeof actual.ResponsiveContainer>) {
    useEffect(() => { onResize?.(chartWidth, 288); }, [onResize]);
    return <actual.ResponsiveContainer width={chartWidth} height={288}>{children}</actual.ResponsiveContainer>;
  }
  return { ...actual, ResponsiveContainer: Sized };
});

const readings = Array.from({ length: 42 }, (_, i) => ({
  period: `${2016 + Math.floor(i / 4)}-Q${i % 4 + 1}`,
  value: i === 39 ? null : i / 10,
}));

function comparison(years = 5): BalticCompareData {
  return {
    indicator: 'gdp', title: 'GDP growth', unit: '% YoY', source: 'Eurostat',
    countries: {
      LV: { label: 'Latvia', series: readings.filter((row) => Number(row.period.slice(0, 4)) >= 2026 - years) },
      EE: { label: 'Estonia', series: readings.filter((row) => Number(row.period.slice(0, 4)) >= 2026 - years) },
      LT: { label: 'Lithuania', series: readings.filter((row) => Number(row.period.slice(0, 4)) >= 2026 - years) },
    },
    reference: null,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function RangeControls() {
  const { years, setYears } = useFilter();
  return (
    <div role="group" aria-label="Global time range">
      {YEAR_OPTIONS.map((year) => (
        <button key={year} onClick={() => setYears(year)} aria-pressed={years === year}>{year}Y</button>
      ))}
    </div>
  );
}

function shell(children: ReactNode) {
  return (
    <MemoryRouter initialEntries={['/indicator/gdp']}>
      <ThemeProvider><CountryProvider><FilterProvider>
        <RangeControls />
        {children}
      </FilterProvider></CountryProvider></ThemeProvider>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  downloads.clear();
  chartWidth = 312;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://example.test');
    if (url.searchParams.has('list')) return response({ indicators: [] });
    return response(comparison(Number(url.searchParams.get('years')) || 5));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('one range for the indicator page and its files', () => {
  it('starts at global 5Y and changes both chart requests and exports to 1Y', async () => {
    const view = render(shell(<Routes><Route path="/indicator/:id" element={<IndicatorPage />} /></Routes>));
    await settle();
    expect(screen.getByRole('button', { name: '5Y' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('group', { name: 'Time range' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'MAX' })).toBeNull();
    expect(view.container.querySelectorAll('svg[role="application"]')).toHaveLength(2);
    expect([...downloads.values()].every((file) => file.series[0].observations[0].period === '2021-Q1')).toBe(true);

    downloads.clear();
    fireEvent.click(screen.getByRole('button', { name: '1Y' }));
    await settle();
    const files = [...downloads.values()];
    expect(files).toHaveLength(2);
    for (const file of files) {
      for (const series of file.series) {
        expect(series.observations).toEqual(comparison(1).countries.LV.series);
      }
      expect(toCsv(file)).toContain('2025-Q1');
      expect(toCsv(file)).not.toContain('2021-Q1');
      expect(toJson(file)).toContain('2026-Q2');
      expect(toJson(file)).not.toContain('2016-Q1');
    }
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests).toContain('/api/baltic-compare?indicator=gdp&years=5');
    expect(requests).toContain('/api/baltic-compare?indicator=gdp&years=1');
    expect(requests.some((url) => url.includes('years=10'))).toBe(false);
  });

  it('keeps missing periods in the chart and export rather than joining the gap', async () => {
    const view = render(shell(<IndicatorChart id="gdp" />));
    await settle();
    const file = downloads.get('GDP growth');
    expect(file?.series[0].observations).toContainEqual({ period: '2025-Q4', value: null });
    expect(file && toCsv(file)).toContain('2025-Q4,');
    const path = view.container.querySelector('.recharts-area-curve')?.getAttribute('d') ?? '';
    expect(path.split('M').length - 1).toBe(2);
  });

  it('uses the global range on Latvia-only historical requests too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      indicator: 'building_permits', title: 'Building permits', unit: 'count', source: 'CSP',
      series: [{ period: '2026-Q1', value: 12 }],
      summary: { latest: 12, previous: null, change: null, min: 12, max: 12, avg: 12, count: 1 },
    })));
    render(shell(<IndicatorChart id="building_permits" />));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '1Y' }));
    await settle();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/historical-data?indicator=building_permits&years=5',
      '/api/historical-data?indicator=building_permits&years=1',
    ]);
  });

  it('retains the country override for article-embedded charts', async () => {
    const body = comparison();
    body.countries.EE.series = [{ period: '2026-Q2', value: 9.8 }];
    vi.stubGlobal('fetch', vi.fn(async () => response(body)));
    render(shell(<IndicatorChart id="gdp" country="EE" />));
    await settle();
    expect(downloads.get('GDP growth')?.series[0].observations).toEqual(body.countries.EE.series);
  });

  it('ignores a late 5Y response after the reader has switched to 1Y', async () => {
    let finishOldRequest: (response: Response) => void = () => {};
    const oldRequest = new Promise<Response>((resolve) => { finishOldRequest = resolve; });
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce(response(comparison(1))));
    render(shell(<IndicatorChart id="gdp" />));
    fireEvent.click(screen.getByRole('button', { name: '1Y' }));
    await settle();
    expect(downloads.get('GDP growth')?.series[0].observations[0].period).toBe('2025-Q1');
    await act(async () => { finishOldRequest(response(comparison(5))); });
    await settle();
    expect(downloads.get('GDP growth')?.series[0].observations[0].period).toBe('2025-Q1');
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('named, recoverable missing indicator states', () => {
  it('does not drop a GDP card after HTTP 503, and Retry really reaches the network', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(response(comparison())));
    const view = render(shell(<IndicatorCard id="gdp" title="GDP growth" unit="%" />));
    expect(screen.getByLabelText('Loading GDP growth').getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(screen.getByRole('status').textContent).toContain("Couldn't load GDP growth.");
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View GDP growth details' })?.textContent).not.toContain('0%');
    fireEvent.click(screen.getByRole('button', { name: 'Retry GDP growth' }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'View GDP growth details' }).textContent).toContain('4.1%');
  });

  it.each(['empty', 'null values', 'null payload'] as const)('rechecks a successful %s response instead of replaying its cached absence', async (kind) => {
    const empty = comparison();
    empty.countries = { LV: { label: 'Latvia', series: kind === 'empty' ? [] : [{ period: '2026-Q2', value: null }] } };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(kind === 'null payload' ? null : empty))
      .mockResolvedValueOnce(response(comparison())));
    const view = render(shell(<IndicatorCard id="gdp" title="GDP growth" unit="%" />));
    await settle();
    expect(screen.getByRole('status').textContent).toContain('No readings for GDP growth');
    fireEvent.click(screen.getByRole('button', { name: 'Retry GDP growth' }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'View GDP growth details' }).textContent).toContain('4.1%');
    expect(await fetchBalticCompare('gdp', 5)).toEqual(comparison());
    view.unmount();
    render(shell(<IndicatorCard id="gdp" title="GDP growth" unit="%" />));
    await settle();
    expect(screen.getByRole('button', { name: 'View GDP growth details' }).textContent).toContain('4.1%');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not mislabel an Estonian network failure as a Latvia-only series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    render(shell(<IndicatorChart id="gdp" title="GDP growth" country="EE" fallback={<p>Alternate chart</p>} />));
    await settle();
    expect(screen.getByRole('status').textContent).toContain("Couldn't load GDP growth");
    expect(screen.queryByText('Alternate chart')).toBeNull();
    expect(screen.queryByText(/only available for Latvia/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry GDP growth' })).not.toBeNull();
  });

  it('shows an empty comparison explicitly when countries exist but contain no readings', async () => {
    const body = comparison();
    for (const country of Object.values(body.countries)) country.series = [{ period: '2026-Q2', value: null }];
    vi.stubGlobal('fetch', vi.fn(async () => response(body)));
    const view = render(shell(<BalticCompareChart indicator="gdp" title="GDP comparison" />));
    await settle();
    expect(screen.getByRole('status').textContent).toContain('No readings for GDP comparison');
    expect(view.container.querySelector('svg[role="application"]')).toBeNull();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(downloads.size).toBe(0);
  });

  it.each(['main', 'comparison'] as const)('recovers a failed %s chart without exporting an invented value', async (kind) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(response(comparison())));
    render(shell(kind === 'main'
      ? <IndicatorChart id="gdp" title="GDP growth" />
      : <BalticCompareChart indicator="gdp" title="GDP growth" />));
    await settle();
    expect(screen.getByRole('status').textContent).toContain("Couldn't load GDP growth");
    expect(downloads.size).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry GDP growth' }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(downloads.get('GDP growth')?.series[0].observations).toEqual(comparison().countries.LV.series);
    expect(screen.queryByRole('button', { name: 'Retry GDP growth' })).toBeNull();
  });
});

describe('mobile chart labels', () => {
  it.each([220, 280, 312, 600, 960])('retains the date boundaries at %ipx without printing every reading', async (width) => {
    chartWidth = width;
    const view = render(shell(<IndicatorChart id="gdp" />));
    await settle();
    const labels = [...view.container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((node) => node.textContent);
    expect(labels[0]).toBe('Q1 2021');
    expect(labels.at(-1)).toBe('Q2 2026');
    expect(labels.length).toBeLessThanOrEqual(width < 320 ? 4 : 6);
    fireEvent.focus(screen.getByRole('application'));
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' });
    await settle();
    expect(view.container.querySelector('.recharts-tooltip-label')?.textContent).toMatch(/Q[1-4] 2021/);
  });

  it('retains both weekly boundaries in compact comparisons', async () => {
    chartWidth = 254;
    const body = comparison();
    for (const country of Object.values(body.countries)) {
      country.series = Array.from({ length: 52 }, (_, i) => ({
        period: `2025-W${String(i + 1).padStart(2, '0')}`, value: i,
      }));
    }
    vi.stubGlobal('fetch', vi.fn(async () => response(body)));
    const view = render(shell(<BalticCompareChart indicator="weekly_deaths" title="Weekly deaths" compact />));
    await settle();
    const labels = [...view.container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((node) => node.textContent);
    expect(labels[0]).toBe('Jan 25');
    expect(labels.at(-1)).toBe('Dec 25');
    expect(labels.length).toBeLessThanOrEqual(4);
    fireEvent.focus(screen.getByRole('application'));
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' });
    await settle();
    expect(view.container.querySelector('.recharts-tooltip-label')?.textContent).toMatch(/2025-W\d{2}/);
  });
});

const emptyEconomy: EconomyData = {
  electricityCurrent: null, electricityPrices: [], exchangeRates: [],
  indicators: [], businessPulse: { activeVatPayers: null, suspendedBusinesses: null },
  fetchedAt: '2026-09-06T06:00:00Z',
};

describe('economy essentials before optional detail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null)));
  });

  it('replaces resolved empty feed skeletons with explicit source feedback', async () => {
    const view = render(shell(<EconomyTile data={null} loading />));
    expect(screen.getByLabelText('Loading electricity prices')).not.toBeNull();
    expect(screen.getByLabelText('Loading exchange rates')).not.toBeNull();
    view.rerender(shell(<EconomyTile data={emptyEconomy} loading={false} />));
    await settle();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByText('No electricity prices returned by Elering.')).not.toBeNull();
    expect(screen.getByText('No exchange rates returned by the ECB.')).not.toBeNull();
    expect(view.container.textContent).not.toContain('€0.00');
  });

  it('ends loaders after a completely unavailable economy request', async () => {
    const view = render(shell(<EconomyTile data={null} loading={false} />));
    await settle();
    expect(screen.getByText('Electricity prices are unavailable.')).not.toBeNull();
    expect(screen.getByText('Exchange rates are unavailable.')).not.toBeNull();
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
  });

  it('puts the key summary first and retains all ten comparisons in named native disclosures', async () => {
    const view = render(shell(<EconomyTile data={emptyEconomy} loading={false} />));
    await settle();
    const summary = screen.getByRole('heading', { name: 'Latvia key indicators' });
    const firstCard = screen.getByRole('button', { name: 'View GDP growth details' });
    expect(summary.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const details = [...view.container.querySelectorAll('details')];
    expect(details.map((detail) => detail.querySelector('summary')?.textContent)).toEqual([
      'Prices & inflation · 6 charts', 'Housing & production · 2 charts', 'Business activity · 2 charts',
    ]);
    expect(details.map((detail) => detail.querySelectorAll('[role="status"]').length)).toEqual([6, 2, 2]);
    expect(details.every((detail) => !detail.open)).toBe(true);
    fireEvent.click(details[0].querySelector('summary')!);
    expect(details[0].open).toBe(true);
    expect(details[0].textContent).toContain('Inflation (HICP)');
    expect(details[0].textContent).toContain('Goods inflation');
  });

  it('keeps genuine zero electricity prices and old payloads without priceSchedule usable', async () => {
    const view = render(shell(<EconomyTile data={{
      ...emptyEconomy,
      electricityCurrent: 0,
      electricityPrices: [{ timestamp: '2026-09-06T06:00:00Z', price: 0 }],
      exchangeRates: [{ currency: 'USD', name: 'US Dollar', rate: 1.2 }],
    }} loading={false} />));
    await settle();
    expect(view.container.textContent).toContain('€0.00');
    expect(screen.getByText('1.2000')).not.toBeNull();
    expect(screen.queryByText(/No electricity prices/)).toBeNull();
    expect(screen.queryByText(/No exchange rates/)).toBeNull();
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
  });

  it('labels a cached schedule without requiring a retrieval timestamp', async () => {
    render(shell(<EconomyTile data={{
      ...emptyEconomy,
      electricityPrices: [{ timestamp: '2026-09-06T06:00:00Z', price: 2.4 }],
      priceSchedule: { stale: true, retrievedAt: null },
    }} loading={false} />));
    await settle();
    expect(screen.getByText('Cached price schedule.')).not.toBeNull();
    expect(screen.getByText('Current price unavailable; published intervals shown.')).not.toBeNull();
  });
});
