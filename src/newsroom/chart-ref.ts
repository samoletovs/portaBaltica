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

/**
 * Chart ids the dashboard can serve. Mirrors api/shared/indicators.js, and
 * tests/chartRef.test.ts asserts that mirror rather than trusting this comment.
 *
 * It had drifted in both directions at once, which is worse than either alone.
 * Six ids here were served by nothing — `gov_debt`, `renewable_share`,
 * `new_vehicles`, `tourist_arrivals`, `building_permits`, `biz_confidence` —
 * so a ref naming one passed this gate, reached
 * /api/baltic-compare?indicator=gov_debt, came back 400, and produced exactly
 * the empty "Live data" frame this module exists to prevent. Meanwhile
 * twenty-three ids the API does serve were absent, so an article citing
 * `gov_deficit` or `life_expectancy` had its chart silently dropped.
 *
 * The four that had a real counterpart moved to ALIASES. `biz_confidence` has
 * none, so it resolves to undefined and renders no chart — mapping it to a
 * near-miss would put a chart under a claim it does not support.
 * `building_permits` was in the same position until `sts_cobp_q` was added to
 * the registry; it is now a real id again rather than an alias, which is why
 * it is back in the list above.
 */
export const DASHBOARD_INDICATORS = new Set([
  'gdp', 'gdp_per_capita', 'inflation', 'energy_inflation', 'food_inflation',
  'core_inflation', 'services_inflation', 'goods_inflation', 'admin_prices',
  'home_energy_inflation', 'ppi', 'industrial', 'retail', 'construction',
  'house_prices', 'interest_rate', 'consumer_confidence',
  'building_permits', 'building_permits_residential',
  'building_permits_non_residential',
  'economic_sentiment', 'unemployment', 'youth_unemployment',
  'employment_rate', 'job_vacancy', 'salary', 'wages_mfg', 'wages_it',
  'minimum_wage', 'gov_debt_gdp', 'gov_revenue', 'gov_deficit', 'inequality',
  'poverty_risk', 'life_expectancy', 'weekly_deaths', 'population',
  'net_migration', 'asylum_applications',
  'birth_rate', 'rd_spending', 'digital_skills', 'online_shoppers',
  'exports', 'imports', 'trade_balance', 'goods_balance', 'services_balance',
  'transport_services', 'financial_services', 'ict_services',
  'other_business_services', 'current_account', 'tourism',
  'tourism_foreign', 'hotel_occupancy', 'elec_production',
  'elec_renewable_gen', 'renewables', 'elec_price_household',
  'elec_price_industry', 'gas_price_household', 'vehicles', 'air_passengers',
  'ghg_emissions',
  'business_registrations', 'bankruptcies', 'rail_freight', 'road_freight',
  'road_freight_tkm', 'rail_passengers', 'labour_productivity',
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
  // Ids this module used to accept as if the dashboard served them.
  gov_debt: 'gov_debt_gdp',
  renewable_share: 'renewables',
  new_vehicles: 'vehicles',
  tourist_arrivals: 'tourism',
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
