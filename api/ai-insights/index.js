const https = require('https');
const es = require('../shared/eurostat.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const airQuality = require('../shared/airQuality.js');
const countries = require('../shared/country.js');

/**
 * WHO 2021 global air quality guideline for PM2.5, 24-hour mean, in µg/m³.
 *
 * Named rather than inlined because it is a published figure with a date, and
 * because the claim this file makes about it must be checked against the value
 * it prints rather than inferred from an index band.
 * @see https://www.who.int/publications/i/item/9789240034228
 */
const WHO_PM25_24H = 15;

/**
 * How much recent market history to fetch, so today can be described against
 * the distribution it belongs to rather than against a constant.
 *
 * Thirty days is long enough for a percentile to mean something and short
 * enough to still be "recent" for a market that moves seasonally. It is the
 * same Elering call with a wider `start`, so no new upstream is involved.
 */
const PRICE_WINDOW_DAYS = 30;

/**
 * How exceptional today has to be before we say so.
 *
 * A named percentile of the trailing window, not a price. The threshold this
 * replaces was the literal `100`, and measured against 62 days of Latvian
 * day-ahead prices it fired on **58 of them — 93.5%** — while describing them
 * as "significantly above normal". The median daily peak over that window was
 * **168**, so the constant sat *below* the typical day and labelled the
 * ordinary as exceptional. A severity that almost always fires carries no
 * information, and this one carried instructions with it.
 *
 * At p90 the same 62 days produce 6 alerts rather than 58.
 */
const PRICE_ALERT_PERCENTILE = 0.90;

/**
 * How many prior days a percentile needs before it is worth quoting.
 *
 * Below this the "highest tenth" of the window is one or two observations, and
 * a threshold drawn from that describes the sample rather than the market. The
 * card then states the figures and makes no comparison, which is what they are
 * entitled to say on their own.
 */
const MIN_BASELINE_DAYS = 14;

/** The value at a percentile of a sorted-ascending array. */
function percentile(sortedAscending, fraction) {
  if (sortedAscending.length === 0) return null;
  const idx = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.floor(sortedAscending.length * fraction)),
  );
  return sortedAscending[idx];
}

/**
 * Split priced intervals into today and the trailing window that precedes it.
 *
 * Days are keyed on the UTC date, matching the window the request asks for.
 * Today is excluded from its own baseline: comparing a day against a
 * distribution it is part of drags the threshold toward itself, and on a short
 * window that is not a small effect.
 */
function splitByDay(rows, todayKey) {
  const today = [];
  const priorPeaks = [];
  const byDay = new Map();
  for (var i = 0; i < rows.length; i++) {
    const p = rows[i];
    if (typeof p.price !== 'number' || !Number.isFinite(p.price)) continue;
    const key = new Date(p.timestamp * 1000).toISOString().slice(0, 10);
    if (key === todayKey) { today.push(p); continue; }
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p.price);
  }
  byDay.forEach(function (prices) { priorPeaks.push(Math.max.apply(null, prices)); });
  priorPeaks.sort(function (a, b) { return a - b; });
  return { today: today, priorPeaks: priorPeaks };
}

/**
 * A reading, or null. Never a zero.
 *
 * Lifted from `api/sea-state/index.js`, which carries the argument in full: on
 * the Baltic a zero is an ordinary wave height, air temperature and wind speed,
 * so a zero standing in for "no answer" is indistinguishable from an
 * observation.
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Why a source produced no insight — a closed vocabulary, deliberately.
 *
 * `#329` established `unavailable` and answered *which* source was lost. This
 * answers *why*, and the distinction that earns the field is `NO_READING`:
 * three of the four sources can answer HTTP 200, parse cleanly, and still yield
 * nothing, because `if (prices.length > 0)`, `if (usdMatch)` and `if (band)`
 * each had no `else`. Those never reach a `catch` — nothing threw — so after
 * `#329` they still dropped in silence. Four of the seven paths were covered;
 * these are the other three.
 *
 * A network failure and an empty answer are different messages to whoever reads
 * this. One says look at the channel; the other says the source published
 * nothing. Collapsing them sends a reader hunting an outage that never happened.
 *
 * NOT the upstream's own error text. `jsonGet` rejects with the full request URL
 * in the message, so `e.message` would publish our query strings and the
 * capital-city coordinates in a public response body. Nothing leaks today —
 * `#329`'s four pushes are fixed literals — and this vocabulary is what keeps it
 * that way, because attaching reasons is exactly the change that tempts someone
 * to pass the error through. `tests/aiInsightsReasons.test.ts` asserts nothing
 * outside this set plus `http-<nnn>` ever reaches the wire.
 *
 * `UNKNOWN` is the default and says so. Defaulting to `UNREACHABLE` would be a
 * confident claim about a network nobody examined — absence resolving to a
 * specific cause, which is the fault this endpoint keeps being fixed for.
 */
