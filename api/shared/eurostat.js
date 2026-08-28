/**
 * Shared Eurostat access layer.
 *
 * Three jobs, all learned from live audits of the deployed dashboard:
 *
 * 1. `httpJson` gives every upstream call a hard deadline. The old per-call
 *    `timeout` option only armed a socket idle timer, so a source that accepted
 *    the connection and then stalled could hold a request open far longer than
 *    its stated budget — that is how /api/system-status came to report a 16s
 *    response for an 8s timeout.
 *
 * 2. `parseJsonStat` no longer guesses silently. The previous parser used index
 *    0 for any dimension the query had not pinned. When Eurostat retired a code
 *    (or a definition named the wrong one) the query still returned a valid
 *    cube, the parser read a slice of it, and the chart rendered either nothing
 *    or — worse — a completely different statistic under the old label. The
 *    parser now picks the slice that actually carries data and reports every
 *    such choice in `assumptions`, so an unpinned dimension is visible in the
 *    API response and can be asserted against in tests.
 *
 * 3. `monthsSincePeriod` / `maxAgeMonths` measure whether a series is still
 *    moving. Points-returned and sanity-band checks both pass forever against a
 *    dataset Eurostat has stopped updating: when HICP migrated to ECOICOP ver.2
 *    the ver.1 tables kept answering HTTP 200, kept listing every old code, and
 *    kept returning perfectly plausible values — from 2025-12, for eight months.
 *    Freshness is the only assertion that catches that.
 */

const https = require('https');

const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

function httpText(url, options) {
  const opts = options || {};
  const deadlineMs = opts.deadlineMs || 15000;

  return new Promise(function (resolve, reject) {
    let settled = false;
    const finish = function (err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      if (err) reject(err); else resolve(value);
    };

    const timer = setTimeout(function () {
      const err = new Error('Deadline ' + deadlineMs + 'ms exceeded for ' + url);
      err.transient = true;
      finish(err);
    }, deadlineMs);

    const req = https.get(url, {
      timeout: deadlineMs,
      headers: Object.assign({ 'User-Agent': 'portaBaltica/1.0 (+https://portabaltica.naurolabs.com)' }, opts.headers || {}),
    }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        const err = new Error('HTTP ' + res.statusCode + ' from ' + url);
        err.status = res.statusCode;
        // A 5xx or a 429 is the server saying "not now", which is the textbook
        // retryable answer — and the one a rate limiter in front of a source
        // actually returns. Observed live: Elering answered HTTP 503 through
        // Cloudflare three times in ten seconds and then served eight clean
        // requests, which was long enough for the status page to call a healthy
        // source dead. Every other 4xx is an answer about the request itself
        // and asking again only spends another second to hear it repeated.
        if (res.statusCode === 429 || res.statusCode >= 500) err.transient = true;
        return finish(err);
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { finish(null, data); });
      res.on('error', finish);
    });

    req.on('timeout', function () {
      const err = new Error('Timeout: ' + url);
      err.transient = true;
      finish(err);
    });
    req.on('error', function (err) {
      // A refused, reset or unresolvable connection is worth one more go for
      // the same reason a hung one is: it says nothing about whether the
      // source is healthy, only about this particular socket.
      err.transient = true;
      finish(err);
    });
  });
}

/**
 * One retry for a connection that hung, refused, reset, or was turned away.
 *
 * Two live failures motivate this, and they look nothing alike:
 *
 *   - The Open-Meteo probe returned in 17–63ms when it worked and in *exactly*
 *     5000ms when it did not, roughly one call in three, while the same
 *     endpoint answered in 119–222ms from a laptop. A response landing
 *     precisely on the deadline is a socket that was accepted and then said
 *     nothing — not a slow source. The likeliest cause is the shared Azure
 *     egress address meeting a per-IP free-tier limit, which no amount of
 *     waiting fixes but a fresh connection usually does.
 *   - Elering answered HTTP 503 through Cloudflare three times in ten seconds
 *     and then served eight consecutive clean requests. A rate limiter says
 *     429 or 503 rather than hanging, so covering only timeouts would have
 *     missed the very hypothesis the retry was built for.
 *
 * Only transient failures are retried. An HTTP 404 or a malformed body is an
 * answer; asking again spends another second to hear the same thing.
 * `retries` defaults to 0, so no existing caller changes behaviour.
 *
 * The pause is short on purpose. It gives a rate limiter a moment to forget
 * without pushing two attempts past the status page's own budget.
 */
const RETRY_PAUSE_MS = 200;

