import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { PropertyTile } from '../src/components/PropertyTile';
import { EnvironmentTile } from '../src/components/EnvironmentTile';
import { EconomyTile } from '../src/components/EconomyTile';
import { BusinessTile } from '../src/components/BusinessTile';

/**
 * Rendering a tile with a payload that resolved but is the wrong shape.
 *
 * This is the durable form of a manual check: serve every endpoint an empty
 * object, then one where the fields exist but hold the wrong types, and see
 * what survives. Before this pass, seven of the nine dashboard sections threw
 * and were replaced by their error-boundary fallback; `SystemStatusFooter`
 * threw *outside* those boundaries and took the whole page with it.
 *
 * Both fixtures resolve, which is the point. A rejected fetch was always
 * handled; a 200 carrying the wrong shape was not, and that is what a renamed
 * upstream dataset or a changed API contract actually looks like.
 */

/** A payload with nothing in it at all. */
const EMPTY = {} as never;

/** A payload whose fields exist and are all the wrong type. */
const WRONG = {
  electricityCurrent: null,
  electricityPrices: 'nope',
  exchangeRates: {},
  indicators: null,
  businessPulse: null,
  weather: 'nope',
  weatherCoverage: 'nope',
  airQuality: null,
  capitalPopulation: 'lots',
  constructionPermits: null,
  energyCerts: 7,
  totalPermits: null,
  totalCerts: 'x',
  total: 0,
  statusSummary: null,
} as never;

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

describe('a tile handed a payload of the wrong shape', () => {
  const cases: [string, (payload: never) => ReactElement][] = [
    ['PropertyTile', (p) => <PropertyTile data={p} loading={false} />],
    ['EnvironmentTile', (p) => <EnvironmentTile data={p} loading={false} />],
    ['EconomyTile', (p) => <EconomyTile data={p} loading={false} />],
    ['BusinessTile', (p) => <BusinessTile euFunds={p} euLoading={false} />],
  ];

  for (const [name, build] of cases) {
    for (const [shape, payload] of [
      ['an empty object', EMPTY],
      ['fields of the wrong type', WRONG],
    ] as const) {
      it(`${name} renders rather than throwing on ${shape}`, () => {
        // `fetch` is not available in this environment and the tiles that own
        // their own requests should not make any for this assertion.
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        expect(() => mount(build(payload))).not.toThrow();
        vi.unstubAllGlobals();
      });
    }
  }

  it('shows a dash rather than a number it did not receive', () => {
    // The two defaults this pass exists to remove both *invented a reading* —
    // one said the air was clean, one said the sea was a storm. An absent
    // figure has to look absent.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = mount(<PropertyTile data={WRONG} loading={false} />);
    expect(container.textContent, 'an absent total must render as a dash').toContain('—');
    expect(container.textContent, 'and never as a fabricated zero').not.toMatch(/\b0\b\s*Construction/);
    vi.unstubAllGlobals();
  });
});