const REASONS = {
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  MALFORMED: 'malformed',
  NO_READING: 'no-reading',
  UNKNOWN: 'unknown',
};

/** An upstream that answered, but not with success. */
function httpReason(statusCode) { return 'http-' + statusCode; }

/** An error carrying its own classification, so no caller has to parse text. */
function tagged(reason, message) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

/**
 * The classification an error carries, read structurally.
 *
 * Three error shapes reach here, because three producers do. `es.httpJson`
 * (which `#333` routes Open-Meteo through) sets `status` on a non-2xx and
 * `transient` on anything worth retrying; Node sets `code` on a real socket
 * failure; and `jsonGet`/`httpGetText` below tag their own with `reason`. Each
 * branch reads a PROPERTY rather than matching the message text, so a reworded
 * error upstream cannot silently reclassify a failure — this file has been
 * bitten by lexical proxies before.
 *
 * The `transient` fallback resolves to `TIMEOUT` deliberately. Everything es
 * marks transient without a status or a code is one of its two deadline paths,
 * because a genuine socket error carries `code`. On this egress a hang IS the
 * dominant failure, so resolving it to `unreachable` would misdirect a reader
 * to a source that is answering a laptop in 110-302ms.
 *
 * KNOWN GAP, stated rather than papered over: `es.httpJson` throws a plain
 * `Error('JSON parse failed for ' + url)` on a body that arrives and will not
 * parse — no `status`, no `code`, no `transient` — so an unparseable Open-Meteo
 * response classifies as `unknown` rather than `malformed`. `MALFORMED` remains
 * reachable for Elering, which keeps `jsonGet`. Closing the gap would mean
 * either parsing at this end (a second transport for one reason code) or
 * matching that message text (the lexical proxy this function exists to avoid),
 * and the case has never been observed. `unknown` is honest about it; a guessed
 * `malformed` would not be. Asserted in `tests/aiInsightsReasons.test.ts` so the
 * behaviour is pinned rather than accidental.
 *
 * `UNKNOWN` is last and says so. Defaulting an unclassified error to any named
 * cause would be a confident claim about something nobody examined — absence
 * resolving to success's cousin, a confident diagnosis.
 */
function reasonOf(err) {
  if (!err) return REASONS.UNKNOWN;
  if (typeof err.reason === 'string' && err.reason) return err.reason;
  if (typeof err.status === 'number') return httpReason(err.status);
  if (typeof err.code === 'string' && err.code) return REASONS.UNREACHABLE;
  if (err.transient) return REASONS.TIMEOUT;
  return REASONS.UNKNOWN;
}

/**
 * A JSON GET with a socket timeout and no retry.
 *
 * Kept for Elering, which is reliable on this egress: measured across 18
 * production samples on 2026-08-31 it never failed, and neither did the ECB.
 *
 * NOT used for Open-Meteo. `{ timeout: 15000 }` is a **socket inactivity**
 * timer, not a total deadline, and there is no retry — which is the wrong shape
 * for a host that accepts the connection and then goes quiet. `sea-state` calls
 * the same host through `es.httpJson` with a hard deadline and one retry, under
 * a comment that already says why:
 *
 *     Open-Meteo has been measured hanging for the full deadline on this egress
 *     address, so the budget is short and one retry is allowed: a fresh
 *     connection usually succeeds where waiting does not.
 *
 * The answer was written down in a neighbouring file and this one did not use
 * it — the correct sibling that conceals the broken one.
 */
function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 15000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(tagged(httpReason(res.statusCode), 'HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(tagged(REASONS.MALFORMED, 'Parse failed')); }
      });
    });
    // `destroy(err)` re-emits that same object on 'error', so the tag survives
    // to the handler below rather than being rebuilt from the message there.
    req.on('timeout', function () { req.destroy(tagged(REASONS.TIMEOUT, 'Timeout: ' + url)); });
    req.on('error', function (err) {
      reject(err && err.reason ? err : tagged(REASONS.UNREACHABLE, (err && err.message) || 'Request failed'));
    });
  });
}

