/**
 * Whether the EU27 benchmark can share the axis with the three — measured from
 * the data, not declared.
 *
 * `euAggregation` in `api/shared/indicators.js` already keeps the benchmark off
 * an extensive total, and that gate is right: a slice of cube we cannot draw is
 * not worth fetching. But it is a **hand-written taxonomy standing in for a
 * measurable property**, and this repository has watched that shape fail
 * repeatedly — a word list encodes the examples its author thought of, and a
 * declaration encodes the indicators its author classified. Sixty-six of them
 * are classified today; nothing checks that any classification is true, and a
 * new indicator declared `average` whose EU figure happens to sit an order of
 * magnitude away would flatten its chart with no test to notice.
 *
 * So the rule is stated against the thing it is actually about: the height of
 * the y-axis, before and after the benchmark is added to it.
 *
 * ## What was measured
 *
 * Every indicator was fetched live from Eurostat over a five-year window on
 * 389d1f9, LV/EE/LT against `EU27_2020`, and the axis computed both ways. The
 * distribution is bimodal and the gap between the two modes is the widest in
 * the data:
 *
 * | Indicators | axis retained | band the three keep |
 * |---|---|---|
 * | the 11 `sum` cubes that carry an EU figure | 0.002 – 0.034 | 0.002 – 0.034 |
 * | the 42 `average` cubes | **0.541 – 1.000** | 0.076 – 1.000 |
 *
 * `tourism_foreign`, `tourism` and `air_passengers` — the three charts that
 * prompted this — retain 0.002, 0.002 and 0.006. That is the flat line along
 * the bottom, and it is two orders of magnitude away from the worst legitimate
 * case rather than a near miss.
 *
 * ## Two clauses, because there are two ways to ruin the axis
 *
 * The first is the obvious one: the benchmark stretches the axis so far that
 * what is left is not a comparison. `MIN_AXIS_RETENTION` catches it.
 *
 * The second is subtler and is the reason this is not a one-liner. A band can
 * be unreadable *without* the benchmark having done it: measured, Latvian life
 * expectancy, the employment rate and labour productivity occupy 7.6%, 9.5% and
 * 12.4% of their own axes with no EU line drawn at all, because a zero-based
 * axis under a series that lives at 73–79 is mostly empty space. Dropping the
 * benchmark there buys nothing and costs a real reading, so the test is whether
 * **the reference is what pushed them under**, not whether they are under.
 *
 * `MIN_LEGIBLE_BAND` is anchored to something physical rather than to the gap
 * in the table: three 2.5px strokes need on the order of 15–20px to read as
 * three lines, and the compact chart is 128px tall.
 *
 * ## Absence resolves to withholding
 *
 * Every "guard that cannot fail" in this codebase reduces to absence resolving
 * to success. Here it resolves the other way and deliberately: given nothing to
 * measure, this returns `false` and the line is not drawn. A missing benchmark
 * is a smaller loss than an unreadable chart, which is the same ruling
 * DESIGN.md §3.3 makes for an indicator that declares nothing.
 */

/**
 * The share of the axis the three must keep once the benchmark joins them.
 *
 * Sits in the empty band between the two modes above — 16× above the worst
 * ruined chart and 1.6× below the most compressed legitimate one — so a small
 * revision upstream cannot flip a chart across it.
 */
export const MIN_AXIS_RETENTION = 0.25;

/**
 * The share of the axis the three must span before they stop reading as three.
 *
 * Below this the strokes converge into one thick line and the chart answers no
 * question at all.
 */
export const MIN_LEGIBLE_BAND = 0.15;

function finite(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/**
 * The y-axis recharts will draw for these values.
 *
 * Its default numeric domain is `[0, 'auto']` — confirmed in
 * `recharts/lib/state/selectors/axisSelectors.js`, where `defaultNumericDomain`
 * is that literal and `getDomainDefinition` falls back to it whenever no
 * `domain` prop is given, which is the case in both the compact and full
 * chart. So the axis always contains zero, and that is what makes a distant
 * benchmark so expensive: it does not shift the axis, it extends it.
 *
 * Computed here rather than read back from the rendered SVG because the
 * decision has to be made before the line is handed to recharts — and because
 * `ResponsiveContainer` has no size under jsdom, so a measurement taken from
 * the DOM would report zero for a chart that renders perfectly in a browser.
 */
function axisHeight(values: number[]): number | null {
  if (values.length === 0) return null;
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi > lo ? hi - lo : null;
}

/** The vertical distance between the highest and lowest of the three. */
function spread(values: number[]): number | null {
  if (values.length === 0) return null;
  let lo = values[0];
  let hi = values[0];
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

export interface ReferenceScale {
  /** Axis height without the benchmark over axis height with it. 1 means it is free. */
  retention: number;
  /** Share of the axis the three span once the benchmark is on it. */
  bandWith: number;
  /** Share of the axis the three span on their own. */
  bandWithout: number;
  /** Whether the benchmark may be drawn. */
  sharesAxis: boolean;
}

/**
 * Measure what the benchmark costs, or `null` when there is nothing to measure.
 *
 * Returned rather than reduced to a boolean so a failing live check can name
 * the numbers instead of only the verdict.
 */
export function measureReferenceScale(
  baltic: readonly (number | null | undefined)[],
  reference: readonly (number | null | undefined)[],
): ReferenceScale | null {
  const three = finite(baltic);
  const benchmark = finite(reference);
  if (three.length === 0 || benchmark.length === 0) return null;

  const alone = axisHeight(three);
  const together = axisHeight(three.concat(benchmark));
  const band = spread(three);
  if (alone === null || together === null || band === null) return null;

  const retention = alone / together;
  const bandWith = band / together;
  const bandWithout = band / alone;

  // Ruined outright, or ruined by the benchmark specifically. A band that was
  // already below the floor is a zero-based-axis problem and withholding the
  // benchmark does not fix it.
  const sharesAxis =
    retention >= MIN_AXIS_RETENTION && (bandWith >= MIN_LEGIBLE_BAND || bandWithout < MIN_LEGIBLE_BAND);

  return { retention, bandWith, bandWithout, sharesAxis };
}

/**
 * Whether to draw the benchmark. `false` when it cannot be measured — see the
 * note on absence above.
 */
export function referenceSharesAxis(
  baltic: readonly (number | null | undefined)[],
  reference: readonly (number | null | undefined)[],
): boolean {
  return measureReferenceScale(baltic, reference)?.sharesAxis ?? false;
}
