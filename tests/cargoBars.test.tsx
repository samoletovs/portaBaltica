/**
 * The cargo-type bars, and the third member of a family.
 *
 * `Math.max` and `reduce` both propagate NaN, so one category arriving without
 * a usable weight made `total` and `max` NaN — and then every row, **including
 * the well-formed ones**, printed "0.0%" (because `NaN > 0` is false) and got
 * `width: NaN%`, which CSS drops silently, leaving every bar at the container's
 * full width. One absent value rendered the whole panel as "all cargo types
 * equal": a wrong chart rather than a broken one.
 *
 * The `, 1` floor looks like it guards this and does not — it exists to stop a
 * division by zero when every weight is zero, and `Math.max(NaN, 1)` is NaN.
 *
 * Reachable because `list<T>()` checks that the container is an array and casts
 * the contents, so `weight: number` in `CargoMix` is a compile-time claim about
 * a payload we did not write. Same mechanism as the EU-funds bars drawn at
 * `Infinity` and the port forecast hour drawn full-height (DESIGN.md §3.8).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CargoPanel } from '../src/components/CargoPanel';
import { valueAt } from '../src/portStats';
import type { CargoMix, PortMeasure, PortSeries } from '../src/types';

/** No ports, so the panel opens on the type view without needing a click. */
const NO_PORTS: PortMeasure = {
  unit: 'THS_T', latest: null, ports: [], countryOnly: false,
} as unknown as PortMeasure;

function mixOf(categories: unknown[]): CargoMix {
  return {
    period: '2026-Q1', total: null,
    categories: categories as CargoMix['categories'],
    breakdown: 'published',
  };
}

/** The rendered width of each bar, in source order. */
function barWidths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('div[style*="width"]')]
    .map((el) => el.style.width)
    .filter((w) => w !== '');
}

describe('one unusable weight does not destroy the other bars', () => {
  it('keeps a usable width on the row that did report', () => {
    // The assertion that fails without the fix. Before: `max` is NaN, so this
    // row's width is `NaN%` — dropped by CSS, and the bar inherits the
    // container. The valid row is destroyed by its neighbour.
    const { container } = render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 12 },
          { code: 'B', name: 'Dry bulk' },
        ])}
      />,
    );

    const widths = barWidths(container);
    expect(widths).toHaveLength(2);
    expect(widths[0], 'the measured row lost its width').toMatch(/^\d/);
    expect(widths[0]).not.toMatch(/NaN/);
    // It is the only measured row, so it is the maximum: a full bar.
    expect(parseFloat(widths[0])).toBeGreaterThan(0);
  });

  it('keeps a usable share on the row that did report', () => {
    // `total` is NaN too, and `NaN > 0` is false, so every share fell to the
    // "0.0" branch — a confident zero for a category we had measured.
    render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 12 },
          { code: 'B', name: 'Dry bulk' },
        ])}
      />,
    );
    expect(screen.getByText('100.0%')).toBeTruthy();
  });

  it('shows the unmeasured row as unknown, not as zero', () => {
    // "We do not know" and "none of it" are different claims about a port, and
    // the row is still named because the category exists.
    render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 12 },
          { code: 'B', name: 'Dry bulk' },
        ])}
      />,
    );
    expect(screen.getByText('Dry bulk')).toBeTruthy();
    // Two dashes: the share and the quantity. Neither may read "NaN kt".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('excludes it from the arithmetic rather than counting it as zero', () => {
    // Two measured rows and one absent: the shares must sum over the measured
    // pair alone, not be diluted by a category with no reading.
    render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 30 },
          { code: 'B', name: 'Dry bulk' },
          { code: 'C', name: 'Containers', weight: 10 },
        ])}
      />,
    );
    expect(screen.getByText('75.0%')).toBeTruthy();
    expect(screen.getByText('25.0%')).toBeTruthy();
  });

  it('survives every shape a weight can arrive in', () => {
    const { container } = render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 12 },
          { code: 'B', name: 'Null', weight: null },
          { code: 'C', name: 'String', weight: '8' },
          { code: 'D', name: 'NaN', weight: Number.NaN },
          { code: 'E', name: 'Infinite', weight: Number.POSITIVE_INFINITY },
        ])}
      />,
    );
    // `finite()` refuses '8' rather than coercing it, because a field that
    // silently became a string is something to notice.
    expect(barWidths(container).some((w) => w.includes('NaN'))).toBe(false);
    expect(screen.queryByText(/NaN kt/)).toBeNull();
  });
});

