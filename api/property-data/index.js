const ckan = require('../shared/ckan.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const { isCodeFault, failureResponse } = require('../shared/handlerFailure.js');

async function getLatestActiveResource(datasetId) {
  const resources = await ckan.latestActiveResources(datasetId);
  if (!resources.length) throw new Error('No active resource for ' + datasetId);
  return resources[0];
}

/**
 * How many rows the resource holds, as the datastore itself reports them.
 *
 * `datastore_search` returns `total` for the whole table regardless of how many
 * rows it hands back, so this is one cheap call rather than a scan. It is a
 * separate question from how many rows we read, and conflating the two is what
 * this endpoint used to do: it published `records.length` — the page size, a
 * flat 500 — as the number of construction cases in Latvia, against a real
 * 324,119. A reader saw "500" and it was rendered with `toLocaleString()`,
 * which is to say it was presented as a count worth punctuating.
 */
async function datastoreTotal(resourceId) {
  try {
    return await ckan.countRows(resourceId);
  } catch (e) {
    if (isCodeFault(e)) throw e;
    return null;
  }
}

/**
 * Count rows per distinct value of one column, across the WHOLE table.
 *
 * The alternative — tallying a page of records in JavaScript — does not sample
 * the table, it takes a contiguous block from one end of it. `datastore_search`
 * returns rows in `_id` order, so a 500-row page of the construction dataset is
 * `_id` 1..500 of 324,119: the oldest 0.15%, and not a sample in any sense that
 * would license a ranking.
 *
 * Measured, that ranking was not merely imprecise, it was wrong about the
 * subject. The oldest 500 rows put Ādaži first with 189 cases. Across all
 * 324,119 the leader is Rīga with 52,033 — four times the next authority — and
 * Rīga does not appear in the published list at all, while Ādaži is eighth.
 *
 * Read only the grouping column, and refuse an incomplete scan rather than
 * presenting a partial ranking. The SQL action is no longer available.
 */
async function countByColumn(resourceId, column, limit) {
  const rows = await ckan.scanFields(resourceId, [column]);
  const counts = new Map();
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) {
      throw new Error('CKAN returned no ' + column + ' field');
    }
    const key = row[column] === null || String(row[column]).trim() === ''
      ? 'Unknown' : String(row[column]).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, function (entry) { return { key: entry[0], count: entry[1] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, limit || 20);
}

async function breakdown(datasetId, column, limit) {
  let total = null;
  try {
    const resource = await getLatestActiveResource(datasetId);
    const results = await Promise.all([
      countByColumn(resource.id, column, limit).then(
        function (groups) { return { groups: groups }; },
        function (error) { return { error: error }; },
      ),
      datastoreTotal(resource.id),
    ]);
    total = results[1];
    if (results[0].error) throw results[0].error;
    return { groups: results[0].groups, total: total };
  } catch (error) {
    if (isCodeFault(error)) throw error;
    return { groups: [], total: total, unavailable: { unavailable: true, error: error.message } };
  }
}

async function fetchConstructionPermits() {
  const result = await breakdown('bis_jlyakg7hgslonjnwyrwc6w', 'Atbildigas_iestades_nosaukums', 20);
  var permits = result.groups
    .map(function (g) {
      // Shorten the authority's name for a label, without merging two of them:
      // only the trailing office word goes.
      var name = g.key.replace(/ būvvalde$/i, '').replace(/ novada$/i, ' nov.').trim();
      return { municipality: name || 'Unknown', count: g.count };
    })
    .slice(0, 15);
  return { permits: permits, total: result.total, unavailable: result.unavailable };
}

async function fetchEnergyCerts() {
  // Building energy certificates, grouped by the energy carrier recorded
  // against each one — Latvia's building energy profile.
  const result = await breakdown('bis_yjv2q8uzi-oidtg81mkifg', 'Energonesejs', 12);
  // `Unknown` is kept rather than dropped: 21,037 of 48,269 certificates record
  // no carrier, so removing it would show a profile of the 57% that do and
  // imply it was the whole. It was invisible before only because the oldest 500
  // rows happen to carry a carrier.
  var certs = result.groups
    .map(function (g) { return { rating: g.key, count: g.count }; })
    .slice(0, 8);
  return { certs: certs, total: result.total, unavailable: result.unavailable };
}

const handler = async function (context, req) {
  try {
    const [construction, energy] = await Promise.all([
      fetchConstructionPermits(),
      fetchEnergyCerts(),
    ]);
    const available = construction.total !== null || energy.total !== null;

    context.res = {
      status: available ? 200 : 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': available ? 'public, max-age=3600' : 'no-store' },
      body: JSON.stringify({
        constructionPermits: construction.permits,
        constructionPermitsUnavailable: construction.unavailable,
        totalPermits: construction.total,
        energyCerts: energy.certs,
        energyCertsUnavailable: energy.unavailable,
        totalCerts: energy.total,
        ...(available ? {} : { error: 'Property data sources unavailable' }),
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    if (isCodeFault(error)) {
      context.res = failureResponse(context, error);
      return;
    }
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'property-data',
  keyOn: [],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
