const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');

/**
 * GET /api/system-status
 *
 * Public health check. What it reports is only as good as what it probes, and
 * a live audit found three of the seven probes were wrong rather than the
 * sources being down:
 *
 *   - data.gov.lv was probed with the CKAN `site_read` action, which the portal
 *     no longer implements. It answered "Action name not known" in 124ms and
 *     was recorded as an outage while the portal was perfectly healthy.
 *   - CSP PxWeb was probed by POSTing an empty query, which materialises an
 *     entire GDP table (13s) to answer "are you up".
 *   - Riga Open Data is genuinely broken upstream — every entity set returns
 *     HTTP 500 — so it is probed at the only endpoint that works and is no
 *     longer relied on for data anywhere in the app.
 *
 * Eurostat is probed now too. It backs more than forty charts and was the one
 * dependency the health check never looked at.
 *
 * Each probe carries its own deadline and the endpoint reports whatever has
 * answered by the overall budget. Previously the response time was the slowest
 * probe's, so one stalled source made the whole status page take 16 seconds.
 */

const PROBE_DEADLINE_MS = 5000;
const OVERALL_BUDGET_MS = 7000;

function buildNordPoolProbeUrl() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return 'https://dashboard.elering.ee/api/nps/price?start=' +
    encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString());
}

const CHECKS = [
  {
    name: 'Eurostat',
    url: es.EUROSTAT_BASE + '/une_rt_m?geo=LV&unit=PC_ACT&s_adj=SA&age=TOTAL&sex=T&freq=M&lastTimePeriod=1',
    type: 'json',
    required: true,
    powers: 'All Baltic comparison charts',
  },
  {
    name: 'Eurostat maritime',
    // The exact slice the maritime tile reads, asserted to carry a value.
    // A source that answers 200 with nothing in it is the failure that ended
    // the previous maritime feed: data.gov.lv served eighteen consecutive
    // header-only CSVs while every liveness check on the host stayed green.
    url: es.EUROSTAT_BASE + '/mar_tf_qm?format=JSON&lang=EN&freq=Q&tonnage=TOTAL' +
      '&vessel=TOTAL&unit=NR&rep_mar=LV_0LVRIX&lastTimePeriod=1',
    type: 'eurostat-cube',
    cubeKey: 'rep_mar',
    required: true,
    powers: 'Port cargo, passenger and vessel statistics',
  },
  {
    name: 'ECB Exchange Rates',
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    type: 'ecb-xml',
    required: true,
    powers: 'Currency ticker',
  },
  {
    name: 'NordPool Electricity',
    url: buildNordPoolProbeUrl(),
    type: 'json',
    required: true,
    powers: 'Day-ahead power prices',
  },
  {
    name: 'data.gov.lv CKAN',
    // `site_read` was removed from the portal's action list; `status_show` is
    // the supported liveness action.
    url: 'https://data.gov.lv/dati/api/3/action/status_show',
    type: 'ckan',
    required: true,
    powers: 'Business registry counts',
  },
  {
    // Liveness of the portal is not the same as availability of the data we
    // read from it, and conflating the two hid a real outage: the Economy
    // tile asked for a dataset that had been renamed, the portal answered
    // 404, the tile printed "0 Suspended Activities", and this page stayed
    // green throughout because `status_show` on the same host still answered.
    //
    // So probe the datasets by name. `package_show` is 3–4 KB and answers in
    // well under a second, and it 404s for a dataset that no longer exists —
    // which is precisely the failure that went unnoticed.
    name: 'VID business registers',
    datasets: [
      'saimnieciskas-darbibas-apturesana',
      'pvn-maksataji',
    ],
    type: 'ckan-datasets',
    required: true,
    powers: 'Suspended activities and VAT-payer counts',
  },
  {
    name: 'CSP PxWeb',
    // The catalogue root answers in ~80ms; a table query takes seconds.
    url: 'https://data.stat.gov.lv/api/v1/en/OSP_PUB',
    type: 'json',
    required: true,
    powers: 'Latvian national indicators',
  },
  {
    name: 'Open-Meteo Weather',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&current=temperature_2m',
    type: 'json',
    required: true,
    powers: 'City weather',
  },
  {
    name: 'Open-Meteo Air Quality',
    url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=56.95&longitude=24.11&current=pm2_5',
    type: 'json',
    required: true,
    powers: 'Air quality',
  },
  {
    name: 'Riga Open Data',
    // Entity sets return HTTP 500 upstream; only the service document responds.
    url: 'https://opendata.riga.lv/odata/service/',
    type: 'text',
    required: false,
    powers: 'Nothing — retained as an availability signal only',
    note: 'Entity sets return HTTP 500 upstream; no dashboard element depends on it',
  },
];

