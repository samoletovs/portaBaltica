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

/** The cadences a period label can be written in. */
export type Cadence = 'W' | 'M' | 'Q' | 'S' | 'A';

/**
 * How long a series of each cadence may trail before it is frozen rather than
 * late, in months.
 *
 * One threshold cannot serve all five. Gas prices are semi-annual and eight
 * months in arrears as normal operation; weekly deaths are seven weeks behind
 * and would be dead at three months. Judging both by the quarterly twelve
 * either cries wolf on one or says nothing about the other — and a warning
 * that fires permanently is one readers learn to route around, which is worse
 * than no warning because it also covers the real ones.
 *
 * These mirror `MAX_AGE_MONTHS` in `api/shared/eurostat.js` — the same
 * judgement, made about the same series, on the other side of the wire.
 * `tests/dashboardCadence.test.tsx` asserts the two agree rather than trusting
 * this sentence, because a threshold in two places is a threshold that will
 * drift.
 *
 * That pointer named `tests/dataFreshness.test.ts` until it was checked: the
 * assertion is real, and it is in the other file. A note that answers the
 * question a reader was about to ask, with an answer about a different thing,
 * closes the enquiry as effectively as a correct one — so the wrong filename
 * was worse than no filename.
 */
export const STALE_AFTER_MONTHS: Record<Cadence, number> = {
  W: 3, M: 6, Q: PORT_DATA_STALE_AFTER_MONTHS, S: 18, A: 30,
};

export interface Freshness {
  /** The period the data describes, e.g. `2025-Q4`. */
  period: string;
  /** Whole months from the end of that period to now. */
  monthsBehind: number;
  /** Cadence read off the label's own shape, which cannot be misdeclared. */
  cadence: Cadence;
  stale: boolean;
  /**
   * Later than a reader should have to assume. Distinct from `stale`, which
   * asks whether the feed is dead — see `WARN_AFTER_MONTHS`.
   */
  late: boolean;
  /** Reader-facing age, e.g. "2 quarters behind". */
  label: string;
}

/**
 * How late a series may be before a reader is warned, in months.
 *
 * WHY THIS IS A SECOND TABLE AND NOT A FRACTION OF THE FIRST
 * ---------------------------------------------------------
 * `STALE_AFTER_MONTHS` above answers "is this feed dead" — a failover
 * threshold, roughly twice the worst real publication lag. Measured against
 * production on 2026-08-29, nothing on the dashboard reaches even two thirds of
 * it: **0 of 213 series are stale** and the worst sits at 67% of its own
 * allowance. A warning built on it would be silent for ever while nine series
 * twenty months old were shown under the word "Latest".
 *
 * A percentage of that table does not work either, because it is not a uniform
 * multiple of normal lag. Median observed age as a fraction of the failover
 * bound: `W 60%, M 17%, Q 42%, S 44%, A 27%` — so any single percentage flags
 * the *typical* weekly series before it says anything about monthly data.
 *
 * These are sited in the empty gaps of the observed distribution instead, so
 * each line separates clusters rather than cutting one. Ages in months, 213
 * series:
 *
 *     A   39 at 8 ····· 12 months of empty space ····· 9 at 20    -> 14
 *     Q   21 at 2, 60 at 5 ··· 3 months empty ··· 9 at 8          ->  6
 *     M   4 at 0, 32 at 1, 20 at 2, 2 at 3 ····· 2 at 4           ->  3
 *     S   3 at -4 (published ahead) ····· 9 at 8, all of them     -> 12
 *     W   3 series, 1.6 to 1.8                                    ->  3
 *
 * `W` equals its failover bound deliberately: one weekly indicator and three
 * series is too thin a population to site a separate line on. The API side
 * carries the same table and the same reasoning, and
 * `tests/dataFreshness.test.ts` asserts the two agree — a threshold in two
 * places is a threshold that will drift.
 */
export const WARN_AFTER_MONTHS: Record<Cadence, number> = {
  W: 3, M: 3, Q: 6, S: 12, A: 14,
};

const ISO_WEEK = /^(\d{4})-?W(\d{1,2})$/;
const DAY_MS = 86400e3;

/**
 * The cadence a period label is written in.
 *
 * Read from the label rather than declared alongside it, for the reason
 * `tests/indicators.live.test.ts` learned the hard way: a declaration can
 * disagree with the data, and the label's shape cannot.
 */
