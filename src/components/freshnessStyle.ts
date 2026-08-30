import type { Freshness } from '../dataFreshness';

/**
 * The colour for a period label, given how far behind its series is.
 *
 * Shared for the same reason the sentence in `FreshnessNotice.tsx` is: the
 * amber date and the notice are **one signal** — "look at this date" — and a
 * surface where they disagree tells a reader that two different things are
 * wrong. Four surfaces colour a period label and they must all read the same
 * flag.
 *
 * Keyed on `late`, not `stale`, and that is the whole point of the change this
 * arrived with. `stale` implies `late` for every cadence, so this covers both;
 * before it, twenty series that were eight to twenty months behind rendered
 * their dates in the ordinary tertiary grey.
 *
 * In its own file rather than beside the component, because eslint's
 * `react-refresh/only-export-components` forbids a module exporting both — the
 * same constraint `DownloadMenu.tsx` documents for its `downloadText` helper.
 */
export function freshnessLabelColor(freshness: Freshness | null | undefined): string {
  return freshness?.late ? 'var(--data-warning)' : 'var(--text-tertiary)';
}

/**
 * Should the site stop asserting which way a series moved?
 *
 * The other half of `freshnessLabelColor`, and the two are deliberately the
 * only places either flag is read. They answer different questions and they
 * read different flags:
 *
 *   freshnessLabelColor   late    draw attention to the date
 *   judgementWithheld     stale   stop asserting direction
 *
 * `stale`, and never `late`. A late series is still publishing and its change
 * is real and correctly measured — greying it would delete information rather
 * than qualify it. And the sentence this predicate gates says "the last reading
 * published", which is a claim about a dead feed: false of a series that
 * publishes again next quarter.
 *
 * **This exists because the distinction could not be guarded where it lived.**
 * The rule was correct at all ten call sites across `IndicatorCard`,
 * `IndicatorTable` and `RankedComparison`, and a test asserted it — by
 * rendering `IndicatorCard`. Planting the over-reach there went red; planting
 * the identical mutation in `RankedComparison` was green, across the whole
 * suite, because the guard's population was one component and the behaviour's
 * was three. That is not hypothetical: `RankedComparison` draws `rd_spending`
 * and `life_expectancy`, both 20 months behind and both `late`, so six live
 * series would have lost a correct colour with nothing to say so.
 *
 * A wider test would have closed that instance. One predicate closes the class:
 * the flag is chosen once, so a component cannot choose it differently, and the
 * over-reach becomes a one-line change here that reddens every rendering test
 * at once. `AGENTS.md`: structure beats a test wherever you can have it.
 *
 * Typed as a narrowing predicate rather than a plain boolean, because it is one:
 * it can only be true of a non-null verdict, and every call site needs
 * `freshness.period` in the branch it guards. Returning a bare `boolean` would
 * make three of them re-check for null that this function has already excluded.
 */
export function judgementWithheld(
  freshness: Freshness | null | undefined,
): freshness is Freshness {
  return freshness?.stale === true;
}
