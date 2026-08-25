/**
 * How old is the data on screen, and should we say so?
 *
 * The maritime panels served a 2026-03-01 snapshot well into August with no
 * date anywhere on the page, so half-year-old port calls looked like this
 * morning's. That specific feed turned out to be discontinued rather than
 * merely late — data.gov.lv published eighteen consecutive header-only CSVs —
 * and the panels now read Eurostat instead.
 *
 * The lesson survived the source change: an official statistic is *always*
 * behind, so the page must state which period it is looking at rather than let
 * a working API imply currency. What changed is the unit. Eurostat dates
 * maritime data by statistical quarter (`2025-Q4`), not by snapshot date, and
 * a quarter is a span rather than an instant — so age is measured in whole
 * months from the end of the period, and the threshold is months rather than
 * the old fortnight.
 *
 * This is computed at render time rather than served by the API on purpose:
 * `/api/port-data` is cached for hours at the edge and longer in localStorage,
 * so a staleness flag baked into the response would itself go stale and
 * under-report the age.
 */

/**
 * Months a quarterly series may trail before we call it frozen rather than
 * merely in arrears.
 *
 * Eurostat publishes maritime tables one to two quarters behind as normal
 * operation, so anything tighter would fire permanently and teach readers to
 * ignore the warning. Twelve months matches `MAX_AGE_MONTHS.Q` in
 * `api/shared/eurostat.js`, which is the same judgement made server-side.
 */
export const PORT_DATA_STALE_AFTER_MONTHS = 12;

export interface Freshness {
  /** The period the data describes, e.g. `2025-Q4`. */
  period: string;
  /** Whole months from the end of that period to now. */
  monthsBehind: number;
  stale: boolean;
  /** Reader-facing age, e.g. "2 quarters behind". */
  label: string;
}

/** Last month covered by a period label, as an absolute month index. */
function periodToMonthIndex(period: string): number | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-?Q([1-4])$/.exec(period))) return +m[1] * 12 + +m[2] * 3;
  if ((m = /^(\d{4})-(\d{2})$/.exec(period))) return +m[1] * 12 + +m[2];
  if ((m = /^(\d{4})$/.exec(period))) return +m[1] * 12 + 12;
  return null;
}

function describeAge(monthsBehind: number): string {
  if (monthsBehind <= 0) return 'the current quarter';
  if (monthsBehind <= 3) return 'the latest published quarter';
  const quarters = Math.floor(monthsBehind / 3);
  if (quarters <= 1) return '1 quarter behind';
  if (quarters < 4) return `${quarters} quarters behind`;
  const years = monthsBehind / 12;
  return years < 1.5 ? 'over a year behind' : `${Math.round(years)} years behind`;
}

/**
 * Age of a statistical period, or `null` when there is no usable one — which
 * is itself meaningful and must not be mistaken for "fresh".
 */
export function freshnessOf(
  period: string | null | undefined,
  staleAfterMonths: number = PORT_DATA_STALE_AFTER_MONTHS,
  now: number = Date.now(),
): Freshness | null {
  if (!period) return null;

  const idx = periodToMonthIndex(period);
  if (idx === null) return null;

  const d = new Date(now);
  const nowIdx = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
  const monthsBehind = Math.max(0, nowIdx - idx);

  return {
    period,
    monthsBehind,
    stale: monthsBehind > staleAfterMonths,
    label: describeAge(monthsBehind),
  };
}

/** `2025-Q4` → `Q4 2025`, for display next to the age. */
export function formatPeriod(period: string): string {
  const q = /^(\d{4})-?Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const date = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return period;
}
