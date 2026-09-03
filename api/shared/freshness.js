/**
 * Is a source still moving, and how would we know?
 *
 * `/api/system-status` could tell you every upstream answered. It could not
 * tell you whether any of them had said anything new. Those are different
 * questions and only the second one catches the failure that actually happens:
 *
 *   - `prc_hicp_manr` sat frozen at 2025-12 for eight months while answering
 *     HTTP 200 with valid JSON-stat and entirely plausible values. Every
 *     inflation chart on the site was eight months stale and every check was
 *     green.
 *   - data.gov.lv served eighteen consecutive header-only CSVs. The host was
 *     up, the dataset existed, `datastore_active` stayed true.
 *
 * Both are reachable, well-formed and dead. A liveness probe cannot see either,
 * because nothing about the response is wrong — it is just old.
 *
 * So every probe declares the cadence it expects and how many cadence-units of
 * lag are tolerable, and the answer is judged against the age of the newest
 * observation it can find. One global threshold would not do: Elering is
 * hourly, ECB daily, Eurostat monthly or quarterly, and Eurostat's maritime
 * tables run two quarters behind as normal operation. A threshold tight enough
 * to catch a frozen hourly feed would red-light maritime permanently, and a
 * gate that cries wolf is one people learn to route around.
 *
 * Where a source genuinely cannot report when it last changed, that is recorded
 * as `unknown` and stated on the page. "I cannot tell" must never render as
 * "fresh", which is the default that let the HICP freeze run for eight months.
 */

const es = require('./eurostat.js');
const ecb = require('./ecb.js');

/**
 * Milliseconds per cadence unit.
 *
 * Months, quarters and years are averages — 30.44 days, and so on. That is
 * imprecise by up to a day or two at the margin, which does not matter: these
 * bounds are deliberately generous and nothing turns on whether a quarterly
 * table is 2.9 or 3.0 quarters late.
 *
 * The month is read from `api/shared/eurostat.js` rather than restated, because
 * that file now measures ages in months too and the two would have been the
 * same number written twice with nothing comparing them.
 */
const UNIT_MS = {
  H: 3600e3,
  D: 86400e3,
  W: es.WEEK_MS,
  M: es.AVG_MONTH_MS,
  Q: es.AVG_MONTH_MS * 3,
  A: es.AVG_MONTH_MS * 12,
};

const CADENCES = Object.keys(UNIT_MS);

/** Human name for a cadence, for the reason string on a stale verdict. */
const CADENCE_NAME = {
  H: 'hourly', D: 'daily', W: 'weekly', M: 'monthly', Q: 'quarterly', A: 'annual',
};

/**
 * Age of an observation, expressed in the source's own cadence units.
 *
 * Accepts either a timestamp (`at`) or a statistical period label (`period`).
 * Both occur: Elering and the ECB stamp their data with a moment, Eurostat and
 * PxWeb date theirs by the period it describes. A period resolves to the last
 * month it covers, via the same `periodToMonthIndex` the rest of the codebase
 * uses, so `2026-Q1` is March 2026 rather than January — except for a period
 * shorter than a month, which is located to the millisecond instead because a
 * month index cannot distinguish the weeks inside one.
 *
 * Returns null when it cannot tell, never zero.
 */
function ageInUnits(cadence, observation, now) {
  const per = UNIT_MS[cadence];
  if (!per || !observation) return null;

  const at = new Date(now || Date.now()).getTime();
  if (!Number.isFinite(at)) return null;

  if (observation.at !== undefined && observation.at !== null) {
    const seen = observation.at instanceof Date
      ? observation.at.getTime()
      : Date.parse(observation.at);
    if (!Number.isFinite(seen)) return null;
    return (at - seen) / per;
  }

  if (observation.period) {
    // A period finer than a month has to be located exactly, because a month
    // index cannot tell `2026-W28` from `2026-W30` — they share July. Before
    // `periodToMonthIndex` learned to read a weekly label this branch returned
    // null and the verdict was an honest `unknown`; teaching it the label
    // without this line would have replaced that with a confident number 36%
    // too small, which is the worse of the two failures.
    const end = es.periodEndMs(observation.period);
    if (end !== null) return (at - end) / per;

    const idx = es.periodToMonthIndex(observation.period);
    if (idx === null) return null;
    const d = new Date(at);
    const nowIdx = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
    return ((nowIdx - idx) * UNIT_MS.M) / per;
  }

  return null;
}