// The same budget and retry `sea-state` uses against the same host, and for the
// reason it records. Measured before this change, with the `unavailable` field
// #329 added: 8 of 18 production samples were degraded, and **every one of them
// was Open-Meteo** — `weather` 8, `air quality` 6, Elering and the ECB zero.
const OPEN_METEO_DEADLINE_MS = 6000;
const OPEN_METEO_RETRIES = 1;

/** Open-Meteo, through the client that knows this host hangs rather than fails. */
function openMeteoGet(url) {
  return es.httpJson(url, {
    deadlineMs: OPEN_METEO_DEADLINE_MS,
    retries: OPEN_METEO_RETRIES,
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

/**
 * Elering and the ECB keep `jsonGet`/`httpGetText`, and that is a decision.
 *
 * Both would arguably be better through `es.httpJson` too — the
 * socket-idle-timer argument `#333` makes for Open-Meteo is general. But neither
 * is failing: across 34 generations sampled on 2026-08-31 and 17 more on
 * 2026-09-01, every degradation was Open-Meteo and **zero** lost electricity
 * prices or exchange rates. Measured directly, Elering answers a 30-day window
 * (488KB) in 425-1585ms and the ECB file in 61-220ms. Moving them would mean
 * inventing deadlines for two sources with no observed failures, which is how a
 * currently-reliable source gets made less reliable. Left as a separate change
 * with its own evidence.
 */

function httpGetText(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 10000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(tagged(httpReason(res.statusCode), 'HTTP ' + res.statusCode + ' from ' + url));
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve(data); });
    });
    req.on('timeout', function () { req.destroy(tagged(REASONS.TIMEOUT, 'Timeout: ' + url)); });
    req.on('error', function (err) {
      reject(err && err.reason ? err : tagged(REASONS.UNREACHABLE, (err && err.message) || 'Request failed'));
    });
  });
}

