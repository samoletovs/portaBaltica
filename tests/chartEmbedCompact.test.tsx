/**
 * The chart an article embeds is the compact one, and nothing rendered it.
 *
 * `#123` moved country colour off the direct labels and onto a `SeriesSwatch`,
 * because a hue tuned to clear 3:1 as a chart line cannot clear 4.5:1 as 12px
 * text. That is right, and it improves the article embed too — the reading is
 * now `--text-primary` rather than a 3.24:1 amber.
 *
 * `tests/seriesColourUsage.test.tsx` guards it with
 * `render(<BalticCompareChart indicator="inflation" />)`. No `compact`.
 *
 * `ChartEmbed` — the only way a chart reaches an article — renders
 * `<BalticCompareChart indicator={resolved} compact />`. Today `compact`
 * changes the plot height and nothing else, so both paths produce the same
 * labels and the existing guard covers the embed by luck rather than by
 * design. Move the direct-label block inside a `!compact` branch and every
 * article on the site silently loses the link between a label and its line,
 * while the suite stays green.
 *
 * So this asserts the path articles take. It is deliberately the same
 * assertion as the non-compact one: the point is not a new property, it is the
 * same property on the other side of a prop nobody was exercising.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BalticCompareChart } from '../src/components/BalticCompareChart';

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...a: unknown[]) => fetchBalticCompare(...a),
  fetchPowerPrices: vi.fn(),
}));

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

/** The palette, read from `ThemeContext` the way the sibling suites read it. */
function seriesColours(): Set<string> {
  const source = readFileSync(resolve('src/ThemeContext.tsx'), 'utf8');
  const found = new Set<string>();
  for (const block of source.matchAll(/series:\s*\{([^}]*)\}/g)) {
    for (const hex of block[1].matchAll(/#([0-9a-fA-F]{6})/g)) {
      found.add(hex[0].toLowerCase());
      found.add(asRgb(hex[1]));
    }
  }
  expect(found.size, 'no series palette found in ThemeContext').toBeGreaterThan(0);
  return found;
}

/**
 * jsdom normalises an inline `background: '#dc3b4a'` to `rgb(220, 59, 74)`, so
 * comparing the style back against the hex it was written with finds nothing
 * and reports zero swatches — which reads exactly like the component having
 * dropped them. It cost a debugging round here; both forms go in the set.
 */
function asRgb(hex: string): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function swatchesIn(container: HTMLElement): HTMLElement[] {
  const palette = seriesColours();
  return [...container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')].filter((el) =>
    palette.has((el.style.background || el.style.backgroundColor).toLowerCase()),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchBalticCompare.mockResolvedValue(COMPARE);
});

describe('the chart as an article embeds it', () => {
  it('keeps a swatch beside every label in the compact render', async () => {
    const { container } = render(<BalticCompareChart indicator="inflation" compact />);
    await waitFor(() => expect(container.textContent).toContain('0.6'));

    expect(
      swatchesIn(container).length,
      'an embedded chart lost the link between its labels and its lines',
    ).toBe(3);
  });

  it('keeps the readings on a text token in the compact render', async () => {
    const { container } = render(<BalticCompareChart indicator="inflation" compact />);
    await waitFor(() => expect(container.textContent).toContain('0.6'));

    const palette = seriesColours();
    const offenders = [...container.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const colour = (el.style.color || '').toLowerCase();
      return colour !== '' && palette.has(colour) && (el.textContent ?? '').trim() !== '';
    });

    expect(
      offenders.map((o) => o.textContent?.trim()),
      'a chart-line hue cannot clear 4.5:1 as text — put it on a swatch',
    ).toEqual([]);
  });

  it('still shows every country the article is comparing', async () => {
    // The companion to the assertions above: they are satisfied by a render
    // that produced nothing at all, so prove the chart drew its three
    // readings before concluding anything about how they are coloured.
    const { container } = render(<BalticCompareChart indicator="inflation" compact />);
    await waitFor(() => expect(container.textContent).toContain('0.6'));

    expect(container.textContent).toContain('0.4');
    expect(container.textContent).toContain('1.7');
  });
});
