import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * One bad row must not destroy the good ones.
 *
 * `WRONG` above sets `constructionPermits: null`, so `list()` returns `[]` and
 * no arithmetic runs at all. The gap it leaves is the case where the **array
 * arrives and an item inside it is wrong** — which is what `list<T>()` cannot
 * catch by construction: it validates the container and *casts* the contents,
 * so `{ count: number }` is a compile-time claim about a runtime payload.
 *
 * That gap was reachable:
 *
 *     Math.max(undefined, 1) === NaN
 *     Math.max(NaN, 1)       === NaN
 *
 * so a single item without `count` made `maxPermits` NaN, every width `NaN%`,
 * and CSS dropped all of them — leaving every bar at the container's default.
 * Not a broken chart, a **wrong** one: it says every municipality is equal.
 * That is the EU-funds `Infinity` bars (DESIGN.md §3.8) by a different
 * arithmetic route, and the third member of that family.
 *
 * The assertion is on the **rendered width of the valid row**, not on
 * `finite()`. A test of the helper passes today and always did; the defect was
 * that nothing called it here.
 */
describe('a bar chart given one unusable row', () => {
  /** Inline widths, in source order, for the bars matching a fill class. */
  function widths(container: HTMLElement, fill: string): string[] {
    return [...container.querySelectorAll<HTMLElement>(`.${fill}`)].map((el) => el.style.width);
  }

  const withBadRow = {
    constructionPermits: [
      { municipality: 'Rīga', count: 12 },
      { municipality: 'Liepāja' }, // no `count` — the shape TypeScript promised
      { municipality: 'Ventspils', count: 6 },
    ],
    energyCerts: [
      { rating: 'Centralizētā apkure', count: 40 },
      { rating: 'Malka', count: null },
      { rating: 'Granulas', count: 10 },
    ],
    totalPermits: 18,
    totalCerts: 50,
  } as never;

  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
  afterEach(() => vi.unstubAllGlobals());

  it('still draws the rows that are usable', () => {
    const { container } = mount(<PropertyTile data={withBadRow} loading={false} />);

    for (const fill of ['dash-fill-cat1', 'dash-fill-cat2']) {
      const drawn = widths(container, fill);
      expect(drawn.length, `${fill}: expected bars to render`).toBeGreaterThan(0);
      for (const w of drawn) {
        expect(w, `${fill}: a bar was left without a width`).not.toBe('');
        expect(w, `${fill}: "${w}" is not a usable width`).toMatch(/^\d+(\.\d+)?%$/);
      }
    }
  });

  it('gives the largest usable row the full bar', () => {
    // The sharpest form of the defect: with NaN widths every bar rendered
    // identically, so "all rows equal" was the picture. The widest row must be
    // 100% and the others must be smaller, which is a statement about the
    // chart being *right* rather than merely non-crashing.
    const { container } = mount(<PropertyTile data={withBadRow} loading={false} />);

    const permits = widths(container, 'dash-fill-cat1').map(parseFloat);
    expect(permits[0], 'the largest row should fill the track').toBe(100);
    expect(permits.some((w) => w < 100), 'every bar is the same width — the chart says nothing').toBe(true);
  });

  it('renders an all-zero chart as empty bars rather than as a special case', () => {
    // The `, 1` floor genuinely guards division by zero, and that still has to
    // work: all-zero counts are a real reading and must draw as 0%, not as a
    // fallback or a dash. This passed before the fix and has to keep passing —
    // trading one wrong chart for another is not a repair.
    const allZero = {
      constructionPermits: [{ municipality: 'Rīga', count: 0 }, { municipality: 'Liepāja', count: 0 }],
      energyCerts: [{ rating: 'Malka', count: 0 }],
      totalPermits: 0,
      totalCerts: 0,
    } as never;

    const { container } = mount(<PropertyTile data={allZero} loading={false} />);
    expect(widths(container, 'dash-fill-cat1')).toEqual(['0%', '0%']);
    expect(widths(container, 'dash-fill-cat2')).toEqual(['0%']);
  });

  it('keeps the unusable row, and draws no track for it', () => {
    // Two decisions worth pinning, because the obvious alternatives are both
    // wrong.
    //
    // The row is **not dropped**: we did hear about that municipality, and
    // removing it silently shortens a "top 8" without saying so —
    // `RankedComparison` refuses the same thing, naming countries it cannot
    // rank rather than omitting them.
    //
    // And it draws **no track at all**, rather than an empty one. An empty
    // track is pixel-identical to a zero-length bar, so it would render "no
    // reading" as "none were issued" — absence as a confident value, which is
    // the defect DESIGN.md §3.8 exists to name.
    const { container } = mount(<PropertyTile data={withBadRow} loading={false} />);

    expect(container.textContent, 'the row we cannot draw must still be named').toContain('Liepāja');
    expect(container.textContent, 'and its figure must look absent').toContain('—');

    // Three rows arrived, one is unusable, so two tracks and two fills.
    expect(container.querySelectorAll('.dash-fill-cat1')).toHaveLength(2);
    expect(widths(container, 'dash-fill-cat1')).not.toContain('0%');
  });

  /**
   * The same mechanism in a second component, found by grepping for the
   * mechanism rather than reading the list of components.
   *
   * `BusinessTile` already carries a comment about the EU-funds `Infinity`
   * bars and a `total > 0` guard that fixed them. The guard protects the
   * **denominator**. An item whose `count` never arrived divides a missing
   * numerator instead — `undefined / 12` is `NaN` — so the component that
   * documents this defect still had a live instance of it.
   *
   * It is a milder instance than `PropertyTile`'s, and the difference is worth
   * naming: `pct` here is computed against `euFunds.total`, a *per-row*
   * denominator, so a bad row loses only its own bar. `PropertyTile` divides
   * by a shared `Math.max(...)`, so one bad row poisoned every bar in the
   * chart. Shared denominators fail worse.
   */
  const euFundsWithBadRow = {
    total: 12,
    source: 'CFLA',
    statusSummary: [
      { status: 'Apstiprināts', count: 8 },
      { status: 'Izvērtēšanā' }, // no `count`
      { status: 'Noraidīts', count: 1 },
    ],
  } as never;

  it('BusinessTile draws every bar it renders a track for', () => {
    // The assertion is that a *track* never appears without a *fill*. An empty
    // track is pixel-identical to a zero-length bar, so a status with no count
    // would report "no projects at this status" — a number nobody published.
    const { container } = mount(<BusinessTile euFunds={euFundsWithBadRow} euLoading={false} />);

    const tracks = container.querySelectorAll('div.h-1\\.5.dash-raised');
    const fills = [...container.querySelectorAll<HTMLElement>('div.h-full.rounded-full')]
      .map((el) => el.style.width);

    expect(tracks.length, 'expected some status bars').toBeGreaterThan(0);
    expect(fills.length, 'a track was drawn with no fill inside it').toBe(tracks.length);
    for (const w of fills) {
      expect(w, `"${w}" is not a usable width`).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it('BusinessTile survives a status that is not a string', () => {
    // `s.status.toLowerCase()` decides the bar colour, and it is called on a
    // value `list<T>()` only *claims* is a string. This one is a page-killer
    // rather than a wrong picture: it throws in the render path.
    const euFunds = {
      total: 4,
      source: 'CFLA',
      statusSummary: [{ count: 4 }],
    } as never;

    expect(() => mount(<BusinessTile euFunds={euFunds} euLoading={false} />)).not.toThrow();
  });
});
