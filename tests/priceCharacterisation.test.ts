/**
 * Characterisations the data has to support.
 *
 * `sanity` bands guard a number's magnitude and nothing guards what we *call*
 * it. Sea state named every band one WMO degree too alarming; air quality
 * banded Europe's index on America's scale. This is the third instance and the
 * words here were not merely mis-calibrated — several described statistics the
 * endpoint never computed.
 *
 * Measured against live Elering, Latvia, 5856 intervals over 62 days:
 *
 *   "spike ... significantly above normal"  (maxP > 100)  ->  58 of 62 days, 93.5%
 *   median daily peak                                     ->  168
 *   "below seasonal average"                (avg < 30)    ->  12 of 62 days, 19.4%
 *   the routine branch                                    ->   4 of 62 days
 *
 * A spike that fires on 93.5% of days is the weather, and the constant sat
 * *below* the median daily peak — so it called the typical day exceptional,
 * with advice attached. "Below seasonal average" named a statistic computed
 * nowhere. "Within normal Baltic market range" was the `else` branch, asserted
 * against nothing.
 *
 * And measured against the ECB's own 90-day file, all 64 observations sat
 * between 1.134 and 1.1699 — so `usdRate > 1.12`, "Euro strengthening against
 * the dollar", fired on **100% of trading days** and the other two branches
 * were unreachable. It was also a claim about a *change* derived from a single
 * *level*: the endpoint fetches one day's rate and holds no previous value.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const insights = require('../api/ai-insights/index.js');

describe('the threshold is derived, not decreed', () => {
  it('reads a percentile off the trailing distribution', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(insights.percentile(sorted, 0.9)).toBe(100);
    expect(insights.percentile(sorted, 0.5)).toBe(60);
    expect(insights.percentile(sorted, 0)).toBe(10);
  });

  it('has nothing to say about an empty window', () => {
    expect(insights.percentile([], 0.9)).toBeNull();
  });

  it('names the percentile rather than a price', () => {
    // The point of the change. A literal `100` cannot be checked against
    // anything; a percentile carries its own basis.
    expect(insights.PRICE_ALERT_PERCENTILE).toBeGreaterThan(0);
    expect(insights.PRICE_ALERT_PERCENTILE).toBeLessThan(1);
    expect(insights.PRICE_WINDOW_DAYS).toBeGreaterThanOrEqual(14);
  });
});

describe('today is not part of its own baseline', () => {
  const day = (iso: string, prices: number[]) =>
    prices.map((price, h) => ({
      timestamp: Math.floor(Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`) / 1000),
      price,
    }));

  it('separates today from the days that precede it', () => {
    const rows = [
      ...day('2026-08-25', [10, 20]),
      ...day('2026-08-26', [30, 40]),
      ...day('2026-08-27', [500, 600]),
    ];
    const split = insights.splitByDay(rows, '2026-08-27');

    expect(split.today).toHaveLength(2);
    // Comparing a day against a distribution it belongs to drags the threshold
    // toward itself, and on a thirty-day window that is not a small effect.
    expect(split.priorPeaks, "today's peak leaked into its own baseline")
      .toEqual([20, 40]);
  });

  it('drops intervals that carry no usable price', () => {
    const rows = [
      { timestamp: Math.floor(Date.parse('2026-08-25T00:00:00Z') / 1000), price: null },
      { timestamp: Math.floor(Date.parse('2026-08-25T01:00:00Z') / 1000), price: 42 },
      { timestamp: Math.floor(Date.parse('2026-08-26T00:00:00Z') / 1000), price: Number.NaN },
    ];
    const split = insights.splitByDay(rows, '2026-08-27');
    expect(split.priorPeaks).toEqual([42]);
  });

  it('returns the peaks sorted, which is what a percentile needs', () => {
    const rows = [
      ...day('2026-08-20', [90]), ...day('2026-08-21', [10]), ...day('2026-08-22', [50]),
    ];
    expect(insights.splitByDay(rows, '2026-08-27').priorPeaks).toEqual([10, 50, 90]);
  });
});

describe('the words are ones the data supports', () => {
  const src = require('node:fs').readFileSync('api/ai-insights/index.js', 'utf8');
  // Comments describe what the file used to say, so only code is scanned.
  const code = src.split('\n')
    .filter((l: string) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  it('no longer calls 93.5% of days significantly above normal', () => {
    expect(code).not.toMatch(/significantly above normal/);
    expect(code, 'the literal threshold is back').not.toMatch(/maxP\s*>\s*100/);
  });

  it('does not name a seasonal average it never computes', () => {
    expect(code).not.toMatch(/seasonal average/i);
    expect(code, 'a hardcoded 30 characterised as a seasonal comparison')
      .not.toMatch(/avg\s*<\s*30/);
  });

  it('does not assert a normal range against nothing', () => {
    expect(code).not.toMatch(/within normal Baltic market range/i);
  });

  it('does not claim a direction it holds no second observation for', () => {
    // "Strengthening" and "weakening" are changes. The endpoint fetches one
    // day's reference rate, so neither could be derived at any threshold.
    expect(code).not.toMatch(/strengthening/i);
    expect(code).not.toMatch(/weakening/i);
    expect(code, 'a branch that fired on 100% of trading days')
      .not.toMatch(/usdRate\s*>\s*1\.12/);
  });

  it('does not report the day average as the current price', () => {
    // #131's shape: a guard whose false branch is a claim, and a plausible one,
    // because an average price looks exactly like a price.
    expect(code).not.toMatch(/curEntry\s*\?\s*curEntry\.price\s*:\s*avg/);
  });

  it('still states the figures, which is what they are entitled to say', () => {
    expect(code).toMatch(/day average/);
    expect(code).toMatch(/Range €/);
  });
});

describe('an extreme day is still called extreme', () => {
  /**
   * The other direction, which is the whole risk of this change: trading
   * crying wolf for silence would be no improvement.
   */
  function peaksThenToday(priorPeaks: number[], todayPeak: number) {
    const rows: { timestamp: number; price: number }[] = [];
    priorPeaks.forEach((p, i) => {
      const d = new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10);
      rows.push({ timestamp: Math.floor(Date.parse(`${d}T12:00:00Z`) / 1000), price: p });
    });
    rows.push({ timestamp: Math.floor(Date.parse('2026-08-27T12:00:00Z') / 1000), price: todayPeak });
    return insights.splitByDay(rows, '2026-08-27');
  }

  // The measured shape of the Latvian market: daily peaks with a median near
  // 168 and a long right tail.
  const REAL_PEAKS = [
    59, 71, 84, 96, 103, 118, 127, 134, 141, 152,
    160, 165, 168, 171, 178, 185, 194, 203, 214, 223,
    231, 240, 248, 259, 271, 288, 305, 324, 402, 637,
  ];

  it('fires on a genuinely exceptional peak', () => {
    const split = peaksThenToday(REAL_PEAKS, 500);
    const threshold = insights.percentile(split.priorPeaks, insights.PRICE_ALERT_PERCENTILE);
    expect(threshold).not.toBeNull();
    expect(500 > threshold!, 'a 500 EUR peak was not called exceptional').toBe(true);
  });

  it('stays quiet on the ordinary day the old constant shouted about', () => {
    // 168 is the median daily peak, and `maxP > 100` called it "significantly
    // above normal".
    const split = peaksThenToday(REAL_PEAKS, 168);
    const threshold = insights.percentile(split.priorPeaks, insights.PRICE_ALERT_PERCENTILE);
    expect(168 > threshold!, 'the median day is still called a spike').toBe(false);
    expect(168 > 100, 'the old constant would have fired here').toBe(true);
  });

  it('selects roughly a tenth of days, not almost all of them', () => {
    const split = peaksThenToday(REAL_PEAKS, 100);
    const threshold = insights.percentile(split.priorPeaks, insights.PRICE_ALERT_PERCENTILE)!;
    const firing = REAL_PEAKS.filter((p) => p > threshold).length;
    expect(firing / REAL_PEAKS.length).toBeLessThan(0.2);
    // And the constant it replaces, on the same distribution.
    const old = REAL_PEAKS.filter((p) => p > 100).length;
    expect(old / REAL_PEAKS.length).toBeGreaterThan(0.8);
  });

  it('makes no comparison at all on too short a window', () => {
    // A "highest tenth" of four days is one observation, and a threshold drawn
    // from it describes the sample rather than the market.
    const split = peaksThenToday([80, 90, 100, 110], 400);
    expect(split.priorPeaks.length).toBeLessThan(insights.MIN_BASELINE_DAYS);
  });
});
