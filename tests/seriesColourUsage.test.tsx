/**
 * The series palette has two jobs and only one contrast floor.
 *
 * `--series-lv` and its siblings are tuned to clear **3:1** on a card, which is
 * what WCAG 2.2 SC 1.4.11 asks of a graphical object — a chart line. They were
 * also used to colour text, where SC 1.4.3 asks **4.5:1** of anything under
 * 24px. Measured in a real browser against the real card surface, across both
 * themes and eleven routes, **328 of 496 series-coloured text nodes failed the
 * floor that governed them**. At the values current when that was written:
 *
 *     light  --series-lt  #c28206  3.24:1     dark  --series-lv  #dc3b4a  3.90:1
 *     light  --series-lv  #e6414e  4.01:1
 *     light  --series-ee  #1a7ae0  4.28:1
 *
 * Four failures across two themes is not four unlucky values. A hue sitting
 * just above 3:1 as a line cannot simultaneously clear 4.5:1 as text, so this
 * was structural from the moment the palette was pointed at a `<span>`.
 *
 * The 2026 chroma reduction demonstrated that directly. It changed all six
 * Baltic values and *raised* most of these ratios — light Lithuania to 4.18,
 * dark Lithuania down from 9.92 to 4.15 — and **not one crossed 4.5**. The
 * hexes above are therefore history; the structure they illustrate is not.
 *
 * ─── Why the existing contrast tests could not see it ───
 *
 * They resolve a *token* and check it against the floor it was designed for,
 * and `--series-lv` passes 3:1. Nothing in the suite knew those 328 nodes were
 * text. So a further assertion about the token would have been the same test
 * again — the failure was in **usage**, not in definition.
 *
 * This file therefore renders the components and inspects what they actually
 * produce. `tests/seriesContrast.live.test.ts` does the full computed-colour
 * measurement in a real browser, where font size and the painted background
 * are real; this one runs in the PR gate and catches a new call site the day
 * it is written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BalticCompareChart } from '../src/components/BalticCompareChart';
import { PowerMarketCard } from '../src/components/PowerMarketCard';
import { SeriesSwatch } from '../src/components/SeriesSwatch';

const fetchBalticCompare = vi.fn();
const fetchPowerPrices = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...a: unknown[]) => fetchBalticCompare(...a),
  fetchPowerPrices: (...a: unknown[]) => fetchPowerPrices(...a),
}));

/**
 * The palette is read out of `ThemeContext` rather than imported, matching how
 * `design-system.test.ts` already reads it. Exporting a constant only so a test
 * can see it widens a module's public surface to serve the tests, and the
 * values are literals precisely because recharts needs them to be.
 */
