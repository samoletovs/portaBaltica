import { Blob as NodeBlob } from 'node:buffer';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import App from '../src/App';
import { DataExplorerPage } from '../src/components/DataExplorerPage';
import { IndicatorPage } from '../src/components/IndicatorPage';
import { CountryProvider, useCountry } from '../src/CountryContext';
import { FilterProvider, useFilter } from '../src/FilterContext';
import { DASHBOARD_SECTIONS } from '../src/sections';
import { fetchBalticCompare, fetchEconomyData, type BalticCompareData } from '../src/api';
import type { IndicatorRegistryEntry } from '../src/hooks/useIndicatorRegistry';

vi.mock('../src/api', () => ({
  fetchBalticCompare: vi.fn(), fetchEconomyData: vi.fn().mockResolvedValue(null),
  fetchPropertyData: vi.fn().mockResolvedValue(null), fetchEnvironmentData: vi.fn().mockResolvedValue(null),
  fetchEUFunds: vi.fn().mockResolvedValue(null), fetchAllWeather: vi.fn().mockResolvedValue([]),
  fetchPortData: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/components/BalticCompareChart', () => ({
  BalticCompareChart: ({ indicator, workspace }: { indicator: string; workspace?: boolean }) =>
    <div data-testid="comparison" data-workspace={workspace}>{indicator}</div>,
}));
vi.mock('../src/components/IndicatorCard', () => ({ IndicatorChart: ({ id }: { id: string }) => <div data-testid="national">{id}</div> }));
vi.mock('../src/components/OnboardingTutorial', () => ({ OnboardingTutorial: () => null }));
vi.mock('../src/components/InsightsBanner', () => ({ InsightsBanner: () => null }));
vi.mock('../src/components/SystemStatusFooter', () => ({ SystemStatusFooter: () => null }));
vi.mock('../src/components/DataTicker', () => ({ DataTicker: () => null }));
vi.mock('../src/components/EconomyTile', () => ({ EconomyTile: () => <h2>Economy tools</h2> }));
vi.mock('../src/components/TradeTile', () => ({ TradeTile: () => <h2>Trade tools</h2> }));
vi.mock('../src/components/GovernmentTile', () => ({ GovernmentTile: () => null }));
vi.mock('../src/components/LabourTile', () => ({ LabourTile: () => null }));
vi.mock('../src/components/EnergyTile', () => ({ EnergyTile: () => null }));
vi.mock('../src/components/PropertyTile', () => ({ PropertyTile: () => null }));
vi.mock('../src/components/EnvironmentTile', () => ({ EnvironmentTile: () => null }));
vi.mock('../src/components/BusinessTile', () => ({ BusinessTile: () => null }));
vi.mock('../src/components/MaritimeTile', () => ({ MaritimeTile: () => null }));

const require = createRequire(import.meta.url);
const definitions = require('../api/shared/indicators.js') as Record<string, Omit<IndicatorRegistryEntry, 'id'>>;
const registry = Object.entries(definitions).map(([id, definition]) => ({ ...definition, id }));
const future = { id: 'future_measure', title: 'Future measure', unit: 'index', freq: 'M', dataset: 'future_cube' };
const compare = vi.mocked(fetchBalticCompare);
const { BalticCompareChart: ActualBalticCompareChart } =
  await vi.importActual<typeof import('../src/components/BalticCompareChart')>('../src/components/BalticCompareChart');

function fixture(id = 'gdp'): BalticCompareData {
  const entry = [...registry, future].find(item => item.id === id)!;
  return {
    indicator: id, title: entry.title, unit: entry.unit, source: `Eurostat (${entry.dataset})`,
    dataset: entry.dataset, fetchedAt: '2026-08-01T09:00:00.000Z', reference: null,
    countries: {
      LV: { label: 'Latvia', series: [{ period: '2026-Q1', value: 0 }, { period: '2026-Q2', value: 3.4 }] },
      EE: { label: 'Estonia', series: [{ period: '2026-Q1', value: 1.2 }, { period: '2026-Q2', value: null }] },
      LT: { label: 'Lithuania', series: [{ period: '2026-Q2', value: 2.3 }, { period: '2026-Q1', value: 1.8 }] },
    },
  };
}

