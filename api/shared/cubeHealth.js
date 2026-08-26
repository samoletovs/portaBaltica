/**
 * Is a Eurostat cube alive, and is it still moving?
 *
 * Split out of `/api/system-status` because a health probe is worth exactly as
 * much as its verdict function, and that function has to be assertable without
 * the network. The maritime probe had failed in *both* directions at once while
 * looking perfectly reasonable in review:
 *
 *   - **False red.** It asked `mar_tf_qm` for `lastTimePeriod=1`. That cube is
 *     Europe-wide, so its newest period is the newest quarter *any* European
 *     port has filed — 2026-Q2 when this was written. Riga was on 2025-Q4, as
 *     it normally is, so the probe received a single all-null cell, reported
 *     "Cube answered but carries no observation", and held the whole status
 *     page at `degraded` while `/api/port-data` served complete statistics for
 *     Latvia, Estonia and Lithuania. That half is fixed by asking for a window
 *     of quarters instead of one column.
 *
 *   - **False green.** Had Eurostat stopped publishing, the cube's newest
 *     period would have been whatever it last managed, and that period *does*
 *     carry a value — so the same probe would have gone green and stayed green.
 *     That is not hypothetical: it is how data.gov.lv served eighteen
 *     consecutive header-only CSVs without tripping a single check. That half
 *     is fixed here, by judging age rather than mere presence.
 *
 * Both come from asking "does the last column have a number in it", which
 * cannot separate a normal publication lag from a dead feed. The question that
 * can is how old the newest observation *anywhere* in the cube is, measured
 * against the cadence it is published at.
 *
 * Thresholds come from `MAX_AGE_MONTHS` in `eurostat.js`, so the server judges
 * staleness the same way `src/dataFreshness.ts` does on the client. A probe
 * that disagreed with the banner shown to readers would just be a third opinion
 * to reconcile.
 */

const es = require('./eurostat.js');

/**
 * Newest observation in the cube, and whether it is old enough to call the
 * source stopped rather than merely in arrears.
 *
 * Every key's series is folded into one before judging, because the question is
 * "has this table been updated recently", not "has this particular port filed".
 * A cube is padded to its newest column for every key it contains, so requiring
 * one specific key to have filed the newest quarter is what produced the false
 * red.
 *
 * Returns `{ ok, period, age, reason }`. `reason` is a sentence a human can act
 * on; `period` and `age` are reported even on success, so the status page can
 * show which quarter the verdict rests on and a wrong threshold is visible
 * rather than inferred.
 */
function judgeCube(body, keyDim, options) {
  const opts = options || {};
  const parsed = es.parseJsonStatDim(body, keyDim, opts.wanted || null);
  const keys = Object.keys(parsed.series);

  if (keys.length === 0) {
    return { ok: false, period: null, age: null, reason: 'Cube carries no ' + keyDim + ' series' };
  }

  const points = [];
  keys.forEach(function (key) {
    const series = parsed.series[key].series || [];
    for (let i = 0; i < series.length; i++) points.push(series[i]);
  });

  const verdict = es.isSeriesStale(points, opts.now);

  // `isSeriesStale` returns null when it cannot tell — an empty series, or
  // period labels it does not recognise. "Cannot tell" must not read as fresh.
  if (verdict === null) {
    return { ok: false, period: null, age: null, reason: 'Cube answered but carries no observation' };
  }

  if (verdict.stale) {
    return {
      ok: false,
      period: verdict.period,
      age: verdict.age,
      reason: 'Newest observation is ' + verdict.period + ', ' + verdict.age +
        ' months old; a ' + verdict.cadence + ' series may trail ' + verdict.allowed,
    };
  }

  return { ok: true, period: verdict.period, age: verdict.age, reason: null };
}

module.exports = { judgeCube: judgeCube };
