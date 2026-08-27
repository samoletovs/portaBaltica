const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');
const cache = require('../shared/cache.js');

/**
 * GET /api/live-grid
 *
 * The physical state of the Estonian power system: what is being generated,
 * what is being consumed, how much of it is renewable, and whether the country
 * is importing or exporting — plus the transmission operator's own forecast for
 * the hours ahead.
 *
 * **This is Estonia, not the Baltics, and the endpoint says so in every
 * response.** Elering is the Estonian TSO and `/api/system/with-plan` is its
 * own system. The numbers make that unmistakable once you look: consumption
 * runs 670–870 MW, where the three Baltic states together draw three to four
 * gigawatts. Serving it as a regional figure would be the same failure as
 * "Latvian sea passengers" turning out to mean Ventspils.
 *
 * It is worth having anyway, and next to the price card in particular. The four
 * Nord Pool bidding zones are coupled, so Estonian scarcity is one of the
 * things that moves a Latvian price — and this is the only free, real-time,
 * physical measurement available anywhere on the site. Everything else the
 * dashboard draws is a statistical release published quarters in arrears.
 *
 * Three things about the source that the response has to be honest about:
 *
 *   1. **It is not "now".** Metering lags: the newest actual observed while
 *      building this was 81 minutes behind the wall clock. The response reports
 *      the timestamp of the newest reading and how far behind it is, so the UI
 *      can date it rather than implying a live feed.
 *   2. **`frequency` is nominal.** Every row returns exactly 50, in every
 *      sample taken. It is a constant, not a measurement, and showing it as
 *      live telemetry would be inventing a signal. It is dropped here.
 *   3. **`solar_energy_production` is empty on actuals.** Solar appears only in
 *      the forecast, so actual solar output is not reported and this endpoint
 *      does not pretend otherwise.
 *
 * `system_balance` is verified as production minus consumption, to the second
 * decimal, across every sampled row — so a negative balance is a net import.
 * `ac_balance` is *not* net import: it read 429–653 MW while the country was
 * short by 160–280 MW, because Estonia's link to Finland is DC and sits outside
 * it. Its convention is not documented anywhere we can check, so it is not
 * served rather than served with a guess at what it means.
 */

const ELERING_SYSTEM = 'https://dashboard.elering.ee/api/system/with-plan';

/** Hours of history to request. Enough to show a shape, small enough to be cheap. */
const WINDOW_HOURS = 12;

/**
 * The source refreshes every fifteen minutes and lags over an hour, so asking
 * more often than this cannot produce a newer number. Elering also sits behind
 * a Cloudflare tier that returns bursts of HTTP 503 — measured, several times —
 * which the grace window rides out.
 */
const TTL_MS = 5 * 60 * 1000;
const GRACE_MS = 30 * 60 * 1000;

const CACHE_SECONDS = 5 * 60;

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One metered or forecast interval, with only the fields we can stand behind. */
function point(row, kind) {
  const production = num(row.production);
  const consumption = num(row.consumption);
  const renewable = num(row.production_renewable);
  return {
    time: new Date(row.timestamp * 1000).toISOString(),
    kind: kind,
    production: production,
    consumption: consumption,
    renewable: renewable,
    // Recomputed rather than read: `system_balance` agrees to the second
    // decimal on every sampled row, and deriving it means the sign convention
    // is ours and stated rather than assumed from an undocumented field.
    balance: production !== null && consumption !== null
      ? +(production - consumption).toFixed(2)
      : null,
    renewableShare: production !== null && renewable !== null && production > 0
      ? +((renewable / production) * 100).toFixed(1)
      : null,
  };
}

function newestWithProduction(points) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].production !== null && points[i].consumption !== null) return points[i];
  }
  return null;
}

module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_HOURS * 3600 * 1000);
  const url = ELERING_SYSTEM +
    '?start=' + encodeURIComponent(start.toISOString()) +
    '&end=' + encodeURIComponent(end.toISOString());

  try {
    const result = await cache.memo(
      // Keyed on the request, with the sliding window declared as the only
      // thing deliberately left out: `start` and `end` move on every call, so
      // keying on them would mean never reading the cache. Should this endpoint
      // ever take a parameter that selects *what* is fetched — an area, say —
      // it lands in the key automatically instead of quietly serving Estonia's
      // numbers under another country's name.
      cache.requestKey('live-grid', url, ['start', 'end']),
      TTL_MS, GRACE_MS, function () {
        return es.httpJson(url, { deadlineMs: 8000, retries: 1 });
      });

    const payload = result.value;
    // `data` is an object with `real` and `plan`, not an array of one. A shell
    // that auto-wraps a single object into a collection made it look like an
    // array during exploration, and indexing it as one silently yields nothing.
    const block = (payload && payload.data) || {};
    const actual = Array.isArray(block.real) ? block.real.map(function (r) { return point(r, 'actual'); }) : [];
    const forecast = Array.isArray(block.plan) ? block.plan.map(function (r) { return point(r, 'forecast'); }) : [];

    const latest = newestWithProduction(actual);
    const meteredTo = latest ? latest.time : null;
    const minutesBehind = meteredTo
      ? Math.max(0, Math.round((Date.now() - Date.parse(meteredTo)) / 60000))
      : null;

    // Forecast intervals that are still ahead of the newest actual, so the two
    // series meet rather than overlap.
    const ahead = meteredTo
      ? forecast.filter(function (p) { return p.time > meteredTo; })
      : forecast;

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=' + CACHE_SECONDS,
      },
      body: JSON.stringify({
        // Stated in the payload, not just in the UI, so no consumer can mistake
        // this for a Baltic aggregate.
        area: 'EE',
        areaLabel: 'Estonia',
        operator: 'Elering (Estonian transmission system operator)',
        unit: 'MW',
        latest: latest,
        meteredTo: meteredTo,
        minutesBehind: minutesBehind,
        actual: actual,
        forecast: ahead,
        // True when the answer came from cache after a failed fetch, so the UI
        // can say when we last got through instead of implying a live read.
        servedFromCache: result.cached === true,
        readAgoMs: result.ageMs,
        source: 'Elering system data (with-plan)',
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, source: 'Elering system data (with-plan)' }),
    };
  }
};
