import { formatPeriod, type Freshness } from '../dataFreshness';

/**
 * The one sentence the site uses for a series that is behind.
 *
 * **One component rather than five copies.** This text was byte-identical in
 * `IndicatorCard` and `BalticCompareChart` on purpose, with a comment on each
 * saying that two surfaces inventing two vocabularies for one condition is how
 * a design system dies. That was right, and it held while there was one
 * condition and one sentence. There are now two conditions, and five surfaces
 * maintaining the same two-branch rule by hand is the drift that comment was
 * written to prevent, arriving the long way round.
 *
 * WHAT EACH VERDICT DRIVES, AND WHY THEY ARE NOT THE SAME
 * ------------------------------------------------------
 * `freshnessOf` returns two flags and they answer different questions:
 *
 *   stale   the feed looks dead        monthsBehind > STALE_AFTER_MONTHS
 *   late    behind further than this   monthsBehind > WARN_AFTER_MONTHS
 *           cadence normally runs
 *
 * They drive different things, and the split is the point of this whole change:
 *
 *   late  ->  **draw attention to the date**  — this notice, and the amber on
 *             the period label beside it. The reading is real and the series is
 *             still publishing; it is simply further back than a reader would
 *             assume from a figure captioned "Latest".
 *
 *   stale ->  **stop asserting direction** — sentiment colour suppressed, and
 *             the spoken change sentence replaced by "up as of {period}, the
 *             last reading published". Those stay gated on `stale` alone.
 *
 * Extending the sentiment suppression to `late` would have been the obvious
 * one-flag-per-gate reading of the task and it is wrong twice over. It would
 * grey the change on 20 live series whose direction is real and correctly
 * measured — and the replacement sentence says "the last reading published",
 * which is a claim about a dead feed and would simply be false on a series that
 * publishes again next quarter.
 *
 * ORDER IS FORCED, NOT PREFERRED
 * ------------------------------
 * `WARN_AFTER_MONTHS <= STALE_AFTER_MONTHS` for every cadence, so **`stale`
 * implies `late`** and the stale branch must be tested first or it becomes
 * unreachable. Measured, per cadence:
 *
 *     W  warn 3,  stale 3    identical — a weekly series is never late-only
 *     M  warn 3,  stale 6    a 3-month band
 *     Q  warn 6,  stale 14   an 8-month band
 *     S  warn 12, stale 18   a 6-month band
 *     A  warn 14, stale 30   a 16-month band
 *
 * The weekly row is worth knowing rather than glossing: for `W` the two
 * thresholds are the same number, so "warned before being judged dead" is a
 * state that does not exist there.
 *
 * WHAT THIS TURNS ON, MEASURED
 * ----------------------------
 * Swept against production across all 72 comparison indicators, 216 series:
 *
 *     late AND stale        0
 *     LATE but not stale   20   across 8 indicators
 *     neither             196
 *
 * So the stale sentence has never been reachable on the dashboard — every one
 * of the 21 gates that read `stale` has been dormant since it was written —
 * and this is what makes the apparatus visible for the first time. Nine annual
 * series sit 20 months behind and render today as though current.
 */
export function FreshnessNotice({
  freshness,
  spans = false,
  className = '',
}: {
  freshness: Freshness | null | undefined;
  /**
   * True where the panel draws several series that publish independently, so
   * the verdict is taken on the laggard. `BalticCompareChart` sets it: the
   * singular sentence was false for whichever countries had already published,
   * and the Baltic states routinely publish weeks apart.
   */
  spans?: boolean;
  className?: string;
}) {
  if (!freshness) return null;

  const subject = spans ? 'The slowest of these series' : 'This series';
  const text = freshness.stale
    ? `${subject} has published nothing newer than ${formatPeriod(freshness.period)}.`
    : freshness.late
      ? `${subject} is later than usual: nothing newer than ${formatPeriod(freshness.period)}.`
      : null;

  if (!text) return null;

  return (
    <p className={`text-caption ${className}`.trim()} style={{ color: 'var(--data-warning)' }}>
      {text}
    </p>
  );
}
