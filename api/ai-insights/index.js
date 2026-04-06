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
 * Generates real-time AI insights by analyzing actual data from the dashboard APIs.
 * Collects key metrics, identifies significant changes, and formats them as insights.
 */
module.exports = async function (context, req) {
  try {
    // Fetch live data from our own APIs in parallel
    var baseUrl = 'https://' + (req.headers.host || 'portabaltica.naurolabs.com');
    var [economy, environment] = await Promise.all([
      jsonGet(baseUrl + '/api/economy-data').catch(function () { return null; }),
      jsonGet(baseUrl + '/api/environment-data').catch(function () { return null; }),
    ]);

    var insights = [];

    // Electricity insight
    if (economy && economy.electricityPrices && economy.electricityPrices.length > 0) {
      var prices = economy.electricityPrices;
      var today = new Date().toISOString().slice(0, 10);
      var todayPrices = prices.filter(function (p) { return p.timestamp && p.timestamp.startsWith(today); });
      var relevantPrices = todayPrices.length > 0 ? todayPrices : prices.slice(0, 24);
      var avg = relevantPrices.reduce(function (s, p) { return s + p.price; }, 0) / (relevantPrices.length || 1);
      var min = Math.min.apply(null, relevantPrices.map(function (p) { return p.price; }));
      var max = Math.max.apply(null, relevantPrices.map(function (p) { return p.price; }));
      var current = economy.electricityCurrent;

      var level = 'routine';
      var headline, description;
      if (current < 0) {
        level = 'significant';
        headline = 'Negative electricity prices today';
        description = 'Current price is €' + current.toFixed(2) + '/MWh. Negative prices occur when wind/solar generation exceeds demand. Industrial users benefit from flexible scheduling.';
      } else if (max > 100) {
        level = 'significant';
        headline = 'Electricity price spike detected';
        description = 'Peak price today reached €' + max.toFixed(0) + '/MWh (avg €' + avg.toFixed(0) + '). This is significantly above normal Baltic market levels.';
      } else if (avg < 30) {
        level = 'routine';
        headline = 'Low electricity prices today';
        description = 'Average day-ahead price €' + avg.toFixed(0) + '/MWh (range €' + min.toFixed(0) + '–€' + max.toFixed(0) + '). Favorable conditions for energy-intensive operations.';
      } else {
        level = 'routine';
        headline = 'Electricity market within normal range';
        description = 'Average €' + avg.toFixed(0) + '/MWh today (range €' + min.toFixed(0) + '–€' + max.toFixed(0) + '). Current spot: €' + current.toFixed(2) + '/MWh.';
      }
      insights.push({ headline: headline, description: description, level: level, category: 'economy', timestamp: new Date().toISOString() });
    }

    // Exchange rate insight
    if (economy && economy.exchangeRates && economy.exchangeRates.length > 0) {
      var usd = economy.exchangeRates.find(function (r) { return r.currency === 'USD'; });
      if (usd) {
        var usdLevel = usd.rate > 1.15 ? 'notable' : usd.rate < 1.05 ? 'notable' : 'routine';
        insights.push({
          headline: 'EUR/USD at ' + usd.rate.toFixed(4),
          description: usd.rate > 1.12 ? 'Euro strengthening against the dollar. Favorable for Baltic importers of US goods.' : 'Euro stable against the dollar. Exchange rate within historical norms.',
          level: usdLevel,
          category: 'economy',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Business pulse insight
    if (economy && economy.businessPulse) {
      var bp = economy.businessPulse;
      if (bp.suspendedBusinesses > 0) {
        insights.push({
          headline: bp.newVatRegistrations.toLocaleString() + ' VAT-registered businesses',
          description: bp.suspendedBusinesses.toLocaleString() + ' businesses currently suspended. The business registry is a key indicator of economic activity and regulatory enforcement.',
          level: 'routine',
          category: 'business',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Air quality insight
    if (environment && environment.airQuality) {
      var aq = environment.airQuality;
      var aqLevel = aq.status === 'unhealthy' ? 'significant' : aq.status === 'moderate' ? 'notable' : 'routine';
      insights.push({
        headline: 'Air quality: ' + aq.label,
        description: 'PM2.5: ' + aq.pm25.toFixed(1) + ' µg/m³, NO₂: ' + aq.no2.toFixed(1) + ' µg/m³. ' +
          (aq.status === 'good' ? 'Well below WHO guidelines. Good conditions for outdoor activities.' :
           aq.status === 'moderate' ? 'Moderate levels. Sensitive groups should limit prolonged outdoor exposure.' :
           'Unhealthy levels. Consider limiting outdoor activities.'),
        level: aqLevel,
        category: 'environment',
        timestamp: new Date().toISOString(),
      });
    }

    // Weather insight
    if (environment && environment.weather && environment.weather.length > 0) {
      var w = environment.weather[0]; // Capital city
      insights.push({
        headline: w.city + ': ' + w.temperature.toFixed(0) + '°C, ' + w.description.toLowerCase(),
        description: 'Wind ' + w.windSpeed.toFixed(0) + ' km/h, humidity ' + w.humidity + '%. ' +
          (w.temperature < 0 ? 'Below freezing — monitor heating costs and transport disruptions.' :
           w.temperature > 25 ? 'Warm conditions may increase electricity demand for cooling.' :
           'Current conditions within seasonal norms.'),
        level: 'routine',
        category: 'environment',
        timestamp: new Date().toISOString(),
      });
    }

    // GDP/salary from live indicators if available
    if (economy && economy.indicators) {
      economy.indicators.forEach(function (ind) {
        if (ind.label === 'GDP Growth' && ind.value !== 'N/A') {
          insights.push({
            headline: 'GDP growth at ' + ind.value,
            description: 'Latvia\'s economy ' + (ind.change ? 'changed ' + ind.change + ' vs previous period. ' : '') +
              'GDP growth reflects overall economic health and drives investment decisions.',
            level: ind.value.includes('-') ? 'significant' : 'routine',
            category: 'economy',
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    // Limit to 5 most relevant insights
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