function withRetry(fn, retries) {
  const attempts = Math.max(1, (retries || 0) + 1);
  let attempt = 0;

  const tryOnce = function () {
    attempt++;
    return fn().catch(function (err) {
      if (attempt >= attempts || !err || !err.transient) throw err;
      return new Promise(function (resolve) {
        setTimeout(resolve, RETRY_PAUSE_MS);
      }).then(tryOnce);
    });
  };

  return tryOnce();
}

function httpTextRetrying(url, options) {
  const opts = options || {};
  if (!opts.retries) return httpText(url, opts);
  return withRetry(function () { return httpText(url, opts); }, opts.retries);
}

function httpJson(url, options) {
  return httpTextRetrying(url, options).then(function (text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('JSON parse failed for ' + url);
    }
  });
}

function strides(sizes) {
  const out = new Array(sizes.length);
  let mult = 1;
  for (let d = sizes.length - 1; d >= 0; d--) {
    out[d] = mult;
    mult *= sizes[d];
  }
  return out;
}

function valueAt(data, flatIdx) {
  const v = data.value[flatIdx];
  return v === undefined ? data.value[String(flatIdx)] : v;
}

function sortedCodes(category) {
  return Object.keys(category.index).sort(function (a, b) {
    return category.index[a] - category.index[b];
  });
}

/**
 * Count non-null cells for a candidate set of fixed positions on the
 * dimensions that are neither the key dimension nor time.
 */
function coverage(data, dims, str, keyIdx, timeIdx, fixed, keyCat, keyCodes, timeCount) {
  let found = 0;
  for (let g = 0; g < keyCodes.length; g++) {
    for (let t = 0; t < timeCount; t++) {
      let idx = 0;
      for (let d = 0; d < dims.length; d++) {
        let pos;
        if (d === keyIdx) pos = keyCat.index[keyCodes[g]];
        else if (d === timeIdx) pos = t;
        else pos = fixed[d] || 0;
        idx += pos * str[d];
      }
      const v = valueAt(data, idx);
      if (v !== null && v !== undefined) found++;
    }
  }
  return found;
}

/**
 * Parse a JSON-stat 2.0 cube into one series per category of `keyDim`.
 *
 * `geo` is only the commonest key dimension, not the only one. Eurostat's
 * maritime tables are published per country and keyed on `rep_mar` (the
 * reporting port) with no `geo` dimension at all, so a parser that insisted on
 * `geo` returned an empty cube for every one of them. The strictness that
 * matters — pinning every other dimension and reporting whatever it had to
 * guess — is independent of which dimension is the key, so it lives here once.
 *
 * `wanted` filters the key categories; pass a falsy value to keep them all,
 * which is what a cube whose codes are discovered from the response needs.
 *
 * Returns { series, assumptions }. `assumptions` is non-empty only when the
 * query left a non-key dimension with more than one category — which a correct
 * definition never should.
 */
function parseJsonStatDim(data, keyDim, wanted) {
  const empty = { series: {}, assumptions: [] };
  if (!data || !data.value || !data.id || !data.dimension) return empty;

  const dims = data.id;
  const sizes = data.size;
  const keyIdx = dims.indexOf(keyDim);
  const timeIdx = dims.indexOf('time');
  if (keyIdx < 0 || timeIdx < 0) return empty;
  if (!data.dimension[keyDim] || !data.dimension[keyDim].category) return empty;

  const keyCat = data.dimension[keyDim].category;
  const timeCat = data.dimension.time.category;
  const allKeys = sortedCodes(keyCat);
  const keyCodes = wanted && wanted.length
    ? allKeys.filter(function (g) { return wanted.indexOf(g) >= 0; })
    : allKeys;
  const timeCodes = sortedCodes(timeCat);
  if (keyCodes.length === 0 || timeCodes.length === 0) return empty;

  const str = strides(sizes);
  const fixed = new Array(dims.length).fill(0);
  const assumptions = [];

  // Resolve unpinned dimensions greedily: for each, keep the category that
  // yields the most data. A well-specified indicator has none of these.
  for (let d = 0; d < dims.length; d++) {
    if (d === keyIdx || d === timeIdx || sizes[d] <= 1) continue;
    const codes = sortedCodes(data.dimension[dims[d]].category);
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < codes.length; c++) {
      fixed[d] = c;
      const score = coverage(data, dims, str, keyIdx, timeIdx, fixed, keyCat, keyCodes, timeCodes.length);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    fixed[d] = best;
    assumptions.push({
      dimension: dims[d],
      chosen: codes[best],
      optionCount: codes.length,
      reason: 'dimension not pinned by the indicator definition',
    });
  }

  const series = {};
  for (let g = 0; g < keyCodes.length; g++) {
    const key = keyCodes[g];
    const points = [];
    for (let t = 0; t < timeCodes.length; t++) {
      let idx = 0;
      for (let d = 0; d < dims.length; d++) {
        let pos;
        if (d === keyIdx) pos = keyCat.index[key];
        else if (d === timeIdx) pos = timeCat.index[timeCodes[t]];
        else pos = fixed[d];
        idx += pos * str[d];
      }
      const v = valueAt(data, idx);
      points.push({
        period: timeCodes[t],
        value: v !== null && v !== undefined ? +v : null,
      });
    }
    series[key] = {
      label: (keyCat.label && keyCat.label[key]) || key,
      series: points,
    };
  }

  return { series: series, assumptions: assumptions };
}

