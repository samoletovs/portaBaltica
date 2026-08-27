/**
 * One clock per chart.
 *
 * `PowerMarketCard` labelled its x-axis with `d.getHours()` — the **browser's**
 * local hour — while the API groups `p.day` in **UTC**, and the "tomorrow"
 * marker was placed at the first point whose UTC day was tomorrow. Measured
 * against production from a UTC+3 machine:
 *
 *     "tomorrow" marker drawn at x = 03:00   (2026-08-28T00:00:00.000Z)
 *     local midnight of that day  = 00:00    (2026-08-27T21:00:00.000Z)
 *     marker is 12 points (180 min) from the midnight the axis had just drawn
 *
 * So the chart put a label reading "tomorrow" three hours into tomorrow, on an
 * axis that had already shown midnight pass. It is #81's defect in a second
 * component: that fix established the rule and repaired `EconomyTile`, and
 * nobody grepped for the mechanism, so the other instance stayed.
 *
 * The assertions run against the pure functions rather than the rendered
 * chart, because jsdom does not lay out and recharts draws nothing without a
 * measured container — a test that mounted the card would assert on an empty
 * SVG and pass for the wrong reason. Every case names an explicit zone, so it
 * means the same thing on a laptop in Riga and on a runner at UTC: a test that
 * passes only because the machine happens to sit at UTC+0 is the "check that
 * cannot fail" in another costume.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hourFormatter, dayFormatter, firstDayChange } from '../src/utils/marketClock';

const RIGA = 'Europe/Riga';

/**
 * Two days of hourly prices starting at UTC midnight, which is what Elering
 * publishes and what the API passes through. In Riga (UTC+3 in August) the
 * first point is 03:00 and local midnight falls at index 21.
 */
function twoDays() {
  return Array.from({ length: 48 }, (_, i) => {
    const t = new Date(Date.UTC(2026, 7, 27, i));
    return { time: t.toISOString(), day: t.toISOString().slice(0, 10) };
  });
}

describe('the market clock', () => {
  it('labels an hour in the zone it was given, not the runner’s', () => {
    const inRiga = hourFormatter(RIGA);
    const inUtc = hourFormatter('UTC');
    const midnightUtc = '2026-08-27T00:00:00.000Z';

    expect(inUtc(midnightUtc)).toBe('00:00');
    expect(inRiga(midnightUtc), 'Riga is UTC+3 in August').toBe('03:00');
  });

  it('reads a calendar day in the zone it was given', () => {
    const dayInRiga = dayFormatter(RIGA);
    // 21:00 UTC is already the next day in Riga. This is the exact instant the
    // two clocks disagree about, and the one the marker has to land on.
    expect(dayInRiga('2026-08-27T20:59:00.000Z')).toBe('2026-08-27');
    expect(dayInRiga('2026-08-27T21:00:00.000Z')).toBe('2026-08-28');
  });

  it('finds the boundary the axis draws, not the one the API grouped by', () => {
    const points = twoDays();
    const boundary = firstDayChange(points, dayFormatter(RIGA));

    expect(boundary, 'no boundary found in a two-day window').not.toBeNull();
    // 21:00Z is local midnight; 00:00Z the next day — the API's `day` change —
    // is three hours and three points later.
    expect(boundary!.time).toBe('2026-08-27T21:00:00.000Z');
    expect(points.indexOf(boundary!)).toBe(21);

    const apiBoundary = points.find((p) => p.day === '2026-08-28')!;
    expect(points.indexOf(apiBoundary), 'the old behaviour, for contrast').toBe(24);
  });

  it('marks the boundary at a point the axis labels as midnight', () => {
    // The property that actually matters to a reader, stated as a property:
    // whatever the marker lands on must be the hour the axis calls 00:00.
    const boundary = firstDayChange(twoDays(), dayFormatter(RIGA));
    expect(hourFormatter(RIGA)(boundary!.time)).toBe('00:00');
  });

  it('returns null when the window never crosses a day', () => {
    // A real state rather than an error: a single day of prices has no
    // midnight to mark, and the caller must not draw one.
    const oneDay = twoDays().slice(0, 12);
    expect(firstDayChange(oneDay, dayFormatter(RIGA))).toBeNull();
    expect(firstDayChange([], dayFormatter(RIGA))).toBeNull();
  });
});

describe('the components that draw a time axis', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');

  it('never read the browser’s clock', () => {
    // The mechanism, not the component. #81 fixed one instance and the rule
    // was written down; this is the check that would have found the second.
    const files = [
      'src/components/PowerMarketCard.tsx',
      'src/components/EconomyTile.tsx',
      'src/components/GridStatePanel.tsx',
      'src/components/DataTicker.tsx',
      'src/components/Header.tsx',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      for (const m of read(file).matchAll(/\.get(Hours|Minutes|Date|Month|FullYear|Day)\(\)/g)) {
        // A comment recording the old defect is not a call site.
        const line = read(file).slice(0, m.index).split('\n').pop() ?? '';
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders, 'use Intl.DateTimeFormat with an explicit timeZone').toEqual([]);
  });

  it('say which clock they are on', () => {
    // A bare "14:00" on a Baltic price chart is ambiguous to anyone outside
    // the Baltics. The masthead declares the country's zone and the grid panel
    // declares UTC; the power chart now declares one too.
    expect(read('src/components/PowerMarketCard.tsx')).toMatch(/times \{tzAbbr\}/);
    expect(read('src/components/GridStatePanel.tsx')).toMatch(/UTC/);
  });
});
