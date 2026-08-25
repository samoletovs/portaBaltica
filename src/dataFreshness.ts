/**
 * How old is the data on screen, and should we say so?
 *
 * The maritime panels served snapshots from February 2026 well into August
 * with no date anywhere on the page. Nothing was broken — data.gov.lv ingests
 * its weekly port CSVs into the queryable datastore months behind publication
 * — but a reader had no way to know the port calls they were looking at were
 * half a year old.
 *
 * This is computed at render time rather than served by the API on purpose:
 * `/api/port-data` is cached for an hour at the edge and longer in
 * localStorage, so a staleness flag baked into the response would itself go
 * stale and under-report the age.
 */

/** Upstream publishes weekly, so two missed weeks means ingestion has stalled. */
export const PORT_DATA_STALE_AFTER_DAYS = 14;

export interface Freshness {
  /** The date the data describes, ISO `YYYY-MM-DD`. */
  asOf: string;
  ageDays: number;
  stale: boolean;
  /** Reader-facing age, e.g. "6 months old". */
  label: string;
}

const DAY_MS = 86_400_000;

function describeAge(ageDays: number): string {
  if (ageDays <= 0) return 'today';
  if (ageDays === 1) return 'yesterday';
  if (ageDays < 14) return `${ageDays} days old`;
  if (ageDays < 60) return `${Math.round(ageDays / 7)} weeks old`;
  if (ageDays < 365) return `${Math.round(ageDays / 30)} months old`;
  const years = ageDays / 365;
  return years < 1.5 ? 'over a year old' : `${Math.round(years)} years old`;
}

/**
 * Age of a snapshot date, or `null` when there is no usable date — which is
 * itself meaningful and must not be mistaken for "fresh".
 */
export function freshnessOf(
  asOf: string | null | undefined,
  staleAfterDays: number = PORT_DATA_STALE_AFTER_DAYS,
  now: number = Date.now(),
): Freshness | null {
  if (!asOf) return null;

  const parsed = Date.parse(asOf);
  if (Number.isNaN(parsed)) return null;

  const ageDays = Math.max(0, Math.floor((now - parsed) / DAY_MS));
  return {
    asOf,
    ageDays,
    stale: ageDays > staleAfterDays,
    label: describeAge(ageDays),
  };
}

/** `2026-03-01` → `1 March 2026`, for display next to the age. */
export function formatAsOf(asOf: string): string {
  const parsed = Date.parse(asOf);
  if (Number.isNaN(parsed)) return asOf;
  return new Date(parsed).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
