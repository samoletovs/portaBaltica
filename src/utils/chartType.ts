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
