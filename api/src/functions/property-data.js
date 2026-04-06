/**
 * Azure SWA API function: Property & Energy data aggregator.
 * Fetches: Construction permits (BVKB), energy certificates, construction stats.
 *
 * GET /api/property-data
 */

const CKAN_API = 'https://data.gov.lv/dati/api/3/action';

const CONSTRUCTION_CASES_DATASET = 'bvkb-buvniecibas-lietas';
const ENERGY_CERTS_DATASET = 'eku-energosertifikati';
const CONSTRUCTION_STATS_DATASET = 'bvkb-buvniecibas-lietu-saskanoojumi';

async function fetchDatastoreRecords(resourceId, limit = 500) {
  const url = `${CKAN_API}/datastore_search?resource_id=${resourceId}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.result?.records ?? [];
}

async function getLatestActiveResource(datasetId) {
  try {
    const url = `${CKAN_API}/package_show?id=${datasetId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const pkg = await res.json();
    const resources = (pkg.result?.resources ?? []).filter((r) => r.datastore_active);
    return resources.length > 0 ? resources[resources.length - 1] : null;
  } catch {
    return null;
  }
}

async function fetchConstructionPermits() {
  const resource = await getLatestActiveResource(CONSTRUCTION_CASES_DATASET);
  if (!resource) return { permits: [], total: 0 };

  const records = await fetchDatastoreRecords(resource.id, 500);
  // Group by municipality
  const byMunicipality = {};
  for (const rec of records) {
    const municipality = rec['Pašvaldība'] || rec['Municipality'] || 'Unknown';
    byMunicipality[municipality] = (byMunicipality[municipality] || 0) + 1;
  }

  const permits = Object.entries(byMunicipality)
    .map(([municipality, count]) => ({ municipality, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return { permits, total: records.length };
}

async function fetchEnergyCerts() {
  const resource = await getLatestActiveResource(ENERGY_CERTS_DATASET);
  if (!resource) return { certs: [], total: 0 };

  const records = await fetchDatastoreRecords(resource.id, 500);
  // Group by energy rating
  const byRating = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  for (const rec of records) {
    const rating = (rec['Energoefektivitātes klase'] || rec['Klase'] || '').toUpperCase().charAt(0);
    if (rating in byRating) {
      byRating[rating]++;
    }
  }

  const certs = Object.entries(byRating)
    .map(([rating, count]) => ({ rating, count }))
    .filter((c) => c.count > 0);

  return { certs, total: records.length };
}

export default async function (request, context) {
  try {
    const [construction, energy] = await Promise.all([
      fetchConstructionPermits(),
      fetchEnergyCerts(),
    ]);

    const result = {
      constructionPermits: construction.permits,
      totalPermits: construction.total,
      permitsTrend: 0,
      energyCerts: energy.certs,
      totalCerts: energy.total,
      fetchedAt: new Date().toISOString(),
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
}
