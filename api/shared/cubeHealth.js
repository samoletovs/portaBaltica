/**
 * The newest observation in a Eurostat cube.
 *
 * This began as a maritime-specific health check that answered "is this cube
 * alive and moving" in one call. Extraction and policy have since been split:
 * this module finds the newest observation, and `freshness.js` decides whether
 * that is old enough to matter, against the cadence each source declares. One
 * function deciding both meant maritime's two-quarter publication lag and
 * Elering's six hours were being judged by the same constant, which is only
 * possible if the constant is wrong for at least one of them.
 *
 * What it guards against is unchanged, and worth restating because it is subtle
 * in both directions:
 *
 *   - **A cube is padded to its newest column for every key it contains.** The
 *     Europe-wide `mar_tf_qm` runs to whatever quarter any European port has
 *     filed; Riga is routinely a quarter or two behind that. Asking whether one
 *     specific key filled the last column reports a healthy source as dead, and
 *     did — production sat at `degraded` for weeks while `/api/port-data`
 *     served complete statistics for all three countries.
 *
 *   - **A frozen cube's last column still carries a value.** So the same
 *     question, asked of a table that stopped being updated, answers yes for
 *     ever. That is how the ECOICOP ver.1 HICP tables stayed green through
 *     eight months of serving 2025-12.
 *
 * Both come from asking whether the last column has a number in it. The
 * question that separates them is *when* the newest observation is from, which
 * is what this returns.
 */

const es = require('./eurostat.js');

/**
 * Newest period anywhere in the cube that carries a value, or null.
 *
 * Every key's series is folded together on purpose: the question is whether the
 * table has been updated, not whether one particular port or country has filed.
 * Null means the cube parsed but holds no observation at all — an emptied cube,
 * which is a fault rather than a lag, and callers must not read it as fresh.
 */
function newestPeriod(body, keyDim, wanted) {
  const parsed = es.parseJsonStatDim(body, keyDim, wanted || null);
  const keys = Object.keys(parsed.series);
  if (keys.length === 0) return null;

  let newest = null;
  let newestIdx = -Infinity;

  keys.forEach(function (key) {
    const points = parsed.series[key].series || [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p || p.value === null || p.value === undefined) continue;
      const idx = es.periodToMonthIndex(p.period);
      if (idx === null || idx <= newestIdx) continue;
      newestIdx = idx;
      newest = p.period;
    }
  });

  return newest;
}

/** `newestPeriod` in the shape `freshness.judge` consumes, or null. */
function newestObservation(body, keyDim, wanted) {
  const period = newestPeriod(body, keyDim, wanted);
  return period === null ? null : { period: period };
}

module.exports = {
  newestPeriod: newestPeriod,
  newestObservation: newestObservation,
};