/**
 * Fresh, stale, or unknown.
 *
 * A negative age is fresh: Elering publishes tomorrow's prices and Open-Meteo
 * forecasts forward, so data ahead of now is normal rather than suspicious.
 *
 * `stale` is deliberately not `unhealthy`. A source that is reachable but
 * frozen is a different message to a reader — and a different thing to do about
 * it — than one that is down, and the status page could not previously say
 * which. Flattening the two is how a real freeze hides behind a green light.
 *
 * Two things a source may say about itself override what we would infer:
 *
 *   - **`observation.stale`** — a source able to tell us directly that it is
 *     not advancing is more authoritative than an age calculation. The newsroom
 *     run report is the case in point: a pipeline that ran on time, wrote five
 *     articles and published none of them has a perfectly current timestamp and
 *     is plainly not producing.
 *   - **`observation.maxLag`** — a source that declares its own tolerance beats
 *     our guess and cannot drift out of step with it. The run report carries
 *     `stale_after_hours` precisely so a probe need not hardcode a cron someone
 *     may change, and when the newsroom moved from one run a day to three, a
 *     bound copied into our registry would have quietly become wrong.
 */
function judge(check, observation, now) {
  const cadence = check && check.cadence;

  if (observation && observation.stale) {
    return {
      state: 'stale',
      reason: observation.staleReason || 'the source reports it is not advancing',
    };
  }

  if (!cadence) {
    return {
      state: 'unknown',
      reason: (check && check.freshnessNote) || 'this source reports no observation time',
    };
  }

  const age = ageInUnits(cadence, observation, now);
  if (age === null) {
    return { state: 'unknown', reason: 'the response carried no observation time' };
  }

  const declared = observation && observation.maxLag;
  const limit = typeof declared === 'number' && declared > 0 ? declared : check.maxLag;

  // No usable bound, no verdict.
  //
  // This function's contract is that it answers `unknown` and never `fresh`
  // when it cannot tell — the comment above says "I cannot tell" must never
  // render as fresh, and the registry test requires every declared cadence to
  // carry a positive `maxLag`. Without this branch the code contradicted both:
  // `age > undefined` is false for every age, so a check whose `maxLag` went
  // missing would report `fresh` for ever. Measured rather than reasoned — a
  // seven-year-old observation returns `fresh` with `maxLag` deleted and
  // `stale` with it present.
  //
  // No registry entry can reach this today, and it is not being closed as
  // defence against an unreachable state. It is closed because the alternative
  // is a function that documents one behaviour and performs another, which is
  // the more expensive kind of wrong: the next reader trusts the comment.
  if (typeof limit !== 'number' || !(limit > 0)) {
    return {
      state: 'unknown',
      age: Math.round(age * 10) / 10,
      cadence: cadence,
      reason: 'this source declares a cadence but no bound to judge it against',
    };
  }

  const rounded = Math.round(age * 10) / 10;
  const shared = { age: rounded, limit: limit, cadence: cadence };

  if (age > limit) {
    return Object.assign({ state: 'stale' }, shared, {
      reason: 'Newest observation is ' + rounded + ' ' + CADENCE_NAME[cadence] +
        ' units old; this source may trail ' + limit,
    });
  }

  return Object.assign({ state: 'fresh' }, shared, { reason: null });
}

/**
 * Pulling "when did this last change" out of each upstream's own shape.
 *
 * Kept as pure functions of an already-parsed body so each can be asserted
 * against a captured real response without the network. These are precisely the
 * code that fails silently: an extractor that returns null for a healthy source
 * downgrades it to `unknown` for ever, and nobody notices because the page
 * still looks fine.
 */

