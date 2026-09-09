import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import App from '../src/App';
import { SiteLayout } from '../src/components/SiteLayout';
import { DataExplorerPage } from '../src/components/DataExplorerPage';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { DASHBOARD_SECTIONS } from '../src/sections';

vi.mock('../src/components/OnboardingTutorial', () => ({ OnboardingTutorial: () => null }));
vi.mock('../src/components/InsightsBanner', () => ({ InsightsBanner: () => <h2>Insights</h2> }));
vi.mock('../src/components/DataTicker', () => ({ DataTicker: () => <div data-testid="market-ticker" /> }));
vi.mock('../src/components/EconomyTile', () => ({ EconomyTile: () => <h2>Economy &amp; markets</h2> }));
vi.mock('../src/components/TradeTile', () => ({ TradeTile: () => null }));
vi.mock('../src/components/GovernmentTile', () => ({ GovernmentTile: () => null }));
vi.mock('../src/components/LabourTile', () => ({ LabourTile: () => null }));
vi.mock('../src/components/EnergyTile', () => ({ EnergyTile: () => null }));
vi.mock('../src/components/PropertyTile', () => ({ PropertyTile: () => null }));
vi.mock('../src/components/EnvironmentTile', () => ({ EnvironmentTile: () => null }));
vi.mock('../src/components/BusinessTile', () => ({ BusinessTile: () => null }));
vi.mock('../src/components/MaritimeTile', () => ({ MaritimeTile: () => null }));
vi.mock('../src/components/SystemStatusFooter', () => ({ SystemStatusFooter: () => null }));
vi.mock('../src/components/BalticCompareChart', () => ({ BalticCompareChart: () => <div>Selected comparison</div> }));
vi.mock('../src/api', () => ({
  fetchBalticCompare: vi.fn().mockResolvedValue({ indicator: 'gdp', title: 'GDP Growth Rate', unit: '%', source: 'Eurostat',
    countries: { LV: { label: 'Latvia', series: [{ period: '2026-Q1', value: 1 }] } } }),
  fetchEconomyData: vi.fn().mockResolvedValue(null), fetchAllWeather: vi.fn().mockResolvedValue([]),
  fetchPortData: vi.fn().mockResolvedValue(null), fetchPropertyData: vi.fn().mockResolvedValue(null),
  fetchEnvironmentData: vi.fn().mockResolvedValue(null), fetchEUFunds: vi.fn().mockResolvedValue(null),
}));

function Location() {
  const value = useLocation();
  return <output data-testid="location">{value.pathname}{value.search}</output>;
}

async function renderDashboard(path = '/data') {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    indicators: [{ id: 'gdp', title: 'GDP Growth Rate', unit: '%', dataset: 'namq_10_gdp', freq: 'Q' }],
  })));
  await act(async () => {
    render(<ThemeProvider><CountryProvider><FilterProvider><MemoryRouter initialEntries={[path]}>
      <Location />
      <Routes><Route element={<SiteLayout />}>
        <Route path="/data/:section?" element={<App />} />
        <Route path="/explore" element={<DataExplorerPage />} />
      </Route></Routes>
    </MemoryRouter></FilterProvider></CountryProvider></ThemeProvider>);
    await vi.dynamicImportSettled();
  });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('dashboard and explorer are different jobs', () => {
  it('shows every sector on the dashboard, with one sector navigator', async () => {
    await renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: 'The Baltic dashboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Economy & markets' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeTruthy();
    expect(screen.getByText('Market snapshot').closest('details')?.open).toBe(true);
    expect(screen.getByTestId('market-ticker')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Dashboard sectors' });
    expect(within(nav).getAllByRole('link')).toHaveLength(DASHBOARD_SECTIONS.length + 1);
    for (const section of DASHBOARD_SECTIONS) expect(document.getElementById(section)).not.toBeNull();
    expect(screen.queryByText('Indicator library')).toBeNull();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  it('focuses one sector and returns to all sectors while preserving the country', async () => {
    await renderDashboard('/data?country=EE');
    const nav = screen.getByRole('navigation', { name: 'Dashboard sectors' });
    await act(async () => { fireEvent.click(within(nav).getByRole('link', { name: 'Economy' })); });
    expect(screen.getByRole('heading', { level: 1, name: 'Economy dashboard' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Insights' })).toBeNull();
    expect(screen.queryByText('Market snapshot')).toBeNull();
    expect(document.getElementById('economy')).not.toBeNull();
    expect(document.getElementById('trade')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/data/economy?country=EE');
    await act(async () => { fireEvent.click(within(nav).getByRole('link', { name: 'All sectors' })); await vi.dynamicImportSettled(); });
    for (const section of DASHBOARD_SECTIONS) expect(document.getElementById(section)).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeTruthy();
  });

  it('opens an old selected-measure bookmark in the explorer instead of showing another screen', async () => {
    await renderDashboard('/data/economy?indicator=gdp&country=EE');
    expect(screen.getByTestId('location').textContent).toContain('/explore?');
    expect(screen.getByTestId('location').textContent).toContain('indicator=gdp');
    expect(screen.getByTestId('location').textContent).toContain('section=economy');
    expect(screen.getByRole('heading', { level: 1, name: 'Data explorer' })).toBeTruthy();
    expect(document.getElementById('economy')).toBeNull();
  });

  it('keeps an old explicit tools bookmark on the sector dashboard', async () => {
    await renderDashboard('/data/economy?indicator=gdp&view=tools&country=LT');
    expect(screen.getByRole('heading', { level: 1, name: 'Economy dashboard' })).toBeTruthy();
    expect(document.getElementById('economy')).not.toBeNull();
    expect(screen.queryByText('Indicator library')).toBeNull();
  });
});
