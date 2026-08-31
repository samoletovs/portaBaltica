const es = require('../shared/eurostat.js');
const cache = require('../shared/cache.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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
 *   3. **`solar_energy_production` runs on a slower clock than the rest of the
 *      row.** This endpoint used to state that the field "is empty on actuals",
 *      and that was an artefact of the probe: it requested twelve hours, solar
 *      is filed a day at a time, and at midday every row inside twelve hours is
 *      legitimately null. Measured over 763 readings across eight days it is
 *      94.2% populated, with all 44 nulls in ONE unbroken run at the newest end
 *      and nothing missing beyond 12.3 hours old. So the response reports solar
 *      per interval, and reports the renewable share with its own timestamp and
 *      lag rather than attaching a half-day-old figure to `meteredTo`.
 *
 * `system_balance` is verified as production minus consumption, to the second
 * decimal, across every sampled row — so a negative balance is a net import.
 * `ac_balance` is *not* net import: it read 429–653 MW while the country was
 * short by 160–280 MW, because Estonia's link to Finland is DC and sits outside
 * it. Its convention is not documented anywhere we can check, so it is not
 * served rather than served with a guess at what it means.
 */

const ELERING_SYSTEM = 'https://dashboard.elering.ee/api/system/with-plan';

/** Hours of history to plot. Enough to show a shape, small enough to be cheap. */
const WINDOW_HOURS = 12;

/**
 * Hours of history to REQUEST, which is longer than the window we plot.
 *
 * Solar is filed a day at a time, so at midday the newest solar reading is
 * around twelve hours old — just outside a twelve-hour request. That is how
 * this endpoint came to state, in its own docstring, that solar "is empty on
 * actuals": the sample window was shorter than the publication lag, so every
 * row in it was legitimately null and the field looked dead. Measured over an
 * eight-day window it is 94.2% populated, with the 44 nulls in one unbroken run
 * at the newest end.
 *
 * Thirty-six hours clears a full day's lag with margin, costs one request
 * rather than two, and does not change what is plotted: `actual` is still
 * trimmed to WINDOW_HOURS.
 */
const REQUEST_HOURS = 36;

/**
 * The source refreshes every fifteen minutes and lags over an hour, so asking
 * more often than this cannot produce a newer number. Elering also sits behind
 * a Cloudflare tier that returns bursts of HTTP 503 — measured, several times —
 * which the grace window rides out.
 */
const TTL_MS = 5 * 60 * 1000;
const GRACE_MS = 30 * 60 * 1000;

// Derived, not restated. `withCache` below takes the same two windows, and both
// were written out again there as `300000` and `1800000` — the same facts in
// two enumerations, agreeing only because someone typed matching digits.
//
// That drift was already unobservable. Setting `GRACE_MS` to zero and running
// the outage tests changed nothing a reader would see, because the literal in
// the `withCache` options still granted the full thirty minutes: the constant
// named for the grace window did not control the grace window.
const CACHE_SECONDS = TTL_MS / 1000;

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One metered or forecast interval, with only the fields we can stand behind.
 *
 * WHAT ELERING SENDS AND WHAT WE TAKE. The feed carries nine fields per row and
 * this reads five. The four it leaves are left deliberately, measured over 668
 * readings across seven days:
 *
 *   losses                   0% populated. Nothing to read.
 *   frequency                100% populated, ONE distinct value (50.0) across
 *                            every reading. Fully populated and carrying no
 *                            information, which is not the same as missing.
 *   ac_balance               100% populated and genuinely varying, but it
 *                            shares a sign with `system_balance` in only 44 of
 *                            668 rows, so it is not the interconnector share of
 *                            the balance or any other reading we could state.
 *                            Undocumented and unresolved: not published rather
 *                            than published with a guessed meaning.
 *   solar_energy_production  now read. See below.
 */
function point(row, kind) {
  const production = num(row.production);
  const consumption = num(row.consumption);
  const renewable = num(row.production_renewable);
  const solar = num(row.solar_energy_production);
  // `production_renewable` EXCLUDES solar, and `production` includes it.
  //
  // That is measured, not assumed, because the field names imply the opposite
  // and reading them the obvious way is what shipped a wrong number. Over 668
  // readings:
  //
  //   solar exceeds production_renewable in 331 of 668 rows, and a component
  //     cannot exceed its total;
  //   production averages 698 MW when solar is highest against 348 MW when
  //     solar is near zero — it doubles, so solar is inside it;
  //   production minus solar is never negative, in 624 of 624 rows;
  //   production_renewable averages just 39.5 MW when solar is at its highest,
  //     where a solar-inclusive figure would be near 570.
  //
  // So the renewable total is renewable + solar, and dividing the
  // solar-EXCLUDING numerator by the solar-INCLUDING denominator — which is
  // what this did — understated the share by a mean of 28.4 percentage points
  // and a maximum of 95.8. At 11:30 on 2026-08-26 it reported 1.6% while solar
  // alone was 601.7 MW of 666.0 MW generated.
  const renewableTotal = renewable !== null && solar !== null
    ? renewable + solar
    : null;
  return {
    time: new Date(row.timestamp * 1000).toISOString(),
    kind: kind,
    production: production,
    consumption: consumption,
    renewable: renewable,
    // Reported separately as well as folded into the share, because it is the
    // larger half of Estonian renewable generation for most of a summer day
    // and the reader cannot recover it from a percentage.
    solar: solar,
    // Recomputed rather than read. `system_balance` tracks production minus
    // consumption closely but NOT exactly — measured across 668 rows the two
    // differ by a mean of 0.31 MW and a maximum of 4.72 — so deriving it means
    // the sign convention and the arithmetic are both ours and stated, rather
    // than assumed from an undocumented field that does not quite agree.
    balance: production !== null && consumption !== null
      ? +(production - consumption).toFixed(2)
      : null,
    renewableShare: renewableShare(production, renewableTotal),
  };
}

/**
 * Renewable generation as a percentage of all generation, or null.
 *
 * Null in two cases, both deliberate. Solar is absent from 6.6% of readings and
 * those gaps are NOT night — measured, they fall in a contiguous stretch across
 * hours a reader would expect sun — so treating an absent solar reading as zero
 * would print a confident, badly understated number. And a total above
 * generation is internally inconsistent: it happened in 1 of 624 rows, where
 * solar rose while production fell between two neighbours that both agree, so
 * it is a single-interval metering artefact. Clamping it to 100 would publish a
 * certainty the reading does not support.
 */
function renewableShare(production, renewableTotal) {
  if (production === null || renewableTotal === null || production <= 0) return null;
  if (renewableTotal > production) return null;
  return +((renewableTotal / production) * 100).toFixed(1);
}

function newestWithProduction(points) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].production !== null && points[i].consumption !== null) return points[i];
  }
  return null;
}