async function runCheck(check) {
  const started = Date.now();
  try {
    if (check.type === 'ecb-xml') {
      const xml = await es.httpText(check.url, { deadlineMs: PROBE_DEADLINE_MS });
      const hasEnvelope = /<\s*(?:\w+:)?Envelope\b/i.test(xml);
      const hasCube = /<\s*(?:\w+:)?Cube\b/i.test(xml);
      if (!hasEnvelope || !hasCube) throw new Error('ECB XML missing required elements (envelope and/or cube)');
    } else if (check.type === 'ckan') {
      const body = await es.httpJson(check.url, { deadlineMs: PROBE_DEADLINE_MS });
      // CKAN answers 200 with success:false for an unknown action, which is how
      // a removed action previously read as a healthy source.
      if (body && body.success === false) throw new Error('CKAN reported failure: ' + JSON.stringify(body.error || body).slice(0, 120));
    } else if (check.type === 'ckan-datasets') {
      // A dataset counts as available only if it still exists *and* still has
      // a resource the datastore will answer queries for. An ingestion that
      // has silently stopped leaves the dataset present but unqueryable, and
      // the count that depends on it disappears.
      const missing = [];
      await Promise.all(check.datasets.map(async function (dataset) {
        try {
          const body = await es.httpJson(
            'https://data.gov.lv/dati/api/3/action/package_show?id=' + encodeURIComponent(dataset),
            { deadlineMs: PROBE_DEADLINE_MS },
          );
          if (!body || body.success !== true) throw new Error('success:false');
          const resources = (body.result && body.result.resources) || [];
          if (!resources.some(function (r) { return r && r.datastore_active; })) {
            throw new Error('no datastore-active resource');
          }
        } catch (err) {
          missing.push(dataset + ' (' + ((err && err.message) || err) + ')');
        }
      }));
      if (missing.length > 0) throw new Error('Unavailable: ' + missing.join('; '));
    } else if (check.type === 'eurostat-cube') {
      // Parsing is not enough: an emptied cube still parses. Require at least
      // one real observation, which is what the tile needs to render.
      const body = await es.httpJson(check.url, { deadlineMs: PROBE_DEADLINE_MS });
      const parsed = es.parseJsonStatDim(body, check.cubeKey, null);
      const carriesData = Object.keys(parsed.series).some(function (key) {
        return parsed.series[key].series.some(function (p) {
          return p.value !== null && p.value !== undefined;
        });
      });
      if (!carriesData) throw new Error('Cube answered but carries no observation');
    } else if (check.type === 'text') {
      const text = await es.httpText(check.url, { deadlineMs: PROBE_DEADLINE_MS });
      if (!text || text.length === 0) throw new Error('Empty response');
    } else {
      await es.httpJson(check.url, { deadlineMs: PROBE_DEADLINE_MS });
    }
    return { name: check.name, status: 'healthy', latency: Date.now() - started, required: check.required, powers: check.powers, note: check.note };
  } catch (e) {
    return { name: check.name, status: 'unhealthy', latency: Date.now() - started, required: check.required, powers: check.powers, note: check.note, error: e.message };
  }
}

/** Resolve with whatever each probe has produced by the overall budget. */
function withBudget(promise, check, budgetMs, startedAt) {
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          name: check.name,
          status: 'unhealthy',
          latency: Date.now() - startedAt,
          required: check.required,
          powers: check.powers,
          note: check.note,
          error: 'Exceeded the ' + budgetMs + 'ms status budget',
        });
      }, budgetMs);
    }),
  ]);
}

const API_ENDPOINTS = [
  '/api/baltic-compare', '/api/historical-data', '/api/economy-data',
  '/api/property-data', '/api/environment-data', '/api/power-prices',
  '/api/port-data', '/api/business-search', '/api/eu-funds',
  '/api/address-search', '/api/ai-insights', '/api/system-status',
];

module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }
  const startTime = Date.now();

  const results = await Promise.all(CHECKS.map(function (check) {
    return withBudget(runCheck(check), check, OVERALL_BUDGET_MS, startTime);
  }));

  const healthy = results.filter(function (r) { return r.status === 'healthy'; }).length;
  const requiredResults = results.filter(function (r) { return r.required; });
  const requiredHealthy = requiredResults.filter(function (r) { return r.status === 'healthy'; }).length;
  const requiredTotal = requiredResults.length;
  const optionalResults = results.filter(function (r) { return !r.required; });
  const optionalHealthy = optionalResults.filter(function (r) { return r.status === 'healthy'; }).length;
  const minHealthyForDegraded = Math.ceil(requiredTotal / 2);

  let systemStatus = 'unhealthy';
  if (requiredHealthy === requiredTotal) systemStatus = 'healthy';
  else if (requiredHealthy >= minHealthyForDegraded) systemStatus = 'degraded';

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({
      status: systemStatus,
      version: '0.4.0',
      phase: 'Phase 3 — Deep Latvia',
      uptime: 'Azure Static Web Apps (managed)',
      dataSources: {
        healthy: healthy,
        total: results.length,
        requiredHealthy: requiredHealthy,
        requiredTotal: requiredTotal,
        optionalHealthy: optionalHealthy,
        optionalTotal: optionalResults.length,
        checks: results,
      },
      apis: {
        total: API_ENDPOINTS.length,
        endpoints: API_ENDPOINTS,
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