describe('the same mechanism in the port bars', () => {
  it('drops a NaN cell rather than letting it destroy every bar', () => {
    // `PortBars` filters on `value !== null`, and NaN passes that. It then
    // computes `Math.max` and a `reduce`, both of which propagate NaN — so one
    // bad cell set every width to `NaN%` and every share to "0.0%", exactly as
    // in the cargo mix. `valueAt` is the single place that can refuse it.
    const bad = valueAt(
      { code: 'LV_X', name: 'X', latest: '2026-Q1',
        series: [{ period: '2026-Q1', value: Number.NaN }] } as unknown as PortSeries,
      '2026-Q1',
    );
    expect(bad).toBeNull();
  });

  it('refuses every other shape that is not a finite number', () => {
    const shapes = [undefined, null, '12', {}, [], Number.POSITIVE_INFINITY];
    for (const value of shapes) {
      expect(
        valueAt(
          { code: 'LV_X', name: 'X', latest: '2026-Q1',
            series: [{ period: '2026-Q1', value }] } as unknown as PortSeries,
          '2026-Q1',
        ),
        `${String(value)} was accepted as a reading`,
      ).toBeNull();
    }
  });

  it('still returns a real reading', () => {
    expect(
      valueAt(
        { code: 'LV_X', name: 'X', latest: '2026-Q1',
          series: [{ period: '2026-Q1', value: 0 }] } as unknown as PortSeries,
        '2026-Q1',
      ),
      'zero is a reading and must survive',
    ).toBe(0);
    expect(
      valueAt(
        { code: 'LV_X', name: 'X', latest: '2026-Q1',
          series: [{ period: '2026-Q1', value: 42.5 }] } as unknown as PortSeries,
        '2026-Q1',
      ),
    ).toBe(42.5);
  });
});

describe('the cases that already worked, kept working', () => {

  it('still draws ordinary categories in proportion', () => {
    const { container } = render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 50 },
          { code: 'B', name: 'Dry bulk', weight: 25 },
        ])}
      />,
    );
    const widths = barWidths(container).map(parseFloat);
    expect(widths[0]).toBeCloseTo(100, 1);
    expect(widths[1]).toBeCloseTo(50, 1);
    expect(screen.getByText('66.7%')).toBeTruthy();
    expect(screen.getByText('33.3%')).toBeTruthy();
  });

  it('does not divide by zero when every category reports nothing', () => {
    // What the `, 1` floor is actually for. All-zero must not produce
    // `0/0 = NaN`; it produces a share of 0.0% and no bar.
    const { container } = render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 0 },
          { code: 'B', name: 'Dry bulk', weight: 0 },
        ])}
      />,
    );
    expect(barWidths(container).some((w) => w.includes('NaN'))).toBe(false);
    expect(screen.getAllByText('0.0%').length).toBe(2);
  });

  it('draws no bar for a genuine zero, and a visible one for a small quantity', () => {
    // The floor keeps a real but tiny quantity visible. Lending it to zero
    // would draw a sliver of cargo that does not exist — which is the same
    // rule this file is about, one step smaller.
    const { container } = render(
      <CargoPanel
        measure={NO_PORTS}
        mix={mixOf([
          { code: 'A', name: 'Liquid bulk', weight: 10000 },
          { code: 'B', name: 'Trace', weight: 1 },
          { code: 'C', name: 'None', weight: 0 },
        ])}
      />,
    );
    const widths = barWidths(container).map(parseFloat);
    expect(widths[0]).toBeCloseTo(100, 1);
    expect(widths[1], 'a real quantity must stay visible').toBeGreaterThanOrEqual(1);
    expect(widths[2], 'zero cargo must draw no bar').toBe(0);
  });
});
