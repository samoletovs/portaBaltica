const https = require('https');

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { timeout: 15000 }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse failed')); }
      });
    }).on('error', reject);
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
    https.get(url, { timeout: 10000 }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve(data); });
    }).on('error', reject);
  });
}

module.exports = async function (context, req) {
  try {
    var insights = [];
    var country = (req.query && req.query.country) || 'lv';
    var zoneMap = { lv: 'lv', ee: 'ee', lt: 'lt' };
    var zone = zoneMap[country] || 'lv';
    var capitalCoords = {
      lv: { lat: 56.95, lon: 24.11, name: 'Riga', tz: 'Europe/Riga' },
      ee: { lat: 59.44, lon: 24.75, name: 'Tallinn', tz: 'Europe/Tallinn' },
      lt: { lat: 54.69, lon: 25.28, name: 'Vilnius', tz: 'Europe/Vilnius' },
    };
    var capital = capitalCoords[country] || capitalCoords.lv;

    // 1. Electricity prices from Elering
    try {
      var now = new Date();
      var start = new Date(now); start.setUTCHours(0, 0, 0, 0);
      var end = new Date(start); end.setDate(end.getDate() + 1);
      var elData = await jsonGet(ELERING_URL + '?start=' + start.toISOString() + '&end=' + end.toISOString());
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
      var xml = await httpGetText(ECB_URL);
      var usdMatch = xml.match(/currency='USD' rate='([\d.]+)'/);
      if (usdMatch) {
        var usdRate = parseFloat(usdMatch[1]);
        insights.push({ headline: 'EUR/USD: ' + usdRate.toFixed(4), description: usdRate > 1.12 ? 'Euro strengthening against the dollar — favorable for Baltic importers.' : usdRate < 1.05 ? 'Euro weakening — Baltic exporters benefit from cheaper euro-denominated goods.' : 'Exchange rate within normal range. ECB rates updated daily at 16:00 CET.', level: usdRate > 1.15 || usdRate < 1.03 ? 'notable' : 'routine', category: 'economy', timestamp: new Date().toISOString() });
      }
    } catch (e) { /* skip */ }

    // 3. Air quality
    try {
      var aqData = await jsonGet(OPEN_METEO_AQ + '?latitude=' + capital.lat + '&longitude=' + capital.lon + '&current=pm2_5,nitrogen_dioxide,european_aqi&timezone=' + capital.tz);
      var aqCurrent = aqData.current || {};
      var aqi = aqCurrent.european_aqi || 0;
      var pm25 = aqCurrent.pm2_5 || 0;
      var aqStatus = aqi > 100 ? 'unhealthy' : aqi > 50 ? 'moderate' : 'good';
      insights.push({ headline: capital.name + ' air quality: ' + (aqStatus === 'good' ? 'Good' : aqStatus === 'moderate' ? 'Moderate' : 'Unhealthy'), description: 'PM2.5: ' + pm25.toFixed(1) + ' µg/m³. ' + (aqStatus === 'good' ? 'Well below WHO guidelines. Outdoor activities recommended.' : aqStatus === 'moderate' ? 'Sensitive groups should limit prolonged outdoor exposure.' : 'Consider limiting outdoor activities. Monitor WHO advisories.'), level: aqStatus === 'good' ? 'routine' : aqStatus === 'moderate' ? 'notable' : 'significant', category: 'environment', timestamp: new Date().toISOString() });
    } catch (e) { /* skip */ }

    // 4. Weather
    try {
      var wxData = await jsonGet(OPEN_METEO_WX + '?latitude=' + capital.lat + '&longitude=' + capital.lon + '&current=temperature_2m,wind_speed_10m,weather_code&timezone=' + capital.tz);
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
