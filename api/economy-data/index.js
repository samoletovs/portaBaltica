const https = require('https');
const businessRegistry = require('../shared/businessRegistry.js');
const ecb = require('../shared/ecb.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const country = require('../shared/country.js');

function httpGet(url) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise(function (resolve, reject) {
    var req = lib.get(url, { timeout: 12000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { resolve(data); });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

function jsonGet(url) {
  return httpGet(url).then(function (text) {
    return JSON.parse(text);
  });
}

const ECB_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';

// The nine we publish, of the twenty-nine the ECB files. A curation, not a
// parse limit: `ecb.parseDaily` returns all of them and this picks.
const CURRENCY_NAMES = {
  USD: 'US Dollar', GBP: 'British Pound', PLN: 'Polish Zloty',
  SEK: 'Swedish Krona', NOK: 'Norwegian Krone', CHF: 'Swiss Franc',
  JPY: 'Japanese Yen', CZK: 'Czech Koruna', DKK: 'Danish Krone',
};

/**
 * The published euro reference rates, or an empty list with the reason logged.
 *
 * Two things were wrong here and neither needed the ECB to change anything.
 *
 * **It had its own parser.** `currency='X' rate='Y'` — single quotes, that
 * attribute order, exactly one space — while `shared/freshness.js` read the
 * same document with a pattern accepting either quote style and any spacing.
 * Measured on the live file reserialised with double quotes, which is valid
 * XML for the identical data: this returned **0 of 9** rates while the status
 * probe still returned a reference date and reported the ECB healthy. The
 * disagreement was ordered, so it could only ever fail toward a false green.
 * Both now call `shared/ecb.js`, so the probe cannot outlive the ticker.
 *
 * **And it caught everything into `[]`.** An unreachable ECB and a document we
 * could not parse produced the same empty array, so nobody debugging an empty
 * ticker could tell which had happened. That is the defect `optionalCount`
 * below was written to fix — *"a wrong number that looks exactly like a right
 * one"* — and it was never applied here. The two states are now distinct
 * warnings, because they call for different work: one is an outage to wait
 * out, the other is a format change to follow.
 */
async function fetchECBRates() {
  let xml;
  try {
    xml = await httpGet(ECB_RATES_URL);
  } catch (e) {
    warnUnavailable('ECB exchange rates', e);
    return [];
  }

  const parsed = ecb.parseDaily(xml);
  if (Object.keys(parsed.rates).length === 0) {
    // Reachable and unreadable is a different fact from unreachable, and it is
    // the one that means the document's shape moved under us.
    warnUnavailable('ECB exchange rates',
      'fetched ' + xml.length + ' bytes but parsed no rates; the document shape may have changed');
    return [];
  }

  return Object.keys(CURRENCY_NAMES)
    .filter(function (code) { return parsed.rates[code] !== undefined; })
    .map(function (code) {
      return { currency: code, rate: parsed.rates[code], name: CURRENCY_NAMES[code] };
    });
}

/**
 * Today's day-ahead prices for one bidding zone, and the price now.
 *
 * **`current` is `null` when we do not have one, never `0`.** It used to be
 * zero on both the missing-hour path and the whole catch, and zero is not an
 * absurd price here — Nord Pool clears at zero and goes negative when the wind
 * is up, and `EconomyTile` has a branch for exactly that. So a fabricated zero
 * was indistinguishable from a real reading, and the dashboard rendered
 * "€0.00/MWh" as a headline figure on the strength of a request that failed.
 *
 * That is worse than the `NaN%` bar widths: those at least looked broken. This
 * one is the shape of a guard whose false branch is a *claim* — the ternary
 * looks like it is handling absence and is in fact asserting a price.
 *
 * Elering demonstrably fails: measured five consecutive `HTTP 503 no available
 * server` from its Cloudflare edge in one burst, then twelve clean calls at
 * 75-217ms. So the catch is not a theoretical path.
 *
 * Every consumer already copes with `null` and always did — `EconomyTile` reads
 * it through `fixed()`, which renders an em dash, and `DataTicker` through
 * `finite()`, which drops the item. They were written defensively and this
 * function was the only thing defeating them.
 */
async function fetchElectricityPrices(zone) {
  try {
    // Already normalised by the handler, so no `|| 'lv'` here — a fallback at
    // this depth could only mask a programming error by answering with Latvia.
    var country = zone;
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const url = ELERING_URL + '?start=' + start.toISOString() + '&end=' + end.toISOString();
    const data = await jsonGet(url);
    const zonePrices = (data.data && data.data[country]) || [];
    const prices = zonePrices.map(function (p) {
      return { timestamp: new Date(p.timestamp * 1000).toISOString(), price: p.price };
    });
    const currentHour = now.getHours();
    const currentEntry = zonePrices.find(function (p) {
      return new Date(p.timestamp * 1000).getHours() === currentHour;
    });
    // The entry existing does not mean it carries a price: a published interval
    // with a null price is a normal thing for a day-ahead feed to contain.
    //
    // `Number.isFinite` alone is the whole guard — unlike the global `isFinite`
    // it does not coerce, so it rejects `null`, `undefined`, `NaN`, `Infinity`
    // and the string `'50'` on its own. A `typeof === 'number'` beside it was
    // redundant, which mutation testing showed by removing it and watching
    // nothing fail.
    const price = currentEntry && Number.isFinite(currentEntry.price)
      ? currentEntry.price
      : null;
    return { prices: prices, current: price };
  } catch (e) {
    warnUnavailable('electricity prices', e);
    return { prices: [], current: null };
  }
}

function warnUnavailable(label, err) {
  console.warn('[economy-data] ' + label + ' unavailable: ' + ((err && err.message) || err));
}

/**
 * Resolve a business-registry count, or `null` if the portal could not answer.
 *
 * `null` rather than `0` is the whole point. The previous helper caught every
 * error and returned `0`, so a dataset that had been 404ing for months
 * rendered as a confident "0 Suspended Activities" — a wrong number that looks
 * exactly like a right one. A null reaches the UI as an explicit dash.
 */
function optionalCount(label, load) {
  return load().catch(function (err) {
    warnUnavailable(label, err);
    return null;
  });
}

// CSP PxWeb API queries for live economic indicators
const PXWEB = 'https://data.stat.gov.lv/api/v1/en/OSP_PUB';

function httpsPost(url, body) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var postData = JSON.stringify(body);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      timeout: 12000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    var req = https.request(opts, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('PxWeb parse failed')); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function fetchPxWebIndicators() {
  var indicators = [];
  try {
    // GDP quarterly growth (seasonally adjusted, % of corresponding period prev year)
    var gdpData = await httpsPost(PXWEB + '/VEK/IS/ISI/ISI010c', {
      query: [
        { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
        { code: 'INDICATOR', selection: { filter: 'item', values: ['B1GQ'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['ISI010c1'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (gdpData && gdpData.value) {
      var vals = gdpData.value.filter(function (v) { return v !== null; });
      var latest = vals[vals.length - 1];
      var prev = vals.length > 4 ? vals[vals.length - 5] : null;
      var growthPct = latest ? (latest - 100).toFixed(1) : null;
      indicators.push({
        label: 'GDP Growth',
        value: growthPct != null ? growthPct + '%' : 'N/A',
        unit: 'YoY',
        change: prev != null ? ((latest - prev) >= 0 ? '+' : '') + (latest - prev).toFixed(1) + 'pp' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'GDP Growth', value: 'N/A', unit: '', change: '' }); }

  try {
    // Average gross salary (quarterly, TOTAL sector)
    var salData = await httpsPost(PXWEB + '/EMP/DS/DSV/DSV010c', {
      query: [
        { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
        { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
        { code: 'INDICATOR', selection: { filter: 'item', values: ['AVWAG_M'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV010c'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (salData && salData.value) {
      var salVals = salData.value.filter(function (v) { return v !== null; });
      var latestSal = salVals[salVals.length - 1];
      var prevSal = salVals.length > 4 ? salVals[salVals.length - 5] : null;
      var change = prevSal ? (((latestSal - prevSal) / prevSal) * 100) : 0;
      indicators.push({
        label: 'Avg Salary',
        value: '€' + Math.round(latestSal).toLocaleString(),
        unit: '/month',
        change: prevSal ? (change >= 0 ? '+' : '') + change.toFixed(1) + '%' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'Avg Salary', value: 'N/A', unit: '', change: '' }); }

  try {
    // CPI inflation (monthly, 12-month average over prev 12-month average)
    var cpiData = await httpsPost(PXWEB + '/VEK/PC/PCI/PCI021m', {
      query: [
        { code: 'ECOICOP_V2', selection: { filter: 'item', values: ['0'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI021m4'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (cpiData && cpiData.value) {
      var cpiVals = cpiData.value.filter(function (v) { return v !== null; });
      var latestCpi = cpiVals[cpiVals.length - 1];
      var prevCpi = cpiVals.length > 12 ? cpiVals[cpiVals.length - 13] : null;
      indicators.push({
        label: 'CPI Inflation',
        value: latestCpi != null ? latestCpi.toFixed(1) + '%' : 'N/A',
        unit: 'YoY',
        change: prevCpi != null ? ((latestCpi - prevCpi) >= 0 ? '+' : '') + (latestCpi - prevCpi).toFixed(1) + 'pp' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'CPI Inflation', value: 'N/A', unit: '', change: '' }); }

  // Unemployment rate (monthly, seasonally adjusted)
  try {
    var unemData = await httpsPost(PXWEB + '/EMP/NBBA/NBBB/NBB150m', {
      query: [
        { code: 'SEX', selection: { filter: 'item', values: ['T'] } },
        { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['NBB1501m'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (unemData && unemData.value) {
      var uVals = unemData.value.filter(function (v) { return v !== null; });
      var latestU = uVals[uVals.length - 1];
      indicators.push({
        label: 'Unemployment',
        value: latestU != null ? latestU.toFixed(1) + '%' : 'N/A',
        unit: '',
        change: '',
      });
    }
  } catch (e) { indicators.push({ label: 'Unemployment', value: 'N/A', unit: '', change: '' }); }

  return indicators;
}

const handler = async function (context, req) {
  // Normalised once, at the boundary. `data.data[zone]` below keys Elering's
  // payload, whose zone keys are lower case — so an upper-case `LV` found
  // nothing, the `|| []` swallowed it, and the endpoint returned an empty price
  // series. `isLatvia` was measured against the same unnormalised value, so
  // `?country=LV` also skipped every Latvia-only block on a request *for*
  // Latvia.
  const zone = country.normaliseCountry(req.query && req.query.country);
  if (zone === null) {
    context.res = country.badCountry(req.query && req.query.country);
    return;
  }
  const isLatvia = zone === country.DEFAULT_COUNTRY;

  try {
    // ECB rates and electricity are country-aware; PxWeb/CKAN are Latvia-only
    const [exchangeRates, electricity, vatCount, suspendedCount, indicators] = await Promise.all([
      fetchECBRates(),
      fetchElectricityPrices(zone),
      isLatvia ? optionalCount('VAT payers', businessRegistry.fetchActiveVatPayers) : Promise.resolve(null),
      isLatvia ? optionalCount('Suspended activities', businessRegistry.fetchSuspendedBusinesses) : Promise.resolve(null),
      isLatvia ? fetchPxWebIndicators() : Promise.resolve([]),
    ]);

    const result = {
      exchangeRates: exchangeRates,
      electricityPrices: electricity.prices,
      electricityCurrent: electricity.current,
      indicators: indicators.length > 0 ? indicators : [
        { label: 'GDP Growth', value: 'N/A', unit: '', change: '' },
        { label: 'Avg Salary', value: 'N/A', unit: '', change: '' },
        { label: 'CPI Inflation', value: 'N/A', unit: '', change: '' },
        { label: 'Unemployment', value: 'N/A', unit: '', change: '' },
      ],
      businessPulse: {
        activeVatPayers: vatCount,
        suspendedBusinesses: suspendedCount,
      },
      fetchedAt: new Date().toISOString(),
    };

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'economy-data',
  keyOn: ['country'],
  ttlMs: 1800000,
  graceMs: 7200000,
  staleWhileRevalidate: true,
}));

// Exported for the tests, as `system-status` exports `visitStats`. The two
// empty-list paths differ in what they mean and a test is the only consumer
// that can tell them apart, since both render as an absent ticker.
module.exports.fetchECBRates = fetchECBRates;