const handler = async function (context, req) {
  // Normalised once, at the boundary, and a miss is a bad request rather than
  // a request for Latvia. `zoneMap[country] || 'lv'` and
  // `capitalCoords[country] || capitalCoords.lv` both key lower-case maps, so
  // an upper-case `EE` matched neither and fell through to Latvia — serving
  // Latvia's electricity market under an Estonian heading, and Riga's weather
  // and air quality with it. Every figure real, every figure the wrong
  // country's, and invisible to precisely the readers who would notice,
  // because Latvia is what the default returns.
  const requested = countries.normaliseCountry(req.query && req.query.country);
  if (requested === null) {
    context.res = countries.badCountry(req.query && req.query.country);
    return;
  }

  try {
    var insights = [];
    var country = requested;
    var zone = country;
    var capitalCoords = {
      lv: { lat: 56.95, lon: 24.11, name: 'Riga', tz: 'Europe/Riga' },
      ee: { lat: 59.44, lon: 24.75, name: 'Tallinn', tz: 'Europe/Tallinn' },
      lt: { lat: 54.69, lon: 25.28, name: 'Vilnius', tz: 'Europe/Vilnius' },
    };
    var capital = capitalCoords[country];

    // Start every upstream fetch before awaiting any of them.
    //
    // These four calls were previously awaited one after another, each with
    // its own 10-15s timeout, so a single slow upstream delayed all the
    // others and the worst case was the SUM of the timeouts (~55s) rather
    // than the longest one. That is what made /api/ai-insights intermittently
    // time out on a cold cache, and why tests/api-contracts.live.test.ts fails
    // against production when the 15s client budget expires first.
    //
    // The calls are independent, so kicking them all off here makes the worst
    // case the slowest single upstream (~15s). Each result is still consumed
    // inside its own try/catch below, so one failing source degrades that one
    // insight instead of the whole response.
    var now = new Date();
    var dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    var dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    // A trailing window, so today can be characterised against the market's own
    // recent distribution rather than against a constant somebody chose. Same
    // endpoint and one call: the window widens, nothing new is fetched.
    var windowStart = new Date(dayStart.getTime() - PRICE_WINDOW_DAYS * 86400e3);

    var eleringPromise = jsonGet(
      ELERING_URL + '?start=' + windowStart.toISOString() + '&end=' + dayEnd.toISOString()
    );
    var ecbPromise = httpGetText(ECB_URL);
    var airPromise = openMeteoGet(
      OPEN_METEO_AQ + '?latitude=' + capital.lat + '&longitude=' + capital.lon +
      '&current=pm2_5,nitrogen_dioxide,european_aqi&timezone=' + capital.tz
    );
    var weatherPromise = openMeteoGet(
      OPEN_METEO_WX + '?latitude=' + capital.lat + '&longitude=' + capital.lon +
      '&current=temperature_2m,wind_speed_10m,weather_code&timezone=' + capital.tz
    );

    // Attach a no-op catch to each so a rejection that is not awaited until
    // later cannot surface as an unhandled rejection and take down the worker.
    [eleringPromise, ecbPromise, airPromise, weatherPromise].forEach(function (p) {
      p.catch(function () { /* handled at the await site below */ });
    });

    // 1. Electricity prices from Elering
    //
    // Every source below is optional: one failing degrades that one insight
    // rather than the response. What the four `catch` clauses used to do was
    // drop it **silently**, and a skipped insight and an insight that does not
    // exist are the same artefact — a shorter list, with nothing saying a
    // source was unavailable.
    //
    // Measured on 2026-08-31, that shipped: `country=lv` and `country=ee`
    // returned two insights while `lt` returned four, because Open-Meteo was
    // unreachable from our egress for Riga and Tallinn. `responseCache` then
    // remembered the short list, so a blip lasting seconds was served for the
    // full 15-minute TTL — every `Age` above 800 carried two insights, every
    // one below 500 carried four.
    //
    // This file was the only endpoint that could degrade with **no signal at
    // all**: no published field, and no `console` call either, so neither a
    // reader nor an operator could tell. Four siblings already publish an
    // `unavailable` field — `sea-state` serves `unavailable: []` today — and
    // the correctness of those siblings is why nobody looked at this one.
    var unavailable = [];
    /**
     * Record a source that produced no insight, and why.
     *
     * `#329` established this field with bare source names and covered the four
     * `catch` clauses. Three more paths reach here without ever throwing — the
     * `if` guards below — and a fourth was the weather block fabricating rather
     * than dropping. Same field and the same four source names; the element
     * carries a `reason` so "reached, and empty" is not reported as an outage.
     */
    function lost(source, reason) {
      unavailable.push({ source: source, reason: reason });
    }
    try {
      var elData = await eleringPromise;
      var allRows = (elData.data && elData.data[zone]) || [];
      var split = splitByDay(allRows, dayStart.toISOString().slice(0, 10));
      var prices = split.today;

      if (prices.length > 0) {
        var avg = prices.reduce(function (s, p) { return s + p.price; }, 0) / prices.length;
        var minP = Math.min.apply(null, prices.map(function (p) { return p.price; }));
        var maxP = Math.max.apply(null, prices.map(function (p) { return p.price; }));
        var curHour = now.getHours();
        var curEntry = prices.find(function (p) { return new Date(p.timestamp * 1000).getHours() === curHour; });
        // Not `: avg`. Reporting the day's average *as* the current price is a
        // guard whose false branch is a claim, and a plausible one — an average
        // price looks exactly like a price. #131 removed the same line from
        // `economy-data`; this copy was untouched.
        var current = curEntry && Number.isFinite(curEntry.price) ? curEntry.price : null;

        // The comparison is drawn from the market's own trailing distribution,
        // and the sentence names its basis. Below `MIN_BASELINE_DAYS` we do not
        // have a distribution worth quoting, so we state the numbers and stop —
        // which is what the figures are entitled to say on their own.
        var threshold = split.priorPeaks.length >= MIN_BASELINE_DAYS
          ? percentile(split.priorPeaks, PRICE_ALERT_PERCENTILE)
          : null;
        var basis = split.priorPeaks.length + ' preceding days';
        var range = 'Range €' + minP.toFixed(0) + '–€' + maxP.toFixed(0) + '/MWh, day average €' + avg.toFixed(0) + '.';

        if (minP < 0) {
          insights.push({
            headline: 'Negative electricity price: €' + minP.toFixed(2) + '/MWh',
            description: 'Prices below zero indicate more generation than the grid can absorb. ' + range,
            level: 'significant', category: 'economy', timestamp: now.toISOString(),
          });
        } else if (threshold !== null && maxP > threshold) {
          insights.push({
            headline: 'Electricity peak €' + maxP.toFixed(0) + '/MWh',
            // The claim names the comparison it rests on, so a reader can judge
            // it. "Significantly above normal" named nothing and was true of
            // 93.5% of days.
            description: "Today's peak is in the highest tenth of daily peaks over the last "
              + basis + ' (above €' + threshold.toFixed(0) + '). ' + range,
            level: 'significant', category: 'economy', timestamp: now.toISOString(),
          });
        } else {
          insights.push({
            headline: current !== null
              ? 'Electricity €' + current.toFixed(2) + '/MWh'
              : 'Electricity: day average €' + avg.toFixed(0) + '/MWh',
            // No characterisation. "Below seasonal average" named a statistic
            // this endpoint never computed, and "within normal Baltic market
            // range" was asserted against nothing at all — it was the `else`.
            //
            // "of daily peaks" is load-bearing and was missing. The other
            // branch quotes the same threshold as "the highest tenth of daily
            // peaks"; this one said "the highest tenth of the last 31
            // preceding days", which names no quantity. A reader then has
            // three prices in one sentence — a current €26, a day average €57
            // and a threshold €259 — and no way to know the third is a
            // percentile of *peaks* rather than something comparable to the
            // first two. Two branches quoting one number must describe it
            // identically, or the number means different things depending on
            // which day you read it.
            description: range + (threshold !== null
              ? ' Highest tenth of daily peaks over the last ' + basis
                + ' begins at €' + threshold.toFixed(0) + '.'
              : ''),
            level: 'routine', category: 'economy', timestamp: now.toISOString(),
          });
        }
      } else {
        // Elering answered and carried no priced interval for today. Not an
        // outage, and `if (prices.length > 0)` had no `else`, so this dropped
        // in silence even after #329 — nothing threw, so no `catch` ran.
        lost('electricity prices', REASONS.NO_READING);
      }
    } catch (e) { lost('electricity prices', reasonOf(e)); }

    // 2. ECB exchange rates
    try {
      var xml = await ecbPromise;
      var usdMatch = xml.match(/currency='USD' rate='([\d.]+)'/);
      if (usdMatch) {
        var usdRate = parseFloat(usdMatch[1]);
        insights.push({
          headline: 'EUR/USD: ' + usdRate.toFixed(4),
          // No direction. "Euro strengthening against the dollar" describes a
          // *change*, and this endpoint fetches a single day's reference rate —
          // there is no previous value anywhere in it, so the claim could not
          // be derived from what we hold no matter where the threshold sat.
          //
          // Nor was the threshold sound: measured over the ECB's own 90-day
          // file, all 64 observations sat between 1.134 and 1.1699, so the
          // `> 1.12` branch fired on **100% of trading days** and the other two
          // were unreachable. A branch that always wins is a constant.
          //
          // Saying the rate and when it was set is what the figure supports.
          // A real direction needs the 90-day series, which is a separate
          // change and a separate call.
          description: 'ECB euro foreign exchange reference rate, published each working day at 16:00 CET.',
          level: 'routine',
          category: 'economy',
          timestamp: new Date().toISOString(),
        });
      } else {
        // The file arrived and carries no USD line. Reached, and nothing to say.
        lost('exchange rates', REASONS.NO_READING);
      }
    } catch (e) { lost('exchange rates', reasonOf(e)); }

    // 3. Air quality
    try {
      var aqData = await airPromise;
      var aqCurrent = aqData.current || {};
      // No `|| 0`. A missing index is not a reading of zero, and zero is the
      // best band there is — that is how this file would have announced perfect
      // air on the strength of a field that never arrived.
      var aqi = typeof aqCurrent.european_aqi === 'number' && Number.isFinite(aqCurrent.european_aqi)
        ? aqCurrent.european_aqi : null;
      var pm25 = typeof aqCurrent.pm2_5 === 'number' && Number.isFinite(aqCurrent.pm2_5)
        ? aqCurrent.pm2_5 : null;
      var band = airQuality.classifyEuropeanAqi(aqi);

      if (band) {
        // The advice follows the EEA's own bands, because the index is the
        // EEA's. This used to split at the US EPA's 50 and 100 and call the
        // worst band "Unhealthy", an EPA word the European scale does not use.
        var advice = band.rank <= 2
          ? 'Within the European index\u2019s two cleanest bands.'
          : band.rank === 3
            ? 'Sensitive groups may wish to limit prolonged outdoor exertion.'
            : 'Consider limiting outdoor activity, particularly for sensitive groups.';

        // The WHO comparison is made against the number we are about to print,
        // rather than inferred from the index band. Those two disagree: sampled
        // over 6696 hourly readings, every single occasion PM2.5 exceeded the
        // WHO 24-hour guideline the old line still read "Well below WHO
        // guidelines" — printing 16.9 µg/m³ and calling it well below 15.
        var whoNote = pm25 === null
          ? ''
          : pm25 > WHO_PM25_24H
            ? ' PM2.5 is above the WHO 24-hour guideline of ' + WHO_PM25_24H + ' \u00b5g/m\u00b3.'
            : ' PM2.5 is within the WHO 24-hour guideline of ' + WHO_PM25_24H + ' \u00b5g/m\u00b3.';

        insights.push({
          headline: capital.name + ' air quality: ' + band.label,
          description: 'European AQI ' + aqi
            + (pm25 === null ? '. PM2.5 unavailable.' : '. PM2.5: ' + pm25.toFixed(1) + ' \u00b5g/m\u00b3.')
            + whoNote + ' ' + advice,
          level: band.rank <= 2 ? 'routine' : band.rank === 3 ? 'notable' : 'significant',
          category: 'environment',
          timestamp: new Date().toISOString(),
        });
      } else {
        // `classifyEuropeanAqi` returned null, correctly, because there was no
        // index in the payload. `if (band)` had no `else`, so a source that
        // answered HTTP 200 and parsed cleanly vanished exactly like one that
        // timed out — the widest of the three unguarded branches, since this is
        // one of the two insights production was measured losing.
        lost('air quality', REASONS.NO_READING);
      }
    } catch (e) { lost('air quality', reasonOf(e)); }

    // 4. Weather
    try {
      var wxData = await weatherPromise;
      var wxCurrent = wxData.current || {};
      // No `|| 0`, for the reason the air-quality block 46 lines above already
      // gives — and more urgently here, because of where zero sits on each
      // scale:
      //
      //   AQI  0 is the BEST band there is  -> "perfect air", odd enough to query
      //   TEMP 0 is the freezing point      -> an ordinary Riga winter reading
      //
      // Both downstream branches then waved it through. `temp < -10 || temp >
      // 35` is false at 0, so the level was `routine`; `temp < 0` is false at 0,
      // so the advice was "Conditions within seasonal range." With `wind || 0`
      // beside it a missing field rendered as a real, still, overcast day:
      //
      //   Riga: 0°C, overcast — Wind 0 km/h. Conditions within seasonal range.
      //
      // Nothing in that says a field was absent, which is what makes it worse
      // than the AQI version it was copied from: a reader might query perfect
      // air, and nobody queries a freezing day in Riga. It is the third time
      // this substitution has been found against this same upstream, after a
      // fabricated calm sea and fabricated clean air.
      //
      // This does not rest on Open-Meteo's contract, and it is worth saying why,
      // because measurement alone does not settle it: 6 of 6 live replies
      // carried a finite `temperature_2m`, and asking for an unknown variable
      // returns HTTP 400, which `jsonGet` rejects before reaching here. But the
      // line above already writes `wxData.current || {}`, conceding that
      // `current` may be absent. If it cannot be, that guard is dead code; if it
      // can be, `|| 0` invents a reading. The two lines contradicted each other
      // on the file's own terms, with no appeal to the upstream at all — and
      // `jsonGet` accepts any 2xx that parses, without checking the shape.
      var temp = num(wxCurrent.temperature_2m);
      var wind = num(wxCurrent.wind_speed_10m);
      var codes = { 0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 51: 'drizzle', 61: 'rain', 71: 'snow', 80: 'rain showers', 95: 'thunderstorm' };
      var desc = codes[wxCurrent.weather_code] || 'variable';

      if (temp === null) {
        // Declared, not merely dropped. Fixing a fabrication must not quietly
        // convert it into the silent vanish `#329` has just removed, so this
        // reuses that field and its existing 'weather' source name rather than
        // adding a second vocabulary for the same fact.
        lost('weather', REASONS.NO_READING);
      } else {
        insights.push({
          headline: capital.name + ': ' + temp.toFixed(0) + '°C, ' + desc,
          // The temperature is the headline; the wind is context beside it. So a
          // missing wind states itself and the card stands, exactly as the
          // air-quality block prints "PM2.5 unavailable." and still reports its
          // band. Dropping the whole card here would discard a temperature we
          // actually hold — an over-correction in the opposite direction.
          description: 'Wind ' + (wind === null ? 'unavailable' : wind.toFixed(0) + ' km/h') + '. '
            + (temp < -10 ? 'Severe cold — expect elevated heating demand.'
              : temp < 0 ? 'Below freezing — monitor transport and energy costs.'
                : temp > 30 ? 'Heat wave — increased cooling demand.'
                  : 'Conditions within seasonal range.'),
          // `wind !== null` is spelled out rather than left to `null > 80`.
          // Both are false, so this is a readability change and not a
          // behavioural one — and it is not asserted anywhere, because a test
          // that cannot distinguish the two spellings could not fail.
          level: temp < -10 || temp > 35 || (wind !== null && wind > 80) ? 'significant' : 'routine',
          category: 'environment',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) { lost('weather', reasonOf(e)); }

    // Limit to 5
    insights = insights.slice(0, 5);

    // Nothing at all is a failure, and has to read as one.
    //
    // `/api/sea-state` makes the same call for the same reason — "all three
    // failing is a failure and has to read as one rather than as an empty,
    // becalmed coastline" — and here it buys something concrete. A non-200 is
    // `NotCacheable`, so `responseCache` declines to remember it and
    // `cache.memo` falls back to the last good answer inside its hour of grace,
    // serving that with `Age` and `X-Cache: stale`. A reader gets the insights
    // we last had rather than an empty strip standing in front of them.
    //
    // Without this branch, `200 {insights: [], unavailable: [4]}` is a perfectly
    // cacheable answer and is remembered for the full fifteen-minute TTL — which
    // is exactly the case `responseCache.js` refuses a 502 for: turning a blip
    // into a fixed outage.
    //
    // A PARTIAL answer is still remembered, deliberately, and the deciding fact
    // is the rate rather than the principle. `api/shared/statusChecks.js`
    // records roughly half of all calls from this egress address hanging while
    // the same endpoint answers a laptop in 110-302ms; `api/shared/eurostat.js`
    // records about one in three. At that rate, refusing to cache partials would
    // leave the cache mostly empty and send most requests upstream on a channel
    // that is throttled precisely for being asked too often — and it would do it
    // to Elering and the ECB too, which had answered. The `unavailable` field is
    // what makes a partial answer honest; the TTL is deliberately unchanged.
    if (insights.length === 0) {
      context.res = {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'No source produced an insight',
          insights: [],
          // Carried on the failure too, so even a total outage says which four
          // sources were lost and why.
          unavailable: unavailable,
          generatedAt: new Date().toISOString(),
          source: 'portaBaltica AI (data-driven)',
        }),
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        insights: insights,
        // Always present, `[]` when nothing failed — so a consumer can tell
        // "this source was quiet" from "we do not offer that insight", and an
        // empty array is a measurement rather than a missing key.
        //
        // Each element is `{ source, reason }` rather than a bare name. A source
        // that answered HTTP 200 and carried no reading is a different message
        // from one that timed out — the first says the source published nothing,
        // the second says look at the channel — and collapsing them sends a
        // reader hunting an outage that never happened. The reason comes from a
        // closed vocabulary and never from the upstream's own error text, which
        // carries our request URL.
        unavailable: unavailable,
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

module.exports = withSecurity(withCache(handler, {
  name: 'ai-insights',
  keyOn: ['country'],
  ttlMs: 900000,
  graceMs: 3600000,
  staleWhileRevalidate: true,
}));
// Exported so the derivation is assertable on its own, rather than only
// through a live handler that depends on what the market did today.
module.exports.percentile = percentile;
module.exports.splitByDay = splitByDay;
module.exports.PRICE_ALERT_PERCENTILE = PRICE_ALERT_PERCENTILE;
module.exports.PRICE_WINDOW_DAYS = PRICE_WINDOW_DAYS;
module.exports.MIN_BASELINE_DAYS = MIN_BASELINE_DAYS;
// The reason vocabulary, exported so a test asserts against the closed set the
// handler actually uses rather than against its own copy of the words. A second
// copy is a second enumeration, and two enumerations always drift.
module.exports.REASONS = REASONS;
module.exports.reasonOf = reasonOf;
module.exports.httpReason = httpReason;
