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
const UBO_RESOURCE_ID = '20a9b26d-d056-4dbb-ae18-9ff23c87bdee';

/**
 * GET /api/business-search?q=SEARCH_TERM
 *
 * Searches the UBO (beneficial owners) registry by company registration number
 * or person surname. Returns matching records from the official PLG dataset.
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

  // Sanitize input — only allow alphanumeric, spaces, and Latvian diacritics
  query = query.replace(/[^\w\sāčēģīķļņōŗšūžĀČĒĢĪĶĻŅŌŖŠŪŽ-]/gi, '').trim();

  try {
    var results = [];

    // Try as registration number first (numeric)
    if (/^\d+$/.test(query)) {
      var url = CKAN_API + '/datastore_search?resource_id=' + UBO_RESOURCE_ID +
        '&filters=' + encodeURIComponent(JSON.stringify({ legal_entity_registration_number: query })) +
        '&limit=50';
      var data = await jsonGet(url);
      results = (data.result && data.result.records) || [];
    }

    // Also search by surname (text search)
    if (results.length === 0) {
      var textUrl = CKAN_API + '/datastore_search?resource_id=' + UBO_RESOURCE_ID +
        '&q=' + encodeURIComponent(query) +
        '&limit=50';
      var textData = await jsonGet(textUrl);
      results = (textData.result && textData.result.records) || [];
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
        totalMatches: results.length,
        companies: Object.values(byCompany),
        source: 'Patiesie labuma guvēji (data.gov.lv, CC0)',
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
