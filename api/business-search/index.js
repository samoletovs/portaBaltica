const ckan = require('../shared/ckan.js');
const { normaliseSearch } = require('../shared/searchQuery.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

const UBO_RESOURCE_ID = '20a9b26d-d056-4dbb-ae18-9ff23c87bdee';

/**
 * GET /api/business-search?q=SEARCH_TERM
 *
 * Searches the UBO (beneficial owners) registry by company registration number
 * or person surname. Returns matching records from the official PLG dataset.
 */
/**
 * Rows fetched per search. The list is deliberately capped — a search for a
 * common surname matches hundreds of owners and nobody reads them — but the
 * cap is a display decision and must never be reported as a count.
 */
const PAGE_LIMIT = 50;

/**
 * How many rows matched, as the datastore reports them.
 *
 * `datastore_search` returns `total` for the whole match set regardless of the
 * `limit` it honoured, so this costs nothing extra. Falls back to the number of
 * rows actually returned only when the field is missing or not a number — and
 * that fallback is safe precisely because it is only reached when the datastore
 * declined to say, rather than being the default.
 */
function totalOf(response, fallback) {
  const total = response && response.result && response.result.total;
  return typeof total === 'number' ? total : fallback;
}

const handler = async function (context, req) {
  var query = normaliseSearch(req.query && req.query.q, false);
  if (!query) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Query parameter "q" required (3–200 searchable characters)' }),
    };
    return;
  }

  try {
    var results = [];
    // How many rows MATCH, as the datastore counts them — which is a different
    // question from how many we asked it to hand back.
    //
    // This used to publish `results.length`, capped at 50, under the name
    // `totalMatches`, and `BusinessTile` renders it as `{totalMatches} matches
    // for "{query}"`. Measured against the datastore's own count: Bērziņš 904,
    // Kalniņš 652, Ozoliņš 582 — every one of them published as "50". Four of
    // four common Latvian surnames landing on exactly the page size is the
    // tell; a real count does not do that.
    var matched = null;

    // Try as registration number first (numeric)
    if (/^\d+$/.test(query)) {
      var data = { result: await ckan.ckan('datastore_search', {
        resource_id: UBO_RESOURCE_ID,
        filters: { legal_entity_registration_number: query },
        limit: PAGE_LIMIT,
      }) };
      results = (data.result && data.result.records) || [];
      matched = totalOf(data, results.length);
    }

    // Also search by surname (text search)
    if (results.length === 0) {
      var textData = { result: await ckan.ckan('datastore_search', {
        resource_id: UBO_RESOURCE_ID, q: query, limit: PAGE_LIMIT,
      }) };
      results = (textData.result && textData.result.records) || [];
      matched = totalOf(textData, results.length);
    }

    // Group by company registration number
    var byCompany = {};
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var regNum = r.legal_entity_registration_number || 'unknown';
      if (!byCompany[regNum]) {
        byCompany[regNum] = { registrationNumber: regNum, owners: [] };
      }
      byCompany[regNum].owners.push({
        forename: r.forename || '',
        surname: r.surname || '',
        nationality: r.nationality || '',
        residence: r.residence || '',
        registeredOn: r.registered_on || '',
      });
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        query: query,
        totalMatches: matched === null ? 0 : matched,
        // True when the datastore holds more matches than this response
        // carries. The count alone is not enough: corrected to 904 beside a
        // list of 50, a reader would reasonably take the 50 to be the whole
        // answer. `BusinessTile` must say the list stops.
        truncated: matched !== null && matched > results.length,
        returned: results.length,
        companies: Object.values(byCompany),
        source: 'Patiesie labuma guvēji (data.gov.lv, CC0)',
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'business-search',
  keyOn: ['q'],
  ttlMs: 300000,
  graceMs: 900000,
  staleWhileRevalidate: false,
}));
