/**
 * Azure SWA API function: proxy data.gov.lv CKAN requests to bypass CORS.
 * Also resolves the latest resource IDs so the frontend doesn't need to
 * download the massive package_show responses.
 *
 * GET /api/port-data
 * Returns: { shipVisits, ferryData, cargoData }
 */

const CKAN_API = 'https://data.gov.lv/dati/api/3/action';

// Known dataset IDs
const FORMALITIES_DATASET = 'ar-juras-parvadajumiem-un-ostas-formalitatem-saistito-formalitasu-statistika';
const FERRY_DATASET = '8c5af8aa-eb45-4832-a502-313108499951';
const CARGO_DATASET = 'parvadajamo-juras-kravu-veidi-apjomi-dinamika';

async function fetchDatastoreRecords(resourceId, limit = 100) {
  const url = `${CKAN_API}/datastore_search?resource_id=${resourceId}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.result?.records ?? [];
}

async function getLatestActiveResources(datasetId, count = 6, nameFilter = null) {
  const url = `${CKAN_API}/package_show?id=${datasetId}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const pkg = await res.json();
  let resources = pkg.result?.resources ?? [];
  resources = resources.filter(r => r.datastore_active);
  if (nameFilter) {
    resources = resources.filter(r => r.name && r.name.startsWith(nameFilter));
  }
  return resources.slice(-count);
}

export default async function (request, context) {
  try {
    // Fetch ship visits (last 3 REJVESLS snapshots — rejected/cancelled visits)
    const shipResources = await getLatestActiveResources(FORMALITIES_DATASET, 6);
    const shipVisits = [];
    for (const r of shipResources) {
      const records = await fetchDatastoreRecords(r.id, 50);
      const type = r.name?.startsWith('CNCVESLS') ? 'cancelled' : 'rejected';
      const dateMatch = r.name?.match(/(\d{8})/);
      const snapshotDate = dateMatch ? `${dateMatch[1].slice(0,4)}-${dateMatch[1].slice(4,6)}-${dateMatch[1].slice(6,8)}` : '';
      for (const rec of records) {
        shipVisits.push({
          portCode: rec['Osta (Kods)'] ?? '',
          portName: rec['Osta (Nosaukums)'] ?? '',
          ship: rec['Kuģis'] ?? '',
          visitDate: rec['Vizītes datums'] ?? '',
          type,
          snapshotDate,
        });
      }
    }

    // Fetch ferry passengers (last 3 snapshots)
    const ferryResources = await getLatestActiveResources(FERRY_DATASET, 3, 'PSNGFERRY');
    const ferryData = [];
    for (const r of ferryResources) {
      const records = await fetchDatastoreRecords(r.id, 50);
      const dateMatch = r.name?.match(/(\d{8})/);
      const snapshotDate = dateMatch ? `${dateMatch[1].slice(0,4)}-${dateMatch[1].slice(4,6)}-${dateMatch[1].slice(6,8)}` : '';
      for (const rec of records) {
        ferryData.push({
          portCode: rec['Osta'] ?? '',
          previousNextPort: rec['Iepriekšējā/nākamā osta'] ?? '',
          flagCode: rec['Prāmja pieraksta valsts (karogs) (Kods)'] ?? '',
          flagName: rec['Prāmja pieraksta valsts (karogs) (Nosaukums)'] ?? '',
          passengers: parseInt(rec['Pasažieri'] ?? '0', 10),
          snapshotDate,
        });
      }
    }

    // Fetch loaded cargo data (latest LOADCRG snapshot)
    const cargoResources = await getLatestActiveResources(CARGO_DATASET, 2, 'LOADCRG');
    const cargoData = [];
    for (const r of cargoResources.slice(-1)) {
      const records = await fetchDatastoreRecords(r.id, 200);
      for (const rec of records) {
        cargoData.push({
          year: rec['Gads'] ?? '',
          portCode: rec['Ostas (Kods)'] ?? '',
          portName: rec['Ostas (Nosaukums)'] ?? '',
          direction: rec['Virziens'] ?? '', // IN or OUT
          cargoGroupCode: rec['Kravas grupa (Kods)'] ?? 0,
          cargoGroupName: rec['Kravas grupa (Nosaukums)'] ?? '',
        });
      }
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        shipVisits,
        ferryData,
        cargoData,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
}
