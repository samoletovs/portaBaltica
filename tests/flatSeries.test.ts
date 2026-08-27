import { describe, expect, it } from 'vitest';
import { FLAT_SERIES_THRESHOLD, isNearlyFlat } from '../src/utils/chartType';

/**
 * A zero-based filled area is the right default and the wrong one for a
 * handful of series.
 *
 * Recharts' implicit y-axis is `[0, 'auto']`, so every sparkline on the
 * dashboard starts at zero whether or not anyone decided it should. That is
 * Carbon's rule for a fill and it is correct — until the series barely moves,
 * at which point the fill is a flat bar and a reader reports the card as
 * broken. Population is the case that surfaced it: it shifts well under 1%
 * across five years and rendered as a dead straight line.
 *
 * These pin the general rule rather than a population special case.
 */
describe('a series too flat for a zero-based fill', () => {
  /** Latvian population, roughly, over five years: a real slow decline. */
  const population = [1_875_800, 1_871_900, 1_867_200, 1_862_700, 1_857_100];

  it('recognises a series that moves under 2% of its own level', () => {
    const move = (Math.max(...population) - Math.min(...population)) / Math.max(...population);
    expect(move).toBeLessThan(FLAT_SERIES_THRESHOLD);
    expect(isNearlyFlat(population)).toBe(true);
  });

  it('leaves a series that genuinely moves alone', () => {
    // Unemployment across the same window: a fill says something here.
    expect(isNearlyFlat([6.2, 8.1, 7.4, 6.9, 5.8])).toBe(false);
  });

  it('never crops a series that crosses zero', () => {
    // On a percentage-change series zero is the most important value on the
    // chart, and cropping it away would hide the sign change — which is
    // usually the entire story. A tiny swing either side of zero must still
    // keep its zero-based axis.
    expect(isNearlyFlat([-0.2, 0.1, -0.05, 0.15])).toBe(false);
  });

  it('is not fooled by a series pinned at zero', () => {
    // All-zero would divide by zero on the level. It is not "flat" in the
    // sense that matters; there is nothing to crop to.
    expect(isNearlyFlat([0, 0, 0])).toBe(false);
  });

  it('needs two readings before it can call anything flat', () => {
    expect(isNearlyFlat([])).toBe(false);
    expect(isNearlyFlat([1_875_800])).toBe(false);
  });

  it('ignores gaps rather than treating them as readings', () => {
    // A gap is a gap (DESIGN.md §3.1). A NaN leaking into the comparison would
    // silently make every series non-flat.
    expect(isNearlyFlat([...population, Number.NaN])).toBe(true);
  });

  it('handles a negative series by its magnitude', () => {
    // A trade balance sits below zero without crossing it. Flatness is about
    // how much it moves relative to its own level, not its sign.
    expect(isNearlyFlat([-1000, -1002, -998, -1001])).toBe(true);
    expect(isNearlyFlat([-1000, -1400, -820, -1290])).toBe(false);
  });
});
