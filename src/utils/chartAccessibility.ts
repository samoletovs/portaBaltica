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
 */
export function describeComparison(
  title: string,
  series: { label: string; points: Point[] }[],
  format: (value: number | null) => string,
  formatPeriod: (period: string) => string = (p) => p,
): string {
  const clauses = series
    .map(({ label, points }) => {
      const observed = points.filter(
        (point): point is { period: string; value: number } => point.value !== null,
      );
      if (observed.length === 0) return `${label}: no data`;
      const last = observed[observed.length - 1];
      return `${label} ${format(last.value)} in ${formatPeriod(last.period)}`;
    })
    .join('; ');

  return `${title}. Latest readings — ${clauses}.`;
}
