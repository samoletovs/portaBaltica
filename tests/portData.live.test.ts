/**
 * Contract test: the Eurostat maritime tables still carry data, and the
 * definitions still point at the right slice of them.
 *
 * This is the test whose absence let the maritime tile serve a frozen March
 * snapshot for half a year. The old source did not fail in any way a status
 * check could see: data.gov.lv answered HTTP 200, listed the datasets, and
 * served weekly CSVs on schedule — CSVs containing a column header and no
 * rows, eighteen weeks running. Structural health said nothing at all about
 * whether there was data inside.
 *
 * So each series is asserted three ways, and all three matter:
 *
 *   - it returns observations at all, which catches a retired dataset code;
 *   - the newest one is inside a sanity band, which catches a definition
 *     pointing at a real table that measures something else — the trap that
 *     `unit=THS_PASF` walked straight into, returning one value in eight
 *     quarters while looking more precise than the unit that works;
 *   - the series is still moving, which is the only property that separates a
 *     live table from a fossil.
 *
 * It lives in the live suite because it depends on Eurostat being reachable,
 * and a gate that red-lights a correct pull request because a European
 * statistics API was slow teaches people to bypass gates.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const eurostat = require('../api/shared/eurostat.js');
const ports = require('../api/shared/ports.js');

interface Point { period: string; value: number | null }

/**
 * What each measure means, so a table swap cannot pass unnoticed.
 *
 * Bands are per quarter and deliberately wide — they are there to catch a
 * definition reading the wrong statistic, not to track the business cycle.
 */
const SANITY: Record<string, { min: number; max: number; what: string }> = {
  // Thousand tonnes. A main Baltic port moves roughly 0.1–15 Mt a quarter.
  goods: { min: 50, max: 20000, what: 'thousand tonnes of goods' },
  // Thousand passengers. Tallinn alone is ~2.9M a quarter; Riga reports 0.
  passengers: { min: 0, max: 10000, what: 'thousand sea passengers' },
  // Vessel arrivals. Klaipėda and Tallinn are ~1,000–1,700 a quarter.
  vessels: { min: 1, max: 20000, what: 'vessel arrivals' },
};

function newest(points: Point[]): Point | null {
  let best: Point | null = null;
  let bestIdx = -Infinity;
  for (const p of points) {
    if (p.value === null || p.value === undefined) continue;
    const idx = eurostat.periodToMonthIndex(p.period);
    if (idx === null || idx <= bestIdx) continue;
    bestIdx = idx;
    best = p;
  }
  return best;
}

describe('Eurostat maritime tables', () => {
  for (const country of ports.COUNTRIES as string[]) {
    describe(country, () => {
      for (const series of ['goods', 'passengers', 'vessels'] as const) {
        it(`${series} returns fresh, in-band, fully pinned data`, async () => {
          const url = ports.seriesUrls(country)[series];
          const raw = await eurostat.httpJson(url, { deadlineMs: 30000 });
          const parsed = eurostat.parseJsonStatDim(raw, 'rep_mar', null);

          // Nothing may be guessed on our behalf.
          expect(parsed.assumptions, `${country} ${series} left a dimension unpinned`)
            .toEqual([]);

          const entries = Object.values(parsed.series) as { label: string; series: Point[] }[];
          expect(entries.length, `${country} ${series} returned no reporting ports`)
            .toBeGreaterThan(0);

          const observations = entries.flatMap(e => e.series).filter(p => p.value !== null);
          expect(observations.length, `${country} ${series} returned an empty cube`)
            .toBeGreaterThan(0);

          // Sanity: the largest reported figure has to look like the thing the
          // definition claims to measure.
          const band = SANITY[series];
          const largest = Math.max(...observations.map(p => p.value as number));
          expect(largest, `${country} ${series} peaks at ${largest}, not ${band.what}`)
            .toBeGreaterThanOrEqual(band.min);
          expect(largest, `${country} ${series} peaks at ${largest}, not ${band.what}`)
            .toBeLessThanOrEqual(band.max);

          // Freshness: quarterly data may lag, but not indefinitely.
          const latest = newest(entries.flatMap(e => e.series));
          expect(latest, `${country} ${series} has no dated observation`).not.toBeNull();
          const age = eurostat.monthsSincePeriod(latest!.period);
          expect(age, `${country} ${series} is frozen at ${latest!.period}`)
            .toBeLessThanOrEqual(eurostat.MAX_AGE_MONTHS.Q);
        });
      }

      it('cargo mix sums to the reported total without double counting', async () => {
        const url = ports.seriesUrls(country).cargoMix;
        const raw = await eurostat.httpJson(url, { deadlineMs: 30000 });
        const codes = ports.CARGO_MIX.map((c: { code: string }) => c.code);
        const parsed = eurostat.parseJsonStatDim(raw, 'cargo', codes.concat(['TOTAL']));

        const totalPoint = newest((parsed.series.TOTAL && parsed.series.TOTAL.series) || []);
        expect(totalPoint, `${country} reported no cargo total`).not.toBeNull();

        let sum = 0;
        let reported = 0;
        for (const code of codes) {
          const entry = parsed.series[code];
          const point = entry && entry.series.find((p: Point) => p.period === totalPoint!.period);
          if (point && point.value !== null) { sum += point.value; reported++; }
        }

        // Estonia publishes only a total, with no breakdown at all. That is a
        // legitimate shape and the panel handles it; what must never happen is
        // a partial breakdown that overshoots the total, which is the
        // signature of summing nested categories.
        if (reported === 0) return;
        expect(sum, `${country} cargo categories overshoot the total — nested codes?`)
          .toBeLessThanOrEqual((totalPoint!.value as number) * 1.01);
      });
    });
  }
});
