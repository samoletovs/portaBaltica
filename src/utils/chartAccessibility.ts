/**
 * A chart, described in words.
 *
 * Recharts draws to SVG with no `role`, no `<title>`, no `<desc>` and no table
 * alternative, so on a product whose core content *is* the charts, that content
 * was entirely absent for anyone using a screen reader. The paths are not
 * merely unlabelled — they are announced as a pile of anonymous graphics.
 *
 * The full remedy is a `<figure>` with a visually-hidden data table, and that
 * is still owed (DESIGN.md §7). This is the floor: mark the chart as one
 * image, and give it a sentence that carries what a sighted reader takes from
 * a glance — what is plotted, over what span, and where it started and ended.
 */

interface Point {
  period: string;
  value: number | null;
}

/**
 * Describes a single series: its range, its endpoints and its direction.
 *
 * `format` is the caller's own value formatter, so units and currency read the
 * same way they do on screen rather than as raw floats.
 */
export function describeSeries(
  title: string,
  points: Point[],
  format: (value: number | null) => string,
  formatPeriod: (period: string) => string = (p) => p,
): string {
  const observed = points.filter(
    (point): point is { period: string; value: number } => point.value !== null,
  );

  if (observed.length === 0) return `${title}: no data available.`;

  const first = observed[0];
  const last = observed[observed.length - 1];

  if (observed.length === 1) {
    return `${title}: a single reading, ${format(first.value)} in ${formatPeriod(first.period)}.`;
  }

  const values = observed.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const move = last.value > first.value ? 'rising' : last.value < first.value ? 'falling' : 'flat';

  return (
    `${title}: ${observed.length} readings from ${formatPeriod(first.period)} to ` +
    `${formatPeriod(last.period)}, ${move} from ${format(first.value)} to ${format(last.value)}. ` +
    `Lowest ${format(low)}, highest ${format(high)}.`
  );
}

/**
 * Describes several series plotted together, one clause each.
 *
 * Used by the Baltic comparison charts, where the point of the chart is the
 * gap between the countries rather than any one line.
 *
 * ## The forward-curve trap, and why this takes an `asAt`
 *
 * This used to open with "Latest readings —" unconditionally and report the
 * **final** element of each series. That is true of a historical series and
 * false of any curve that runs forward, and it shipped a measured error:
 *
 *     the label said     Estonia €28.26 … Finland €1.83   "Latest readings"
 *     the panel showed   Estonia €28.41 … Finland €27.45   current
 *
 * Finland out by a factor of fifteen, because the last *interval* of a
 * day-ahead price curve is tomorrow's final slot rather than today's price. It
 * is the forecast trap `AGENTS.md` records for freshness probes, arriving in an
 * accessible name — and it has a built-in blind spot, because a sighted reader
 * sees the correct figure two inches away and only a screen-reader user ever
 * hears the wrong one.
 *
 * **The boundary is not knowable here.** Measured against the three real call
 * sites, this function receives period *labels*, and they are display strings:
 *
 *     PowerMarketCard   184 points   "00:45"    88 duplicate labels
 *     GridStatePanel     48 points   "18:00"     0 duplicates
 *     an indicator       22 points   "2026-Q2"   0 duplicates
 *
 * The day-ahead labels carry no date at all, and 88 of the 184 repeat because
 * the clock wraps at midnight — so "00:45" names two different points and
 * nothing in the input distinguishes them. `GridStatePanel` knows where
 * measurement stops only because its payload carries `meteredTo`, which never
 * reaches this function. So recency is caller knowledge, and the caller has to
 * declare it.
 *
 * Two mechanisms follow, and the difference between them matters:
 *
 * - **`asAt` is the guarantee.** Name the period that is current and this
 *   reports the reading *there*, says "Latest readings" truthfully, and notes
 *   that the series continues beyond it when it does.
 * - **Repeated period labels are refused**, structurally. When a label occurs
 *   twice it cannot identify a point, so no clause of the form "X in <period>"
 *   is well-defined and this stops claiming one — it reports each series'
 *   range across the plotted points instead, which is true at any orientation.
 *
 * **The residual, stated rather than hidden:** a forward curve whose labels
 * happen to be unique — `GridStatePanel` is exactly this — still gets "Latest
 * readings" for a point that may be a forecast. That clause is *unambiguous
 * and true as drawn*, and it is not *current*. Only `asAt` closes it, which is
 * why this documents the gap instead of pretending the detection is complete.
 */
export function describeComparison(
  title: string,
  series: { label: string; points: Point[] }[],
  format: (value: number | null) => string,
  formatPeriod: (period: string) => string = (p) => p,
  options: { asAt?: string } = {},
): string {
  const observedIn = (points: Point[]) =>
    points.filter((point): point is { period: string; value: number } => point.value !== null);

  // Structural, not lexical: a label that occurs twice cannot name a point.
  // This is deliberately not a date parser. A parser handles the formats its
  // author imagined and fails silently on the next one, in the direction that
  // reports success — and here it would have to make sense of "2026-Q2",
  // "2026-S2", "2026-W28", "00:45" and whatever a future caller invents.
  const labelsRepeat = series.some(({ points }) => {
    const seen = new Set<string>();
    return points.some((point) => (seen.has(point.period) ? true : (seen.add(point.period), false)));
  });

  if (options.asAt !== undefined) {
    const clauses = series
      .map(({ label, points }) => {
        // The reading *at* the declared period, or the last one before it.
        // Indexed on the series' own labels rather than on a global position,
        // because two series may not carry the same points.
        const cut = points.findIndex((point) => point.period === options.asAt);
        const upTo = cut === -1 ? points : points.slice(0, cut + 1);
        const observed = observedIn(upTo);
        if (observed.length === 0) return `${label}: no reading yet`;
        const at = observed[observed.length - 1];
        return `${label} ${format(at.value)} at ${formatPeriod(at.period)}`;
      })
      .join('; ');

    // Only claim the series continues if a point genuinely follows the cut.
    const continues = series.some(({ points }) => {
      const cut = points.findIndex((point) => point.period === options.asAt);
      return cut !== -1 && observedIn(points.slice(cut + 1)).length > 0;
    });
    const furthest = series
      .flatMap(({ points }) => observedIn(points))
      .map((point) => point.period)
      .at(-1);

    return (
      `${title}. Latest readings — ${clauses}.` +
      (continues && furthest ? ` The series continues to ${formatPeriod(furthest)}.` : '')
    );
  }

  if (labelsRepeat) {
    const clauses = series
      .map(({ label, points }) => {
        const observed = observedIn(points);
        if (observed.length === 0) return `${label}: no data`;
        const values = observed.map((point) => point.value);
        return `${label} between ${format(Math.min(...values))} and ${format(Math.max(...values))}`;
      })
      .join('; ');

    const plotted = Math.max(...series.map(({ points }) => points.length), 0);
    return `${title}. Across ${plotted} plotted points — ${clauses}.`;
  }

  const clauses = series
    .map(({ label, points }) => {
      const observed = observedIn(points);
      if (observed.length === 0) return `${label}: no data`;
      const last = observed[observed.length - 1];
      return `${label} ${format(last.value)} in ${formatPeriod(last.period)}`;
    })
    .join('; ');

  return `${title}. Latest readings — ${clauses}.`;
}