export function cadenceOf(period: string): Cadence | null {
  if (ISO_WEEK.test(period)) return 'W';
  if (/^(\d{4})-?Q[1-4]$/.test(period)) return 'Q';
  if (/^(\d{4})-?[SH][12]$/.test(period)) return 'S';
  if (/^(\d{4})-(\d{2})$/.test(period)) return 'M';
  if (/^(\d{4})$/.test(period)) return 'A';
  return null;
}

/** Last instant of an ISO week, in UTC milliseconds. */
function isoWeekEndMs(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const isoDow = ((new Date(jan4).getUTCDay() + 6) % 7) + 1;
  const week1Monday = jan4 - (isoDow - 1) * DAY_MS;
  return week1Monday + (week - 1) * 7 * DAY_MS + 7 * DAY_MS - 1;
}

/** Last month covered by a period label, as an absolute month index. */
function periodToMonthIndex(period: string): number | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-?Q([1-4])$/.exec(period))) return +m[1] * 12 + +m[2] * 3;
  // Half-years, which the dashboard now draws: electricity and gas prices are
  // published by semester. Without this the two price charts dated themselves
  // `null` and printed nothing, which on a page carrying hourly power prices
  // reads as "as current as everything else".
  if ((m = /^(\d{4})-?[SH]([12])$/.exec(period))) return +m[1] * 12 + +m[2] * 6;
  if ((m = ISO_WEEK.exec(period))) {
    const end = new Date(isoWeekEndMs(+m[1], +m[2]));
    return end.getUTCFullYear() * 12 + end.getUTCMonth() + 1;
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(period))) return +m[1] * 12 + +m[2];
  if ((m = /^(\d{4})$/.exec(period))) return +m[1] * 12 + 12;
  return null;
}

/**
 * Weeks between the end of a weekly period and now.
 *
 * A month index cannot answer this: four or five weeks share one, so an age
 * derived from it is quantised to a month, and a seven-week-old weekly reading
 * reports as "1 month behind" — a third of its real age, in the reassuring
 * direction. Same defect the API side had, and the same fix.
 */
function weeksBehind(period: string, now: number): number | null {
  const m = ISO_WEEK.exec(period);
  if (!m) return null;
  return Math.max(0, Math.floor((now - isoWeekEndMs(+m[1], +m[2])) / (7 * DAY_MS)));
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} behind`;
}

/**
 * The age, in the unit the series is published in.
 *
 * A weekly series described in quarters is unreadable and a semi-annual one
 * described in quarters is misleading — "the latest published quarter" on a
 * table that has no quarters claims a cadence it does not have. So the wording
 * follows the cadence, and the quarterly strings are unchanged because the
 * maritime banner is built on them.
 */
function describeAge(monthsBehind: number, cadence: Cadence, weeks: number | null): string {
  if (cadence === 'W') {
    const n = weeks ?? 0;
    if (n <= 1) return 'the latest published week';
    return n < 53 ? plural(n, 'week') : 'over a year behind';
  }

  if (cadence === 'Q') {
    if (monthsBehind <= 0) return 'the current quarter';
    if (monthsBehind <= 3) return 'the latest published quarter';
    const quarters = Math.floor(monthsBehind / 3);
    if (quarters <= 1) return '1 quarter behind';
    if (quarters < 4) return plural(quarters, 'quarter');
    const years = monthsBehind / 12;
    return years < 1.5 ? 'over a year behind' : `${Math.round(years)} years behind`;
  }

  if (cadence === 'A') {
    if (monthsBehind <= 12) return 'the latest published year';
    return plural(Math.floor(monthsBehind / 12), 'year');
  }

  // Monthly and semi-annual are both stated in months. A semester is not a
  // unit a reader carries around, and "1 half-year behind" hides the
  // difference between seven months and twelve.
  if (monthsBehind <= 0) return cadence === 'M' ? 'the latest published month' : 'the latest published half-year';
  if (monthsBehind < 24) return plural(monthsBehind, 'month');
  return plural(Math.floor(monthsBehind / 12), 'year');
}

/**
 * Age of a statistical period, or `null` when there is no usable one — which
 * is itself meaningful and must not be mistaken for "fresh".
 *
 * `staleAfterMonths` defaults to the threshold for the cadence the label is
 * written in, rather than to the quarterly one. Every existing caller either
 * passes it explicitly or reads quarterly periods, where the two are the same
 * number by construction.
 */
export function freshnessOf(
  period: string | null | undefined,
  staleAfterMonths?: number,
  now: number = Date.now(),
): Freshness | null {
  if (!period) return null;

  const cadence = cadenceOf(period);
  const idx = periodToMonthIndex(period);
  if (cadence === null || idx === null) return null;

  const d = new Date(now);
  const nowIdx = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
  // Clamped, because a period can be open or even published in advance —
  // `earn_mw_cur` carries a semester four months ahead of the wall clock,
  // since a minimum wage is legislated before it takes effect. A negative age
  // is not "fresher than fresh", it is a period that has not finished.
  const monthsBehind = Math.max(0, nowIdx - idx);
  const limit = staleAfterMonths ?? STALE_AFTER_MONTHS[cadence];

  return {
    period,
    monthsBehind,
    cadence,
    stale: monthsBehind > limit,
    // Always judged against the reader-facing table, never against
    // `staleAfterMonths`. A caller that passes a custom failover bound — the
    // maritime banner does — is answering "is this feed dead", and it must not
    // silently redefine "is this later than a reader should assume" as well.
    late: monthsBehind > WARN_AFTER_MONTHS[cadence],
    label: describeAge(monthsBehind, cadence, weeksBehind(period, now)),
  };
}

/** `2025-Q4` → `Q4 2025`, for display next to the age. */
export function formatPeriod(period: string): string {
  const q = /^(\d{4})-?Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const h = /^(\d{4})-?[SH]([12])$/.exec(period);
  if (h) return `H${h[2]} ${h[1]}`;
  const w = ISO_WEEK.exec(period);
  if (w) {
    // The week number alone is unreadable — nobody knows when week 28 was —
    // so it is rendered as the Sunday that closes it, which is also the date
    // the observation is complete.
    const end = new Date(isoWeekEndMs(+w[1], +w[2]));
    return `week to ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  }
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const date = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return period;
}

