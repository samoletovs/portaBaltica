/**
 * The European Air Quality Index, banded the way the EEA bands it.
 *
 * **We were fetching a European index and banding it with American
 * thresholds.** Open-Meteo's `european_aqi` is the EEA/CAMS index, which runs
 * in six bands at 20, 40, 60, 80 and 100. Both call sites split it at 50 and
 * 100 into Good / Moderate / Unhealthy — those are US EPA AQI breakpoints and
 * "Unhealthy" is an EPA word; the European scale does not use it.
 *
 * | European AQI | EEA band | this used to say |
 * |---|---|---|
 * | 0–20   | Good           | Good        |
 * | 20–40  | Fair           | **Good**    |
 * | 40–60  | Moderate       | **Good** below 50, Moderate above |
 * | 60–80  | Poor           | **Moderate** |
 * | 80–100 | Very poor      | **Moderate** |
 * | > 100  | Extremely poor | Unhealthy   |
 *
 * Measured against 6696 hourly readings from Riga, Tallinn and Vilnius over 92
 * days: **76.1% of readings named the air better than the European scale says
 * it is, and none named it worse.** 5050 of them called air the EEA rates
 * *Fair* "Good", and 48 called air the EEA rates *Moderate* "Good".
 *
 * The direction matters. This is the same component DESIGN.md §3.8 already
 * records for inventing a clean-air reading when the fetch failed — and it
 * turns out that even when the fetch *succeeded* the label still flattered the
 * air. A scale that only ever errs towards reassurance is worse than one that
 * errs both ways, because nothing about it ever looks alarming enough to check.
 *
 * Shared rather than duplicated because it was duplicated: `environment-data`
 * and `ai-insights` each carried their own copy of the wrong thresholds, so a
 * fix to one would have left the other quietly disagreeing.
 *
 * @see https://www.eea.europa.eu/en/topics/in-depth/air-pollution
 * @see https://open-meteo.com/en/docs/air-quality-api
 */

/**
 * Upper bound of each band, inclusive, with the EEA's own name for it.
 *
 * Written as a table rather than an `if` chain so the scale is data that can be
 * asserted against, and so adding a band cannot silently reorder the others.
 */
const EAQI_BANDS = [
  { max: 20, status: 'good', label: 'Good', rank: 1 },
  { max: 40, status: 'fair', label: 'Fair', rank: 2 },
  { max: 60, status: 'moderate', label: 'Moderate', rank: 3 },
  { max: 80, status: 'poor', label: 'Poor', rank: 4 },
  { max: 100, status: 'very-poor', label: 'Very poor', rank: 5 },
  { max: Infinity, status: 'extremely-poor', label: 'Extremely poor', rank: 6 },
];

/**
 * The EEA band for an index value, or `null` when there is no reading.
 *
 * `null` rather than a default, for the reason this whole component is a
 * cautionary tale: a failed air-quality fetch used to return
 * `{ status: 'good', label: 'Good' }` and tell a reader the air was clean on
 * the strength of a request that never completed. An absent reading has no
 * band, and the caller must say so (DESIGN.md §3.8).
 */
function classifyEuropeanAqi(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi)) return null;
  // Negative is not a reading either; the index has no values below zero.
  if (aqi < 0) return null;
  for (var i = 0; i < EAQI_BANDS.length; i++) {
    if (aqi <= EAQI_BANDS[i].max) {
      return {
        status: EAQI_BANDS[i].status,
        label: EAQI_BANDS[i].label,
        rank: EAQI_BANDS[i].rank,
      };
    }
  }
  return null;
}

module.exports = {
  EAQI_BANDS: EAQI_BANDS,
  BAND_COUNT: EAQI_BANDS.length,
  classifyEuropeanAqi: classifyEuropeanAqi,
};
