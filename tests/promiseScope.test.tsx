/**
 * What does one failure inside a `.then` take with it?
 *
 * The origin of this sweep: `DataTicker` read `d.electricityCurrent.toFixed(2)`
 * inside a `.then` that also built the exchange rates and four indicators. A
 * payload without that one field threw, the chain's single `.catch` swallowed
 * it, and everything else in the chain went too. The ticker did not look
 * broken — it looked like there was no data, which is why nobody reported it.
 *
 * #100 fixed the *field reads*. It did not change the *scope*: the `.then`
 * still spans four independent things behind one `.catch`, so the next
 * unguarded read has the same blast radius. This file tests the scope by
 * poisoning exactly one thing and asserting the others survive.
 *
 * That is a different question from "does it crash". A chain can be entirely
 * crash-free and still discard three good values because a fourth was absent.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { DataTicker } from '../src/components/DataTicker';

function mount(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>{ui}</FilterProvider>
        </CountryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** A ticker payload where every independent part is present and usable. */
const WHOLE = {
  electricityCurrent: 82.4,
  exchangeRates: [
    { currency: 'USD', rate: 1.0842 },
    { currency: 'GBP', rate: 0.8561 },
  ],
  indicators: [
    { label: 'GDP Growth', value: '2.1%', change: '+0.3pp' },
    { label: 'CPI Inflation', value: '3.4%', change: '-0.2pp' },
  ],
};

function serve(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response)));
}

describe('one bad field in a shared .then', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders every part when the payload is whole', async () => {
    // The control. Without this, a test asserting "the rates survived" cannot
    // distinguish a fix from a payload that never had rates.
    serve(WHOLE);
    const { container } = mount(<DataTicker />);
    await waitFor(() => expect(container.textContent).toContain('EUR/USD'));

    expect(container.textContent).toContain('Electricity');
    expect(container.textContent).toContain('EUR/GBP');
    expect(container.textContent).toContain('GDP Growth');
    expect(container.textContent).toContain('CPI Inflation');
  });

  it('keeps the rates and indicators when an indicator entry is null', async () => {
    // `list()` checks the container, not the contents, so an array carrying a
    // null passes through and `ind.label` throws. Before the split that throw
    // reached the chain's single `.catch` and discarded electricity and both
    // rates — three good values lost to one bad one.
    serve({ ...WHOLE, indicators: [null, { label: 'GDP Growth', value: '2.1%' }] });
    const { container } = mount(<DataTicker />);

    await waitFor(() => expect(container.textContent).toContain('Electricity'));
    expect(container.textContent, 'the rates went with the bad indicator').toContain('EUR/USD');
    expect(container.textContent, 'the usable indicator went too').toContain('GDP Growth');
  });

  it('keeps the rest when an exchange rate entry is null', async () => {
    serve({ ...WHOLE, exchangeRates: [null, { currency: 'GBP', rate: 0.8561 }] });
    const { container } = mount(<DataTicker />);

    await waitFor(() => expect(container.textContent).toContain('Electricity'));
    expect(container.textContent, 'a bad rate took the good one').toContain('EUR/GBP');
    expect(container.textContent, 'a bad rate took the indicators').toContain('GDP Growth');
  });

  it('keeps the rest when the indicators are not an array at all', async () => {
    serve({ ...WHOLE, indicators: 'nope' });
    const { container } = mount(<DataTicker />);

    await waitFor(() => expect(container.textContent).toContain('Electricity'));
    expect(container.textContent).toContain('EUR/USD');
  });

  it('renders nothing rather than throwing when the whole payload is hostile', async () => {
    serve({ electricityCurrent: 'lots', exchangeRates: 7, indicators: null });
    expect(() => mount(<DataTicker />)).not.toThrow();
  });
});

/**
 * The patterns that were already right, asserted so the sweep is trustworthy.
 *
 * A sweep that only reports hits is indistinguishable from a sweep that
 * stopped early, so the chains judged safe are checked rather than assumed —
 * and pinning them stops a later refactor quietly collapsing a correct
 * per-item guard back into a shared one.
 */
describe('the chains that were already scoped correctly', () => {
  it('gives each indicator row its own failure', () => {
    // `IndicatorTable` maps N indicators into N chains, each ending in
    // `.catch(() => null)`, and filters the nulls out. One indicator's API
    // failing costs that row and nothing else.
    const source = readFileSync(resolve('src/components/IndicatorTable.tsx'), 'utf8');
    const inner = source.slice(source.indexOf('await Promise.all('));
    const catches = [...inner.matchAll(/\.catch\(\(\) => null\)/g)];
    expect(catches.length, 'each branch inside the Promise.all needs its own catch').toBe(2);
  });

  it('gives each of the dashboard’s two maritime requests its own failure', () => {
    // `App.tsx` awaits weather and port statistics together but attaches a
    // `.catch` to each *before* `Promise.all` sees them, so neither can reject
    // the pair. This is the shape the ticker was missing.
    const source = readFileSync(resolve('src/App.tsx'), 'utf8');
    expect(source).toMatch(/fetchAllWeather\(\)\.catch\(/);
    expect(source).toMatch(/fetchPortData\(country\)\.catch\(/);
  });

  it('leaves genuinely interdependent requests coupled', () => {
    // Not every shared `.then` is a defect. `FreightModalSplit` needs *both*
    // rail and road to compute a share at all — a modal split from one mode is
    // not a partial answer, it is a wrong one — so a single `.catch` covering
    // the pair is correct and must not be "fixed" into two.
    const source = readFileSync(resolve('src/components/FreightModalSplit.tsx'), 'utf8');
    expect(source).toMatch(/Promise\.all\(\[fetchBalticCompare\('rail_freight'\), fetchBalticCompare\('road_freight_tkm'\)\]\)/);
    expect(source, 'the pair is one unit of meaning').toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setSplits\(null\); \}\)/);
  });
});