/**
 * The shortest unambiguous form of a period, for a chart axis.
 *
 * `formatPeriod` above is written to be *read* — "week to 12 Jul 2026" — and
 * it is what the spoken chart description uses. An axis is a reference grid
 * rather than prose, and the full form does not fit one: measured at 375px,
 * six `2021-W01` labels ran together into `2021-W012021-W502022-W47`, and
 * before that the first of them was clipped in half by the card edge. Both
 * readings are worse than a shorter label.
 *
 * Six characters is the budget. `chartType.ts` sizes its six-label default on
 * `03:00` at five, and a 320px card gives an unaxised chart about 254px, so a
 * seven-character label was already over budget on the monthly charts before
 * weekly arrived and made it eight.
 */
export function axisPeriodLabel(period: string): string {
  const yy = (year: string) => year.slice(2);

  const q = /^(\d{4})-?Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${yy(q[1])}`;

  const h = /^(\d{4})-?[SH]([12])$/.exec(period);
  if (h) return `H${h[2]} ${yy(h[1])}`;

  // A week number is not a date anyone can place, and at six ticks across five
  // years the gap between two of them is about ten months — so the month it
  // ends in carries more than its ordinal does.
  const w = ISO_WEEK.exec(period);
  if (w) {
    const end = new Date(isoWeekEndMs(+w[1], +w[2]));
    return `${end.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} ${String(end.getUTCFullYear()).slice(2)}`;
  }

  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const date = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    return `${date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} ${yy(m[1])}`;
  }

  // A year is already four characters and shortening it would lose the century.
  return period;
}

/**
 * How to date a panel whose measures did not all reach the same period.
 *
 * The maritime tile draws three Eurostat tables that are published
 * independently, and they drift: the Europe-wide vessel cube was padded to
 * 2026-Q2 while Latvian goods stopped at 2025-Q4. Heading the tile with the
 * newest of the three dates the other two to a quarter they never reached,
 * which is the same shared-as-of dishonesty the per-panel dates exist to avoid
 * — just moved up one level.
 *
 * So: one period when they agree, a span when they do not. `spans` is returned
 * separately rather than baked into the label, because the caller owns the
 * sentence and only it knows what is being dated.
 *
 * Returns null when there is no period at all, which must not read as current.
 */
export function periodCoverage(
  from: string | null | undefined,
  to: string | null | undefined,
): { label: string; spans: boolean } | null {
  if (!to) return null;
  if (!from || from === to) return { label: formatPeriod(to), spans: false };
  return { label: `${formatPeriod(from)} to ${formatPeriod(to)}`, spans: true };
}
