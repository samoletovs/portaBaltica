/**
 * The indicator page: does it claim itself, and does it render at all?
 *
 * WHAT WAS MEASURED
 * -----------------
 * The brief that produced this change said "there are 71 indicators, each with
 * a page that serves 200 and is linked from the dashboard". The first half is
 * true and the second is not, and the gap was the whole finding.
 *
 * Measured against production, 2026-08-28T14:19:29Z, in a rendering Chromium:
 *
 *     /indicator/salary              renders: Hourly Labour Cost
 *     /indicator/gdp                 renders: GDP Growth Rate
 *     /indicator/gdp_per_capita      UNKNOWN INDICATOR      <- in the registry
 *     /indicator/youth_unemployment  UNKNOWN INDICATOR      <- in the registry
 *     /indicator/core_inflation      UNKNOWN INDICATOR      <- in the registry
 *     /indicator/not-a-real-indicator UNKNOWN INDICATOR     <- pure fiction
 *
 * All six answered HTTP 200. `INDICATOR_INFO` held 24 ids; the registry holds
 * 71; only 14 overlapped. So 57 indicators the dashboard serves rendered a dead
 * end that a status check could not distinguish from a real page.
 *
 * And it was reader-facing rather than theoretical. `ArticleView` links to
 * `/indicator/<resolveChartRef(...)>` under "Check it yourself", and
 * `resolveChartRef` resolves against the 71. Measured over every published tier
 * A article on the same day: of the 19 carrying a resolvable chart reference,
 * **14 sent the reader to "Unknown indicator"** and 5 to a page. The one link
 * on the site that exists to prove a figure is checkable was broken three times
 * in four.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { IndicatorPage } from '../src/components/IndicatorPage';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const registry = require(resolve(ROOT, 'api/shared/indicators.js')) as
  Record<string, { title: string; unit: string; dataset: string; freq: string }>;

// The charts pull recharts through a lazy boundary and fetch their own series.
// Nothing here is about charts; the head and the gate are what is under test.
vi.mock('../src/components/IndicatorCard', () => ({
  IndicatorChart: ({ id }: { id: string }) => <div data-testid="national-series">{id}</div>,
}));
vi.mock('../src/components/BalticCompareChart', () => ({
  BalticCompareChart: ({ indicator }: { indicator: string }) => (
    <div data-testid="baltic-compare">{indicator}</div>
  ),
}));

/** The catalogue endpoint, answering with the real registry. */
function stubRegistry(entries?: unknown) {
  const indicators = entries ?? Object.entries(registry).map(([id, def]) => ({
    id, title: def.title, unit: def.unit, dataset: def.dataset, freq: def.freq,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ indicators }),
    } as unknown as Response),
  );
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <CountryProvider>
        <FilterProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/indicator/:id" element={<IndicatorPage />} />
            </Routes>
          </MemoryRouter>
        </FilterProvider>
      </CountryProvider>
    </ThemeProvider>,
  );
}

function canonical(): string | null {
  return document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href')
    ?? null;
}

function robots(): string | null {
  return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
}

/**
 * Let the mocked fetch settle, without waiting on a clock.
 *
 * Adopted from `dashboardCadence.test.tsx`, and for its reason:
 * `tests/suiteDeterminism.test.ts` refuses a new wall-clock wait in a parallel
 * suite, because a polling budget measures how busy the machine is rather than
 * whether the code works. The registry response resolves through a promise
 * chain and React commits on a macrotask, so each turn drains the microtask
 * queue and then yields one macrotask via `setImmediate` — the check phase,
 * with no timer and therefore no duration to exceed.
 *
 * The bound is a turn count, not a duration: a component that never settles
 * fails here with this sentence instead of hanging.
 */
async function settle(until: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (until()) return;
    await act(async () => {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    });
  }
  throw new Error(
    `the page had not settled after ${turns} turns of the event loop; it is waiting on ` +
      'something this helper cannot drain — a real timer, or a promise that never resolves',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('link[rel="canonical"], meta[name="robots"]')
    .forEach((node) => node.remove());
});

