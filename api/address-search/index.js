const ckan = require('../shared/ckan.js');
const { normaliseSearch } = require('../shared/searchQuery.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

// Resource 6: "Building and land addresses" — 608K addresses with GPS coordinates
const ADDRESS_RESOURCE_ID = 'a510737a-18ce-400f-ad4b-04fce5228272';

/**
 * GET /api/address-search?q=SEARCH_TERM
 *
 * Searches Latvia's State Address Register (608K+ addresses).
 * Returns matching addresses with coordinates, postal codes, and municipality info.
 */
const handler = async function (context, req) {
  var query = normaliseSearch(req.query && req.query.q, true);
  if (!query) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Query parameter "q" required (3–200 searchable characters)' }),
    };
    return;
  }

  try {
    // Full-text search on the address datastore
    var data = await ckan.ckan('datastore_search', {
      resource_id: ADDRESS_RESOURCE_ID, q: query, limit: 20,
      filters: { STATUSS: 'EKS' },
      fields: 'KODS,STD,ATRIB,DD_N,DD_E,STATUSS,NOSAUKUMS',
    });
    var records = data.records;
    var total = data.total;
    if (!Array.isArray(records) || !Number.isFinite(total)) throw new Error('Address registry returned an incomplete search');

    var addresses = records
      .filter(function (r) { return r.STATUSS === 'EKS'; }) // Only active addresses
      .map(function (r) {
        return {
          code: r.KODS,
          fullAddress: r.STD || '',
          name: r.NOSAUKUMS || '',
          postalCode: r.ATRIB || '',
          lat: r.DD_N || null,
          lon: r.DD_E || null,
        };
      });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        query: query,
        total: total,
        addresses: addresses,
        source: 'Valsts adrešu reģistrs (data.gov.lv, CC0)',
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
  name: 'address-search',
  keyOn: ['q'],
  ttlMs: 300000,
  graceMs: 900000,
  staleWhileRevalidate: false,
}));
