import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import App from '../src/App';
import { Header } from '../src/components/Header';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { DASHBOARD_SECTIONS } from '../src/sections';

vi.mock('../src/components/OnboardingTutorial', () => ({ OnboardingTutorial: () => null }));
vi.mock('../src/components/InsightsBanner', () => ({ InsightsBanner: () => <h2>Insights</h2> }));
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

class Observer {
  observe() {}
  disconnect() {}
}

async function renderOverview() {
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ports: [], indicators: [] })));
  await act(async () => {
    render(
      <ThemeProvider><CountryProvider><FilterProvider>
        <MemoryRouter initialEntries={['/data']}>
          <Header />
          <Routes><Route path="/data/:section?" element={<App />} /></Routes>
        </MemoryRouter>
      </FilterProvider></CountryProvider></ThemeProvider>,
    );
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Overview without a duplicate section menu', () => {
  it('keeps Insights and every data section but only one Economy navigation link', async () => {
    await renderOverview();
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Economy & markets' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Economy' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Jump to a dashboard section' })).toBeNull();
    for (const section of DASHBOARD_SECTIONS) {
      expect(document.getElementById(section)).not.toBeNull();
    }
  });

  it('still opens a subject from the unchanged top navigation and returns to Overview', async () => {
    await renderOverview();
    fireEvent.click(screen.getByRole('link', { name: 'Economy' }));
    expect(screen.getByRole('link', { name: 'Economy' }).getAttribute('aria-current')).toBe('page');
    expect(document.getElementById('economy')).not.toBeNull();
    expect(document.getElementById('trade')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
    expect(document.getElementById('trade')).not.toBeNull();
    expect(screen.getAllByRole('link', { name: 'Economy' })).toHaveLength(1);
  });
});
