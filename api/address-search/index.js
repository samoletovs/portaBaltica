const https = require('https');

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 15000 }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

const CKAN_API = 'https://data.gov.lv/dati/api/3/action';
// Resource 6: "Building and land addresses" — 608K addresses with GPS coordinates
const ADDRESS_RESOURCE_ID = 'a510737a-18ce-400f-ad4b-04fce5228272';

/**
 * GET /api/address-search?q=SEARCH_TERM
 *
 * Searches Latvia's State Address Register (608K+ addresses).
 * Returns matching addresses with coordinates, postal codes, and municipality info.
 */
module.exports = async function (context, req) {
  var query = (req.query && req.query.q) || '';
  if (!query || query.length < 3) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Query parameter "q" required (min 3 chars)' }),
    };
    return;
  }

  // Sanitize — allow Latin, Latvian diacritics, numbers, spaces, commas, hyphens
  query = query.replace(/[^\w\sāčēģīķļņōŗšūžĀČĒĢĪĶĻŅŌŖŠŪŽ,.\-]/gi, '').trim();

  try {
    // Full-text search on the address datastore
    var url = CKAN_API + '/datastore_search?resource_id=' + ADDRESS_RESOURCE_ID +
      '&q=' + encodeURIComponent(query) +
      '&limit=20' +
      '&fields=KODS,STD,ATRIB,DD_N,DD_E,STATUSS,NOSAUKUMS';
    var data = await jsonGet(url);
    var records = (data.result && data.result.records) || [];
    var total = (data.result && data.result.total) || 0;

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
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
