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
import { freshnessOf, formatPeriod, PORT_DATA_STALE_AFTER_MONTHS } from '../src/dataFreshness';

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