/**
 * Parse a JSON-stat 2.0 cube into per-country series.
 *
 * Returns { countries, assumptions }.
 */
function parseJsonStat(data, wanted) {
  const parsed = parseJsonStatDim(data, 'geo', wanted);
  return { countries: parsed.series, assumptions: parsed.assumptions };
}

/**
 * Earliest period to request, expressed in the granularity the dataset uses.
 *
 * Eurostat rejects or silently mismatches a quarterly bound on a monthly or
 * semi-annual dataset, so the frequency has to come from the definition rather
 * than be inferred from a substring of the query string.
 */
function sincePeriod(freq, years) {
  const since = new Date().getFullYear() - Math.max(1, years || 5);
  if (freq === 'M') return since + '-01';
  if (freq === 'Q') return since + '-Q1';
  if (freq === 'S') return since + '-S1';
  // Eurostat's own spelling, hyphen included. Measured against demo_r_mwk_ts:
  // `2000-W01` answers HTTP 200, `2000W01` answers HTTP 400. A bare year also
  // works and returns the same 1388 periods, which is exactly why this branch
  // is worth having — the fallback below happened to be accepted, so a weekly
  // dataset would have looked correctly bounded while the granularity of the
  // bound was never stated.
  if (freq === 'W') return since + '-W01';
  return String(since);
}

function buildUrl(def, years, geos) {
  return EUROSTAT_BASE + '/' + def.dataset +
    '?' + geos.map(function (g) { return 'geo=' + g; }).join('&') +
    '&' + def.params +
    '&sinceTimePeriod=' + sincePeriod(def.freq, years);
}

/** One average month, in milliseconds. The single definition of it. */
const AVG_MONTH_MS = 2629746e3;

/** One week, in milliseconds. Exact, unlike a month. */
const WEEK_MS = 604800e3;

const ISO_WEEK = /^(\d{4})-?W(\d{1,2})$/;

/**
 * Milliseconds at the end of the Sunday closing ISO week `week` of `year`.
 *
 * ISO 8601 anchors on 4 January, which is in week 1 by definition whatever
 * weekday it falls on. Everything else follows from the Monday of that week.
 */
function isoWeekEndMs(year, week) {
  const jan4 = Date.UTC(year, 0, 4);
  const isoDow = ((new Date(jan4).getUTCDay() + 6) % 7) + 1; // Mon=1 … Sun=7
  const week1Monday = jan4 - (isoDow - 1) * 86400e3;
  const monday = week1Monday + (week - 1) * WEEK_MS;
  return monday + WEEK_MS - 1;
}

/**
 * Absolute week ordinal for a weekly period label, or null for anything else.
 *
 * Consecutive ISO weeks differ by exactly one here, across a year boundary and
 * across a 53-week year, because it counts real weeks rather than parsing the
 * `-Www` suffix as a number. `2026-W01` follows `2025-W52`; subtracting the
 * suffixes would give -51.
 */
function periodToWeekIndex(period) {
  if (typeof period !== 'string') return null;
  const m = ISO_WEEK.exec(period.trim());
  if (!m) return null;
  return Math.round((isoWeekEndMs(+m[1], +m[2]) + 1) / WEEK_MS) - 1;
}

/**
 * The last instant of a period *finer* than a month, or null.
 *
 * A month index cannot locate a week: every week of August shares one index,
 * so an age derived from it is out by up to a month — which for a weekly
 * series is more than four cadence units. Measured on 2026-08-28 against
 * `demo_r_mwk_ts`, whose newest Latvian observation is `2026-W28`: the month
 * path gives 1 month (≈4.3 weeks) and the true age is 6.7 weeks.
 *
 * Month-grid labels deliberately return null and keep the month arithmetic
 * they have always used. That path is not merely adequate for them, it is what
 * `tests/freshness.test.ts` and `tests/indicators.test.ts` pin — `2025-Q4` is
 * exactly 8 months old in August 2026 — and swapping it for exact milliseconds
 * would move every existing verdict slightly, in the loosening direction, for
 * no gain.
 */
