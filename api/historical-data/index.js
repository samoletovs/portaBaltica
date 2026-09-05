const https = require('https');
const latvianSeries = require('../shared/latvianSeries.js');
const es = require('../shared/eurostat.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

function httpsPost(url, body) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var postData = JSON.stringify(body);
    var opts = {
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    var req = https.request(opts, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse failed')); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

var PXWEB = 'https://data.stat.gov.lv/api/v1/en/OSP_PUB';

// Indicator definitions: PxWeb path, query params, label extraction
var INDICATORS = {
  gdp: {
    path: '/VEK/IS/ISI/ISI010c',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['B1GQ'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ISI010c1'] } },
    ],
    transform: function (v) { return v !== null ? +(v - 100).toFixed(1) : null; },
    unit: '% YoY',
    title: 'GDP Growth Rate',
    source: 'CSP Latvia (PxWeb)',
  },
  salary: {
    path: '/EMP/DS/DSV/DSV010c',
    query: [
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['AVWAG_M'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV010c'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Average Gross Salary',
    source: 'CSP Latvia (PxWeb)',
  },
  cpi: {
    path: '/VEK/PC/PCI/PCI021m',
    query: [
      { code: 'ECOICOP_V2', selection: { filter: 'item', values: ['0'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI021m4'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'CPI Inflation',
    source: 'CSP Latvia (PxWeb)',
  },
  unemployment: {
    // CSP's NBB150m stopped at 2025M12 while Eurostat's une_rt_m kept
    // publishing monthly. The two track within ~0.2pp on overlapping months —
    // both are the seasonally adjusted LFS rate — so Eurostat is a legitimate
    // stand-in, and `source` names whichever one actually answered.
    path: '/EMP/NBBA/NBBB/NBB150m',
    query: [
      { code: 'SEX', selection: { filter: 'item', values: ['T'] } },
      { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['NBB1501m'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Unemployment Rate',
    source: 'CSP Latvia (PxWeb)',
    eurostatFallback: 'unemployment',
    preferEurostat: true,
  },
  house_prices: {
    path: '/VEK/PC/PCI/PCI050c',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI050c1'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'House Price Change',
    source: 'CSP Latvia (PxWeb)',
  },
  retail_sales: {
    path: '/TIR/TI/TIT/TIT010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TIT010m'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'Retail Sales Growth',
    source: 'CSP Latvia (PxWeb)',
  },
  industrial: {
    // CSP's RUI020m is not queryable: the MIG_* codes return an all-null
    // series and every aggregate code (B_C_D_X_D353, C, C10) is rejected with
    // HTTP 400. Served from Eurostat until the national table works again.
    path: '/NOZ/RU/RUI/RUI020m',
    query: [
      { code: 'NACE_MIG', selection: { filter: 'item', values: ['MIG_ING'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['RUI020m4'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'Industrial Production Growth',
    source: 'CSP Latvia (PxWeb)',
    eurostatFallback: 'industrial',
    preferEurostat: true,
  },
  population: {
    path: '/POP/IR/IRS/IRS010',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['POP_SY'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['IRS010'] } },
    ],
    transform: null,
    unit: 'persons',
    title: 'Population',
    source: 'CSP Latvia (PxWeb)',
  },
  hotel_occupancy: {
    path: '/NOZ/TU/TUV/TUV010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TUV010m'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Hotel occupancy rate',
    source: 'CSP Latvia (PxWeb)',
  },
  tourist_arrivals: {
    path: '/NOZ/TU/TUV/TUV020c',
    query: [
      { code: 'ACCOMMODATION', selection: { filter: 'item', values: ['I551-I553'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TUV020c'] } },
    ],
    transform: null,
    unit: 'thousands',
    title: 'Tourist arrivals',
    source: 'CSP Latvia (PxWeb)',
  },
  gov_revenue: {
    path: '/VEK/VF/VFV/VFV010c',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['P11_P12_P131'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['VFV010c1'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Government revenue',
    source: 'CSP Latvia (PxWeb)',
  },
  gov_debt: {
    path: '/VEK/VF/VFV/VFV020c',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['S13'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['VFV020c1'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Government debt',
    source: 'CSP Latvia (PxWeb)',
  },
  exports: {
    path: '/TIR/AT/ATD/ATD110m',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SCA'] } },
      { code: 'FLOW', selection: { filter: 'item', values: ['EXP'] } },
      { code: 'COUNTRY_GROUP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ATD110m'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Exports (seasonally adjusted)',
    source: 'CSP Latvia (PxWeb)',
  },
  imports: {
    path: '/TIR/AT/ATD/ATD110m',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SCA'] } },
      { code: 'FLOW', selection: { filter: 'item', values: ['IMP'] } },
      { code: 'COUNTRY_GROUP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ATD110m'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Imports (seasonally adjusted)',
    source: 'CSP Latvia (PxWeb)',
  },
  biz_confidence: {
    path: '/VEK/KR/KRE/KRE010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['KRE010m'] } },
    ],
    transform: null,
    unit: 'index',
    title: 'Economic sentiment',
    source: 'CSP Latvia (PxWeb)',
  },
  construction_output: {
    path: '/NOZ/BU/BUP/BUP010c',
    query: [
      { code: 'NACE', selection: { filter: 'item', values: ['F'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['BUP010c'] } },
    ],
    transform: null,
    unit: 'index',
    title: 'Construction output',
    source: 'CSP Latvia (PxWeb)',
  },
  new_vehicles: {
    path: '/NOZ/TR/TRC/TRC010c',
    query: [
      { code: 'VEHICLE', selection: { filter: 'item', values: ['CAR'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['VEH_REG_1ST_NEW'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TRC010c'] } },
    ],
    transform: null,
    unit: 'vehicles',
    title: 'New car registrations',
    source: 'CSP Latvia (PxWeb)',
  },
  wages_industry: {
    path: '/EMP/DS/DSV/DSV030',
    query: [
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'NACE', selection: { filter: 'item', values: ['C'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV030'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Wages: manufacturing',
    source: 'CSP Latvia (PxWeb)',
  },
  wages_it: {
    path: '/EMP/DS/DSV/DSV030',
    query: [
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'NACE', selection: { filter: 'item', values: ['J'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV030'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Wages: IT sector',
    source: 'CSP Latvia (PxWeb)',
  },
  energy_price_gas: {
    path: '/NOZ/EN/ENC/ENC020',
    query: [
      { code: 'NG_CONS', selection: { filter: 'item', values: ['4141902'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['I_TAX'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ENC020'] } },
    ],
    transform: null,
    unit: 'EUR/GJ',
    title: 'Gas price (households)',
    source: 'CSP Latvia (PxWeb)',
  },
  building_permits: {
    path: '/NOZ/BU/BUE/BUP040c',
    query: [
      { code: 'BUILDING', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['BUP040c'] } },
    ],
    transform: null,
    unit: 'index',
    title: 'New buildings started',
    source: 'CSP Latvia (PxWeb)',
  },
  renewable_share: {
    // ENA010 is renewable resources in natural units: 50 indicators x 15
    // resource types, 12,750 cells. The flat read below picked an arbitrary
    // slice of it and published the result as a percentage share.
    path: '/NOZ/EN/ENA/ENA010',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ENA010'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Renewable energy share',
    source: 'CSP Latvia (PxWeb)',
    eurostatFallback: 'renewables',
    preferEurostat: true,
  },
  ppi: {
    // RCI020m fails the same way as RUI020m — see `industrial`.
    path: '/VEK/RC/RCI/RCI020m',
    query: [
      { code: 'SALES', selection: { filter: 'item', values: ['TOVT'] } },
      { code: 'NACE_MIG', selection: { filter: 'item', values: ['MIG_ING'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['RCI020m2'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'Producer prices (PPI)',
    source: 'CSP Latvia (PxWeb)',
    eurostatFallback: 'ppi',
    preferEurostat: true,
  },
  trade_balance: {
    path: '/TIR/AT/ATD/ATD110m',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SCA'] } },
      { code: 'FLOW', selection: { filter: 'item', values: ['BAL'] } },
      { code: 'COUNTRY_GROUP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ATD110m'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Trade balance',
    source: 'CSP Latvia (PxWeb)',
  },
};

/**
 * Fetch a Latvian series from Eurostat, used when the CSP table behind an
 * indicator is unavailable or returns a cube this endpoint cannot read flatly.
 */
async function fetchEurostatSeries(eurostatKey, years) {
  return latvianSeries.fetchEurostatSeries(eurostatKey, years);
}

function summarise(series) {
  const valid = series.filter(function (s) { return s.value !== null; }).map(function (s) { return s.value; });
  const latest = valid.length > 0 ? valid[valid.length - 1] : null;
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;
  const min = valid.length > 0 ? Math.min.apply(null, valid) : null;
  const max = valid.length > 0 ? Math.max.apply(null, valid) : null;
  const avg = valid.length > 0 ? valid.reduce(function (a, b) { return a + b; }, 0) / valid.length : null;
  return {
    latest: latest,
    previous: previous,
    change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null,
    min: min !== null ? +min.toFixed(2) : null,
    max: max !== null ? +max.toFixed(2) : null,
    avg: avg !== null ? +avg.toFixed(2) : null,
    count: valid.length,
  };
}

/**
 * Read a PxWeb json-stat2 response as a single time series.
 *
 * Returns null when the cube has more cells than time periods. That means the
 * query left a dimension open, and the flat read below would publish an
 * arbitrary slice of the cube under the indicator's label — which is exactly
 * what "Renewable energy share" was doing with a 12,750-cell table.
 */
function readPxWebSeries(data, transform) {
  return latvianSeries.readPxWebSeries(data, transform);
}

/**
 * GET /api/historical-data?indicator=gdp
 * GET /api/historical-data?indicator=gdp&years=5
 *
 * Latvian time series, from CSP PxWeb where it works and Eurostat where it
 * does not. `source` always names the provider that actually answered, so a
 * fallback is visible rather than silent.
 */
const handler = async function (context, req) {
  var indicator = (req.query && req.query.indicator) || '';
  var def = Object.prototype.hasOwnProperty.call(INDICATORS, indicator) ? INDICATORS[indicator] : null;
  if (!def) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', '),
      }),
    };
    return;
  }

  var years = parseInt(req.query && req.query.years, 10) || 0;
  var title = def.title;
  var unit = def.unit;
  var source = def.source;
  var series = null;

  if (!def.preferEurostat) {
    try {
      var data = await httpsPost(PXWEB + def.path, {
        query: def.query,
        response: { format: 'json-stat2' },
      });
      series = readPxWebSeries(data, def.transform);
    } catch (e) {
      series = null;
    }

  }

  // A national table that has stopped updating was the failure this endpoint
  // could not see. `series` comes back non-null, so the fallback below never
  // fired, and the card rendered eight-month-old unemployment with nothing to
  // say so — CSP's NBB150m stopped at 2025M12 while Eurostat kept publishing.
  // Emptiness and staleness are the same failure at different speeds, so they
  // now take the same escape route.
  var freshness = es.isSeriesStale(series);

  if ((!series || (freshness && freshness.stale)) && def.eurostatFallback) {
    try {
      var fallback = await fetchEurostatSeries(def.eurostatFallback, years || 10);
      var fallbackFreshness = es.isSeriesStale(fallback.series);
      // Only switch if Eurostat is genuinely further ahead. Trading a stale
      // national series for an equally stale European one buys nothing and
      // costs the longer national history.
      var better = !series || !freshness ||
        (fallbackFreshness && fallbackFreshness.age < freshness.age);
      if (better) {
        series = fallback.series;
        unit = fallback.unit;
        source = fallback.source;
        freshness = fallbackFreshness;
      }
    } catch (e) {
      // Keep the stale national series if there is one: old data under an
      // honest `source` beats an empty card.
      if (!series) series = null;
    }
  }

  if (!series) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        indicator: indicator,
        title: title,
        unit: unit,
        source: source,
        series: [],
        summary: summarise([]),
        error: 'No data available from ' + source,
        fetchedAt: new Date().toISOString(),
      }),
    };
    return;
  }

  series = latvianSeries.limitYears(series, years);
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify({
      indicator: indicator,
      title: title,
      unit: unit,
      source: source,
      series: series,
      summary: summarise(series),
      // How current the served series actually is, so a consumer never has to
      // parse period labels to find out.
      //
      // src/dataFreshness.ts deliberately computes port-data staleness at
      // render time instead, because that response is cached for hours in
      // localStorage and a baked-in flag would under-report the age. The
      // reasoning does not carry here: this is measured in whole months
      // against a one-hour edge cache, so the number cannot drift before it
      // expires. The period label is a fact about the data and never drifts.
      freshness: freshness,
      fetchedAt: new Date().toISOString(),
    }),
  };
};

module.exports = withSecurity(withCache(handler, {
  name: 'historical-data',
  keyOn: ['indicator', 'years'],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
