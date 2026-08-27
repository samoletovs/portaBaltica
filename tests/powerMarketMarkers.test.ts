/**
 * Why neither marker was drawn on the power chart.
 *
 * Reported as "no `.recharts-reference-line` in the DOM, master or branch", and
 * that is exactly right — measured in Chromium against the deployed site, the
 * card renders its axes, its grid, its ticks and all four zone lines, and the
 * class `recharts-reference-line` is absent from the sub-tree entirely.
 *
 * The cause is the axis domain. A `ReferenceLine` on a category axis resolves
 * its `x` against the categories, and the chart keyed on an **already
 * formatted** `HH:mm` label. "Day-ahead" means two days, so the series carries
 * ~184 quarter-hours and only 96 distinct labels — every one appears exactly
 * twice. A duplicated domain cannot be resolved, and recharts renders nothing
 * and reports nothing.
 *
 * The irony is exact and worth keeping: the boundary marker exists *because*
 * the labels repeat across midnight, and the repetition is what stopped it
 * being drawn. #136 then corrected a 180-minute offset on a marker that was
 * never on the page.
 *
 * Verified in a real browser against the built app, because jsdom gives
 * `ResponsiveContainer` no size and recharts draws nothing at all there — a
 * jsdom assertion would have "passed" on master for the wrong reason:
 *
 *   before   lines: 4   refLines: 0   vertical: 0
 *   after    lines: 4   refLines: 2   vertical: 2
 *   axis     03:00 09:00 15:00 21:00 03:00 09:00 15:00 21:00 ... "tomorrow"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hourFormatter, firstDayChange, dayFormatter } from '../src/utils/marketClock';

const source = readFileSync(resolve('src/components/PowerMarketCard.tsx'), 'utf8');

/** Two days of quarter-hours, which is what /api/power-prices actually serves. */
function series(n = 184, startIso = '2026-08-27T00:00:00.000Z') {
  const t0 = new Date(startIso).getTime();
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(t0 + i * 15 * 60_000).toISOString(),
  }));
}

describe('the power chart axis domain', () => {
  const format = hourFormatter('Europe/Riga');

  it('collides on formatted labels, which is what broke the markers', () => {
    const points = series();
    const labels = points.map((p) => format(p.time));

    // The measurement, reproduced: production returned exactly this shape.
    expect(labels).toHaveLength(184);
    expect(new Set(labels).size, 'every HH:mm label appears twice across two days').toBe(96);
  });

  it('is unique when keyed on the instant', () => {
    const points = series();
    expect(new Set(points.map((p) => p.time)).size).toBe(points.length);
  });

  it('places the current interval unambiguously', () => {
    const points = series();
    const current = points[70].time;

    // One match is the whole requirement. Under the old key this was two, and
    // recharts resolved neither.
    expect(points.filter((p) => p.time === current)).toHaveLength(1);
    expect(points.filter((p) => format(p.time) === format(current)).length)
      .toBeGreaterThan(1);
  });

  it('places the day boundary on a real category', () => {
    const points = series();
    const boundary = firstDayChange(points, dayFormatter('Europe/Riga'));

    expect(boundary, 'a two-day window has a midnight to mark').not.toBeNull();
    expect(points.map((p) => p.time)).toContain(boundary!.time);
  });
});

describe('PowerMarketCard wires the axis so a reference line can resolve', () => {
  it('keys the axis on the instant rather than on its label', () => {
    expect(source, 'the category domain must be unique').toMatch(/dataKey="time"/);
    expect(source, 'a pre-formatted label as the key is the defect').not.toMatch(/dataKey="label"/);
  });

  it('formats at the tick, so the axis still reads as hours', () => {
    // Removing the formatting rather than moving it would fix the markers and
    // print `2026-08-27T03:00:00.000Z` under the chart.
    expect(source).toMatch(/tickFormatter=\{formatHour\}/);
  });

  it('gives the tooltip the same treatment, which it also needed', () => {
    // With duplicate labels the tooltip could not say which 17:30 was hovered.
    expect(source).toMatch(/labelFormatter=/);
  });

  it('passes raw instants to both markers', () => {
    const refs = [...source.matchAll(/<ReferenceLine[\s\S]{0,120}?x=\{([^}]+)\}/g)].map((m) => m[1].trim());

    expect(refs, 'both markers should still be declared').toHaveLength(2);
    for (const expr of refs) {
      expect(expr, `ReferenceLine x={${expr}} must not be pre-formatted`).not.toMatch(/formatHour/);
    }
    expect(refs).toContain('data.currentTime');
    expect(refs).toContain('firstTomorrow.time');
  });
});