/**
 * Treat a zoneless timestamp as UTC rather than as host-local.
 *
 * Both CKAN (`2026-08-26 05:01:28`) and Open-Meteo (`2026-08-26T12:45`) emit
 * times with no zone designator, and both mean UTC. `Date.parse` reads a
 * zoneless datetime as *local*, so on the UTC host these run on the answer is
 * right and on a developer's machine in Riga it is three hours out — a bug that
 * only appears in one environment, which is the worst kind. It cost a
 * three-hour error on the CKAN reading before a test caught it.
 */
function asUtc(text) {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : text + 'Z';
}

const extract = {
  /**
   * ECB publishes one `<Cube time='YYYY-MM-DD'>` per daily reference set.
   *
   * Delegates to `shared/ecb.js` rather than carrying its own pattern. This
   * used to match `time=` with its own tolerant regex while `economy-data`
   * matched `currency=`/`rate=` with a much stricter one, so the two could
   * disagree about the same document — and only in one direction, because the
   * tolerant one was the probe. A valid double-quoted reserialisation left
   * this returning a date while the currency ticker rendered nothing.
   */
  ecbXml: function (xml) {
    const parsed = ecb.parseDaily(xml);
    if (parsed.referenceDate === null) return null;
    // Dated at end of day: the rates are for that date, and treating them as
    // midnight would make a same-day publication look a day old.
    return { at: parsed.referenceDate + 'T23:59:59Z' };
  },

  /** Elering returns `{ data: { lv: [{ timestamp, price }], ... } }`, unix seconds. */
  elering: function (body) {
    const data = body && body.data;
    if (!data || typeof data !== 'object') return null;
    let newest = null;
    Object.keys(data).forEach(function (zone) {
      const points = data[zone];
      if (!Array.isArray(points)) return;
      points.forEach(function (p) {
        if (!p || typeof p.timestamp !== 'number') return;
        if (newest === null || p.timestamp > newest) newest = p.timestamp;
      });
    });
    return newest === null ? null : { at: new Date(newest * 1000) };
  },

  /**
   * Elering's `system/with-plan` carries metered actuals *and* a forecast, and
   * only the actuals say anything about whether the feed is alive.
   *
   * This is the reason the generic `elering` extractor above cannot be reused:
   * it takes the newest timestamp across every key of `data`, which for this
   * endpoint means `plan` as well as `real`. Measured against the live feed,
   * `real` ended 77 minutes in the past while `plan` ran 178 minutes into the
   * *future* — so a probe reading the newest row would compute a negative age
   * and report the source fresh forever, including on the day metering stopped.
   * A probe that cannot fail is not a probe.
   *
   * It also matches what the consumer reads: `/api/live-grid` sets `meteredTo`
   * from `newestWithProduction(actual)`, so a row present but carrying no
   * production is not a reading there and is not one here either.
   */
  eleringMetered: function (body) {
    const rows = body && body.data && body.data.real;
    if (!Array.isArray(rows)) return null;
    let newest = null;
    rows.forEach(function (r) {
      if (!r || typeof r.timestamp !== 'number') return;
      if (typeof r.production !== 'number' || !Number.isFinite(r.production)) return;
      if (newest === null || r.timestamp > newest) newest = r.timestamp;
    });
    return newest === null ? null : { at: new Date(newest * 1000) };
  },

  /** Open-Meteo stamps `current.time`, in the timezone the query asked for. */
  openMeteo: function (body) {
    const time = body && body.current && body.current.time;
    if (typeof time !== 'string') return null;
    // The probe does not request a `timezone`, so this is UTC. A bare
    // `YYYY-MM-DDTHH:mm` carries no zone designator, and `Date.parse` would
    // read it as host-local.
    const withSeconds = /T\d{2}:\d{2}$/.test(time) ? time + ':00' : time;
    return { at: asUtc(withSeconds) };
  },

  /**
   * PxWeb table metadata lists every value of every variable; the one flagged
   * `time` ends with the newest period the table carries. Its labels are CSP's
   * own vocabulary — `2026Q1`, `2026M07` — which `periodToMonthIndex` already
   * reads alongside Eurostat's.
   */
  pxwebMetadata: function (body) {
    const variables = body && body.variables;
    if (!Array.isArray(variables)) return null;
    const time = variables.find(function (v) {
      return v && (v.time === true || v.code === 'TIME');
    });
    const values = time && time.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    return { period: values[values.length - 1] };
  },

  /**
   * The newest `last_modified` across the datastore-active resources of a set
   * of CKAN packages.
   *
   * Only active resources count: `pvn-maksataji` carries a JSON resource last
   * touched in 2020 alongside a CSV updated this morning, and reading the wrong
   * one would report a live feed as six years dead.
   *
   * This is a weaker signal than it looks, and the limit is worth stating: the
   * discontinued maritime CSVs were *re-uploaded* every week while containing
   * nothing but a header row, so `last_modified` advanced the whole time. It
   * catches a publisher that stops; it does not catch one that keeps publishing
   * nothing. Only row count would have caught that, and no dataset we still
   * read is in that state.
   */
  ckanResources: function (packages) {
    let newest = null;
    (packages || []).forEach(function (pkg) {
      const resources = (pkg && pkg.result && pkg.result.resources) || [];
      resources.forEach(function (r) {
        if (!r || !r.datastore_active || !r.last_modified) return;
        const t = Date.parse(asUtc(String(r.last_modified).replace(' ', 'T')));
        if (!Number.isFinite(t)) return;
        if (newest === null || t > newest) newest = t;
      });
    });
    return newest === null ? null : { at: new Date(newest) };
  },
};

