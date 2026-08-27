/**
 * One way to read the `country` query parameter.
 *
 * **The API disagreed with itself about case.** `/api/port-data` upper-cased
 * the parameter and keyed a map of `LV|EE|LT`; `/api/economy-data`,
 * `/api/ai-insights` and `/api/environment-data` did not normalise at all and
 * keyed maps of `lv|ee|lt`. So the same value was correct on one endpoint and
 * wrong on three, and a developer moving between them had no way to know which
 * convention applied — which is how this was found.
 *
 * What made it costly was the fallback rather than the mismatch. Every one of
 * those lookups ended `|| 'lv'` or `|| CITIES_BY_COUNTRY.lv`, so an
 * unrecognised country did not fail — **it returned Latvia**:
 *
 *   var zone = zoneMap[country] || 'lv';   // zoneMap['EE'] is undefined
 *
 * `/api/ai-insights?country=EE` therefore served Latvia's electricity market
 * under an Estonian heading, and `/api/environment-data?country=EE` served
 * Riga's weather, Riga's air quality and Riga's population. Every figure real,
 * every figure the wrong country's, and nothing numeric could tell — the same
 * class as the sea-state labels and the EEA bands.
 *
 * It is also invisible to exactly the people who would notice: Latvian readers
 * see correct data, because Latvia is the default.
 *
 * So a miss returns `null` and the caller answers 400. An unrecognised country
 * is a bad request, not a request for Latvia.
 */

/** The three, canonically lower case, which is what the upstreams key on. */
const COUNTRIES = ['lv', 'ee', 'lt'];

const DEFAULT_COUNTRY = 'lv';

/**
 * The canonical lower-case code for a requested country.
 *
 * Returns `DEFAULT_COUNTRY` when nothing was asked for — a bare
 * `/api/economy-data` is a legitimate request for the default view — and `null`
 * when something was asked for and it is not one of the three. Those are
 * different situations and collapsing them is what produced the defect.
 */
function normaliseCountry(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_COUNTRY;
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return COUNTRIES.indexOf(code) >= 0 ? code : null;
}

/** The 400 a caller should return for an unrecognised country. */
function badCountry(raw) {
  return {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Unknown country: ' + String(raw) +
        '. Expected one of ' + COUNTRIES.join(', ') + ' (case-insensitive).',
    }),
  };
}

module.exports = {
  COUNTRIES: COUNTRIES,
  DEFAULT_COUNTRY: DEFAULT_COUNTRY,
  normaliseCountry: normaliseCountry,
  badCountry: badCountry,
};
