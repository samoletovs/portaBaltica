const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');
const cubeHealth = require('../shared/cubeHealth.js');
const freshness = require('../shared/freshness.js');
const registry = require('../shared/statusChecks.js');

/**
 * GET /api/system-status
 *
 * Public health check. What it reports is only as good as what it probes, and
 * successive live audits have found the probes wrong far more often than the
 * sources:
 *
 *   - data.gov.lv was probed with the CKAN `site_read` action, which the portal
 *     no longer implements. It answered "Action name not known" in 124ms and
 *     was recorded as an outage while the portal was perfectly healthy.
 *   - CSP PxWeb was probed by POSTing an empty query, which materialises an
 *     entire GDP table (13s) to answer "are you up".
 *   - The Eurostat maritime probe asked a Europe-wide cube for its newest
 *     column, which no single port fills on time, and held the whole page at
 *     `degraded` while the maritime tile worked perfectly.
 *
 * Two things were still missing after all that, and this endpoint now does both.
 *
 * **It asks whether a source is still moving, not merely whether it answered.**
 * Every probe declares its expected cadence in `shared/statusChecks.js` and is
 * judged against the age of its newest observation. A source that is reachable
 * but frozen reports `stale`, which is a distinct state from `unhealthy`
 * because it is a distinct thing to tell a reader — and because flattening the
 * two is exactly how `prc_hicp_manr` served 2025-12 for eight months behind a
 * green light.
 *
 * **It does not report a hung socket as an outage.** Measured against
 * production, the Open-Meteo probe answered in 17–63ms when it worked and in
 * exactly 5000ms when it did not, about one call in three, while the same
 * endpoint answered in ~150ms from a laptop. That is a connection accepted and
 * then left silent, most likely the shared Azure egress address meeting a
 * per-IP rate limit. One retry on a fresh connection converts almost all of it.
 *
 * The point of both is the same one the maritime fix was about: a status page
 * that cries wolf teaches readers to ignore it, and then the real outage — the
 * frozen table, the eighteen header-only CSVs — goes unnoticed because nobody
 * trusts the amber light any more.
 */

/**
 * Per-attempt deadline, and the ceiling for the whole page.
 *
 * Dropped from 5000ms because five seconds was never a real answer: measured
 * healthy latencies are 16–63ms for Open-Meteo, ~100–500ms for Eurostat cubes
 * and 351ms for PxWeb metadata. Anything past three seconds is a hung socket,
 * and waiting five to discover that only delays the retry that fixes it. Two
 * attempts at 3000ms fit in a smaller worst case than one attempt at 5000ms.
 */
const PROBE_DEADLINE_MS = 3000;
const PROBE_RETRIES = 1;
const OVERALL_BUDGET_MS = 8000;

function httpOptions() {
  return { deadlineMs: PROBE_DEADLINE_MS, retries: PROBE_RETRIES };
}

/**
 * When the newsroom last finished a run, and what it produced.
 *
 * Liveness alone is not enough here. A run that publishes nothing is not
 * necessarily broken — some days genuinely have no news — but a pipeline that
 * publishes nothing every day is exactly the failure this exists to catch, and
 * it would sail past a check that only asked whether the timer fired. So the
 * counts come back alongside the timestamp and the endpoint reports both.
 */
function newsroomObservation(body) {
  if (!body || typeof body !== 'object') return null;
  const at = body.completedAt || body.finishedAt || body.timestamp;
  if (!at) return null;
  return {
    at: at,
    published: typeof body.published === 'number' ? body.published : null,
    rejected: typeof body.rejected === 'number' ? body.rejected : null,
    trigger: body.trigger || null,
  };
}

/**
 * Fetch and validate one source, returning whatever it can say about when its
 * data last changed.
 *
 * Throwing means the source is unreachable or answering wrongly. An observation
 * that turns out to be old is *not* an error here: staleness is judged
 * afterwards against the cadence the check declares, which is what keeps the
 * two verdicts separable.
 */