describe('a page claims its own URL', () => {
  it('does so for an indicator with an editorial entry', async () => {
    stubRegistry();
    renderAt('/indicator/salary');

    await settle(() => document.title.includes('Hourly Labour Cost'));
    expect(canonical()).toContain('/indicator/salary');
    // The defect this replaces: the page inherited the shell's canonical, which
    // names the home page, so 71 URLs would have been 71 duplicates of one page.
    expect(canonical()).not.toMatch(/\/$/);
  });

  it('does so for a registry indicator that had no page at all', async () => {
    // `road_freight` is what the road-freight article links to under "Check it
    // yourself". Before this change it rendered "Unknown indicator".
    stubRegistry();
    renderAt('/indicator/road_freight');

    // Wait on the TITLE, not the canonical. `canonicalPath` is derived from the
    // route parameter and is therefore correct on the very first render, so
    // waiting on it would resolve before the registry had landed and assert
    // nothing about the fetch — the assertion below then read the pre-fetch
    // title and failed. A gate has to wait on the thing it is gating.
    await settle(() => document.title.includes(registry.road_freight.title));
    expect(canonical()).toContain('/indicator/road_freight');
    expect(screen.queryByText('Unknown indicator.')).toBeNull();
  });

  it('renders the Baltic comparison for a registry id, without a translation table', async () => {
    // `EUROSTAT_MAP` translates the legacy ids. A registry id IS the id the API
    // serves, and routing every id through the map is what left 57 unreachable.
    stubRegistry();
    renderAt('/indicator/core_inflation');

    await settle(() => screen.queryByTestId('baltic-compare') !== null);
    expect(screen.getByTestId('baltic-compare').textContent).toBe('core_inflation');
  });

  it('still translates a legacy id through the map', async () => {
    // `gov_debt` is not a registry id; the map sends it to `gov_debt_gdp`.
    // Losing this would break the older half while fixing the newer.
    stubRegistry();
    renderAt('/indicator/gov_debt');

    await settle(() => screen.queryByTestId('baltic-compare') !== null);
    expect(screen.getByTestId('baltic-compare').textContent).toBe('gov_debt_gdp');
  });

  it('shows the Latvian series only where one is served', async () => {
    // `/api/historical-data?indicator=road_freight` answers 400 while the
    // comparison endpoint answers 200 — measured. An empty chart frame on 57
    // pages is worse than no chart.
    stubRegistry();
    const withSeries = renderAt('/indicator/gdp');
    await settle(() => screen.queryByTestId('national-series') !== null);
    withSeries.unmount();

    stubRegistry();
    renderAt('/indicator/road_freight');
    await settle(() => screen.queryByTestId('baltic-compare') !== null);
    expect(screen.queryByTestId('national-series')).toBeNull();
  });
});

describe('a dead end says so, and says it to a crawler', () => {
  it('refuses an id neither we nor the registry knows', async () => {
    stubRegistry();
    renderAt('/indicator/not-a-real-indicator');

    await settle(() => screen.queryByText('Unknown indicator.') !== null);
  });

  it('marks it noindex, because it cannot be a 404', async () => {
    // Every route on this SPA answers HTTP 200 — `/utterly-invented-page`
    // included, measured against production — so a crawler has no status code
    // to read. `noindex` is the only signal available.
    stubRegistry();
    renderAt('/indicator/not-a-real-indicator');

    await settle(() => robots() === 'noindex, nofollow');
    expect(robots()).toBe('noindex, nofollow');
  });

  it('indexes a real page, which is the control', async () => {
    // Without this, the assertion above would pass on a page that marks
    // everything noindex — including all 71 we just asked to be crawled.
    stubRegistry();
    renderAt('/indicator/salary');

    await settle(() => robots() === 'index, follow');
    expect(robots()).toBe('index, follow');
  });

  it('does not call a real indicator unknown while the registry is in flight', async () => {
    // Three states, kept apart: not asked, asked and failed, answered. A page
    // that says "Unknown indicator" before the catalogue lands would flash a
    // dead end at every reader and hand a crawler whichever it saw first.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderAt('/indicator/road_freight');

    expect(screen.queryByText('Unknown indicator.')).toBeNull();
    expect(screen.getByLabelText('Loading the indicator')).toBeTruthy();
  });

  it('falls back to the editorial entry when the registry cannot be read', async () => {
    // A failed catalogue must not take down the 24 pages that never needed it.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderAt('/indicator/gdp');

    await settle(() => document.title.includes('GDP Growth Rate'));
    expect(screen.queryByText('Unknown indicator.')).toBeNull();
    expect(canonical()).toContain('/indicator/gdp');
  });
});

describe('the description is distinct on every page', () => {
  /**
   * The composed form leads with the registry title, and that is load-bearing.
   *
   * Measured across all 71: `freq`, `unit` and `dataset` together are distinct
   * for only 47 of them — eight inflation variants share
   * `M | % YoY | prc_hicp_minr` between them — so a description built from
   * those three alone would put an identical sentence on eight pages. That is
   * the duplicate-content problem one level down from the canonical one this
   * change is about. `title` is distinct 71 of 71.
   */
  const source = readFileSync(resolve(ROOT, 'src/components/IndicatorPage.tsx'), 'utf-8')
    .replace(/\r\n/g, '\n');

  it('proves the collision the composition is written to avoid', () => {
    const triples = Object.values(registry).map((d) => `${d.freq}|${d.unit}|${d.dataset}`);
    const titles = Object.values(registry).map((d) => d.title);

    // The control for the assertion below: if these were already distinct, the
    // composition would not need to lead with the title and this rule would be
    // guarding nothing.
    expect(new Set(triples).size, 'freq/unit/dataset are distinct, so nothing forces the title')
      .toBeLessThan(Object.keys(registry).length);
    expect(new Set(titles).size).toBe(Object.keys(registry).length);
  });

  it('leads the composed description with the title', () => {
    const composed = source.slice(source.indexOf('const description'), source.indexOf('usePageMeta('));

    expect(composed).toMatch(/\$\{registered\.title\}/);
  });

  it('uses the editorial description verbatim where there is one', () => {
    expect(source).toMatch(/info\?\.description/);
  });

  it('keeps the 24 editorial descriptions distinct', () => {
    const info = source.slice(source.indexOf('const INDICATOR_INFO'), source.indexOf('export function IndicatorPage'));
    const descriptions = [...info.matchAll(/description: '([^']*)'/g)].map((m) => m[1]);

    expect(descriptions.length, 'the parser found no descriptions').toBeGreaterThan(20);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
