/**
 * A chart legend must be able to give way.
 *
 * `BalticCompareChart` puts a title block and a direct-labelling legend in one
 * `justify-between` row. Neither was `min-w-0`, so both took the flex default
 * `min-width: auto` — their *min-content* — and neither could shrink. When
 * #132 gave the legend a fourth entry (the EU27 reference), its min-content
 * reached 377px and the row stopped fitting a card halved by
 * `md:grid-cols-2`.
 *
 * Measured on master in a real browser, 4px steps, `/data`:
 *
 *     320..512px   worst 196px overflow
 *     768..960px   worst  98px overflow
 *     98 of 177 widths between 320 and 1024 scrolled sideways
 *
 * The sideways scroll was the *visible* edge and not the worst of it. Squeezed
 * beside a rigid 377px legend, the title block collapsed to **47–91px** and
 * chart titles wrapped into vertical ribbons — "House prices across the
 * Baltics" over **five lines** — while the chart itself stayed exactly
 * 346×128. So the cards were not tall because the chart grew; they were tall
 * because the heading had been reduced to one word per line.
 *
 * ─── What this file can and cannot prove ───
 *
 * It cannot prove the layout. jsdom does not lay out and the suite loads no
 * stylesheet, so `min-content` is unmeasurable here and any assertion about
 * widths would be theatre. The real measurement lives in
 * `reducedMotionLayout.live.test.ts`, which drives a real browser and — with
 * its width list widened to cover both bands — already fails against
 * production today.
 *
 * What it *can* do is hold the structure that makes wrapping possible, so the
 * ability is not removed by someone tidying class lists. That is a wiring
 * guard, the same kind as the typecheck-gate assertions in #133, and it is
 * labelled as one rather than dressed up as a layout proof.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BalticCompareChart } from '../src/components/BalticCompareChart';

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...a: unknown[]) => fetchBalticCompare(...a),
}));

/**
 * A payload carrying the EU27 reference, which is what made the row a fourth
 * entry wide, with the long title that collapsed to five lines beside it.
 */
const WITH_REFERENCE = {
  indicator: 'house_prices',
  title: 'House prices across the Baltics',
  unit: '% YoY',
  source: 'Eurostat',
  dataset: 'prc_hpi_q',
  countries: {
    LV: { label: 'Latvia', series: [{ period: '2025-Q4', value: 9.8 }, { period: '2026-Q1', value: 10.9 }] },
    EE: { label: 'Estonia', series: [{ period: '2025-Q4', value: 6.1 }, { period: '2026-Q1', value: 5.9 }] },
    LT: { label: 'Lithuania', series: [{ period: '2025-Q4', value: 11.2 }, { period: '2026-Q1', value: 11.9 }] },
  },
  reference: {
    code: 'EU27_2020',
    label: 'EU27',
    fullLabel: 'European Union — 27 countries (from 2020)',
    series: [{ period: '2025-Q4', value: 5.4 }, { period: '2026-Q1', value: 5.1 }],
    latest: 5.1,
    latestPeriod: '2026-Q1',
  },
};

describe('the comparison chart header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBalticCompare.mockResolvedValue(WITH_REFERENCE);
  });

  it('renders every entry the legend is asked for', async () => {
    // The control. Without it, "the row can wrap" could pass against a legend
    // that renders nothing at all — and dropping the fourth entry at narrow
    // widths is precisely the wrong fix, because the EU27 reference is the
    // denominator a reader needs most when the chart is smallest (#125).
    const { container } = render(<BalticCompareChart indicator="house_prices" />);
    await waitFor(() => expect(container.textContent).toContain('10.9'));

    expect(container.textContent).toContain('5.9');
    expect(container.textContent).toContain('11.9');
    expect(container.textContent, 'the EU27 reference must survive').toContain('EU27');
    expect(container.textContent).toContain('5.1');
  });

  it('leaves both blocks free to wrap rather than forcing an overflow', async () => {
    // A wiring guard, not a layout proof: it asserts the structure that makes
    // wrapping possible still exists. The measurement that this *works* is in
    // the live suite.
    const { container } = render(<BalticCompareChart indicator="house_prices" />);
    await waitFor(() => expect(container.textContent).toContain('10.9'));

    const title = container.querySelector('p.text-callout');
    expect(title, 'no chart title rendered').not.toBeNull();

    const titleBlock = title!.parentElement!;
    const header = titleBlock.parentElement!;

    expect(header.className, 'the header row must be able to wrap').toContain('flex-wrap');
    expect(
      titleBlock.className,
      'the title block must be able to shrink, or it holds the row open at its min-content',
    ).toContain('min-w-0');

    const legend = [...header.children].find((c) => c !== titleBlock)!;
    expect(legend.className, 'the legend must be able to wrap its own entries').toContain('flex-wrap');
  });

  it('keeps the reference visually distinct from the three countries', async () => {
    // #125 established EU27 as a reference and not a fourth competitor, and
    // the wrap must not quietly turn it into one by lining all four up
    // identically. It carries a dashed rule; the countries carry swatches.
    const { container } = render(<BalticCompareChart indicator="house_prices" />);
    await waitFor(() => expect(container.textContent).toContain('10.9'));

    const dashed = container.querySelector('span.border-dashed');
    expect(dashed, 'the reference lost its dashed rule').not.toBeNull();
  });
});
