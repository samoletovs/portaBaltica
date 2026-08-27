/**
 * One clock per chart.
 *
 * A time axis has two jobs that must agree: labelling each point, and saying
 * where one day ends and the next begins. When those come from different
 * clocks the chart states something specific and wrong.
 *
 * It has happened twice. `EconomyTile` selected its window with a **UTC** date
 * and labelled its bars with the **local** hour, so the axis ran
 * "…19:00, 21:00, 0:00, 1:00" and looked as though tomorrow's prices had
 * leaked in (#81). `PowerMarketCard` labelled hours locally while the API
 * grouped `day` in UTC, so the "tomorrow" marker was drawn **180 minutes and
 * twelve points** after the midnight the axis had just labelled `00:00`.
 *
 * Both are the same fault, and the second survived the first because the fix
 * was applied to a component rather than to the mechanism.
 *
 * So: a chart picks one zone, formats *everything* through it, and says which
 * zone it picked. Not the browser's — a reader in London and a reader in Riga
 * must see the same day boundary on a chart about the Baltic market.
 */

/** Formats an instant as `HH:mm` in one fixed zone. */
export function hourFormatter(timeZone: string): (iso: string) => string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  });
  return (iso) => fmt.format(new Date(iso));
}

/** The calendar day an instant falls on, `YYYY-MM-DD`, in one fixed zone. */
export function dayFormatter(timeZone: string): (iso: string) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  });
  return (iso) => fmt.format(new Date(iso));
}

/**
 * The first point that falls on a different day from the first point.
 *
 * Deliberately derived from the series rather than read off a `day` field the
 * upstream computed. The API groups by UTC; the axis is drawn in the market's
 * zone; and trusting the field is precisely how the marker ended up three
 * hours out. `null` when the window never crosses a boundary, which is a real
 * state — a single day of prices has no midnight to mark.
 */
export function firstDayChange<T extends { time: string }>(
  points: readonly T[],
  dayOf: (iso: string) => string,
): T | null {
  if (points.length === 0) return null;
  const first = dayOf(points[0].time);
  return points.find((p) => dayOf(p.time) !== first) ?? null;
}
