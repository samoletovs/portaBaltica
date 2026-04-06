const https = require('https');
const http = require('http');

function httpGet(url) {
  var lib = url.startsWith('https') ? https : http;
  return new Promise(function (resolve, reject) {
    lib.get(url, { timeout: 10000 }, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed for ' + url)); }
      });
    }).on('error', reject);
  });
}

var OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
var AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';
var RIGA_POP_URL = 'https://opendata.riga.lv/odata/service/DeclaredPersons';

var CITIES = [
  { name: 'Riga', lat: 56.95, lon: 24.11 },
  { name: 'Liepāja', lat: 56.51, lon: 21.01 },
  { name: 'Daugavpils', lat: 55.87, lon: 26.53 },
  { name: 'Jūrmala', lat: 56.97, lon: 23.77 },
];

function describeWeather(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

async function fetchWeather() {
  var results = [];
  for (var i = 0; i < CITIES.length; i++) {
    try {
      var city = CITIES[i];
      var url = OPEN_METEO +
        '?latitude=' + city.lat +
        '&longitude=' + city.lon +
        '&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code' +
        '&timezone=Europe/Riga';
      var data = await httpGet(url);
      var current = data.current || {};
      results.push({
        city: city.name,
        temperature: current.temperature_2m || 0,
        windSpeed: current.wind_speed_10m || 0,
        humidity: current.relative_humidity_2m || 0,
        description: describeWeather(current.weather_code || 0),
      });
    } catch (e) {
      // Skip failed city
    }
  }
  return results;
}

async function fetchAirQuality() {
  try {
    var url = AIR_QUALITY +
      '?latitude=56.95&longitude=24.11' +
      '&current=pm2_5,nitrogen_dioxide,european_aqi' +
      '&timezone=Europe/Riga';
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

async function fetchRigaPopulation() {
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
  try {
    const [weather, airQuality, rigaPopulation] = await Promise.all([
      fetchWeather(),
      fetchAirQuality(),
      fetchRigaPopulation(),
    ]);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        weather: weather,
        airQuality: airQuality,
        rigaPopulation: rigaPopulation,
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
