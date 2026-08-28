import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tickInterval, TARGET_AXIS_LABELS, CHART_TICK_SIZE } from '../src/utils/chartType';

/**
 * How many labels recharts draws for a given `interval`.
 *
 * recharts skips `interval` ticks between the ones it renders, so this is the
 * arithmetic the component is really choosing when it sets that prop. Written
 * out rather than assumed, because the defect below was precisely a mismatch
 * between the number someone wrote and the number it produced.
 */
function labelsDrawn(pointCount: number, interval: number): number {
  return Math.ceil(pointCount / (interval + 1));
}

describe('axis tick intervals', () => {
  it('keeps a quarter-hourly day readable, which a hardcoded interval did not', () => {
    // The live Elering payload measured 88 quarter-hours. `interval={3}` — the
    // value that shipped, beside a comment claiming "six ticks across a 24-hour
    // day" — draws 22 labels, and at 402px 20 of the 21 visible ones overlapped.
    const QUARTER_HOURS_IN_A_DAY = 88;

    expect(
      labelsDrawn(QUARTER_HOURS_IN_A_DAY, 3),
      'the hardcoded interval this replaces drew 22 labels into a 336px chart',
    ).toBe(22);

    const drawn = labelsDrawn(QUARTER_HOURS_IN_A_DAY, tickInterval(QUARTER_HOURS_IN_A_DAY));
    expect(drawn).toBeLessThanOrEqual(8);
    expect(drawn).toBeGreaterThanOrEqual(5);
  });

  it('draws the same count whatever resolution the feed moves to', () => {
    // This is the property the hardcoded value lacked. Elering went hourly to
    // quarter-hourly under a component that had assumed hourly, and nothing
    // failed — the axis just became unreadable at one range of widths.
    for (const pointCount of [24, 48, 88, 96, 184, 365]) {
      const drawn = labelsDrawn(pointCount, tickInterval(pointCount));
      expect(drawn, `${pointCount} points drew ${drawn} labels`).toBeLessThanOrEqual(8);
      expect(drawn, `${pointCount} points drew ${drawn} labels`).toBeGreaterThanOrEqual(4);
    }
  });

  it('honours an explicit target', () => {
    // The power market axis has a 40px YAxis beside it and was measured clean at
    // 402px with eight labels, so it keeps eight. The arithmetic is shared; the
    // count is a per-chart decision stated at the call site.
    expect(tickInterval(184, 8)).toBe(Math.max(0, Math.floor(184 / 8)));
    expect(labelsDrawn(184, tickInterval(184, 8))).toBeLessThanOrEqual(8);
  });

  it('returns a usable interval for degenerate inputs', () => {
    // A series can be empty while a card is still mounted. `interval={NaN}` is
    // not a smaller axis, it is a broken one.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Number.isInteger(tickInterval(bad)), `tickInterval(${bad})`).toBe(true);
      expect(tickInterval(bad)).toBeGreaterThanOrEqual(0);
    }
    expect(tickInterval(10, 0)).toBe(0);
  });

  it('is the only way either chart chooses an interval', () => {
    // Both components derived this separately, and one of them derived it
    // wrongly for three years while the correct version sat one file away. Two
    // derivations of one rule can disagree; a shared one cannot.
    //
    // The set is enumerated rather than globbed on purpose: a new chart that
    // hardcodes an interval is not caught here, and pretending otherwise would
    // be worse than not claiming it.
    //
    // Comments are stripped first. The first version of this check matched the
    // *prose* in EconomyTile that quotes the old `interval={3}` while
    // explaining why it is gone — a check reading the explanation of a defect
    // and reporting the defect.
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const file of ['EconomyTile.tsx', 'PowerMarketCard.tsx']) {
      const raw = readFileSync(resolve(`src/components/${file}`), 'utf8');
      const code = stripComments(raw);

      // Control: the subject must still contain what we are about to check.
      // Without it, a rename would make this pass by finding nothing at all.
      expect(code.match(/interval=\{/g) ?? [], `${file} draws no axis interval`).not.toHaveLength(0);

      expect(code, `${file} must not compute its own tick interval`).toContain('tickInterval(');
      expect(
        code.match(/interval=\{(?!tickInterval)/),
        `${file} sets an axis interval without going through tickInterval`,
      ).toBeNull();
    }
  });

  it('picks a default that fits the narrowest card this site draws', () => {
    // 320px viewport, 254px chart measured; an `HH:mm` label is about 24px at
    // CHART_TICK_SIZE. This is the reasoning behind TARGET_AXIS_LABELS, made
    // executable so that raising it silently is not possible.
    const NARROWEST_CHART_PX = 254;
    const LABEL_PX = CHART_TICK_SIZE * 2.4;

    expect(TARGET_AXIS_LABELS * LABEL_PX).toBeLessThan(NARROWEST_CHART_PX);
  });
});