async function probe(check) {
  if (check.type === 'ecb-xml') {
    const xml = await es.httpText(check.url, httpOptions());
    const hasEnvelope = /<\s*(?:\w+:)?Envelope\b/i.test(xml);
    const hasCube = /<\s*(?:\w+:)?Cube\b/i.test(xml);
    if (!hasEnvelope || !hasCube) throw new Error('ECB XML missing required elements (envelope and/or cube)');
    return freshness.extract.ecbXml(xml);
  }

  if (check.type === 'ckan') {
    const body = await es.httpJson(check.url, httpOptions());
    // CKAN answers 200 with success:false for an unknown action, which is how
    // a removed action previously read as a healthy source.
    if (body && body.success === false) {
      throw new Error('CKAN reported failure: ' + JSON.stringify(body.error || body).slice(0, 120));
    }
    return null;
  }

  if (check.type === 'ckan-datasets') {
    // A dataset counts as available only if it still exists *and* still has a
    // resource the datastore will answer queries for. An ingestion that has
    // silently stopped leaves the dataset present but unqueryable, and the
    // count that depends on it disappears.
    const missing = [];
    const packages = [];
    await Promise.all(check.datasets.map(async function (dataset) {
      try {
        const body = await es.httpJson(
          'https://data.gov.lv/dati/api/3/action/package_show?id=' + encodeURIComponent(dataset),
          httpOptions(),
        );
        if (!body || body.success !== true) throw new Error('success:false');
        const resources = (body.result && body.result.resources) || [];
        if (!resources.some(function (r) { return r && r.datastore_active; })) {
          throw new Error('no datastore-active resource');
        }
        packages.push(body);
      } catch (err) {
        missing.push(dataset + ' (' + ((err && err.message) || err) + ')');
      }
    }));
    if (missing.length > 0) throw new Error('Unavailable: ' + missing.join('; '));
    return freshness.extract.ckanResources(packages);
  }

  if (check.type === 'eurostat-cube') {
    // Parsing is not enough: an emptied cube still parses. A cube carrying no
    // observation at all is a fault; a cube whose newest observation is merely
    // old is a staleness question, and the caller answers it.
    const body = await es.httpJson(check.url, httpOptions());
    const observation = cubeHealth.newestObservation(body, check.cubeKey);
    if (observation === null) throw new Error('Cube answered but carries no observation');
    return observation;
  }

  if (check.type === 'elering') {
    const body = await es.httpJson(check.url, httpOptions());
    if (body && body.success === false) throw new Error('Elering reported failure');
    const observation = freshness.extract.elering(body);
    if (observation === null) throw new Error('Elering answered with no priced intervals');
    return observation;
  }

  if (check.type === 'open-meteo') {
    const body = await es.httpJson(check.url, httpOptions());
    if (!body || !body.current) throw new Error('Open-Meteo answered without a current reading');
    return freshness.extract.openMeteo(body);
  }

  if (check.type === 'pxweb-metadata') {
    const body = await es.httpJson(check.url, httpOptions());
    if (!body || !Array.isArray(body.variables)) throw new Error('PxWeb answered without table metadata');
    return freshness.extract.pxwebMetadata(body);
  }

  if (check.type === 'newsroom-run') {
    // The newsroom writes a report after every run. Its absence is the finding:
    // it means no run has completed far enough to write one.
    const body = await es.httpJson(check.url, httpOptions());
    const observation = newsroomObservation(body);
    if (observation === null) throw new Error('Run report carries no completion time');
    return observation;
  }

  if (check.type === 'text') {
    const text = await es.httpText(check.url, httpOptions());
    if (!text || text.length === 0) throw new Error('Empty response');
    return null;
  }

  await es.httpJson(check.url, httpOptions());
  return null;
}

async function runCheck(check, now) {
  const started = Date.now();
  try {
    const observation = await probe(check);
    const verdict = freshness.judge(check, observation, now);

    const result = {
      name: check.name,
      status: verdict.state === 'stale' ? 'stale' : 'healthy',
      freshness: verdict.state,
      latency: Date.now() - started,
      required: check.required,
      powers: check.powers,
      note: check.note,
    };

    // The observation the verdict rests on, so a wrong threshold is visible on
    // the page rather than something a reader has to take on trust.
    if (observation && observation.period) result.dataPeriod = observation.period;
    if (observation && observation.at) result.dataAt = new Date(observation.at).toISOString();
    if (verdict.age !== undefined) result.ageInCadenceUnits = verdict.age;
    if (verdict.limit !== undefined) result.maxLag = verdict.limit;
    if (check.cadence) result.cadence = check.cadence;
    if (verdict.reason) result.freshnessReason = verdict.reason;
    if (observation && observation.published !== undefined) {
      result.published = observation.published;
      result.rejected = observation.rejected;
      result.trigger = observation.trigger;
    }

    return result;
  } catch (e) {
    return {
      name: check.name,
      status: 'unhealthy',
      freshness: 'unknown',
      latency: Date.now() - started,
      required: check.required,
      powers: check.powers,
      note: check.note,
      error: e.message,
    };
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
          freshness: 'unknown',
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

/**
 * One word for the whole site.
 *
 * `stale` sits between `healthy` and `degraded` deliberately: everything is
 * reachable, so nothing is broken in the way a reader would recognise, but
 * something on the page is older than it should be and saying so is the entire
 * point. Reachability still dominates — a source that is down is worse news
 * than one that is late — so a mix of down and stale reports as `degraded`.
 */
function overallStatus(results) {
  const required = results.filter(function (r) { return r.required; });
  if (required.length === 0) return 'healthy';

  const down = required.filter(function (r) { return r.status === 'unhealthy'; }).length;
  const stale = required.filter(function (r) { return r.status === 'stale'; }).length;
  const reachable = required.length - down;

  if (down === 0 && stale === 0) return 'healthy';
  if (down === 0) return 'stale';
  if (reachable >= Math.ceil(required.length / 2)) return 'degraded';
  return 'unhealthy';
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
  const now = new Date();

  const results = await Promise.all(registry.CHECKS.map(function (check) {
    return withBudget(runCheck(check, now), check, OVERALL_BUDGET_MS, startTime);
  }));

  const healthy = results.filter(function (r) { return r.status === 'healthy'; }).length;
  const staleCount = results.filter(function (r) { return r.status === 'stale'; }).length;
  const requiredResults = results.filter(function (r) { return r.required; });
  const requiredHealthy = requiredResults.filter(function (r) { return r.status === 'healthy'; }).length;
  const requiredTotal = requiredResults.length;
  const optionalResults = results.filter(function (r) { return !r.required; });
  const optionalHealthy = optionalResults.filter(function (r) { return r.status === 'healthy'; }).length;

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({
      status: overallStatus(results),
      version: '0.4.0',
      phase: 'Phase 3 — Deep Latvia',
      uptime: 'Azure Static Web Apps (managed)',
      dataSources: {
        healthy: healthy,
        stale: staleCount,
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

module.exports.overallStatus = overallStatus;
module.exports.newsroomObservation = newsroomObservation;
module.exports.probe = probe;
