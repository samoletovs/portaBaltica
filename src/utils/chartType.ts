/**
 * Chart typography.
 *
 * Recharts draws its axis ticks and tooltips as SVG and inline styles, so they
 * sit outside the CSS type scale and had drifted accordingly: axis ticks were
 * 9px in three charts and 10px in a fourth, tooltips 11px in three and 12px in
 * a fourth. Four sizes for two jobs, none of them chosen.
 *
 * One value each, here. They sit a step below `--text-caption` on purpose —
 * axis labels are a reference grid rather than something to read, and at
 * caption size they crowd and start colliding on a sparkline. Keeping them in
 * one place is what stops that judgement being re-made, differently, in every
 * new chart.
 */

/** Axis tick labels. Below the DOM scale by design; see above. */
export const CHART_TICK_SIZE = 10;

/** Tooltips are read, so they get the caption step. */
export const CHART_TOOLTIP_SIZE = '0.75rem';

/** Every chart's tick, so a new axis cannot invent its own size. */
export function chartTick(fill: string) {
  return { fill, fontSize: CHART_TICK_SIZE };
}

/** Every chart's tooltip surface, so they match each other and the panels. */
export function chartTooltip(background: string, border: string) {
  return {
    background,
    border: `1px solid ${border}`,
    borderRadius: '8px',
    fontSize: CHART_TOOLTIP_SIZE,
  };
}

/**
 * The share of its own level a series has to move before a zero-based fill can
 * show the movement at all. Below this the fill is a flat bar and the shape is
 * pure noise.
 */
export const FLAT_SERIES_THRESHOLD = 0.02;

/**
 * Whether a series is too flat for a zero-based filled area to say anything.
 *
 * Carbon's rule is that a filled area starts at zero, because truncating one
 * distorts the part-to-whole reading — and recharts agrees by default, since
 * its implicit y-axis is `[0, 'auto']`. That is right for almost every series
 * here and wrong for a handful. Population moves well under 1% across a
 * five-year window, so zero-based it draws a dead flat line pinned to the top
 * of the card, and readers reported it as a rendering failure rather than as a
 * slow decline. They were reading it correctly: nothing was being shown.
 *
 * Carbon also says "line charts and scatter plots are less sensitive to this
 * distortion", so the escape is to stop being an area. A series that answers
 * true here drops its fill, becomes a plain line and may crop its axis — and
 * the card then states the range it cropped to, because an undisclosed crop is
 * the actual dishonesty. See DESIGN.md §3.3.
 *
 * A series that crosses zero is never flat in this sense: zero is a real
 * reference on it and cropping it away would hide the sign change, which is
 * usually the whole story.
 */
export function isNearlyFlat(values: number[]): boolean {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return false;

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min < 0 && max > 0) return false;

  const level = Math.max(...finite.map(Math.abs));
  if (level === 0) return false;

  return (max - min) / level < FLAT_SERIES_THRESHOLD;
}
