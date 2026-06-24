const https = require('https');
const rateLimit = require('../shared/rateLimit.js');

function textGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 8000 }, function (res) {
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
  return textGet(url).then(function (text) {
    try { return JSON.parse(text); }
    catch (e) { throw new Error('JSON parse failed for ' + url); }
  });
}

function jsonPost(url, body) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var postData = JSON.stringify(body);
    var req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed for ' + url)); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * GET /api/system-status
 *
 * Public health check endpoint. Reports:
 * - API endpoint health (which data sources are responding)
 * - Data freshness (when each source was last fetched)
 * - System uptime and version info
 * - Self-sustaining metrics (costs, subscribers — Phase 4)
 */
module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }
  var startTime = Date.now();

  var now = new Date();
  var start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  var end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  // Check each data source health in parallel
  var checks = [
    { name: 'ECB Exchange Rates', type: 'xml', required: true },
    { name: 'NordPool Electricity', type: 'json', required: true, url: 'https://dashboard.elering.ee/api/nps/price?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString()) },
    { name: 'data.gov.lv CKAN', type: 'json', required: true, url: 'https://data.gov.lv/dati/api/3/action/site_read' },
    { name: 'CSP PxWeb', type: 'pxweb', required: true, url: 'https://data.stat.gov.lv/api/v1/en/OSP_PUB/VEK/IS/ISI/ISI010c' },
    { name: 'Open-Meteo Weather', type: 'json', required: true, url: 'https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&current=temperature_2m' },
    { name: 'Open-Meteo Air Quality', type: 'json', required: true, url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=56.95&longitude=24.11&current=pm2_5' },
    { name: 'Riga Open Data', type: 'json', required: false, url: 'https://opendata.riga.lv/odata/service/DeclaredPersons?$top=1&$format=json' },
  ];

  var results = await Promise.all(checks.map(async function (check) {
    var checkStart = Date.now();
    try {
      if (check.type === 'xml') {
        var xml = await textGet('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
        if (xml.indexOf('eurofxref') === -1 || xml.indexOf('Cube') === -1) {
          throw new Error('ECB payload missing expected fields');
        }
      } else if (check.type === 'pxweb') {
        await jsonPost(check.url, { query: [], response: { format: 'json-stat2' } });
      } else {
        await jsonGet(check.url);
      }
      return { name: check.name, status: 'healthy', latency: Date.now() - checkStart, required: check.required };
    } catch (e) {
      return { name: check.name, status: 'unhealthy', latency: Date.now() - checkStart, error: e.message, required: check.required };
    }
  }));

  var healthy = results.filter(function (r) { return r.status === 'healthy'; }).length;
  var total = results.length;
  var requiredResults = results.filter(function (r) { return r.required; });
  var requiredHealthy = requiredResults.filter(function (r) { return r.status === 'healthy'; }).length;
  var requiredTotal = requiredResults.length;
  var optionalResults = results.filter(function (r) { return !r.required; });
  var optionalHealthy = optionalResults.filter(function (r) { return r.status === 'healthy'; }).length;

  var systemStatus = 'unhealthy';
  if (requiredHealthy === requiredTotal) {
    systemStatus = 'healthy';
  } else if (requiredHealthy >= Math.ceil(requiredTotal / 2)) {
    systemStatus = 'degraded';
  }

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({
      status: systemStatus,
      version: '0.3.0',
      phase: 'Phase 3 — Deep Latvia',
      uptime: 'Azure Static Web Apps (managed)',
      dataSources: {
        healthy: healthy,
        total: total,
        requiredHealthy: requiredHealthy,
        requiredTotal: requiredTotal,
        optionalHealthy: optionalHealthy,
        optionalTotal: optionalResults.length,
        checks: results,
      },
      apis: {
        total: 8,
        endpoints: [
          '/api/economy-data', '/api/property-data', '/api/environment-data',
          '/api/port-data', '/api/business-search', '/api/eu-funds',
          '/api/address-search', '/api/system-status',
        ],
      },
      selfSustaining: {
        monthlyInfrastructureCost: '~€5-18',
        subscribers: { free: 0, pro: 0, enterprise: 0 },
        revenue: '€0 (pre-monetization)',
        status: 'Phase 3 — building value before monetization',
      },
      respondedIn: Date.now() - startTime + 'ms',
      fetchedAt: new Date().toISOString(),
    }),
  };
};
