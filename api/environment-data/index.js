const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');
const cache = require('../shared/cache.js');
const { withSecurity } = require('../shared/securityHeaders.js');

/**
 * GET /api/environment-data
 *
 * Weather for several cities, air quality for the capital, and capital-region
 * population.
 *
 * Two things were wrong here, and both are the failures this codebase has
 * already fixed elsewhere and not carried across.
 *
 * **It used a socket idle timer, not a deadline.** The local `httpGet` passed
 * `{ timeout: 10000 }`, which only fires when a connection goes quiet — a
 * source that accepts the connection and then stalls holds the request open far
 * longer. That is the exact flaw `shared/eurostat.js` documents fixing, and it
 * is why this endpoint was measured at 22,031ms and 20,326ms cold against
 * 1,105ms warm while its fan-out was already fully parallel. It now uses the
 * shared client, with a hard deadline and one retry — the Open-Meteo probe was
 * separately measured hanging at exactly its deadline about one call in three
 * from Azure, which a fresh connection almost always fixes.
 *
 * **It fabricated readings.** When the air-quality fetch failed the catch
 * returned `{ pm25: 0, no2: 0, status: 'good', label: 'Good' }` — an invented
 * clean-air reading, presented in the same shape and styling as a real one, on
 * a page whose entire premise is that the numbers are real. `current.pm2_5 || 0`
 * did the same thing more quietly for a missing field. Nothing is invented now:
 * a measurement that could not be taken comes back null with a reason, and the
 * response says which parts are missing rather than dropping them and letting
 * the client guess. That is the rule the repo already applies to registry
 * counts, which are omitted rather than shown as a fabricated zero.
 */

/**
 * One shared budget for every upstream this endpoint touches.
 *
 * Four seconds is generous against measured healthy latencies — Open-Meteo
 * answers in 100–300ms and the Eurostat population cube in about 800ms — so the
 * worst case is bounded at roughly eight seconds with the retry, against a
 * previously unbounded wait. A hard deadline is the part that matters: the old
 * socket idle timer could not end a connection that was accepted and then went
 * silent, which is what a shared Azure egress address meets when it is rate
 * limited.
 */
const HTTP = { deadlineMs: 4000, retries: 1 };

/**
 * Weather and air quality are cached, because Open-Meteo publishes hourly and
 * this endpoint asks it five questions per cold request — four cities plus air
 * quality. That is the single largest share of our traffic to a source that is
 * throttling the Static Web App's shared egress address, and re-asking an
 * hourly source every fifteen minutes was never buying anything.
 *
 * Ten minutes matches the fifteen-minute `Cache-Control` this endpoint already
 * sets downstream, so no reader sees anything staler than they did before. The
 * hour of grace is generous on purpose: an hour-old temperature is still a
 * useful and honest number, and it is a far better answer than the dash a
 * dropped socket would otherwise produce.
 */
const WEATHER_TTL_MS = 10 * 60 * 1000;
const WEATHER_GRACE_MS = 60 * 60 * 1000;

function cachedJson(url) {
  return cache.memo(cache.requestKey('open-meteo', url), WEATHER_TTL_MS, WEATHER_GRACE_MS, function () {
    return es.httpJson(url, HTTP);
  }).then(function (result) { return result.value; });
}

var OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
var AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Capital-region population.
 *
 * This used to come from opendata.riga.lv's `DeclaredPersons` OData collection
 * for Latvia and from hardcoded constants for Estonia and Lithuania. The Riga
 * service now returns HTTP 500 on every entity set, so the request always fell
 * through to its own hardcoded constant — meaning all three countries showed a
 * fixed number presented as live "declared residents".
 *
 * Eurostat's NUTS 3 population is a real, comparable, dated figure for all
 * three. It is a region rather than a municipality for Tallinn and Vilnius, so
 * the label travels with the number.
 */
var CAPITAL_REGIONS = {
  lv: { geo: 'LV006', label: 'Rīga (NUTS 3 region)' },
  ee: { geo: 'EE001', label: 'Põhja-Eesti (Tallinn capital region)' },
  lt: { geo: 'LT011', label: 'Vilniaus apskritis (Vilnius county)' },
};

var CITIES_BY_COUNTRY = {
  lv: [
    { name: 'Riga', lat: 56.95, lon: 24.11 },
    { name: 'Liepāja', lat: 56.51, lon: 21.01 },
    { name: 'Daugavpils', lat: 55.87, lon: 26.53 },
    { name: 'Jūrmala', lat: 56.97, lon: 23.77 },
  ],
  ee: [
    { name: 'Tallinn', lat: 59.44, lon: 24.75 },
    { name: 'Tartu', lat: 58.38, lon: 26.72 },
    { name: 'Pärnu', lat: 58.39, lon: 24.50 },
    { name: 'Narva', lat: 59.38, lon: 28.19 },
  ],
  lt: [
    { name: 'Vilnius', lat: 54.69, lon: 25.28 },
    { name: 'Kaunas', lat: 54.90, lon: 23.89 },
    { name: 'Klaipėda', lat: 55.71, lon: 21.13 },
    { name: 'Šiauliai', lat: 55.93, lon: 23.31 },
  ],
};

