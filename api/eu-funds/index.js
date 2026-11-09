const ckan = require('../shared/ckan.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const { failureResponse } = require('../shared/handlerFailure.js');

async function projectResource() {
  const pkg = await ckan.ckan('package_show', { id: 'eiropas-savienibas-atveselosanas-fonda-lidzfinansetie-projekti' });
  // CKAN reports datastore_active=false for this resource while both project
  // queries still succeed. Query results, not that metadata flag, prove access.
  const resource = (pkg.resources || []).find(function (r) {
    return r.name === 'AF projektu saraksts';
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
    // The small project list needs no SQL service. Scan every page before
    // counting statuses, so the summary and total describe the same population.
    var records = await ckan.scanFields(resource.id, [
      'ProjektaNumurs', 'ProjektaStatuss', 'PedejasDatuAtjauninasanasDatums',
    ]);
    var total = records.length;
    var counts = new Map();
    records.forEach(function (r) {
      var status = r.ProjektaStatuss || 'Unknown';
      counts.set(status, (counts.get(status) || 0) + 1);
    });
    var statusSummary = Array.from(counts, function (entry) {
      return { status: entry[0], count: entry[1] };
    })
      .sort(function (a, b) { return b.count - a.count; });

    // Sort by project update, not by amendment version.
    records.sort(function (a, b) {
      return String(b.PedejasDatuAtjauninasanasDatums || '').localeCompare(String(a.PedejasDatuAtjauninasanasDatums || '')) ||
        String(a.ProjektaNumurs || '').localeCompare(String(b.ProjektaNumurs || ''));
    });
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
    context.res = failureResponse(context, error);
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'eu-funds',
  keyOn: [],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
