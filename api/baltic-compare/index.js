const INDICATORS = require('../shared/indicators.js');
const es = require('../shared/eurostat.js');
const freshness = require('../shared/freshness.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

const GEOS = ['LV', 'EE', 'LT'];

/**
 * The European denominator, requested alongside the three but never one of them.
 *
 * `EU27_2020` rides on the same cube in the same request, so this costs no new
 * upstream, no new failure mode and no new trust — it is one more `geo=` on a
 * call we already make.
 *
 * It is returned under `reference`, deliberately outside `countries`. The
 * newsroom made the same ruling for the same reason: EU27 is a **denominator,
 * not a subject**. Everything that iterates `countries` — the ranked
 * comparison, the indicator cards, the chart's own colour assignment — would
 * otherwise silently acquire a fourth peer, and a Baltic dashboard would start
 * ranking the European Union against Latvia.
 *
 * 53 of the 65 indicators carry it with data. The 12 that do not are not a
 * fault: ten are `bop_c6_q`, where an EU aggregate balance of payments against
 * itself is close to meaningless because intra-EU flows cancel, and
 * `minimum_wage` has no EU figure because not every member state has one.
 *
 * It is also only asked for where it *means* something on a shared axis — see
 * `referenceIsComparable` below.
 */
const REFERENCE_GEO = 'EU27_2020';

/**
 * Whether the EU27 figure on this cube is a benchmark at all.
 *
 * It is one only where the statistic is intensive — a rate, a share, a price,
 * an index, a per-capita figure — because there the EU value is a weighted
 * average of its members and sits in the same numeric range as the three.
 *
 * For an extensive total it is a **sum containing the three**, not an average
 * beside them, and it is one to two orders of magnitude larger: EU27 population
 * is ~449M against Latvia's ~1.85M. Drawn on the shared linear axis of
 * `BalticCompareChart` that prices the axis in EU units and flattens Latvia,
 * Estonia and Lithuania into a single line along the bottom — so the benchmark
 * destroys the comparison the chart exists to make. `euAggregation` in the
 * registry records which kind each indicator is, and is mandatory there so that
 * a new indicator cannot acquire a distorting benchmark by saying nothing.
 */
function referenceIsComparable(def) {
  return Boolean(def) && def.euAggregation === 'average';
}

/**
 * Attach how late this country's series is, beside the series itself.
 *
 * WHY THE ENDPOINT SHIPS THIS RATHER THAN LEAVING IT TO THE CLIENT
 * ---------------------------------------------------------------
 * Until now this endpoint carried **no freshness verdict at all** — measured,
 * the only match for "stale" in the file was a cache flag — so a series last
 * observed in 2024 arrived indistinguishable from one observed last month. The
 * client can and does date each figure itself from the period label, and
 * `src/dataFreshness.ts` is the authority for what a reader is shown. This
 * field exists so that everything which is *not* the dashboard — the live
 * contract tests, a monitor, the newsroom — can ask the same question without
 * reimplementing the judgement in a third place.
 *
 * WHY A CACHED AGE IS SAFE HERE, WHICH IS NOT TRUE EVERYWHERE
 * ----------------------------------------------------------
 * `src/dataFreshness.ts` computes at render time on purpose, because
 * `/api/port-data` is cached for hours at the edge and longer in localStorage,
 * and an age baked into that response would itself go stale. The reasoning does
 * not carry here: this response is cached for one hour and `monthsBehind` is
 * quantised to whole months, so no cached copy can outlive the granularity of
 * its own answer. `period` is the durable fact either way — it describes the
 * data rather than the clock — and a consumer that wants an age it computed
 * itself should use that.
 */
function withFreshness(country, now) {
  const verdict = freshness.judgeSeriesLateness(country.series, now);
  // Absent rather than falsely reassuring. A series whose period cannot be read
  // is not evidence that it is current, and `freshness: null` says so where a
  // fabricated `late: false` would not.
  return Object.assign({}, country, { freshness: verdict });
}

/**
 * The reference series, or `null` when this cube does not carry one.
 *
 * **A label is not a reading.** `rail_go_quartal` lists `EU27_2020` among its
 * geographies and populates none of it, so a check for the code's *presence*
 * would have drawn an empty benchmark on that chart — the same mistake as a
 * probe that goes green because the cube answered. The test is whether any
 * finite observation exists, and `null` here is what lets the client withhold
 * the line rather than draw nothing and call it a comparison.
 */
function buildReference(entry) {
  if (!entry || !Array.isArray(entry.series)) return null;
  const points = entry.series.filter(function (p) {
    return typeof p.value === 'number' && Number.isFinite(p.value);
  });
  if (points.length === 0) return null;
  return {
    code: REFERENCE_GEO,
    label: 'EU27',
    // Spelled out once, because "EU27" alone is ambiguous between the pre- and
    // post-Brexit composition and this is the 2020 one.
    fullLabel: 'European Union — 27 countries (from 2020)',
    series: entry.series,
    latest: points[points.length - 1].value,
    latestPeriod: points[points.length - 1].period,
  };
}

/**
 * GET /api/baltic-compare?indicator=gdp&years=5
 * GET /api/baltic-compare?list=1
 *
 * Latvia vs Estonia vs Lithuania, from the Eurostat dissemination API.
 *
 * The indicator definitions live in ../shared/indicators.js so the contract
 * test asserts against exactly what this handler serves. `assumptions` is
 * echoed back on every response: it is empty for a correctly pinned indicator,
 * and a non-empty value means the parser had to guess which slice of the cube
 * to read — the failure mode that previously produced blank and mislabelled
 * charts without anything going red.
 */
const handler = async function (context, req) {
  const query = req.query || {};

  if (query.list) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify({
        indicators: Object.keys(INDICATORS).map(function (key) {
          return {
            id: key,
            title: INDICATORS[key].title,
            unit: INDICATORS[key].unit,
            dataset: INDICATORS[key].dataset,
            freq: INDICATORS[key].freq,
          };
        }),
      }),
    };
    return;
  }

  const indicator = query.indicator || '';
  const def = INDICATORS[indicator];
  if (!def) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', ') }),
    };
    return;
  }

  const years = parseInt(query.years, 10) || 5;

  try {
    // The denominator is asked for only where it is one. For a `sum` indicator
    // it is not merely unusable on the chart, it is a slice of cube we have no
    // use for, so it is left out of the request rather than fetched and dropped.
    const wantReference = referenceIsComparable(def);
    const geos = wantReference ? GEOS.concat([REFERENCE_GEO]) : GEOS.slice();
    const url = es.buildUrl(def, years, geos);
    const data = await es.httpJson(url, { deadlineMs: 20000 });
    const parsed = es.parseJsonStat(data, geos);

    // Split the reference out before anything else sees `countries`, so a
    // fourth series cannot leak into a Baltic comparison by accident.
    const countries = {};
    GEOS.forEach(function (geo) {
      if (parsed.countries[geo]) countries[geo] = withFreshness(parsed.countries[geo]);
    });
    const reference = wantReference ? buildReference(parsed.countries[REFERENCE_GEO]) : null;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        indicator: indicator,
        title: def.title,
        unit: def.unit,
        countries: countries,
        reference: reference,
        assumptions: parsed.assumptions,
        source: 'Eurostat (' + def.dataset + ')',
        dataset: def.dataset,
        years: years,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: indicator,
        error: error.message,
        source: 'Eurostat (' + def.dataset + ')',
      }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'baltic-compare',
  keyOn: ['indicator', 'years', 'list'],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
// Exported so the split between the three and the denominator is assertable,
// rather than being a convention a future refactor could quietly undo.
module.exports.GEOS = GEOS;
module.exports.REFERENCE_GEO = REFERENCE_GEO;
module.exports.buildReference = buildReference;
module.exports.referenceIsComparable = referenceIsComparable;
