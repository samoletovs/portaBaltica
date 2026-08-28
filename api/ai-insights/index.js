const https = require('https');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const airQuality = require('../shared/airQuality.js');
const countries = require('../shared/country.js');

/**
 * WHO 2021 global air quality guideline for PM2.5, 24-hour mean, in µg/m³.
 *
 * Named rather than inlined because it is a published figure with a date, and
 * because the claim this file makes about it must be checked against the value
 * it prints rather than inferred from an index band.
 * @see https://www.who.int/publications/i/item/9789240034228
 */
const WHO_PM25_24H = 15;

/**
 * How much recent market history to fetch, so today can be described against
 * the distribution it belongs to rather than against a constant.
 *
 * Thirty days is long enough for a percentile to mean something and short
 * enough to still be "recent" for a market that moves seasonally. It is the
 * same Elering call with a wider `start`, so no new upstream is involved.
 */
const PRICE_WINDOW_DAYS = 30;

/**
 * How exceptional today has to be before we say so.
 *
 * A named percentile of the trailing window, not a price. The threshold this
 * replaces was the literal `100`, and measured against 62 days of Latvian
 * day-ahead prices it fired on **58 of them — 93.5%** — while describing them
 * as "significantly above normal". The median daily peak over that window was
 * **168**, so the constant sat *below* the typical day and labelled the
 * ordinary as exceptional. A severity that almost always fires carries no
 * information, and this one carried instructions with it.
 *
 * At p90 the same 62 days produce 6 alerts rather than 58.
 */
const PRICE_ALERT_PERCENTILE = 0.90;

/**
 * How many prior days a percentile needs before it is worth quoting.
 *
 * Below this the "highest tenth" of the window is one or two observations, and
 * a threshold drawn from that describes the sample rather than the market. The
 * card then states the figures and makes no comparison, which is what they are
 * entitled to say on their own.
 */
const MIN_BASELINE_DAYS = 14;

/** The value at a percentile of a sorted-ascending array. */
function percentile(sortedAscending, fraction) {
  if (sortedAscending.length === 0) return null;
  const idx = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.floor(sortedAscending.length * fraction)),
  );
  return sortedAscending[idx];
}

/**
 * Split priced intervals into today and the trailing window that precedes it.
 *
 * Days are keyed on the UTC date, matching the window the request asks for.
 * Today is excluded from its own baseline: comparing a day against a
 * distribution it is part of drags the threshold toward itself, and on a short
 * window that is not a small effect.
 */
function splitByDay(rows, todayKey) {
  const today = [];
  const priorPeaks = [];
  const byDay = new Map();
  for (var i = 0; i < rows.length; i++) {
    const p = rows[i];
    if (typeof p.price !== 'number' || !Number.isFinite(p.price)) continue;
    const key = new Date(p.timestamp * 1000).toISOString().slice(0, 10);
    if (key === todayKey) { today.push(p); continue; }
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p.price);
  }
  byDay.forEach(function (prices) { priorPeaks.push(Math.max.apply(null, prices)); });
  priorPeaks.sort(function (a, b) { return a - b; });
  return { today: today, priorPeaks: priorPeaks };
}

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 15000 }, function (res) {
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
  });
}

/**
 * GET /api/ai-insights
 *
 * Generates real-time AI insights by fetching data directly from external sources.
 */

var ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';
var OPEN_METEO_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
var OPEN_METEO_WX = 'https://api.open-meteo.com/v1/forecast';
var ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function httpGetText(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 10000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve(data); });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

