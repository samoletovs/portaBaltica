const https = require('https');
const rateLimit = require('../shared/rateLimit.js');
const http = require('http');

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
var RIGA_POP_URL = 'https://opendata.riga.lv/odata/service/DeclaredPersons';

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

var POP_DATA = { lv: 605802, ee: 456000, lt: 590000 };

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
  if (country !== 'lv') return POP_DATA[country] || 0;
  try {
    var data = await httpGet(RIGA_POP_URL);
    var records = (data.value || (data.d && data.d.results)) || [];
    if (records.length === 0) return 605802;
    var total = records.reduce(function (sum, r) {
      return sum + (r.PersonCount || r.Count || 0);
    }, 0);
    return total > 0 ? total : 605802;
  } catch (e) {
    return 605802; // Fallback 2025 data
  }
}

module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }
  try {
    var country = (req.query && req.query.country) || 'lv';
    const [weather, airQuality, capitalPopulation] = await Promise.all([
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
        capitalPopulation: capitalPopulation,
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
