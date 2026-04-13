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
    const pkg = await jsonGet(CKAN_API + '/package_show?id=' + datasetId);
    const resources = (pkg.result && pkg.result.resources) || [];
    const active = resources.filter(function (r) { return r.datastore_active; });
    return active.length > 0 ? active[active.length - 1] : null;
  } catch (e) {
    return null;
  }
}

async function fetchDatastoreRecords(resourceId, limit) {
  try {
    const data = await jsonGet(CKAN_API + '/datastore_search?resource_id=' + resourceId + '&limit=' + (limit || 500));
    return (data.result && data.result.records) || [];
  } catch (e) {
    return [];
  }
}

async function fetchConstructionPermits() {
  const resource = await getLatestActiveResource('bis_jlyakg7hgslonjnwyrwc6w');
  if (!resource) return { permits: [], total: 0 };
  const records = await fetchDatastoreRecords(resource.id, 500);
  var byMunicipality = {};
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var municipality = rec['Atbildigas_iestades_nosaukums'] || 'Unknown';
    // Clean up: remove "būvvalde" suffix for shorter labels
    municipality = municipality.replace(/ būvvalde$/i, '').replace(/ novada$/i, ' nov.').trim();
    byMunicipality[municipality] = (byMunicipality[municipality] || 0) + 1;
  }
  var permits = Object.entries(byMunicipality)
    .map(function (e) { return { municipality: e[0], count: e[1] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 15);
  return { permits: permits, total: records.length };
}

async function fetchEnergyCerts() {
  // Use energy usage dataset (has 42K records with energy carriers per building)
  // Group by energy carrier type to show Latvia's building energy profile
  const resource = await getLatestActiveResource('bis_yjv2q8uzi-oidtg81mkifg');
  if (!resource) return { certs: [], total: 0 };
  const records = await fetchDatastoreRecords(resource.id, 500);
  var byCarrier = {};
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var carrier = rec['Energonesejs'] || 'Unknown';
    byCarrier[carrier] = (byCarrier[carrier] || 0) + 1;
  }
  var certs = Object.entries(byCarrier)
    .map(function (e) { return { rating: e[0], count: e[1] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 8);
  return { certs: certs, total: records.length };
}

module.exports = async function (context, req) {
  try {
    const [construction, energy] = await Promise.all([
      fetchConstructionPermits(),
      fetchEnergyCerts(),
    ]);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        constructionPermits: construction.permits,
        totalPermits: construction.total,
        permitsTrend: 0,
        energyCerts: energy.certs,
        totalCerts: energy.total,
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
