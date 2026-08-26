const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');
const cubeHealth = require('../shared/cubeHealth.js');
const freshness = require('../shared/freshness.js');
const registry = require('../shared/statusChecks.js');
const cache = require('../shared/cache.js');

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

/**
 * How long an Open-Meteo answer stands, and how long it stands once fetches
 * start failing.
 *
 * Five minutes against a source that publishes hourly is still twelve times
 * more often than the data can change, so nothing is lost and the call volume
 * falls by more than an order of magnitude. Twenty-five minutes of grace means
 * a genuine outage surfaces inside half an hour, while the throttle-induced
 * hangs — which come in bursts of seconds — never surface at all, because they
 * are not news about the weather.
 */
const OPEN_METEO_TTL_MS = 5 * 60 * 1000;
const OPEN_METEO_GRACE_MS = 25 * 60 * 1000;

function httpOptions(check) {
  return {
    deadlineMs: (check && check.deadlineMs) || PROBE_DEADLINE_MS,
    retries: PROBE_RETRIES,
  };
}

/**
 * What the newsroom's run report says about itself.
 *
 * Built against the contract in PR #82. Three things it reports matter here and
 * they are not the same question:
 *
 *   - **`finished_at`** — did a run happen recently. Judged against the
 *     report's own `stale_after_hours` rather than a cron copied into our
 *     registry, because the schedule moved from one run a day to three the
 *     moment that PR merged and a hardcoded bound would silently have gone
 *     wrong.
 *
 *   - **`original_articles.generated` against `.publishable`** — did the run
 *     produce anything. This is the field that exists because of 25 Aug, when
 *     every tier A article was rejected and a single syndicated wire card went
 *     out: `counts.published` was 1, which was true, and a probe reading it
 *     would have gone green on the worst day the newsroom has had. Writing
 *     articles and shipping none of them is a failure; writing none because
 *     nothing was newsworthy is an ordinary quiet day, and only the split can
 *     tell them apart.
 *
 *   - **`attempts_total`** — carried through untouched. It is the number that
 *     shows whether the yield fix is working, and it belongs where someone will
 *     see it.
 *
 * Defensive throughout: a half-written report must degrade to "cannot tell"
 * rather than throw and take the status page down with it.
 */
