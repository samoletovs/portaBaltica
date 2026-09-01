const es = require('../shared/eurostat.js');
const cubeHealth = require('../shared/cubeHealth.js');
const freshness = require('../shared/freshness.js');
const registry = require('../shared/statusChecks.js');
const cache = require('../shared/cache.js');
const ckan = require('../shared/ckan.js');
const trade = require('../shared/tradeStats.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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

/**
 * How long a reader waits for a source that cannot change the answer.
 *
 * `overallStatus` reads only the required checks, so an optional probe's result
 * is, by construction, incapable of altering the verdict. Riga Open Data is the
 * limiting case: it is `required: false` and it `powers` nothing at all, being
 * retained purely so that we notice if it ever recovers. Measured against
 * production it hung for 6202ms on eight consecutive requests and was the whole
 * of a 6206ms page, while every other probe answered inside a few hundred
 * milliseconds. The endpoint whose job is to report health was the slowest
 * thing on the site, and it was slow for a datum that changes nothing.
 *
 * So an optional probe now gets a short slice of the reader's time and no more.
 * It is not cancelled — it runs on with its full deadline and files its result
 * in the cache — so the next caller gets the real answer at no cost, and a
 * recovery still surfaces. Only the waiting is removed.
 *
 * A budget of 750ms is comfortably above every healthy latency on the board
 * (16–63ms for Open-Meteo, 21–500ms for the cubes, 351ms for PxWeb metadata),
 * so a source that is actually working still answers inside it on the first
 * request and is never reported as pending.
 */
const OPTIONAL_RESPONSE_BUDGET_MS = 750;

/**
 * How long a completed optional probe stands before it is run again.
 *
 * The same five minutes Open-Meteo uses, for the same reason: it bounds how
 * long a recovery can go unnoticed while cutting the call volume by more than
 * an order of magnitude. The measured process lifetime supports it — the
 * Open-Meteo entry was observed climbing monotonically from 118s to 170s of age
 * across eight requests, so the cache demonstrably survives between calls on
 * the deployed app rather than being cold every time.
 */
const OPTIONAL_RESULT_TTL_MS = 5 * 60 * 1000;

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

    // Liveness is not availability. `status_show` answering says the portal is
    // up; it says nothing about `datastore_search`, which is the action four of
    // our endpoints actually read through. `site_read` was removed from this
    // portal while everything else kept answering, so this is the documented
    // failure mode rather than a hypothetical one.
    if (check.datastoreUrl) {
      const data = await es.httpJson(check.datastoreUrl, httpOptions(check));
      if (!data || data.success !== true) {
        throw new Error('CKAN datastore_search unavailable: ' +
          JSON.stringify((data && (data.error || data)) || 'no body').slice(0, 120));
      }
      const result = data.result || {};
      if (!Array.isArray(result.fields) || result.fields.length === 0) {
        throw new Error('CKAN datastore_search answered without a field schema');
      }
      // A datastore emptied by a failed ingestion answers perfectly well with
      // nothing in it — the same shape as the header-only maritime CSVs.
      if (typeof result.total === 'number' && result.total === 0) {
        throw new Error('CKAN datastore_search answered with an empty datastore');
      }
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

  if (check.type === 'ckan-trade-sql') {
    // Two steps, both of them the ones `/api/trade-partners` takes, using the
    // endpoint's own builder rather than a URL restated in the registry.
    const pkgBody = await es.httpJson(
      ckan.buildUrl('package_show', { id: check.dataset }),
      httpOptions(check),
    );
    // The portal answers HTTP 200 with success:false for an unknown action, so
    // the status code is not the thing to check.
    if (!pkgBody || pkgBody.success !== true) {
      throw new Error('CKAN package_show failed for ' + check.dataset);
    }

    const picked = ckan.pickLatestActive(pkgBody.result, check.namePrefix, 1);
    if (picked.length === 0) {
      throw new Error('No datastore-active resource named ' + check.namePrefix + '* in ' + check.dataset);
    }

    const body = await es.httpJson(
      trade.sqlUrl(trade.newestPeriodSql(picked[0].id)),
      httpOptions(check),
    );
    if (!body || body.success !== true) {
      throw new Error('CKAN datastore_search_sql unavailable: ' +
        JSON.stringify((body && (body.error || body)) || 'no body').slice(0, 120));
    }

    const records = (body.result && body.result.records) || [];
    const key = trade.num(records[0] && records[0].period_key);
    const period = key === null ? null : trade.periodLabel(key);
    // A resource that answers with no readable month is a fault, not a
    // staleness question — the header-only-CSV shape. Staleness is judged
    // afterwards, against the cadence the check declares.
    if (period === null) {
      throw new Error('CN-8 resource answered but carries no readable month');
    }
    return { period: period };
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

  if (check.type === 'elering-system') {
    const body = await es.httpJson(check.url, httpOptions(check));
    if (body && body.success === false) throw new Error('Elering reported failure');
    // Actuals only. `data.plan` runs into the future — measured 178 minutes
    // ahead while `data.real` was 77 minutes behind — so reading the newest row
    // of the whole payload would make this a probe that can never go stale.
    const observation = freshness.extract.eleringMetered(body);
    if (observation === null) {
      throw new Error('Elering answered with no metered production intervals');
    }
    return observation;
  }

  if (check.type === 'open-meteo') {
    // Cached, because Open-Meteo publishes hourly and the shared Azure egress
    // address is being throttled. See `shared/cache.js` for the measurements;
    // the short version is that half of all calls from here hang for the full
    // deadline, a quarter hang twice, and asking an hourly source for fresh
    // data several times a minute is a large part of the reason.
    const result = await cache.memo(
      cache.requestKey('open-meteo', check.url),
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
 * Run an optional check without making the reader wait for it.
 *
 * The probe is started, filed in the cache when it finishes, and raced against
 * a short budget. Three outcomes, and each is a different thing to say:
 *
 *   - it answered in time — reported exactly as a required check would be;
 *   - it had already answered recently — served from the cache, with the age of
 *     that answer attached, because "healthy as of four minutes ago" is a
 *     different claim from "healthy just now";
 *   - it is still running — reported as `pending`, which is neither `healthy`
 *     (a lie) nor `unhealthy` (a claim about the source we have not earned).
 *
 * The outcome is cached whether the probe succeeded or failed, because a
 * failure is exactly as much worth remembering as a success — and because a
 * cache that only remembers successes would leave a permanently broken source
 * costing the budget on every single request, which is the situation this
 * exists to end.
 *
 * `runner` exists so the race can be exercised without a network. It is a real
 * seam rather than a test hook: the thing under test here is the timing rule,
 * and pointing a probe at an unreachable host does not produce a hang — DNS
 * refuses `.invalid` in microseconds, which is how an earlier version of this
 * test passed while proving nothing.
 */
function runOptionalCheck(check, now, startedAt, runner) {
  const run = runner || runCheck;
  const key = cache.requestKey('status-optional', check.url || check.name);

  // The fetcher deliberately never rejects: `memo` only stores what resolves,
  // and the failure is the thing we most need to stop re-paying for.
  const settled = cache.memo(key, OPTIONAL_RESULT_TTL_MS, OPTIONAL_RESULT_TTL_MS, function () {
    return Promise.resolve(run(check, now));
  });

  // The race below may walk away from this promise. Without a catch, a rejection
  // arriving afterwards is an unhandled rejection, which on some hosts takes the
  // worker down — a status endpoint that crashes the process is worse than a
  // slow one.
  settled.catch(function () { /* recorded by the outcome shape, not by throwing */ });

  return Promise.race([
    settled.then(function (hit) {
      const result = Object.assign({}, hit.value);
      // Two different ages, deliberately not merged: `readAgoMs` is when we last
      // reached the *source*, `checkedAgoMs` is when we last ran this *probe*.
      if (hit.cached && hit.ageMs > 0) result.checkedAgoMs = hit.ageMs;
      return result;
    }).catch(function (e) {
      return {
        name: check.name,
        status: 'unhealthy',
        freshness: 'unknown',
        latency: Date.now() - startedAt,
        required: check.required,
        powers: check.powers,
        note: check.note,
        error: (e && e.message) || String(e),
      };
    }),
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          name: check.name,
          status: 'pending',
          freshness: 'unknown',
          latency: Date.now() - startedAt,
          required: check.required,
          powers: check.powers,
          note: check.note,
          pendingReason: 'Optional source did not answer within ' +
            OPTIONAL_RESPONSE_BUDGET_MS + 'ms; still being checked, and the ' +
            'result will show on the next request. It cannot affect the ' +
            'overall status.',
        });
      }, OPTIONAL_RESPONSE_BUDGET_MS);
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

/**
 * Route one check according to whether its answer can change the verdict.
 *
 * Separated from the handler so the routing itself is testable. A required
 * probe's answer *is* the verdict, so the page waits for it up to the overall
 * budget. An optional one is discarded by `overallStatus` no matter what it
 * says, so it gets a short slice of the reader's time and no more.
 */
function runRegistryCheck(check, now, startedAt, runner) {
  const run = runner || runCheck;
  if (!check.required) return runOptionalCheck(check, now, startedAt, run);
  return withBudget(run(check, now), check, OVERALL_BUDGET_MS, startedAt);
}
const API_ENDPOINTS = [
  '/api/baltic-compare', '/api/historical-data', '/api/economy-data',
  '/api/property-data', '/api/environment-data', '/api/power-prices',
  '/api/live-grid', '/api/port-data', '/api/business-search', '/api/eu-funds',
  '/api/address-search', '/api/ai-insights', '/api/system-status',
];

/**
 * Traffic counts, published hourly by `.github/workflows/visit-stats.yml`.
 *
 * The counts are read from a public blob rather than measured here, because
 * this app cannot measure them: the Static Web App is Free tier and has no
 * managed identity, and its storage account disables shared keys, so a Function
 * has no durable place to keep a tally. Anything counted in process memory
 * would reset on every cold start and quietly under-report. Azure Monitor
 * already records the traffic for 93 days, so the workflow reduces it to four
 * integers and leaves them somewhere credential-free to read.
 *
 * This is the same arrangement `shared/newsroom.js` uses for finished articles:
 * public JSON, fetched over plain HTTPS, no key anywhere.
 */
const VISIT_STATS_URL = process.env.VISIT_STATS_URL ||
  'https://stportabalticabpmff5so.blob.core.windows.net/stats/visits.json';

// The blob is rewritten hourly, so asking more often than that cannot produce a
// new answer. The grace window is deliberately much longer than the TTL: if the
// blob is briefly unreachable the last good counts still stand, and the panel
// simply omits the figure rather than showing a zero.
const VISIT_STATS_TTL_MS = 10 * 60 * 1000;
const VISIT_STATS_GRACE_MS = 6 * 60 * 60 * 1000;

// Short next to the page's own budget. This is a decorative figure on a status
// panel: it must never be the reason a reader waits for the health of the site.
const VISIT_STATS_DEADLINE_MS = 2000;

/**
 * Fetch the published counts, or return null.
 *
 * Null is a first-class answer here and the caller omits the block entirely
 * when it gets one. The alternative — substituting zeros — would render as
 * "no traffic today", which is a claim about the world rather than an admission
 * that we could not read a file.
 */
async function visitStats(now) {
  try {
    const hit = await cache.memo(
      'visit-stats|' + VISIT_STATS_URL,
      VISIT_STATS_TTL_MS,
      VISIT_STATS_GRACE_MS,
      function () {
        return es.httpJson(VISIT_STATS_URL, { deadlineMs: VISIT_STATS_DEADLINE_MS });
      },
      now
    );

    const stats = hit.value;
    if (!stats || typeof stats.today !== 'number') return null;

    return {
      // Named for what Azure Monitor actually counts. `SiteHits` is every HTTP
      // request the SWA serves, and a single-page app serves a dozen or more per
      // arrival, so this is request volume and not a headcount. The unit travels
      // with the payload so no consumer has to remember.
      unit: stats.unit || 'requests',
      metric: stats.metric || 'SiteHits',
      today: stats.today,
      last7Days: stats.last7Days,
      last30Days: stats.last30Days,
      dailyAverage30d: stats.dailyAverage30d,
      timezone: stats.timezone || 'Europe/Riga',
      generatedAt: stats.generatedAt || null,
      // How old the figure is, so the panel can say "an hour ago" rather than
      // implying it is live.
      ageMs: hit.ageMs,
    };
  } catch (e) {
    return null;
  }
}

const handler = async function (context, req) {
  const startTime = Date.now();
  const now = new Date();

  // Fetched alongside the probes rather than after them: this is a small,
  // independent read and it must not add its latency to the page's.
  const [results, visits] = await Promise.all([
    Promise.all(registry.CHECKS.map(function (check) {
      return runRegistryCheck(check, now, startTime);
    })),
    visitStats(startTime),
  ]);

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
        // `subscribers: { free: 0, pro: 0, enterprise: 0 }` was served here and
        // is gone. There is no subscriber system, so those zeros were never
        // counted — and a zero that was never measured is indistinguishable
        // from one that was. The sibling two keys below already says the same
        // thing in words that cannot be mistaken for an observation, and
        // `traffic` immediately after is the pattern: it is omitted entirely
        // when the counts cannot be read, because "no row" and "no traffic"
        // must not render alike.
        revenue: '€0 (pre-monetization)',
        status: 'Phase 3 — building value before monetization',
      },
      // Omitted entirely when the published counts could not be read. An absent
      // key renders as no row; a zero would render as "no traffic".
      traffic: visits,
      respondedIn: Date.now() - startTime + 'ms',
      fetchedAt: new Date().toISOString(),
    }),
  };
};

module.exports = withSecurity(withCache(handler, {
  name: 'system-status',
  keyOn: [],
  ttlMs: 60000,
  graceMs: 0,
  staleWhileRevalidate: false,
}));
module.exports.overallStatus = overallStatus;
module.exports.newsroomObservation = newsroomObservation;
module.exports.probe = probe;
module.exports.runOptionalCheck = runOptionalCheck;
module.exports.runRegistryCheck = runRegistryCheck;
module.exports.visitStats = visitStats;
module.exports.OPTIONAL_RESPONSE_BUDGET_MS = OPTIONAL_RESPONSE_BUDGET_MS;
module.exports.OPTIONAL_RESULT_TTL_MS = OPTIONAL_RESULT_TTL_MS;