function periodEndMs(period) {
  if (typeof period !== 'string') return null;
  const m = ISO_WEEK.exec(period.trim());
  return m ? isoWeekEndMs(+m[1], +m[2]) : null;
}

/**
 * Absolute month index for a period label, used to compare periods of different
 * granularity on one axis. It resolves to the *last* month the period covers —
 * 2026-Q1 is March 2026, 2025 is December 2025, 2026-W28 is July 2026 — because
 * that is when the observation is complete and the clock on publishing it
 * starts.
 *
 * A week is the one granularity this cannot express faithfully: four or five of
 * them share a month. It is still resolved, because ordering and cadence
 * detection need a single axis, but anything measuring an *age* must use
 * `periodEndMs` — see `monthsSincePeriod` immediately below.
 *
 * Two vocabularies, because the dashboard reads two providers. Eurostat writes
 * `2026-07`, `2026-Q1`, `2025-S2`; CSP PxWeb writes `2026M07`, `2026Q1`,
 * `2025H2` for the same things. Recognising only one of them would silently
 * report "cannot tell" for every national series, which is the answer that
 * lets a frozen table through.
 *
 * Returns null for a label this function does not recognise, and callers must
 * treat null as "cannot tell" rather than as "fresh".
 */
function periodToMonthIndex(period) {
  if (typeof period !== 'string') return null;
  let m;
  if ((m = /^(\d{4})-(\d{2})$/.exec(period))) return +m[1] * 12 + +m[2];
  if ((m = /^(\d{4})M(\d{2})$/.exec(period))) return +m[1] * 12 + +m[2];
  if ((m = /^(\d{4})-?Q([1-4])$/.exec(period))) return +m[1] * 12 + +m[2] * 3;
  if ((m = /^(\d{4})-?[SH]([1-2])$/.exec(period))) return +m[1] * 12 + +m[2] * 6;
  if ((m = ISO_WEEK.exec(period))) {
    const end = new Date(isoWeekEndMs(+m[1], +m[2]));
    return end.getUTCFullYear() * 12 + end.getUTCMonth() + 1;
  }
  if ((m = /^(\d{4})$/.exec(period))) return +m[1] * 12 + 12;
  return null;
}

/**
 * The cadence a period label implies, so freshness can be judged for a series
 * that arrived without a declared frequency — which is every PxWeb series.
 */
function periodCadence(period) {
  if (typeof period !== 'string') return null;
  if (/^(\d{4})(-\d{2}|M\d{2})$/.test(period)) return 'M';
  if (/^(\d{4})-?Q[1-4]$/.test(period)) return 'Q';
  if (/^(\d{4})-?[SH][1-2]$/.test(period)) return 'S';
  // Before the monthly branch would ever see it: `2026-W28` does not match
  // `\d{4}-\d{2}`, but a future loosening of that pattern would swallow it and
  // report a weekly series as monthly, which is the direction that hides a
  // freeze rather than inventing one.
  if (ISO_WEEK.test(period)) return 'W';
  if (/^(\d{4})$/.test(period)) return 'A';
  return null;
}

/**
 * Is the newest observation in `series` old enough to call the source frozen?
 *
 * Returns null when it cannot tell — an empty series or an unrecognised label —
 * because "I don't know" must not read as "stale" and trigger a needless
 * failover, nor as "fresh" and hide one.
 */
function isSeriesStale(series, now) {
  if (!Array.isArray(series) || series.length === 0) return null;
  let newest = null;
  let newestIdx = -Infinity;
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    if (!p || p.value === null || p.value === undefined) continue;
    const idx = periodToMonthIndex(p.period);
    if (idx === null) continue;
    if (idx > newestIdx) { newestIdx = idx; newest = p.period; }
  }
  if (newest === null) return null;
  const cadence = periodCadence(newest);
  if (!cadence) return null;
  const age = monthsSincePeriod(newest, now);
  if (age === null) return null;
  return { period: newest, age: age, cadence: cadence, allowed: MAX_AGE_MONTHS[cadence], stale: age > MAX_AGE_MONTHS[cadence] };
}

/**
 * Age of an observation in months. Negative while the period is still open.
 *
 * Whole months for the calendar grid, where a month index locates the period
 * exactly. **Fractional for a week**, where it cannot: `2026-W28` and
 * `2026-W31` share July, so a month index reports the same age for
 * observations three weeks apart, and a weekly allowance built on it would be
 * quantised to four-and-a-third cadence units. The unit stays months so there
 * is one age function and one allowance table — `MAX_AGE_MONTHS` — rather than
 * a second vocabulary that can disagree with the first.
 */