var AQ_COORDS = {
  lv: { lat: 56.95, lon: 24.11 },
  ee: { lat: 59.44, lon: 24.75 },
  lt: { lat: 54.69, lon: 25.28 },
};

function describeWeather(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

/**
 * Weather per city.
 *
 * A city that fails is dropped, which is reasonable — the others are still
 * worth showing. How many were dropped is reported, because a list silently
 * one city short is indistinguishable from a country that has three cities.
 */
async function fetchWeather(country) {
  var cities = CITIES_BY_COUNTRY[country] || CITIES_BY_COUNTRY.lv;
  var settled = await Promise.allSettled(cities.map(function (city) {
    var url = OPEN_METEO +
      '?latitude=' + city.lat +
      '&longitude=' + city.lon +
      '&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code' +
      '&timezone=Europe/Riga';
    return cachedJson(url).then(function (data) {
      var current = data.current || {};
      // `|| 0` turned a missing reading into a real-looking measurement: an
      // absent temperature became 0°C, which in Latvia reads as an ordinary
      // winter day rather than as an error.
      return {
        city: city.name,
        temperature: numberOrNull(current.temperature_2m),
        windSpeed: numberOrNull(current.wind_speed_10m),
        humidity: numberOrNull(current.relative_humidity_2m),
        description: typeof current.weather_code === 'number'
          ? describeWeather(current.weather_code)
          : null,
      };
    });
  }));

  var cityData = settled
    .filter(function (r) { return r.status === 'fulfilled'; })
    .map(function (r) { return r.value; });

  return {
    cities: cityData,
    requested: cities.length,
    missing: cities.length - cityData.length,
  };
}

/** A number, or null. Never a zero standing in for "we do not know". */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchAirQuality(country) {
  try {
    var coords = AQ_COORDS[country] || AQ_COORDS.lv;
    var tz = country === 'ee' ? 'Europe/Tallinn' : country === 'lt' ? 'Europe/Vilnius' : 'Europe/Riga';
    var url = AIR_QUALITY +
      '?latitude=' + coords.lat + '&longitude=' + coords.lon +
      '&current=pm2_5,nitrogen_dioxide,european_aqi' +
      '&timezone=' + tz;
    var data = await cachedJson(url);
    var current = data.current || {};
    var aqi = numberOrNull(current.european_aqi);

    // No reading is not the same as a good reading. The old catch returned
    // `status: 'good', label: 'Good'` on failure, which told a reader the air
    // was clean on the strength of a request that never completed.
    var status = null;
    var label = null;
    if (aqi !== null) {
      if (aqi > 100) { status = 'unhealthy'; label = 'Unhealthy'; }
      else if (aqi > 50) { status = 'moderate'; label = 'Moderate'; }
      else { status = 'good'; label = 'Good'; }
    }

    return {
      pm25: numberOrNull(current.pm2_5),
      no2: numberOrNull(current.nitrogen_dioxide),
      aqi: aqi,
      status: status,
      label: label,
      available: aqi !== null,
    };
  } catch (e) {
    return {
      pm25: null, no2: null, aqi: null, status: null, label: null,
      available: false,
      unavailableReason: e.message,
    };
  }
}

async function fetchCapitalPopulation(country) {
  var region = CAPITAL_REGIONS[country] || CAPITAL_REGIONS.lv;
  try {
    var url = es.EUROSTAT_BASE + '/demo_r_pjanaggr3?geo=' + region.geo +
      '&sex=T&age=TOTAL&freq=A&unit=NR&sinceTimePeriod=' + (new Date().getFullYear() - 6);
    var data = await es.httpJson(url, HTTP);
    var parsed = es.parseJsonStat(data, [region.geo]);
    var series = parsed.countries[region.geo] ? parsed.countries[region.geo].series : [];
    var withValues = series.filter(function (p) { return p.value !== null; });
    if (withValues.length === 0) throw new Error('No population value for ' + region.geo);
    var latest = withValues[withValues.length - 1];
    return {
      value: latest.value,
      year: latest.period,
      label: region.label,
      source: 'Eurostat (demo_r_pjanaggr3)',
    };
  } catch (e) {
    return { value: null, year: null, label: region.label, source: 'unavailable' };
  }
}

const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }
  try {
    var country = (req.query && req.query.country) || 'lv';
    const [weather, airQuality, population] = await Promise.all([
      fetchWeather(country),
      fetchAirQuality(country),
      fetchCapitalPopulation(country),
    ]);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        weather: weather.cities,
        // Always present, even when empty. A missing `weather` key and an empty
        // one are the same thing to a reader and different things to a client,
        // and the reader deserves to know which cities are absent rather than
        // being shown a shorter list with no explanation.
        weatherCoverage: {
          reporting: weather.cities.length,
          requested: weather.requested,
          missing: weather.missing,
        },
        airQuality: airQuality,
        capitalPopulation: population.value,
        capitalPopulationLabel: population.label,
        capitalPopulationYear: population.year,
        capitalPopulationSource: population.source,
        fetchedAt: new Date().toISOString(),
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
