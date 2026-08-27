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

/**
 * Milliseconds per cadence unit.
 *
 * Months, quarters and years are averages — 30.44 days, and so on. That is
 * imprecise by up to a day or two at the margin, which does not matter: these
 * bounds are deliberately generous and nothing turns on whether a quarterly
 * table is 2.9 or 3.0 quarters late.
 */
const UNIT_MS = {
  H: 3600e3,
  D: 86400e3,
  W: 604800e3,
  M: 2629746e3,
  Q: 7889238e3,
  A: 31557600e3,
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
 * uses, so `2026-Q1` is March 2026 rather than January.
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
  /** ECB publishes one `<Cube time='YYYY-MM-DD'>` per daily reference set. */
  ecbXml: function (xml) {
    if (typeof xml !== 'string') return null;
    const dates = [];
    const re = /time\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/g;
    let m;
    while ((m = re.exec(xml)) !== null) dates.push(m[1]);
    if (dates.length === 0) return null;
    dates.sort();
    // Dated at end of day: the rates are for that date, and treating them as
    // midnight would make a same-day publication look a day old.
    return { at: dates[dates.length - 1] + 'T23:59:59Z' };
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

module.exports = {
  UNIT_MS: UNIT_MS,
  CADENCES: CADENCES,
  CADENCE_NAME: CADENCE_NAME,
  ageInUnits: ageInUnits,
  judge: judge,
  extract: extract,
};
