/**
 * Guards for how old data is allowed to look.
 *
 * The maritime panels served a 2026-03-01 snapshot well into August with no
 * date on screen anywhere, so half-year-old port calls were presented exactly
 * like this morning's. The banner then blamed ingestion lag, which was the
 * wrong diagnosis — the publisher had emitted eighteen consecutive header-only
 * CSVs and the feed was simply discontinued.
 *
 * The panels read Eurostat now, which dates its maritime tables by statistical
 * quarter rather than by snapshot date. So these assertions moved from days to
 * months, and the threshold moved from "two missed weekly files" to "a
 * quarterly series that has stopped moving".
 */

import { describe, it, expect } from 'vitest';
import {
  freshnessOf,
  formatPeriod,
  periodCoverage,
  PORT_DATA_STALE_AFTER_MONTHS,
  STALE_AFTER_MONTHS,
  WARN_AFTER_MONTHS,
  type Cadence,
} from '../src/dataFreshness';
import { createRequire } from 'node:module';

// End of August 2026.
const NOW = Date.parse('2026-08-25T00:00:00Z');

describe('freshnessOf', () => {
  it('treats a normal Eurostat publication lag as fine, not as an outage', () => {
    // 2025-Q4 closed in December and was published in July. Two quarters in
    // arrears is how this source always behaves; warning about it every day
    // would train readers to ignore the warning.
    const f = freshnessOf('2025-Q4', PORT_DATA_STALE_AFTER_MONTHS, NOW)!;
    expect(f.stale).toBe(false);
    expect(f.monthsBehind).toBe(8);
    expect(f.label).toBe('2 quarters behind');
  });

  it('does not flag the quarter that just closed', () => {
    expect(freshnessOf('2026-Q2', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.stale).toBe(false);
    expect(freshnessOf('2026-Q2', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.label)
      .toBe('the latest published quarter');
  });

  it('flags a series that has genuinely stopped moving', () => {
    // A year with no new quarter is not a lag, it is a dead table — which is
    // exactly what happened to the feed this replaced.
    const f = freshnessOf('2025-Q1', PORT_DATA_STALE_AFTER_MONTHS, NOW)!;
    expect(f.monthsBehind).toBe(17);
    expect(f.stale).toBe(true);

    // The boundary: 2025-Q3 closed in September, eleven months back, and is
    // still inside the allowance; 2025-Q2 closed in June and is not.
    expect(freshnessOf('2025-Q3', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.monthsBehind).toBe(11);
    expect(freshnessOf('2025-Q3', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.stale).toBe(false);
    expect(freshnessOf('2025-Q2', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.monthsBehind).toBe(14);
    expect(freshnessOf('2025-Q2', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.stale).toBe(true);
  });

  it('returns null when there is no period, so absence is never read as fresh', () => {
    expect(freshnessOf(null, PORT_DATA_STALE_AFTER_MONTHS, NOW)).toBeNull();
    expect(freshnessOf(undefined, PORT_DATA_STALE_AFTER_MONTHS, NOW)).toBeNull();
    expect(freshnessOf('', PORT_DATA_STALE_AFTER_MONTHS, NOW)).toBeNull();
    expect(freshnessOf('not a period', PORT_DATA_STALE_AFTER_MONTHS, NOW)).toBeNull();
    expect(freshnessOf('2026-Q5', PORT_DATA_STALE_AFTER_MONTHS, NOW)).toBeNull();
  });

  it('never reports a negative age for a period still open', () => {
    const f = freshnessOf('2026-Q4', PORT_DATA_STALE_AFTER_MONTHS, NOW)!;
    expect(f.monthsBehind).toBe(0);
    expect(f.stale).toBe(false);
  });

  it('describes ages in units a reader can act on', () => {
    const label = (p: string) => freshnessOf(p, PORT_DATA_STALE_AFTER_MONTHS, NOW)!.label;
    expect(label('2026-Q2')).toBe('the latest published quarter');
    expect(label('2026-Q1')).toBe('1 quarter behind');
    expect(label('2025-Q3')).toBe('3 quarters behind');
    expect(label('2025-Q2')).toBe('over a year behind');
    expect(label('2024-Q2')).toBe('2 years behind');
  });

  it('reads annual and monthly labels too, so a mixed source is not silently dropped', () => {
    expect(freshnessOf('2026-06', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.monthsBehind).toBe(2);
    expect(freshnessOf('2025', PORT_DATA_STALE_AFTER_MONTHS, NOW)!.monthsBehind).toBe(8);
  });
});

describe('formatPeriod', () => {
  it('renders a quarter the way the banner reads it', () => {
    expect(formatPeriod('2025-Q4')).toBe('Q4 2025');
    expect(formatPeriod('2026Q1')).toBe('Q1 2026');
  });

  it('does not shift a month across a timezone boundary', () => {
    // Rendered from UTC; a local-time render would show December in any
    // negative-offset zone.
    expect(formatPeriod('2026-01')).toBe('January 2026');
    expect(formatPeriod('2026-01')).not.toContain('December');
  });

  it('passes through anything it cannot parse', () => {
    expect(formatPeriod('unknown')).toBe('unknown');
  });
});

describe('periodCoverage', () => {
  /**
   * The maritime tile draws three Eurostat tables published independently, and
   * they drift. Dating all three by the newest of them is the shared-as-of
   * problem the per-panel dates exist to avoid, moved up one level: a reader
   * told "Port statistics for Q1 2026" reads the cargo and passenger panels —
   * still on Q4 2025 — as current.
   */
  it('states one quarter when every measure reached it', () => {
    expect(periodCoverage('2025-Q4', '2025-Q4')).toEqual({ label: 'Q4 2025', spans: false });
  });

  it('states the span when they did not', () => {
    // Lithuania reached 2026-Q1 on vessels while its goods table was a quarter
    // behind. Claiming Q1 2026 for the whole tile over-dates two of three.
    expect(periodCoverage('2025-Q4', '2026-Q1'))
      .toEqual({ label: 'Q4 2025 to Q1 2026', spans: true });
  });

  it('falls back to the single period when the older bound is missing', () => {
    // A response cached from before `dataFrom` existed must still date itself.
    expect(periodCoverage(null, '2025-Q4')).toEqual({ label: 'Q4 2025', spans: false });
    expect(periodCoverage(undefined, '2025-Q4')).toEqual({ label: 'Q4 2025', spans: false });
  });

  it('returns null when there is no period, which must not read as current', () => {
    expect(periodCoverage('2025-Q4', null)).toBeNull();
    expect(periodCoverage(null, null)).toBeNull();
  });
});

describe('which bound decides staleness', () => {
  /**
   * The banner used to read `dataAsOf`, the *newest* measure. The three
   * maritime tables are published independently, so one current table could
   * hold the warning off while another panel sat years behind: the reader
   * would be looking at frozen figures under a tile that had decided
   * everything was fine. The oldest bound is the one capable of misleading, so
   * it is the one that decides whether to warn.
   */
  const NOW = Date.parse('2026-08-26T12:00:00Z');

  it('warns when the oldest measure is frozen even though the newest is current', () => {
    const newest = freshnessOf('2026-Q1', PORT_DATA_STALE_AFTER_MONTHS, NOW);
    const oldest = freshnessOf('2022-Q4', PORT_DATA_STALE_AFTER_MONTHS, NOW);

    expect(newest?.stale, 'the newest measure alone looks fine').toBe(false);
    expect(oldest?.stale, 'the oldest is what the reader is being misled by').toBe(true);
  });

  it('stays quiet when every measure is merely in arrears', () => {
    // Two quarters behind is normal operation for Eurostat maritime and must
    // not fire, or the warning becomes wallpaper.
    expect(freshnessOf('2025-Q4', PORT_DATA_STALE_AFTER_MONTHS, NOW)?.stale).toBe(false);
  });

  it('pairs with a span so the banner can name both bounds', () => {
    // Naming only the oldest would be false about the measures that are
    // current; naming only the newest is what hid the problem.
    const coverage = periodCoverage('2022-Q4', '2026-Q1');
    expect(coverage).toEqual({ label: 'Q4 2022 to Q1 2026', spans: true });
  });
});

/**
 * The reader-facing threshold: is this later than a reader should assume?
 *
 * A different question from `stale`, which asks whether the feed is dead, and
 * the distinction is the whole point of this block. Measured against
 * production on 2026-08-29, **0 of 213 series were stale** by the failover
 * verdict while nine sat twenty months old under the word "Latest". A warning
 * built on the failover bound would have been silent for ever.
 */
describe('lateness, which is not staleness', () => {
  // Real cadences and real ages, taken from the sweep rather than invented.
  // `now` is fixed so these do not decay into passing for the wrong reason.
  const AT = Date.parse('2026-08-29T00:00:00Z');

  it('flags the nine twenty-month series that motivated this', () => {
    // life_expectancy / rd_spending / hotel_occupancy, all annual, newest 2024.
    // Thirty-nine other annual series reached 2025 -- that peer comparison is
    // what makes twenty months a statement about these rather than about
    // annual statistics.
    const f = freshnessOf('2024', undefined, AT)!;
    expect(f.cadence).toBe('A');
    expect(f.monthsBehind).toBe(20);
    expect(f.late, 'twenty months must warn a reader').toBe(true);
    expect(f.stale, 'but the feed is not dead, and must not be called dead').toBe(false);
  });

  it('does not flag an annual series that reached last year', () => {
    // The 39. Eight months after a year closes is ordinary for annual data.
    const f = freshnessOf('2025', undefined, AT)!;
    expect(f.monthsBehind).toBe(8);
    expect(f.late).toBe(false);
  });

  it('does not cry wolf on weekly deaths, whose seven-week lag is normal', () => {
    // The measure this replaces -- "more than 2 publication periods behind" --
    // flagged all three of these at 7.8 periods while missing all nine above at
    // 1.67. Precisely inverted: loud on one of the freshest feeds, silent on
    // the oldest data on the dashboard.
    const f = freshnessOf('2026-W27', undefined, AT)!;
    expect(f.cadence).toBe('W');
    expect(f.late, 'a normal weekly lag must not warn').toBe(false);
  });

  it('flags a quarterly series at 2.5 periods and not one at 1.5', () => {
    // The manager's acceptance criterion, in the cadence it was posed for.
    // Q threshold is 6 months: 2025-Q4 is 8 months behind, 2026-Q1 is 5.
    expect(freshnessOf('2025-Q4', undefined, AT)!.monthsBehind).toBe(8);
    expect(freshnessOf('2025-Q4', undefined, AT)!.late, '8 months, above the 6-month line').toBe(true);
    expect(freshnessOf('2026-Q1', undefined, AT)!.monthsBehind).toBe(5);
    expect(freshnessOf('2026-Q1', undefined, AT)!.late, '5 months, below it').toBe(false);
  });

  it('is decided by the reader table even when a caller overrides the failover bound', () => {
    // The maritime banner passes its own `staleAfterMonths`. That argument
    // answers "is this feed dead" and must not silently redefine "is this
    // later than a reader should assume" as well.
    const f = freshnessOf('2024', 99, AT)!;
    expect(f.stale, 'the caller raised the failover bound').toBe(false);
    expect(f.late, 'but lateness is not theirs to move').toBe(true);
  });

  it('never warns after it has already given up', () => {
    // `late` must be reachable before `stale` for every cadence, or the warning
    // is unreachable and the feature is decoration. W is deliberately equal --
    // one weekly indicator and three series is too thin to site a line on --
    // and that exception is asserted rather than tolerated by an inequality
    // loose enough to hide a real inversion.
    for (const cadence of Object.keys(WARN_AFTER_MONTHS) as Cadence[]) {
      expect(
        WARN_AFTER_MONTHS[cadence],
        `${cadence}: a reader would be warned only once the feed was already abandoned`,
      ).toBeLessThanOrEqual(STALE_AFTER_MONTHS[cadence]);
    }
    const equal = (Object.keys(WARN_AFTER_MONTHS) as Cadence[])
      .filter((c) => WARN_AFTER_MONTHS[c] === STALE_AFTER_MONTHS[c]);
    expect(equal, 'only the weekly bound may coincide with its failover bound').toEqual(['W']);
  });

  it('covers exactly the cadences the failover table covers', () => {
    // Two tables over one vocabulary. A cadence present in one and absent from
    // the other would read as `monthsBehind > undefined`, which is false for
    // every age -- the absence-resolves-to-success failure, in the table whose
    // job is to prevent it.
    expect(Object.keys(WARN_AFTER_MONTHS).sort()).toEqual(Object.keys(STALE_AFTER_MONTHS).sort());
  });

  it('agrees with the copy the API serves', () => {
    // A threshold in two places is a threshold that will drift, so the two are
    // compared rather than described as identical.
    const require = createRequire(import.meta.url);
    const apiFreshness = require('../api/shared/freshness.js') as {
      WARN_AFTER_MONTHS: Record<string, number>;
    };
    expect(apiFreshness.WARN_AFTER_MONTHS).toEqual(WARN_AFTER_MONTHS);
  });
});