function newsroomObservation(body) {
  if (!body || typeof body !== 'object') return null;

  const at = body.finished_at || body.finishedAt || body.completedAt;
  if (!at) return null;

  const originals = (body.original_articles && typeof body.original_articles === 'object')
    ? body.original_articles
    : {};
  const counts = (body.counts && typeof body.counts === 'object') ? body.counts : {};
  const liveness = (body.liveness && typeof body.liveness === 'object') ? body.liveness : {};

  const generated = numberOr(originals.generated, null);
  const publishable = numberOr(originals.publishable, null);
  const declaredMaxLag = numberOr(body.stale_after_hours, null);

  const observation = {
    at: at,
    generated: generated,
    publishable: publishable,
    attemptsTotal: numberOr(originals.attempts_total, null),
    published: numberOr(counts.published, null),
    rejected: numberOr(counts.rejected, null),
    errors: numberOr(counts.errors, null),
    trigger: body.trigger || null,
    schedule: body.schedule || null,
    runsWithoutOriginals: numberOr(liveness.runs_without_originals, null),
  };

  // Hours, matching the declared cadence. The report's own threshold beats
  // ours, and `freshness.judge` prefers it when present.
  if (declaredMaxLag !== null) observation.maxLag = declaredMaxLag;

  // Ran, wrote, shipped nothing. The timestamp is current and the wire is not
  // advancing, which is precisely what `stale` means here: the pipeline being
  // up and the pipeline being productive are different facts.
  if (generated !== null && publishable !== null && generated > 0 && publishable === 0) {
    observation.stale = true;
    observation.staleReason = 'Wrote ' + generated + ' original article' +
      (generated === 1 ? '' : 's') + ' and published none of them';
  }

  return observation;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
    const xml = await es.httpText(check.url, httpOptions(check));
    const hasEnvelope = /<\s*(?:\w+:)?Envelope\b/i.test(xml);
    const hasCube = /<\s*(?:\w+:)?Cube\b/i.test(xml);
    if (!hasEnvelope || !hasCube) throw new Error('ECB XML missing required elements (envelope and/or cube)');
    return freshness.extract.ecbXml(xml);
  }

  if (check.type === 'ckan') {
    const body = await es.httpJson(check.url, httpOptions(check));
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
          httpOptions(check),
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
    const body = await es.httpJson(check.url, httpOptions(check));
    const observation = cubeHealth.newestObservation(body, check.cubeKey);
    if (observation === null) throw new Error('Cube answered but carries no observation');
    return observation;
  }

  if (check.type === 'elering') {
    const body = await es.httpJson(check.url, httpOptions(check));
    if (body && body.success === false) throw new Error('Elering reported failure');
    const observation = freshness.extract.elering(body);
    if (observation === null) throw new Error('Elering answered with no priced intervals');
    return observation;
  }

  if (check.type === 'open-meteo') {
    // Cached, because Open-Meteo publishes hourly and the shared Azure egress
    // address is being throttled. See `shared/cache.js` for the measurements;
    // the short version is that half of all calls from here hang for the full
    // deadline, a quarter hang twice, and asking an hourly source for fresh
    // data several times a minute is a large part of the reason.
    const result = await cache.memo(
      'open-meteo:' + check.url,
      OPEN_METEO_TTL_MS,
      OPEN_METEO_GRACE_MS,
      async function () {
        const body = await es.httpJson(check.url, httpOptions(check));
        if (!body || !body.current) throw new Error('Open-Meteo answered without a current reading');
        return freshness.extract.openMeteo(body);
      },
    );

    if (result.value) {
      // Reported so the flakiness appears on the page as information rather
      // than as an outage. A reader can see we last got through four minutes
      // ago and judge that for themselves.
      result.value.viaCache = result.cached;
      result.value.cacheAgeMs = result.ageMs;
      if (result.servedAfterFailure) result.value.lastFetchError = result.error;
    }
    return result.value;
  }

  if (check.type === 'pxweb-metadata') {
    const body = await es.httpJson(check.url, httpOptions(check));
    if (!body || !Array.isArray(body.variables)) throw new Error('PxWeb answered without table metadata');
    return freshness.extract.pxwebMetadata(body);
  }

  if (check.type === 'newsroom-run') {
    // A 404 is not a fault in the way a 500 is: it means no run has yet
    // written a report. That is a true and useful statement about the wire —
    // it is not advancing — so it reports `stale` rather than claiming the
    // site is broken. It also needs no follow-up: the check corrects itself
    // the moment the first report lands, instead of waiting on someone to
    // remember to flip a flag.
    let body;
    try {
      body = await es.httpJson(check.url, httpOptions(check));
    } catch (err) {
      if (/HTTP 404/.test(err.message)) {
        return {
          stale: true,
          staleReason: 'No run report has been written yet',
        };
      }
      throw err;
    }
    const observation = newsroomObservation(body);
    if (observation === null) throw new Error('Run report carries no completion time');
    return observation;
  }

  if (check.type === 'text') {
    const text = await es.httpText(check.url, httpOptions(check));
    if (!text || text.length === 0) throw new Error('Empty response');
    return null;
  }

  await es.httpJson(check.url, httpOptions(check));
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

    // A source answered through the cache is still answering, but a reader is
    // entitled to know when we last actually reached it — especially for
    // Open-Meteo, where getting through is the unreliable part rather than the
    // data being wrong.
    if (observation && observation.viaCache) {
      result.readAgoMs = observation.cacheAgeMs;
      if (observation.lastFetchError) result.lastFetchError = observation.lastFetchError;
    }

    // The newsroom's own numbers, carried through so the page shows whether
    // the wire is producing rather than merely running. `attemptsTotal` is the
    // one that says whether the yield fix is working.
    if (observation && observation.generated !== undefined) {
      result.newsroom = {
        generated: observation.generated,
        publishable: observation.publishable,
        attemptsTotal: observation.attemptsTotal,
        published: observation.published,
        rejected: observation.rejected,
        errors: observation.errors,
        runsWithoutOriginals: observation.runsWithoutOriginals,
        trigger: observation.trigger,
        schedule: observation.schedule,
      };
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
  '/api/live-grid', '/api/port-data', '/api/business-search', '/api/eu-funds',
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
