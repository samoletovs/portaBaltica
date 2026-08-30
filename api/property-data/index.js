const https = require('https');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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
    const data = await jsonGet(CKAN_API + '/datastore_search?resource_id=' + resourceId + '&limit=1');
    const total = data.result && data.result.total;
    return typeof total === 'number' ? total : null;
  } catch (e) {
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
 * Returns null rather than a guess when the datastore will not aggregate, so
 * the caller can omit the ranking instead of falling back to the block-of-500
 * tally this exists to replace. CKAN answers HTTP 200 with `success: false` for
 * an action it does not have, so `success` is checked rather than the status
 * code — and its SQL endpoint refuses casts and `FILTER` with 403/500, so this
 * stays to a plain `GROUP BY`.
 */
async function countByColumn(resourceId, column, limit) {
  const sql = 'SELECT "' + column + '" AS k, COUNT(*) AS n FROM "' + resourceId
    + '" GROUP BY k ORDER BY n DESC LIMIT ' + (limit || 20);
  try {
    const data = await jsonGet(CKAN_API + '/datastore_search_sql?sql=' + encodeURIComponent(sql));
    if (!data || data.success !== true) return null;
    const rows = (data.result && data.result.records) || [];
    return rows.map(function (r) {
      const key = r.k === null || r.k === undefined || String(r.k).trim() === ''
        ? 'Unknown' : String(r.k).trim();
      return { key: key, count: Number(r.n) };
    });
  } catch (e) {
    return null;
  }
}

async function fetchConstructionPermits() {
  const resource = await getLatestActiveResource('bis_jlyakg7hgslonjnwyrwc6w');
  if (!resource) return { permits: [], total: null };
  const [grouped, total] = await Promise.all([
    countByColumn(resource.id, 'Atbildigas_iestades_nosaukums', 20),
    datastoreTotal(resource.id),
  ]);
  if (!grouped) return { permits: [], total: total };
  var permits = grouped
    .map(function (g) {
      // Shorten the authority's name for a label, without merging two of them:
      // only the trailing office word goes.
      var name = g.key.replace(/ būvvalde$/i, '').replace(/ novada$/i, ' nov.').trim();
      return { municipality: name || 'Unknown', count: g.count };
    })
    .slice(0, 15);
  return { permits: permits, total: total };
}

async function fetchEnergyCerts() {
  // Building energy certificates, grouped by the energy carrier recorded
  // against each one — Latvia's building energy profile.
  const resource = await getLatestActiveResource('bis_yjv2q8uzi-oidtg81mkifg');
  if (!resource) return { certs: [], total: null };
  const [grouped, total] = await Promise.all([
    countByColumn(resource.id, 'Energonesejs', 12),
    datastoreTotal(resource.id),
  ]);
  if (!grouped) return { certs: [], total: total };
  // `Unknown` is kept rather than dropped: 21,037 of 48,269 certificates record
  // no carrier, so removing it would show a profile of the 57% that do and
  // imply it was the whole. It was invisible before only because the oldest 500
  // rows happen to carry a carrier.
  var certs = grouped
    .map(function (g) { return { rating: g.key, count: g.count }; })
    .slice(0, 8);
  return { certs: certs, total: total };
}

const handler = async function (context, req) {
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

module.exports = withSecurity(withCache(handler, {
  name: 'property-data',
  keyOn: [],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
