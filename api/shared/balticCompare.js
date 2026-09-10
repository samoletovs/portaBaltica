'use strict';

const INDICATORS = require('./indicators.js');
const es = require('./eurostat.js');
const freshness = require('./freshness.js');
const cache = require('./cache.js');
const { responseKey } = require('./responseCache.js');
const work = require('./comparisonWork.js');

const GEOS = ['LV', 'EE', 'LT'];
const REFERENCE_GEO = 'EU27_2020';
const CACHE_OPTIONS = {
  name: 'baltic-compare',
  keyOn: ['indicator', 'years', 'list'],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
};
const MAX_BATCH_SIZE = 8;
const MAX_YEARS = 30;

function hasIndicator(indicator) {
  return typeof indicator === 'string' && Object.prototype.hasOwnProperty.call(INDICATORS, indicator);
}

function referenceIsComparable(def) {
  return Boolean(def) && def.euAggregation === 'average';
}

function withFreshness(country, now) {
  return Object.assign({}, country, { freshness: freshness.judgeSeriesLateness(country.series, now) });
}

// The EU27 denominator stays outside the three countries. A coordinate with no
// finite observation is not a benchmark; extensive totals are not requested.
function buildReference(entry) {
  if (!entry || !Array.isArray(entry.series)) return null;
  const points = entry.series.filter(function (p) {
    return typeof p.value === 'number' && Number.isFinite(p.value);
  });
  if (points.length === 0) return null;
  return {
    code: REFERENCE_GEO,
    label: 'EU27',
    fullLabel: 'European Union — 27 countries (from 2020)',
    series: entry.series,
    latest: points[points.length - 1].value,
    latestPeriod: points[points.length - 1].period,
  };
}

/** The single route's response builder, also used by each batch item. */
async function buildResponse(indicator, years) {
  if (!hasIndicator(indicator)) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', ') }),
    };
  }
  const def = INDICATORS[indicator];
  try {
    const wantReference = referenceIsComparable(def);
    const geos = wantReference ? GEOS.concat([REFERENCE_GEO]) : GEOS.slice();
    const url = es.buildUrl(def, years, geos);
    const data = await work.run(function (deadlineMs) { return es.httpJson(url, { deadlineMs }); });
    const parsed = es.parseJsonStat(data, geos);
    const countries = {};
    GEOS.forEach(function (geo) {
      if (parsed.countries[geo]) countries[geo] = withFreshness(parsed.countries[geo]);
    });
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        indicator, title: def.title, unit: def.unit, countries,
        reference: wantReference ? buildReference(parsed.countries[REFERENCE_GEO]) : null,
        assumptions: parsed.assumptions,
        source: 'Eurostat (' + def.dataset + ')',
        dataset: def.dataset, years, fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      status: error.code === 'COMPARISON_CAPACITY' ? 503 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indicator, error: error.message, source: 'Eurostat (' + def.dataset + ')' }),
    };
  }
}

/**
 * Read precisely the cache populated by withCache on the single route, without
 * calling that public handler (which would charge a rate-limit hit per item).
 * Only successful item responses are stored. The envelope is never reused.
 */
async function readComparison(indicator, years) {
  const key = responseKey(CACHE_OPTIONS.name, { indicator, years: String(years), list: '' }, CACHE_OPTIONS.keyOn);
  let result;
  try {
    result = await cache.memo(key, CACHE_OPTIONS.ttlMs, CACHE_OPTIONS.graceMs, async function () {
      const response = await buildResponse(indicator, years);
      if (response.status !== 200) throw Object.assign(new Error('Comparison failed'), { response });
      return response;
    }, CACHE_OPTIONS);
  } catch (error) {
    // A coalesced fetch might have started in withCache, whose non-200 marker
    // carries `res`, rather than here. Both preserve the original failure.
    const response = error.response || error.res;
    if (!response) throw error;
    return { indicator, years, status: response.status, error: JSON.parse(response.body).error };
  }
  return {
    indicator, years, status: 200, data: JSON.parse(result.value.body),
    cache: {
      ageSeconds: Math.max(0, Math.floor(result.ageMs / 1000)),
      state: result.revalidating ? 'revalidating' : result.servedAfterFailure ? 'stale' : result.cached ? 'hit' : 'miss',
    },
  };
}

module.exports = {
  GEOS, REFERENCE_GEO, CACHE_OPTIONS, MAX_BATCH_SIZE, MAX_YEARS,
  hasIndicator, buildReference, referenceIsComparable, buildResponse, readComparison,
};
