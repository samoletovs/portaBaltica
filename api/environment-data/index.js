const https = require('https');
const rateLimit = require('../shared/rateLimit.js');
const http = require('http');
const es = require('../shared/eurostat.js');

function httpGet(url) {
  var lib = url.startsWith('https') ? https : http;
  return new Promise(function (resolve, reject) {
    var req = lib.get(url, { timeout: 10000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed for ' + url)); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
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

async function fetchWeather(country) {
  var cities = CITIES_BY_COUNTRY[country] || CITIES_BY_COUNTRY.lv;
  var settled = await Promise.allSettled(cities.map(function (city) {
    var url = OPEN_METEO +
      '?latitude=' + city.lat +
      '&longitude=' + city.lon +
      '&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code' +
      '&timezone=Europe/Riga';
    return httpGet(url).then(function (data) {
      var current = data.current || {};
      return {
        city: city.name,
        temperature: current.temperature_2m || 0,
        windSpeed: current.wind_speed_10m || 0,
        humidity: current.relative_humidity_2m || 0,
        description: describeWeather(current.weather_code || 0),
      };
    });
  }));
  return settled
    .filter(function (r) { return r.status === 'fulfilled'; })
    .map(function (r) { return r.value; });
}

async function fetchAirQuality(country) {
  try {
    var coords = AQ_COORDS[country] || AQ_COORDS.lv;
    var tz = country === 'ee' ? 'Europe/Tallinn' : country === 'lt' ? 'Europe/Vilnius' : 'Europe/Riga';
    var url = AIR_QUALITY +
      '?latitude=' + coords.lat + '&longitude=' + coords.lon +
      '&current=pm2_5,nitrogen_dioxide,european_aqi' +
      '&timezone=' + tz;
    var data = await httpGet(url);
    var current = data.current || {};
    var aqi = current.european_aqi || 0;
    var status = 'good';
    var label = 'Good';
    if (aqi > 100) { status = 'unhealthy'; label = 'Unhealthy'; }
    else if (aqi > 50) { status = 'moderate'; label = 'Moderate'; }
    return {
      pm25: current.pm2_5 || 0,
      no2: current.nitrogen_dioxide || 0,
      status: status,
      label: label,
    };
  } catch (e) {
    return { pm25: 0, no2: 0, status: 'good', label: 'Good' };
  }
}

async function fetchCapitalPopulation(country) {
  var region = CAPITAL_REGIONS[country] || CAPITAL_REGIONS.lv;
  try {
    var url = es.EUROSTAT_BASE + '/demo_r_pjanaggr3?geo=' + region.geo +
      '&sex=T&age=TOTAL&freq=A&unit=NR&sinceTimePeriod=' + (new Date().getFullYear() - 6);
    var data = await es.httpJson(url, { deadlineMs: 10000 });
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

module.exports = async function (context, req) {
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
        weather: weather,
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
