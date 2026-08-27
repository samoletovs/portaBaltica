/**
 * Reading a payload that may not be the shape it claims.
 *
 * Every component on this dashboard is fed by one of eleven upstreams, one of
 * which is a language model, and each of them guarded its render with `!data`.
 * That checks whether *something* arrived. It does not check whether what
 * arrived has the fields the next line reads, and four separate page-level
 * failures came from exactly that gap:
 *
 *   - `SystemStatusFooter` read `status.dataSources.healthy` on a resolved
 *     payload with no `dataSources`, and — sitting outside the per-section
 *     error boundaries — the component whose job is to report an outage
 *     removed the entire site.
 *   - `InsightsBanner` read `.color` off a lookup keyed by a model-authored
 *     string, so one unfamiliar level threw.
 *   - `PropertyTile` called `.map` on two arrays that a 404-shaped response
 *     does not contain.
 *   - `classifySeaState` compared a bare number with a chain of `<`, every one
 *     of which is false for `NaN`, so a missing wave height fell past them all
 *     to the final `return` and a port with no reading was labelled
 *     **"Very Rough"** — a storm — in red.
 *
 * The last one is the important one, and it is why these helpers return an
 * *empty* or *null* value rather than a plausible default. Two of those four
 * bugs invented a reading: one said the air was clean, the other said the sea
 * was dangerous. Opposite defaults, same defect — the absence of data rendered
 * as a confident value. A default that looks like data is worse than a crash,
 * because a crash is at least visible.
 *
 * So: `list` gives you nothing to draw, `finite` gives you `null` to render as
 * "—", and neither invents a number. See DESIGN.md §3.8.
 */

/**
 * The value if it is genuinely an array, otherwise an empty one.
 *
 * Callers then render "no rows" rather than throwing, which is the honest
 * outcome: we did not receive the series, so we have nothing to show for it.
 */
export function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The value if it is a real, finite number, otherwise `null`.
 *
 * `null` and not `0`. A zero is a reading — "Suspended activities: 0" survived
 * on this dashboard for a while as a confident answer produced by a 404 — and
 * the whole point here is to be unable to say that. `NaN` and `Infinity` are
 * rejected for the same reason: they format as "NaN" or crash a `.toFixed`,
 * and they arrive from arithmetic on absent fields rather than from a source.
 */
export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A finite number formatted to fixed decimals, or an em dash.
 *
 * The dash is the house convention for a value we do not have (DESIGN.md
 * §3.8), and routing the formatting through here is what stops a `.toFixed()`
 * being called on `undefined` in a render path.
 */
export function fixed(value: unknown, digits: number): string {
  const n = finite(value);
  return n === null ? '—' : n.toFixed(digits);
}
