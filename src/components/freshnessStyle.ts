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