/**
 * The newest interval whose renewable share is actually known.
 *
 * Solar is metered on a SLOWER CLOCK than the rest of the row, so this is not
 * the same instant as `latest` and must not be stamped with its time. Measured
 * over 763 readings across eight days: 44 nulls, in ONE unbroken run at the
 * newest end, nothing missing beyond 12.3 hours old. The run begins at the
 * first interval of the Estonian local day and the last populated reading is
 * the local day's final interval — so solar is filed a day at a time, and the
 * renewable share is never current, by construction rather than by outage.
 *
 * That is why the share is reported with its own boundary instead of being
 * attached to `latest`: a 12-hour-old figure printed under a 77-minute-old
 * timestamp is the same fault as reading a forecast as a reading.
 */
function newestWithRenewableShare(points) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].renewableShare !== null) return points[i];
  }
  return null;
}

const handler = async function (context, req) {
  const end = new Date();
  const start = new Date(end.getTime() - REQUEST_HOURS * 3600 * 1000);
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
    const fetched = Array.isArray(block.real) ? block.real.map(function (r) { return point(r, 'actual'); }) : [];
    const forecast = Array.isArray(block.plan) ? block.plan.map(function (r) { return point(r, 'forecast'); }) : [];

    // Plot the recent window. The rest of the request exists only so the
    // renewable share is reachable behind solar's publication lag, and serving
    // it would silently triple the chart's x-range.
    const plotFrom = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
    const actual = fetched.filter(function (p) { return p.time >= plotFrom; });

    const latest = newestWithProduction(actual);
    const meteredTo = latest ? latest.time : null;

    // Reported separately because solar arrives on a slower clock, so this is
    // routinely half a day older than `meteredTo`. Null rather than absent when
    // no interval in the window has a share, so a consumer reading `.share`
    // gets an absent reading rather than a TypeError.
    //
    // Both this and `meteredTo` are ABSOLUTE INSTANTS, and neither is
    // accompanied by an age any more. `minutesBehind` was served on both and is
    // gone for the same reason `readAgoMs` was: an age is computed against
    // `Date.now()` when the body is BUILT, and `withCache` then serves that body
    // for its whole TTL — so the number is wrong for every reader after the
    // first. Measured on production, six requests inside one TTL:
    //
    //   Age  561s  minutesBehind 72     <- body built when the lag was 72
    //   Age   20s  minutesBehind 81     <- rebuilt; the truth had moved on
    //   Age  101s  minutesBehind 81     <- frozen again for the next five minutes
    //
    // The browser then caches on top of that, so the error compounds. An age is
    // a fact about when it is READ; only the instant is a fact about the data.
    // Consumers subtract from `time` themselves, which cannot go stale.
    const renewablePoint = newestWithRenewableShare(fetched);
    const renewableLatest = {
      share: renewablePoint ? renewablePoint.renewableShare : null,
      time: renewablePoint ? renewablePoint.time : null,
    };

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
        // The renewable share and the time it belongs to. `latest.renewableShare`
        // is the share AT `meteredTo`, which is usually null because solar has
        // not been filed for that interval yet; this is the newest one we can
        // actually stand behind, carrying its own age so it is never mistaken
        // for a current reading.
        renewableLatest: renewableLatest,
        actual: actual,
        forecast: ahead,
        // `servedFromCache` and `readAgoMs` were served here and are gone, and
        // not merely because nothing read them: they were WRONG for the one
        // case they existed for.
        //
        // They described the inner `cache.memo` fetch at the moment the body
        // was built, and the body is then held by `withCache` for the whole
        // TTL. Measured against production on 2026-08-30, four consecutive
        // requests:
        //
        //   header  X-Cache: hit   Age: 209
        //   body    servedFromCache: false   readAgoMs: 0
        //
        // So a UI using them to say "when we last got through" would have
        // announced a live read for a response three and a half minutes old.
        // The distinction that matters: `fetchedAt` is an ABSOLUTE instant and
        // stays true however long the body is cached, whereas a RELATIVE age
        // frozen into a cached body becomes a lie the moment it is reused.
        //
        // The information itself is not lost. `withCache` already publishes it
        // correctly, per response rather than per body, as the `Age` and
        // `X-Cache` headers above — which is where a staleness banner should
        // read it.
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

module.exports = withSecurity(withCache(handler, {
  name: 'live-grid',
  keyOn: [],
  ttlMs: TTL_MS,
  graceMs: GRACE_MS,
  staleWhileRevalidate: true,
}));