/**
 * How late a published series may be before a *reader* is warned about it.
 *
 * WHY THIS IS NOT `MAX_AGE_MONTHS`, WHICH IS THE WHOLE POINT
 * ----------------------------------------------------------
 * `MAX_AGE_MONTHS` in `eurostat.js` answers "is this feed **dead**" — it is a
 * failover threshold, sized at roughly twice the worst real publication lag so
 * that `/api/historical-data` can decide to abandon a source. Measured against
 * production on 2026-08-29, **nothing on the dashboard comes within a third of
 * it**: 0 of 213 series are stale by that verdict and the worst sits at 67% of
 * its own allowance. Reusing it to decide what a reader sees would light up
 * nothing, for ever, while nine series twenty months old were presented as
 * current.
 *
 * "Should a reader see a warning" is a different question and needs its own
 * numbers.
 *
 * WHY NOT A FRACTION OF THE FAILOVER TABLE
 * ----------------------------------------
 * The obvious economy — warn at some percentage of `MAX_AGE_MONTHS` — was
 * measured and rejected. That table is not a uniform multiple of normal lag,
 * so a single percentage means something different for each cadence. Median
 * observed age as a fraction of the failover allowance, 213 series:
 *
 *     W 60%      M 17%      Q 42%      S 44%      A 27%
 *
 * A line at 60% would therefore flag the *median weekly series* while leaving
 * monthly data untouched until it was three times its typical age.
 *
 * WHY NOT "MORE THAN N PUBLICATION PERIODS BEHIND"
 * -----------------------------------------------
 * That was this work's own first recommendation and re-measuring inverted it.
 * Publication lag does not scale with cadence: annual statistics arrive under
 * one period after the period closes, provisional weekly mortality arrives
 * seven. So `> 2 periods` flags **0 of the 9** twenty-month series that
 * motivated the exercise (they are 1.67 periods behind) and **3 of 3**
 * `weekly_deaths` series, whose seven-week lag `AGENTS.md` documents as normal.
 * Precisely inverted: silent on the oldest thing on the dashboard, loud on one
 * of the freshest.
 *
 * WHERE THESE NUMBERS COME FROM
 * -----------------------------
 * Each is sited in an empty gap in the observed distribution, so the line
 * separates clusters rather than cutting one. Ages in months, 213 series,
 * measured 2026-08-29:
 *
 *     A   39 series at 8 ····· 12 months of empty space ····· 9 at 20     -> 14
 *     Q   21 at 2, 60 at 5 ···· 3 months empty ···· 9 at 8               ->  6
 *     M   4 at 0, 32 at 1, 20 at 2, 2 at 3 ····· 2 at 4                  ->  3
 *     S   3 at -4 (published ahead) ····· 9 at 8, which is all of them   -> 12
 *     W   3 series, 1.6 to 1.8                                           ->  3
 *
 * The justification is a peer comparison rather than an invented constant:
 * within one cadence, 39 annual series reach 8 months, which is what makes 20
 * a statement about those nine rather than about annual statistics.
 *
 * `W` is deliberately equal to its failover bound rather than below it. There
 * is one weekly indicator and three series — too thin a population to site a
 * separate line on, and `MAX_AGE_MONTHS.W` is already tighter than the others
 * relative to normal lag (3 months against a 1.8-month median). A weekly series
 * therefore warns exactly when it fails over, and that is a stated decision
 * rather than an oversight. Revisit it when there is more than one weekly feed.
 *
 * `S` sits above every observed semi-annual series on purpose: all twelve are
 * at 8 months, which is the normal state for a semester table, so a line below
 * that would fire permanently on every one of them.
 */
