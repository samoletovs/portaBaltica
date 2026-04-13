const https = require('https');

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 8000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
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
  var startTime = Date.now();

  // Check each data source health in parallel
  var checks = [
    { name: 'ECB Exchange Rates', url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', type: 'xml' },
    { name: 'NordPool Electricity', url: 'https://dashboard.elering.ee/api/nps/price?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z', type: 'json' },
    { name: 'data.gov.lv CKAN', url: 'https://data.gov.lv/dati/api/3/action/site_read', type: 'json' },
    { name: 'CSP PxWeb', url: 'https://data.stat.gov.lv/api/v1/en/OSP_PUB/', type: 'json' },
    { name: 'Open-Meteo Weather', url: 'https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&current=temperature_2m', type: 'json' },
    { name: 'Open-Meteo Air Quality', url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=56.95&longitude=24.11&current=pm2_5', type: 'json' },
    { name: 'Riga Open Data', url: 'https://opendata.riga.lv/odata/service/DeclaredPersons', type: 'json' },
  ];

  var results = await Promise.all(checks.map(async function (check) {
    var checkStart = Date.now();
    try {
      if (check.type === 'xml') {
        // Simple HEAD-like check for XML
        await new Promise(function (resolve, reject) {
          var req = https.get(check.url, { timeout: 5000 }, function (res) {
            res.on('data', function () {}); // drain
            res.on('end', resolve);
          });
          req.on('timeout', function () { req.destroy(new Error('Timeout')); });
          req.on('error', reject);
        });
      } else {
        await jsonGet(check.url);
      }
      return { name: check.name, status: 'healthy', latency: Date.now() - checkStart };
    } catch (e) {
      return { name: check.name, status: 'unhealthy', latency: Date.now() - checkStart, error: e.message };
    }
  }));

  var healthy = results.filter(function (r) { return r.status === 'healthy'; }).length;
  var total = results.length;

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({
      status: healthy === total ? 'healthy' : healthy > total / 2 ? 'degraded' : 'unhealthy',
      version: '0.3.0',
      phase: 'Phase 3 — Deep Latvia',
      uptime: 'Azure Static Web Apps (managed)',
      dataSources: {
        healthy: healthy,
        total: total,
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
