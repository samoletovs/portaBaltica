import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TradeTile } from '../src/components/TradeTile';
import { CountryProvider } from '../src/CountryContext';
import { fetchBalticCompare, type BalticCompareData } from '../src/api';
import { formatValue } from '../src/utils/formatValue';

vi.mock('../src/api', () => ({ fetchBalticCompare: vi.fn() }));
vi.mock('../src/components/BalticCompareChart', () => ({ BalticCompareChart: () => null }));
vi.mock('../src/components/FreightModalSplit', () => ({ FreightModalSplit: () => null }));
vi.mock('../src/components/TradePartnersPanel', () => ({ TradePartnersPanel: () => null }));

const require = createRequire(import.meta.url);
const { tourism } = require('../api/shared/indicators.js') as { tourism: { unit: string; dataset: string } };
const arrivals = 313942;

beforeEach(() => { vi.mocked(fetchBalticCompare).mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the arrivals card measures people, not thousands of people', () => {
  it.each([true, false])('keeps the same magnitude with an API unit present=%s', async reported => {
    vi.mocked(fetchBalticCompare).mockImplementation(async indicator => indicator === 'tourism' ? {
      indicator, title: 'Tourist arrivals', unit: reported ? tourism.unit : '', source: `Eurostat (${tourism.dataset})`,
      countries: {
        LV: { label: 'Latvia', series: [{ period: '2026-06', value: arrivals }] },
        EE: { label: 'Estonia', series: [] },
        LT: { label: 'Lithuania', series: [] },
      },
    } as BalticCompareData : null);
    await act(async () => {
      render(<CountryProvider><MemoryRouter><TradeTile /></MemoryRouter></CountryProvider>);
    });
    const card = screen.getByRole('button', { name: 'View Tourist arrivals details' });
    expect(within(card).getByText(formatValue(arrivals, tourism.unit))).toBeTruthy();
    expect(card.textContent).not.toContain('thousands');
  });
});