function paletteOf(constant: string): Record<string, string> {
  const source = readFileSync(resolve('src/ThemeContext.tsx'), 'utf8');
  const block = source.match(new RegExp(`const ${constant}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  expect(block, `${constant} not found in ThemeContext`).not.toBeNull();
  const series = block![1].match(/series:\s*\{([^}]*)\}/);
  expect(series, `${constant}.series not found`).not.toBeNull();
  return Object.fromEntries(
    [...series![1].matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi)].map(([, k, v]) => [k, v.toLowerCase()]),
  );
}

const DARK_SERIES = paletteOf('DARK_CHART');
const LIGHT_SERIES = paletteOf('LIGHT_CHART');

/** Every series colour, in both themes, as the `rgb()` a DOM style resolves to. */
function seriesColours(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [theme, palette] of [['dark', DARK_SERIES], ['light', LIGHT_SERIES]] as const) {
    for (const [code, hex] of Object.entries(palette)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      out.set(`rgb(${r}, ${g}, ${b})`, `${theme} --series-${code.toLowerCase()}`);
      out.set(hex, `${theme} --series-${code.toLowerCase()}`);
    }
  }
  return out;
}

/**
 * Elements that render text of their own and carry an explicit colour.
 *
 * "Of their own" matters: a wrapper inheriting a colour it never set is not a
 * call site, and counting it would report the same decision many times.
 */
function colouredTextNodes(container: HTMLElement) {
  const found: { text: string; colour: string; tag: string }[] = [];
  for (const el of container.querySelectorAll<HTMLElement>('*')) {
    const colour = el.style.color;
    if (!colour) continue;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    if (!own) continue;
    found.push({ text: own.slice(0, 24), colour: colour.toLowerCase(), tag: el.tagName.toLowerCase() });
  }
  return found;
}

const COMPARE = {
  indicator: 'inflation',
  title: 'Inflation (HICP)',
  unit: '% QoQ',
  source: 'Eurostat',
  countries: {
    LV: { label: 'Latvia', series: [{ period: '2025-Q4', value: 0.6 }] },
    EE: { label: 'Estonia', series: [{ period: '2025-Q4', value: 0.4 }] },
    LT: { label: 'Lithuania', series: [{ period: '2025-Q4', value: 1.7 }] },
  },
};

const POWER = {
  unit: 'EUR/MWh',
  source: 'Elering',
  coupled: true,
  totalIntervals: 96,
  decoupledIntervals: 0,
  currentSpread: 0,
  zones: [
    { id: 'ee', label: 'Estonia', flag: '🇪🇪', current: 74.08, min: 58, max: 244 },
    { id: 'lv', label: 'Latvia', flag: '🇱🇻', current: 74.08, min: 59, max: 244 },
    { id: 'lt', label: 'Lithuania', flag: '🇱🇹', current: 74.08, min: 59, max: 244 },
    { id: 'fi', label: 'Finland', flag: '🇫🇮', current: 64.25, min: 51, max: 161 },
  ],
  series: [
    { time: '2026-08-27T10:00:00Z', day: '2026-08-27', ee: 74, lv: 74, lt: 74, fi: 64 },
    { time: '2026-08-27T11:00:00Z', day: '2026-08-27', ee: 75, lv: 75, lt: 75, fi: 65 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchBalticCompare.mockResolvedValue(COMPARE);
  fetchPowerPrices.mockResolvedValue(POWER);
});

describe('a series colour never lands on text', () => {
  it('leaves the comparison chart’s direct labels on a text token', async () => {
    const { container } = render(<BalticCompareChart indicator="inflation" />);
    await waitFor(() => expect(container.textContent).toContain('0.6'));

    const palette = seriesColours();
    const offenders = colouredTextNodes(container).filter((n) => palette.has(n.colour));

    expect(
      offenders.map((o) => `"${o.text}" in ${palette.get(o.colour)}`),
      'a chart-line hue cannot clear 4.5:1 — put it on a swatch',
    ).toEqual([]);
  });

  it('leaves the power market’s zone prices on a text token', async () => {
    const { container } = render(<PowerMarketCard />);
    await waitFor(() => expect(container.textContent).toContain('74.08'));

    const palette = seriesColours();
    const offenders = colouredTextNodes(container).filter((n) => palette.has(n.colour));

    expect(
      offenders.map((o) => `"${o.text}" in ${palette.get(o.colour)}`),
      'a chart-line hue cannot clear 4.5:1 — put it on a swatch',
    ).toEqual([]);
  });

  it('can tell a violation from a compliant render', () => {
    // The negative control lives in the test rather than in a component, so
    // the check is shown rejecting something without a defect being committed
    // to prove it. `--series-lv` at #dc3b4a is the value that actually failed
    // at 3.90:1; `--text-primary` is what replaced it.
    const palette = seriesColours();

    const bad = render(<p style={{ color: DARK_SERIES.LV }}>0.6%</p>);
    expect(colouredTextNodes(bad.container).filter((n) => palette.has(n.colour))).toHaveLength(1);

    const good = render(<p style={{ color: 'var(--text-primary)' }}>0.6%</p>);
    expect(colouredTextNodes(good.container).filter((n) => palette.has(n.colour))).toHaveLength(0);
  });
});

describe('but the encoding it was carrying survives', () => {
  it('keeps a swatch beside every direct label', async () => {
    // Deleting the colour outright would have scored identically on the
    // contrast measurement and left a reader unable to match a label to a
    // line. It is worth being explicit about why the flag cannot do this job:
    // Segoe UI Emoji ships no regional-indicator glyphs, so on Windows "🇱🇻"
    // renders as the letters "LV" in the *text* colour — an identifier that
    // carries none of the country's hue.
    const { container } = render(<BalticCompareChart indicator="inflation" />);
    await waitFor(() => expect(container.textContent).toContain('0.6'));

    const palette = seriesColours();
    const swatches = [...container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')]
      .filter((el) => palette.has((el.style.background || el.style.backgroundColor).toLowerCase()));

    expect(swatches.length, 'the label rows lost their link to the chart').toBe(3);
  });

  it('keeps a swatch beside every power market zone', async () => {
    const { container } = render(<PowerMarketCard />);
    await waitFor(() => expect(container.textContent).toContain('74.08'));

    const palette = seriesColours();
    const swatches = [...container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')]
      .filter((el) => palette.has((el.style.background || el.style.backgroundColor).toLowerCase()));

    expect(swatches.length, 'the zone rows lost their link to the chart').toBe(4);
  });

  it('hides the swatch from assistive technology, because it repeats the label', () => {
    // The country is already named in text beside it. A swatch announced as
    // an image would be a second, wordless copy of something the reader has
    // just been told.
    const { container } = render(<SeriesSwatch color="#dc3b4a" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toBe('');
  });
});