function Controls() {
  const location = useLocation();
  const { country, setCountry } = useCountry();
  const { setYears } = useFilter();
  return <>
    <output data-testid="location">{location.pathname}{location.search}</output>
    <output data-testid="country">{country}</output>
    <button onClick={() => setCountry('LT')}>Focus Lithuania</button>
    <button onClick={() => setYears(3)}>Use three years</button>
  </>;
}

async function settle(until: () => boolean, turns = 50) {
  for (let turn = 0; turn < turns; turn += 1) {
    if (until()) return;
    await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
  }
  throw new Error('Research workspace did not settle within 50 event-loop turns');
}

async function mount(path = '/explore') {
  await act(async () => {
    render(<CountryProvider><FilterProvider><MemoryRouter initialEntries={[path]}>
      <Controls />
      <Routes>
        <Route path="/explore" element={<DataExplorerPage />} />
        <Route path="/data" element={<App />} />
        <Route path="/data/:section" element={<App />} />
        <Route path="/indicator/:id" element={<IndicatorPage />} />
      </Routes>
    </MemoryRouter></FilterProvider></CountryProvider>);
  });
  await settle(() => screen.queryByText('Loading the catalogue…') === null);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-09T09:00:00Z'));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ indicators: [...registry, future] }) }));
  compare.mockImplementation(async id => fixture(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('link[rel="canonical"],meta[name="robots"],meta[name="description"]').forEach(node => node.remove());
});

describe('the research workspace', () => {
  it('uses the entire live registry and keeps an unclassified future entry searchable', async () => {
    await mount();
    const list = document.querySelector('.lab-indicator-list')!;
    expect(list.querySelectorAll('button')).toHaveLength(registry.length + 1);
    fireEvent.change(screen.getByLabelText('Find a measure'), { target: { value: 'future_cube' } });
    expect(list.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Future measure/ }));
    await settle(() => screen.queryByTestId('comparison')?.textContent === future.id);
    const selectionUrl = new URL(screen.getByTestId('location').textContent!, 'https://example.test');
    expect(selectionUrl.pathname).toBe('/explore');
    expect(selectionUrl.searchParams.get('indicator')).toBe(future.id);
    expect(selectionUrl.searchParams.get('country')).toBe('LV');
    expect(compare).toHaveBeenCalledWith(future.id, 5);
  });

  it('offers all nine domains once and searches outside the selected domain', async () => {
    await mount('/explore?section=energy');
    const domains = screen.getByRole('combobox', { name: 'Sector' });
    expect([...domains.querySelectorAll('option')].map(option => option.value))
      .toEqual(['all', ...DASHBOARD_SECTIONS]);
    expect(compare).toHaveBeenCalledWith('elec_price_household', 5);
    fireEvent.change(screen.getByLabelText('Find a measure'), { target: { value: future.title } });
    expect(screen.getByRole('button', { name: /Future measure/ })).toBeTruthy();
  });

  it('does not substitute the default chart for an unknown URL selection', async () => {
    await mount('/explore?indicator=not-in-the-registry');
    expect(screen.getByText('Unknown indicator.')).toBeTruthy();
    expect(compare).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comparison')).toBeNull();
  });

  it('restores country URLs and preserves the current focus when sharing another selection', async () => {
    await mount('/indicator/gov_debt?country=ee');
    await settle(() => screen.queryByTestId('comparison') !== null);
    expect(compare).toHaveBeenCalledWith('gov_debt_gdp', 5);
    expect(screen.getByTestId('country').textContent).toBe('EE');
    fireEvent.click(screen.getByRole('button', { name: 'Focus Lithuania' }));
    fireEvent.click(screen.getByRole('button', { name: /Future measure/ }));
    await settle(() => screen.queryByTestId('comparison')?.textContent === future.id);
    expect(screen.getByTestId('location').textContent).toBe('/indicator/future_measure?country=LT');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain('/indicator/future_measure');
  });

  it.each([true, false])('reports clipboard success=%s only for the currently selected measure link', async copied => {
    const writeText = copied
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('clipboard denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await mount('/explore?indicator=gdp&country=EE');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy measure link' })); });
    expect(writeText).toHaveBeenCalledWith(new URL('/indicator/gdp?country=EE', window.location.origin).href);
    if (copied) {
      expect(screen.getByText('Measure link copied.')).toBeTruthy();
    } else {
      expect(screen.getByRole('link', { name: 'Open the permanent link' }).getAttribute('href')).toBe('/indicator/gdp?country=EE');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Focus Lithuania' }));
    expect(screen.queryByText('Measure link copied.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open the permanent link' })).toBeNull();
  });

  it('keeps real hotel occupancy and economic sentiment distinct from their former near-miss mappings', async () => {
    const first = render(<CountryProvider><FilterProvider><MemoryRouter initialEntries={['/indicator/hotel_occupancy']}><Routes>
      <Route path="/indicator/:id" element={<IndicatorPage />} />
    </Routes></MemoryRouter></FilterProvider></CountryProvider>);
    await settle(() => compare.mock.calls.some(([id]) => id === 'hotel_occupancy'));
    expect(compare).not.toHaveBeenCalledWith('tourism', 5);
    first.unmount();
    await mount('/indicator/biz_confidence');
    expect(compare).toHaveBeenCalledWith('economic_sentiment', 5);
  });

  it('switches chart/table, distinguishes null from zero, and inspects a common period', async () => {
    await mount();
    await settle(() => screen.queryByTestId('comparison') !== null);
    expect(screen.getByTestId('comparison').getAttribute('data-workspace')).toBe('true');
    expect((screen.getByLabelText('Inspect one period') as HTMLSelectElement).value).toBe('2026-Q1');
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell')[1].textContent).toBe('—');
    expect(within(rows[2]).getAllByRole('cell')[0].textContent).toBe('0');
    fireEvent.change(screen.getByLabelText('Inspect one period'), { target: { value: '2026-Q2' } });
    expect(screen.getByText('Not published')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exports the actual series, nulls, dataset and retrieval instant', async () => {
    const blobs: NodeBlob[] = [];
    vi.stubGlobal('Blob', NodeBlob);
    const OriginalURL = URL;
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL(blob: Blob | MediaSource) { blobs.push(blob as unknown as NodeBlob); return 'blob:research-export'; }
      static revokeObjectURL() {}
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount();
    await settle(() => screen.queryByRole('button', { name: /Download GDP Growth Rate as JSON/ }) !== null);
    fireEvent.click(screen.getByRole('button', { name: /Download GDP Growth Rate as JSON/ }));
    const json = JSON.parse(await blobs[0].text());
    expect(json.indicator).toBe('gdp');
    expect(json.dataset).toBe(definitions.gdp.dataset);
    expect(json.retrievedAt).toBe('2026-08-01T09:00:00.000Z');
    expect(json.series[0].observations[0].value).toBe(0);
    expect(json.series[1].observations[1].value).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Download GDP Growth Rate as CSV/ }));
    expect(await blobs[1].text()).toContain('2026-Q2,3.4,,2.3');
  });

  it('does not let an earlier request overwrite a newer time range', async () => {
    let resolveOld!: (data: BalticCompareData) => void;
    compare.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use three years' }));
    await settle(() => screen.queryByRole('button', { name: /Download GDP Growth Rate as CSV/ }) !== null);
    const old = fixture();
    old.countries.LV.series = [{ period: '1999-Q1', value: 999 }];
    await act(async () => { resolveOld(old); });
    expect(screen.queryByText(/999/)).toBeNull();
    expect(screen.queryByText('1999-Q1')).toBeNull();
    expect(compare).toHaveBeenLastCalledWith('gdp', 3);
  });

  it('separates a failed catalogue from an unknown indicator and retries it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ indicators: registry }) }));
    await mount('/explore?indicator=gdp');
    expect(screen.getByText('The indicator catalogue is unavailable.')).toBeTruthy();
    expect(screen.queryByText('Unknown indicator.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
    await settle(() => screen.queryByTestId('comparison') !== null);
  });

  it('reports an empty window without manufacturing zero or offering an empty export', async () => {
    const empty = fixture();
    for (const data of Object.values(empty.countries)) data.series = [];
    compare.mockResolvedValue(empty);
    await mount();
    expect(screen.getByText(/No published observations in this window/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download .* as CSV/ })).toBeNull();
  });

  it('keeps the explorer focused instead of embedding the dashboard underneath it', async () => {
    await mount();
    expect(vi.mocked(fetchEconomyData)).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Economy tools' })).toBeNull();
    expect(screen.queryByText('Sector tools', { selector: 'summary' })).toBeNull();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps national data as an optional view, not a second default chart', async () => {
    await mount('/indicator/gdp');
    expect(screen.queryByTestId('national')).toBeNull();
    fireEvent.click(screen.getByText('National source series'));
    await settle(() => screen.queryByTestId('national') !== null);
    expect(screen.getByTestId('national').textContent).toBe('gdp');
  });

  it('keeps the library discoverable as a native disclosure on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    await mount();
    const disclosure = document.querySelector<HTMLDetailsElement>('.lab-library')!;
    expect(disclosure.open).toBe(false);
    expect(screen.queryByRole('searchbox', { name: 'Find a measure' })).toBeNull();
    fireEvent.click(screen.getByText('Indicator library'));
    await settle(() => disclosure.open && !disclosure.querySelector<HTMLElement>('.lab-library-content')!.hidden);
    expect(screen.getByRole('searchbox', { name: 'Find a measure' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Future measure/ })).toBeTruthy();
  });

  it('does not manufacture a shared reading when reporting periods do not overlap', async () => {
    const data = fixture();
    data.countries.EE.series = [{ period: '2025-Q4', value: 1 }];
    compare.mockResolvedValue(data);
    await mount();
    expect(screen.getByText('No shared period across all three countries in this window.')).toBeTruthy();
    expect(screen.getByText('Not published')).toBeTruthy();
  });

  it('keeps reference-only periods visible in the exact table', async () => {
    const data = fixture();
    data.reference = {
      code: 'EU27_2020', label: 'EU27', fullLabel: 'European Union',
      latest: 2.5, latestPeriod: '2026-Q3',
      series: [{ period: '2026-Q3', value: 2.5 }, { period: '2026-Q2', value: 2.1 }],
    };
    compare.mockResolvedValue(data);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const row = within(screen.getByRole('table')).getByRole('row', { name: /2026-Q3/ });
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['—', '—', '—', '2.5']);
  });

  it('retains the existing chart mechanics while opting out of duplicate card chrome', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    let chart!: ReturnType<typeof render>;
    await act(async () => { chart = render(<FilterProvider><ActualBalticCompareChart indicator="gdp" workspace /></FilterProvider>); });
    expect(chart.container.querySelector('.lab-chart-plot')).not.toBeNull();
    expect(chart.queryByText('GDP Growth Rate')).toBeNull();
    expect(chart.queryByRole('button', { name: /Download/ })).toBeNull();
    chart.unmount();
    await act(async () => { chart = render(<FilterProvider><ActualBalticCompareChart indicator="gdp" /></FilterProvider>); });
    expect(chart.queryByText('GDP Growth Rate')).not.toBeNull();
    expect(chart.getByRole('button', { name: /Download GDP Growth Rate as CSV/ })).toBeTruthy();
  });
});
