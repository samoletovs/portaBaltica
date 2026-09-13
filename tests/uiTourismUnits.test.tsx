import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TradeTile } from '../src/components/TradeTile';
import { IndicatorCard, IndicatorChart } from '../src/components/IndicatorCard';
import { ApiDocsPage } from '../src/components/ApiDocsPage';
import { CountryProvider } from '../src/CountryContext';
import { fetchBalticCompare, type BalticCompareData } from '../src/api';
import { formatValue } from '../src/utils/formatValue';

vi.mock('../src/api', () => ({ fetchBalticCompare: vi.fn() }));
vi.mock('../src/components/BalticCompareChart', () => ({ BalticCompareChart: () => null }));
vi.mock('../src/components/FreightModalSplit', () => ({ FreightModalSplit: () => null }));
vi.mock('../src/components/TradePartnersPanel', () => ({ TradePartnersPanel: () => null }));

const require = createRequire(import.meta.url);
const { tourism } = require('../api/shared/indicators.js') as { tourism: { unit: string; dataset: string } };
const nights = 528988;

beforeEach(() => { vi.mocked(fetchBalticCompare).mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the overnight-stays card labels guest nights, not arrivals', () => {
  it.each([true, false])('keeps the same magnitude with an API unit present=%s', async reported => {
    vi.mocked(fetchBalticCompare).mockImplementation(async indicator => indicator === 'tourism' ? {
      indicator, title: 'Overnight stays', unit: reported ? tourism.unit : '', source: `Eurostat (${tourism.dataset})`,
      countries: {
        LV: { label: 'Latvia', series: [{ period: '2026-06', value: nights }] },
        EE: { label: 'Estonia', series: [] },
        LT: { label: 'Lithuania', series: [] },
      },
    } as BalticCompareData : null);
    await act(async () => {
      render(<CountryProvider><MemoryRouter><TradeTile /></MemoryRouter></CountryProvider>);
    });

    const card = screen.getByRole('button', { name: 'View Overnight stays details' });
    expect(within(card).getByText(formatValue(nights, 'nights'))).toBeTruthy();
    expect(card.textContent).not.toMatch(/arrivals|persons|thousands/);
  });
});

describe('the separate national arrivals view', () => {
  it.each(['card', 'chart'])('loads CSP persons rather than Baltic nights in the %s', async kind => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      indicator: 'tourist_arrivals', title: 'Tourist arrivals', unit: 'persons', source: 'CSP Latvia',
      series: [{ period: '2026Q1', value: 447132 }, { period: '2026Q2', value: 749999 }],
      summary: { latest: 749999, previous: 447132, change: 302867, count: 2, min: 447132, max: 749999, avg: 598565.5 },
    }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => {
      render(<CountryProvider><MemoryRouter>{kind === 'card'
        ? <IndicatorCard id="tourist_arrivals" title="Tourist arrivals" unit="persons" />
        : <IndicatorChart id="tourist_arrivals" />}</MemoryRouter></CountryProvider>);
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/historical-data?indicator=tourist_arrivals&years=${kind === 'card' ? 5 : 10}`, { cache: 'no-cache' },
    );
    expect(fetchBalticCompare).not.toHaveBeenCalled();
    if (kind === 'card') expect(screen.getByText(formatValue(749999, 'persons'))).toBeTruthy();
    else expect(screen.getAllByText(/CSP Latvia/).length).toBeGreaterThan(0);
  });

  it('rejects an older national response that still claims thousands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      unit: 'thousands', series: [{ period: '2026Q2', value: 749999 }],
    })));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      render(<CountryProvider><MemoryRouter>
        <IndicatorCard id="tourist_arrivals" title="Tourist arrivals" unit="persons" />
      </MemoryRouter></CountryProvider>);
    });
    expect(warning).toHaveBeenCalledWith('National arrivals response has an unsupported unit:', 'thousands');
    expect(screen.queryByText(formatValue(749999, 'thousands'))).toBeNull();
    expect(fetchBalticCompare).not.toHaveBeenCalled();
  });

  it('links the national API documentation to the arrivals endpoint, not the nights comparator', () => {
    render(<MemoryRouter><ApiDocsPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'tourist_arrivals' }).getAttribute('href'))
      .toBe('/api/historical-data?indicator=tourist_arrivals');
  });
});