const handler = async function (context, req) {
  // Normalised once, at the boundary, and a miss is a bad request rather than
  // a request for Latvia. `zoneMap[country] || 'lv'` and
  // `capitalCoords[country] || capitalCoords.lv` both key lower-case maps, so
  // an upper-case `EE` matched neither and fell through to Latvia — serving
  // Latvia's electricity market under an Estonian heading, and Riga's weather
  // and air quality with it. Every figure real, every figure the wrong
  // country's, and invisible to precisely the readers who would notice,
  // because Latvia is what the default returns.
  const requested = countries.normaliseCountry(req.query && req.query.country);
  if (requested === null) {
    context.res = countries.badCountry(req.query && req.query.country);
    return;
  }

  try {
    var insights = [];
    var country = requested;
    var zone = country;
    var capitalCoords = {
      lv: { lat: 56.95, lon: 24.11, name: 'Riga', tz: 'Europe/Riga' },
      ee: { lat: 59.44, lon: 24.75, name: 'Tallinn', tz: 'Europe/Tallinn' },
      lt: { lat: 54.69, lon: 25.28, name: 'Vilnius', tz: 'Europe/Vilnius' },
    };
    var capital = capitalCoords[country];

    // Start every upstream fetch before awaiting any of them.
    //
    // These four calls were previously awaited one after another, each with
    // its own 10-15s timeout, so a single slow upstream delayed all the
    // others and the worst case was the SUM of the timeouts (~55s) rather
    // than the longest one. That is what made /api/ai-insights intermittently
    // time out on a cold cache, and why tests/api-contracts.test.ts fails
    // against production when the 15s client budget expires first.
    //
    // The calls are independent, so kicking them all off here makes the worst
    // case the slowest single upstream (~15s). Each result is still consumed
    // inside its own try/catch below, so one failing source degrades that one
    // insight instead of the whole response.
    var now = new Date();
    var dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    var dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    // A trailing window, so today can be characterised against the market's own
    // recent distribution rather than against a constant somebody chose. Same
    // endpoint and one call: the window widens, nothing new is fetched.
    var windowStart = new Date(dayStart.getTime() - PRICE_WINDOW_DAYS * 86400e3);

    var eleringPromise = jsonGet(
      ELERING_URL + '?start=' + windowStart.toISOString() + '&end=' + dayEnd.toISOString()
    );
    var ecbPromise = httpGetText(ECB_URL);
    var airPromise = jsonGet(
      OPEN_METEO_AQ + '?latitude=' + capital.lat + '&longitude=' + capital.lon +
      '&current=pm2_5,nitrogen_dioxide,european_aqi&timezone=' + capital.tz
    );
    var weatherPromise = jsonGet(
      OPEN_METEO_WX + '?latitude=' + capital.lat + '&longitude=' + capital.lon +
      '&current=temperature_2m,wind_speed_10m,weather_code&timezone=' + capital.tz
    );

    // Attach a no-op catch to each so a rejection that is not awaited until
    // later cannot surface as an unhandled rejection and take down the worker.
    [eleringPromise, ecbPromise, airPromise, weatherPromise].forEach(function (p) {
      p.catch(function () { /* handled at the await site below */ });
    });

    // 1. Electricity prices from Elering
    try {
      var elData = await eleringPromise;
      var allRows = (elData.data && elData.data[zone]) || [];
      var split = splitByDay(allRows, dayStart.toISOString().slice(0, 10));
      var prices = split.today;

      if (prices.length > 0) {
        var avg = prices.reduce(function (s, p) { return s + p.price; }, 0) / prices.length;
        var minP = Math.min.apply(null, prices.map(function (p) { return p.price; }));
        var maxP = Math.max.apply(null, prices.map(function (p) { return p.price; }));
        var curHour = now.getHours();
        var curEntry = prices.find(function (p) { return new Date(p.timestamp * 1000).getHours() === curHour; });
        // Not `: avg`. Reporting the day's average *as* the current price is a
        // guard whose false branch is a claim, and a plausible one — an average
        // price looks exactly like a price. #131 removed the same line from
        // `economy-data`; this copy was untouched.
        var current = curEntry && Number.isFinite(curEntry.price) ? curEntry.price : null;

        // The comparison is drawn from the market's own trailing distribution,
        // and the sentence names its basis. Below `MIN_BASELINE_DAYS` we do not
        // have a distribution worth quoting, so we state the numbers and stop —
        // which is what the figures are entitled to say on their own.
        var threshold = split.priorPeaks.length >= MIN_BASELINE_DAYS
          ? percentile(split.priorPeaks, PRICE_ALERT_PERCENTILE)
          : null;
        var basis = split.priorPeaks.length + ' preceding days';
        var range = 'Range €' + minP.toFixed(0) + '–€' + maxP.toFixed(0) + '/MWh, day average €' + avg.toFixed(0) + '.';

        if (minP < 0) {
          insights.push({
            headline: 'Negative electricity price: €' + minP.toFixed(2) + '/MWh',
            description: 'Prices below zero indicate more generation than the grid can absorb. ' + range,
            level: 'significant', category: 'economy', timestamp: now.toISOString(),
          });
        } else if (threshold !== null && maxP > threshold) {
          insights.push({
            headline: 'Electricity peak €' + maxP.toFixed(0) + '/MWh',
            // The claim names the comparison it rests on, so a reader can judge
            // it. "Significantly above normal" named nothing and was true of
            // 93.5% of days.
            description: "Today's peak is in the highest tenth of daily peaks over the last "
              + basis + ' (above €' + threshold.toFixed(0) + '). ' + range,
            level: 'significant', category: 'economy', timestamp: now.toISOString(),
          });
        } else {
          insights.push({
            headline: current !== null
              ? 'Electricity €' + current.toFixed(2) + '/MWh'
              : 'Electricity: day average €' + avg.toFixed(0) + '/MWh',
            // No characterisation. "Below seasonal average" named a statistic
            // this endpoint never computed, and "within normal Baltic market
            // range" was asserted against nothing at all — it was the `else`.
            //
            // "of daily peaks" is load-bearing and was missing. The other
            // branch quotes the same threshold as "the highest tenth of daily
            // peaks"; this one said "the highest tenth of the last 31
            // preceding days", which names no quantity. A reader then has
            // three prices in one sentence — a current €26, a day average €57
            // and a threshold €259 — and no way to know the third is a
            // percentile of *peaks* rather than something comparable to the
            // first two. Two branches quoting one number must describe it
            // identically, or the number means different things depending on
            // which day you read it.
            description: range + (threshold !== null
              ? ' Highest tenth of daily peaks over the last ' + basis
                + ' begins at €' + threshold.toFixed(0) + '.'
              : ''),
            level: 'routine', category: 'economy', timestamp: now.toISOString(),
          });
        }
      }
    } catch (e) { /* skip */ }

    // 2. ECB exchange rates
    try {
      var xml = await ecbPromise;
      var usdMatch = xml.match(/currency='USD' rate='([\d.]+)'/);
      if (usdMatch) {
        var usdRate = parseFloat(usdMatch[1]);
        insights.push({
          headline: 'EUR/USD: ' + usdRate.toFixed(4),
          // No direction. "Euro strengthening against the dollar" describes a
          // *change*, and this endpoint fetches a single day's reference rate —
          // there is no previous value anywhere in it, so the claim could not
          // be derived from what we hold no matter where the threshold sat.
          //
          // Nor was the threshold sound: measured over the ECB's own 90-day
          // file, all 64 observations sat between 1.134 and 1.1699, so the
          // `> 1.12` branch fired on **100% of trading days** and the other two
          // were unreachable. A branch that always wins is a constant.
          //
          // Saying the rate and when it was set is what the figure supports.
          // A real direction needs the 90-day series, which is a separate
          // change and a separate call.
          description: 'ECB euro foreign exchange reference rate, published each working day at 16:00 CET.',
          level: 'routine',
          category: 'economy',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) { /* skip */ }

    // 3. Air quality
    try {
      var aqData = await airPromise;
      var aqCurrent = aqData.current || {};
      // No `|| 0`. A missing index is not a reading of zero, and zero is the
      // best band there is — that is how this file would have announced perfect
      // air on the strength of a field that never arrived.
      var aqi = typeof aqCurrent.european_aqi === 'number' && Number.isFinite(aqCurrent.european_aqi)
        ? aqCurrent.european_aqi : null;
      var pm25 = typeof aqCurrent.pm2_5 === 'number' && Number.isFinite(aqCurrent.pm2_5)
        ? aqCurrent.pm2_5 : null;
      var band = airQuality.classifyEuropeanAqi(aqi);

      if (band) {
        // The advice follows the EEA's own bands, because the index is the
        // EEA's. This used to split at the US EPA's 50 and 100 and call the
        // worst band "Unhealthy", an EPA word the European scale does not use.
        var advice = band.rank <= 2
          ? 'Within the European index\u2019s two cleanest bands.'
          : band.rank === 3
            ? 'Sensitive groups may wish to limit prolonged outdoor exertion.'
            : 'Consider limiting outdoor activity, particularly for sensitive groups.';

        // The WHO comparison is made against the number we are about to print,
        // rather than inferred from the index band. Those two disagree: sampled
        // over 6696 hourly readings, every single occasion PM2.5 exceeded the
        // WHO 24-hour guideline the old line still read "Well below WHO
        // guidelines" — printing 16.9 µg/m³ and calling it well below 15.
        var whoNote = pm25 === null
          ? ''
          : pm25 > WHO_PM25_24H
            ? ' PM2.5 is above the WHO 24-hour guideline of ' + WHO_PM25_24H + ' \u00b5g/m\u00b3.'
            : ' PM2.5 is within the WHO 24-hour guideline of ' + WHO_PM25_24H + ' \u00b5g/m\u00b3.';

        insights.push({
          headline: capital.name + ' air quality: ' + band.label,
          description: 'European AQI ' + aqi
            + (pm25 === null ? '. PM2.5 unavailable.' : '. PM2.5: ' + pm25.toFixed(1) + ' \u00b5g/m\u00b3.')
            + whoNote + ' ' + advice,
          level: band.rank <= 2 ? 'routine' : band.rank === 3 ? 'notable' : 'significant',
          category: 'environment',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) { /* skip */ }

    // 4. Weather
    try {
      var wxData = await weatherPromise;
      var wxCurrent = wxData.current || {};
      var temp = wxCurrent.temperature_2m || 0;
      var wind = wxCurrent.wind_speed_10m || 0;
      var codes = { 0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 51: 'drizzle', 61: 'rain', 71: 'snow', 80: 'rain showers', 95: 'thunderstorm' };
      var desc = codes[wxCurrent.weather_code] || 'variable';
      insights.push({ headline: capital.name + ': ' + temp.toFixed(0) + '°C, ' + desc, description: 'Wind ' + wind.toFixed(0) + ' km/h. ' + (temp < -10 ? 'Severe cold — expect elevated heating demand.' : temp < 0 ? 'Below freezing — monitor transport and energy costs.' : temp > 30 ? 'Heat wave — increased cooling demand.' : 'Conditions within seasonal range.'), level: temp < -10 || temp > 35 || wind > 80 ? 'significant' : 'routine', category: 'environment', timestamp: new Date().toISOString() });
    } catch (e) { /* skip */ }

    // Limit to 5
    insights = insights.slice(0, 5);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        insights: insights,
        generatedAt: new Date().toISOString(),
        source: 'portaBaltica AI (data-driven)',
      }),
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
  name: 'ai-insights',
  keyOn: ['country'],
  ttlMs: 900000,
  graceMs: 3600000,
  staleWhileRevalidate: true,
}));
// Exported so the derivation is assertable on its own, rather than only
// through a live handler that depends on what the market did today.
module.exports.percentile = percentile;
module.exports.splitByDay = splitByDay;
module.exports.PRICE_ALERT_PERCENTILE = PRICE_ALERT_PERCENTILE;
module.exports.PRICE_WINDOW_DAYS = PRICE_WINDOW_DAYS;
module.exports.MIN_BASELINE_DAYS = MIN_BASELINE_DAYS;
