const https = require('https');
const rateLimit = require('../shared/rateLimit.js');
const { withSecurity } = require('../shared/securityHeaders.js');
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
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

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

    var eleringPromise = jsonGet(
      ELERING_URL + '?start=' + dayStart.toISOString() + '&end=' + dayEnd.toISOString()
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
      var prices = (elData.data && elData.data[zone]) || [];
      if (prices.length > 0) {
        var avg = prices.reduce(function (s, p) { return s + p.price; }, 0) / prices.length;
        var minP = Math.min.apply(null, prices.map(function (p) { return p.price; }));
        var maxP = Math.max.apply(null, prices.map(function (p) { return p.price; }));
        var curHour = now.getHours();
        var curEntry = prices.find(function (p) { return new Date(p.timestamp * 1000).getHours() === curHour; });
        var current = curEntry ? curEntry.price : avg;

        if (current < 0) {
          insights.push({ headline: 'Negative electricity price: €' + current.toFixed(2) + '/MWh', description: 'Wind/solar overproduction drives prices below zero. Industrial consumers benefit from flexible scheduling. Range: €' + minP.toFixed(0) + ' to €' + maxP.toFixed(0) + '.', level: 'significant', category: 'economy', timestamp: now.toISOString() });
        } else if (maxP > 100) {
          insights.push({ headline: 'Electricity price spike: peak €' + maxP.toFixed(0) + '/MWh', description: 'Today\'s peak is significantly above normal. Average €' + avg.toFixed(0) + '/MWh. Consider shifting energy-intensive tasks to off-peak hours.', level: 'significant', category: 'economy', timestamp: now.toISOString() });
        } else {
          insights.push({ headline: 'Electricity: €' + current.toFixed(2) + '/MWh (avg €' + avg.toFixed(0) + ')', description: 'Day-ahead prices range €' + minP.toFixed(0) + '–€' + maxP.toFixed(0) + '/MWh. ' + (avg < 30 ? 'Below seasonal average — favorable for operations.' : 'Within normal Baltic market range.'), level: 'routine', category: 'economy', timestamp: now.toISOString() });
        }
      }
    } catch (e) { /* skip */ }

    // 2. ECB exchange rates
    try {
      var xml = await ecbPromise;
      var usdMatch = xml.match(/currency='USD' rate='([\d.]+)'/);
      if (usdMatch) {
        var usdRate = parseFloat(usdMatch[1]);
        insights.push({ headline: 'EUR/USD: ' + usdRate.toFixed(4), description: usdRate > 1.12 ? 'Euro strengthening against the dollar — favorable for Baltic importers.' : usdRate < 1.05 ? 'Euro weakening — Baltic exporters benefit from cheaper euro-denominated goods.' : 'Exchange rate within normal range. ECB rates updated daily at 16:00 CET.', level: usdRate > 1.15 || usdRate < 1.03 ? 'notable' : 'routine', category: 'economy', timestamp: new Date().toISOString() });
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

module.exports = withSecurity(handler);
