const ckan = require('../shared/ckan.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

async function projectResource() {
  const pkg = await ckan.ckan('package_show', { id: 'eiropas-savienibas-atveselosanas-fonda-lidzfinansetie-projekti' });
  const resource = (pkg.resources || []).find(function (r) {
    return r.datastore_active && r.name === 'AF projektu saraksts';
  });
  if (!resource || !/^[0-9a-f-]{36}$/i.test(resource.id)) throw new Error('EU funds project list unavailable');
  return resource;
}

/**
 * GET /api/eu-funds
 *
 * Returns EU Recovery & Resilience Fund projects for Latvia.
 * Data from: eiropas-savienibas-atveselosanas-fonda-lidzfinansetie-projekti
 */
const handler = async function (context, req) {
  try {
    var resource = await projectResource();
    var results = await Promise.all([
      ckan.ckan('datastore_search', {
        resource_id: resource.id,
        limit: 20,
        sort: 'PedejasDatuAtjauninasanasDatums desc,ProjektaNumurs asc',
        fields: 'ProjektaNumurs,ProjektaStatuss,PedejasDatuAtjauninasanasDatums',
      }),
      ckan.ckan('datastore_search_sql', {
        sql: 'SELECT "ProjektaStatuss" AS status, COUNT(*) AS count FROM "' + resource.id + '" GROUP BY "ProjektaStatuss"',
      }),
    ]);
    var records = results[0].records;
    var total = results[0].total;
    if (!Array.isArray(records) || !Number.isFinite(total) || !Array.isArray(results[1].records)) {
      throw new Error('EU funds returned an incomplete project list');
    }
    var statusSummary = results[1].records
      .map(function (r) {
        var count = Number(r.count);
        if (!Number.isFinite(count) || count < 0) throw new Error('EU funds returned an invalid status count');
        return { status: r.status || 'Unknown', count: count };
      })
      .sort(function (a, b) { return b.count - a.count; });

    // The datastore sorts by project update, not by amendment version.
    var projects = records.slice(0, 20).map(function (rec) {
      return {
        number: rec['ProjektaNumurs'] || '',
        version: '',
        date: rec['PedejasDatuAtjauninasanasDatums'] || '',
        status: rec['ProjektaStatuss'] || '',
      };
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        projects: projects,
        statusSummary: statusSummary,
        total: total,
        dateMeaning: 'Project data last updated',
        source: 'ES Atveseļošanas fonds (data.gov.lv, CC0)',
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
  name: 'eu-funds',
  keyOn: [],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
