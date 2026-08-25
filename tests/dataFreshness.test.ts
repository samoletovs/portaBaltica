/**
 * Guards for how old data is allowed to look.
 *
 * The maritime panels served snapshots taken on 2026-03-01 well into August
 * with no date on screen anywhere, so half-year-old port calls were presented
 * exactly like this morning's. Nothing upstream was broken — data.gov.lv
 * ingests its weekly port CSVs into the queryable datastore months behind
 * publication — which is precisely why the age has to be shown rather than
 * inferred from a working API.
 */

import { describe, it, expect } from 'vitest';
import { freshnessOf, formatAsOf, PORT_DATA_STALE_AFTER_DAYS } from '../src/dataFreshness';

const NOW = Date.parse('2026-08-25T00:00:00Z');

describe('freshnessOf', () => {
  it('flags the snapshot the dashboard was actually serving', () => {
    const f = freshnessOf('2026-03-01', PORT_DATA_STALE_AFTER_DAYS, NOW);
    expect(f).not.toBeNull();
    expect(f!.stale).toBe(true);
    expect(f!.ageDays).toBe(177);
    expect(f!.label).toBe('6 months old');
  });

  it('does not flag a snapshot from this week', () => {
    expect(freshnessOf('2026-08-23', PORT_DATA_STALE_AFTER_DAYS, NOW)!.stale).toBe(false);
  });

  it('allows one missed weekly publication before complaining', () => {
    // Upstream publishes weekly; a single late week is normal operation.
    expect(freshnessOf('2026-08-14', PORT_DATA_STALE_AFTER_DAYS, NOW)!.stale).toBe(false);
    expect(freshnessOf('2026-08-10', PORT_DATA_STALE_AFTER_DAYS, NOW)!.stale).toBe(true);
  });

  it('returns null when there is no date, so absence is never read as fresh', () => {
    expect(freshnessOf(null, PORT_DATA_STALE_AFTER_DAYS, NOW)).toBeNull();
    expect(freshnessOf(undefined, PORT_DATA_STALE_AFTER_DAYS, NOW)).toBeNull();
    expect(freshnessOf('', PORT_DATA_STALE_AFTER_DAYS, NOW)).toBeNull();
    expect(freshnessOf('not a date', PORT_DATA_STALE_AFTER_DAYS, NOW)).toBeNull();
  });

  it('never reports a negative age for a date in the future', () => {
    const f = freshnessOf('2026-09-01', PORT_DATA_STALE_AFTER_DAYS, NOW)!;
    expect(f.ageDays).toBe(0);
    expect(f.stale).toBe(false);
  });

  it('describes ages in units a reader can act on', () => {
    expect(freshnessOf('2026-08-25', PORT_DATA_STALE_AFTER_DAYS, NOW)!.label).toBe('today');
    expect(freshnessOf('2026-08-24', PORT_DATA_STALE_AFTER_DAYS, NOW)!.label).toBe('yesterday');
    expect(freshnessOf('2026-08-20', PORT_DATA_STALE_AFTER_DAYS, NOW)!.label).toBe('5 days old');
    expect(freshnessOf('2026-08-01', PORT_DATA_STALE_AFTER_DAYS, NOW)!.label).toBe('3 weeks old');
    expect(freshnessOf('2024-01-01', PORT_DATA_STALE_AFTER_DAYS, NOW)!.label).toBe('3 years old');
  });
});

describe('formatAsOf', () => {
  it('renders an ISO date the way the banner reads it', () => {
    expect(formatAsOf('2026-03-01')).toBe('1 March 2026');
  });

  it('does not shift the date across a timezone boundary', () => {
    // Parsed as UTC midnight; a local-time render would show 28 February in
    // any negative-offset zone.
    expect(formatAsOf('2026-03-01')).not.toContain('February');
  });

  it('passes through anything it cannot parse', () => {
    expect(formatAsOf('unknown')).toBe('unknown');
  });
});