function monthsSincePeriod(period, now) {
  const d = now || new Date();
  const end = periodEndMs(period);
  if (end !== null) return (d.getTime() - end) / AVG_MONTH_MS;
  const idx = periodToMonthIndex(period);
  if (idx === null) return null;
  return (d.getUTCFullYear() * 12 + d.getUTCMonth() + 1) - idx;
}

/**
 * Longest a series may go without a new observation before we call it frozen
 * rather than merely lagging.
 *
 * Deliberately generous — roughly twice the worst real publication lag observed
 * across the registry — because this is a gate, and a gate that red-lights a
 * correct pull request because Eurostat was a fortnight late teaches people to
 * bypass gates. It is sized to catch a dataset that has stopped moving, which
 * is what actually happened: the ECOICOP ver.1 HICP tables were frozen at
 * 2025-12 and every monthly inflation chart sat eight months out of date while
 * every existing assertion stayed green.
 *
 * An indicator whose upstream is legitimately slower may override with
 * `maxAgeMonths`, which is a declaration a reviewer can weigh.
 *
 * `W` is measured rather than reasoned. `demo_r_mwk_ts` is provisional weekly
 * mortality and each statistics office files at its own pace: on 2026-08-28
 * Latvia's newest observation was `2026-W28` and Estonia's and Lithuania's
 * `2026-W27`, ages of 1.53 and 1.77 months, while the cube already carried
 * time coordinates out to `2026-W32`. Twice the slower of those is 3.5, so 3
 * is slightly tighter than the policy above rather than looser — and it is a
 * real bound, not the `|| 30` annual fallback a missing rung would have given
 * a weekly series.
 *
 * Note the trap in that measurement, because the survey this work came from
 * fell into it: the newest *coordinate* was 19 days old and the newest
 * *observation* was 47. Reading the time dimension rather than the values
 * understates the lag of a lagging feed by a factor of two and a half.
 */
const MAX_AGE_MONTHS = { W: 3, M: 6, Q: 12, S: 18, A: 30 };

/**
 * The frequencies a definition may declare, and the single place they are
 * listed.
 *
 * The vocabulary lived in four copies — this table, `EXPECTED_STEP` in the live
 * contract, and a `'A' | 'S' | 'Q' | 'M'` literal in each of two test files —
 * with nothing tying them together. That is the shape where a union grows a
 * member and a lookup table does not, and no toolchain notices: TypeScript
 * checks the literals against each other never, and `MAX_AGE_MONTHS` is plain
 * JavaScript.
 *
 * The failure would have been silent in the direction that matters. A frequency
 * absent from the table falls to the `|| 30` below, which is the *annual*
 * allowance — so a new weekly or daily series would be allowed to sit thirty
 * months stale before the freshness gate said anything, which is the exact
 * failure `MAX_AGE_MONTHS` exists to prevent.
 *
 * That paragraph was written before a weekly series existed and named the case
 * exactly. `W` is now here, and the same list is what stopped the addition
 * being half-done: `tests/indicators.test.ts` compares this against
 * `MAX_AGE_MONTHS` in both directions, and the live contract's `EXPECTED_STEP`
 * is keyed on the union so a missing member is a compile error rather than an
 * `undefined` lookup.
 */
const FREQUENCIES = Object.freeze(['W', 'M', 'Q', 'S', 'A']);

function maxAgeMonths(def) {
  if (def && typeof def.maxAgeMonths === 'number') return def.maxAgeMonths;
  return (def && MAX_AGE_MONTHS[def.freq]) || 30;
}

module.exports = {
  EUROSTAT_BASE: EUROSTAT_BASE,
  httpText: httpTextRetrying,
  httpJson: httpJson,
  withRetry: withRetry,
  parseJsonStat: parseJsonStat,
  parseJsonStatDim: parseJsonStatDim,
  sincePeriod: sincePeriod,
  buildUrl: buildUrl,
  periodToMonthIndex: periodToMonthIndex,
  periodToWeekIndex: periodToWeekIndex,
  periodEndMs: periodEndMs,
  periodCadence: periodCadence,
  monthsSincePeriod: monthsSincePeriod,
  isSeriesStale: isSeriesStale,
  maxAgeMonths: maxAgeMonths,
  MAX_AGE_MONTHS: MAX_AGE_MONTHS,
  FREQUENCIES: FREQUENCIES,
  AVG_MONTH_MS: AVG_MONTH_MS,
  WEEK_MS: WEEK_MS,
};
