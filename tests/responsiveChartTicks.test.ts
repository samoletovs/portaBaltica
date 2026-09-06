import { describe, expect, it } from 'vitest';
import { CHART_MIN_TICK_GAP, CHART_TICK_SIZE, periodAxisTicks } from '../src/utils/chartType';

describe('date tick budgets fit the available plot, not a desktop assumption', () => {
  it.each(['2026-Q1', '2026-W01', '2026-12', '2026-S1'])('keeps %s-sized endpoint labels separate at narrow and wide widths', (label) => {
    const periods = Array.from({ length: 42 }, (_, i) => String(i));
    for (const width of [220, 223, 254, 280, 312, 375, 600, 960]) {
      for (const reserved of [0, 40, 60]) {
        const { ticks, inset } = periodAxisTicks(periods, width, () => label, reserved);
        expect(ticks[0]).toBe('0');
        expect(ticks.at(-1)).toBe('41');
        expect(ticks).toEqual([...new Set(ticks)]);
        const positions = ticks.map((tick) => Number(tick) / 41 * (width - reserved - inset * 2));
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i] - positions[i - 1], `${width}px with ${reserved}px reserved`).toBeGreaterThanOrEqual(
            label.length * CHART_TICK_SIZE * 0.62 + CHART_MIN_TICK_GAP,
          );
        }
      }
    }
  });

  it('handles empty and single observations without inventing tick periods', () => {
    expect(periodAxisTicks([], 300, (period) => period).ticks).toEqual([]);
    expect(periodAxisTicks(['2026'], 300, (period) => period).ticks).toEqual(['2026']);
  });
});
