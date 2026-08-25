// ─── Resolving an article's chart reference ───
//
// `chart_ref` is the only thing joining an article to the chart that backs it,
// and for a while the two ends disagreed: the pipeline wrote
// `labour.unemployment` and `unemployment_rate`, while the dashboard serves
// `unemployment`. The request came back 400 and the reader got a panel headed
// "Live data" with nothing in it.
//
// The pipeline now emits dashboard ids (enforced by
// newsroom/tests/pipeline/test_chart_ref_contract.py), but that only fixes
// articles written from now on. Everything already published keeps the ref it
// was stored with, and we do not rewrite published articles — the corrections
// policy is explicit that the record is append-only. So the reader side has to
// understand the older vocabulary too.
//
// Hence two layers, doing different jobs:
//
//   1. `ALIASES` translates the refs we know we emitted. This is a fixed,
//      closed list of past mistakes, not an open-ended guessing mechanism.
//   2. Anything still unrecognised resolves to `undefined`, and the caller
//      renders no chart at all. An absent chart is honest; an empty frame
//      captioned "Live data" is not.

/** Chart ids the dashboard can serve. Mirrors api/shared/indicators.js. */
export const DASHBOARD_INDICATORS = new Set([
  'gdp', 'gdp_per_capita', 'inflation', 'energy_inflation', 'food_inflation',
  'core_inflation', 'ppi', 'industrial', 'retail', 'construction',
  'house_prices', 'interest_rate', 'consumer_confidence', 'economic_sentiment',
  'unemployment', 'youth_unemployment', 'job_vacancy', 'salary', 'wages_mfg',
  'wages_it', 'population', 'exports', 'imports', 'trade_balance', 'gov_debt',
  'gov_revenue', 'renewable_share', 'building_permits', 'new_vehicles',
  'tourist_arrivals', 'hotel_occupancy', 'biz_confidence',
]);

/**
 * Refs the pipeline emitted before the vocabularies were reconciled.
 *
 * Closed list. A new entry belongs here only when an article carrying that ref
 * is genuinely published and cannot be regenerated.
 */
const ALIASES: Record<string, string> = {
  unemployment_rate: 'unemployment',
  'labour.unemployment': 'unemployment',
  hicp_annual_rate: 'inflation',
  'economy.inflation': 'inflation',
};

/**
 * Returns a chart id the dashboard can actually serve, or `undefined`.
 *
 * `undefined` means "render no chart", never "render an empty one".
 */
export function resolveChartRef(ref: string | undefined | null): string | undefined {
  if (!ref) return undefined;

  const direct = ref.trim();
  if (DASHBOARD_INDICATORS.has(direct)) return direct;

  const aliased = ALIASES[direct];
  if (aliased && DASHBOARD_INDICATORS.has(aliased)) return aliased;

  // A dotted ref is a namespaced id that never existed; the last segment is
  // the part that was meant to be the indicator.
  if (direct.includes('.')) {
    const tail = direct.slice(direct.lastIndexOf('.') + 1);
    if (DASHBOARD_INDICATORS.has(tail)) return tail;
  }

  return undefined;
}