const WARN_AFTER_MONTHS = { W: 3, M: 3, Q: 6, S: 12, A: 14 };

/**
 * Is this series late enough that a reader should be told?
 *
 * Built on `es.isSeriesStale`, so the newest observation is selected once, by
 * the code that already does it correctly — including skipping nulls, and
 * ordering weeks by week rather than by the month four of them share.
 *
 * Returns null when the age cannot be established, which callers must render as
 * "unknown" rather than as "current". A series whose period we cannot read is
 * not evidence that it is fresh.
 */
function judgeSeriesLateness(series, now) {
  const verdict = es.isSeriesStale(series, now);
  if (!verdict) return null;

  const warnAfter = WARN_AFTER_MONTHS[verdict.cadence];
  // No bound, no verdict. `judge` above documents the same contract and for the
  // same reason: `age > undefined` is false for every age, so a missing entry
  // would silently report every series of that cadence as timely for ever.
  if (typeof warnAfter !== 'number') {
    return {
      period: verdict.period,
      monthsBehind: verdict.age,
      cadence: verdict.cadence,
      late: null,
      stale: verdict.stale,
      reason: 'no reader-facing bound is declared for cadence ' + verdict.cadence,
    };
  }

  return {
    period: verdict.period,
    monthsBehind: verdict.age,
    cadence: verdict.cadence,
    // The two thresholds this verdict was reached against are deliberately NOT
    // shipped. They were, and nothing read them — not the client, which holds
    // its own `WARN_AFTER_MONTHS` and `STALE_AFTER_MONTHS` in
    // `src/dataFreshness.ts`, and not a test. Two assertions pin the client's
    // tables to these ones by comparing the MODULE CONSTANTS —
    // `dataFreshness.test.ts` on the warn table and `dashboardCadence.test.tsx`
    // on the stale table — so a consumer that has the client already has the
    // numbers, guaranteed equal, and one that does not has `cadence` to look
    // them up by. Shipping them made six fields per `/api/baltic-compare`
    // response that no reader could have needed.
    //
    // `monthsBehind` and `cadence` stay because they are per-series evidence
    // for this verdict and cannot be derived from a constant table; a threshold
    // is a lookup, not a measurement.
    late: verdict.age > warnAfter,
    stale: verdict.stale,
    reason: null,
  };
}

module.exports = {
  UNIT_MS: UNIT_MS,
  CADENCES: CADENCES,
  CADENCE_NAME: CADENCE_NAME,
  WARN_AFTER_MONTHS: WARN_AFTER_MONTHS,
  ageInUnits: ageInUnits,
  judge: judge,
  judgeSeriesLateness: judgeSeriesLateness,
  extract: extract,
};
