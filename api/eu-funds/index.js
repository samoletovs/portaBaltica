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

async function getLatestActiveResource(datasetId) {
  try {
    var pkg = await jsonGet(CKAN_API + '/package_show?id=' + datasetId);
    var resources = (pkg.result && pkg.result.resources) || [];
    var active = resources.filter(function (r) { return r.datastore_active; });
    return active.length > 0 ? active[active.length - 1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * GET /api/eu-funds
 *
 * Returns EU Recovery & Resilience Fund projects for Latvia.
 * Data from: eiropas-savienibas-atveselosanas-fonda-lidzfinansetie-projekti
 */
module.exports = async function (context, req) {
  try {
    var resource = await getLatestActiveResource('eiropas-savienibas-atveselosanas-fonda-lidzfinansetie-projekti');
    if (!resource) {
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [], total: 0, fetchedAt: new Date().toISOString() }),
      };
      return;
    }

    var data = await jsonGet(CKAN_API + '/datastore_search?resource_id=' + resource.id + '&limit=200');
    var records = (data.result && data.result.records) || [];
    var total = (data.result && data.result.total) || 0;

    // Group by status
    var byStatus = {};
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var status = rec['Statuss'] || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    var statusSummary = Object.entries(byStatus)
      .map(function (e) { return { status: e[0], count: e[1] }; })
      .sort(function (a, b) { return b.count - a.count; });

    // Return latest projects with summary
    var projects = records.slice(0, 20).map(function (rec) {
      return {
        number: rec['ProjektaNumurs'] || '',
        version: rec['Numurs'] || '',
        date: rec['SpekaStasanasDatums'] || '',
        status: rec['Statuss'] || '',
      };
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        projects: projects,
        statusSummary: statusSummary,
        total: total,
        source: 'ES Atveseļošanas fonds (data.gov.lv, CC0)',
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
