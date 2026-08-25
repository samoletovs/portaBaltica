const rateLimit = require('../shared/rateLimit.js');
const ckan = require('../shared/ckan.js');

/**
 * Maritime statistics from data.gov.lv.
 *
 * This used to hold eight hardcoded resource ids, captured in February and
 * March 2026 and never revisited. Two things are wrong with pinning them:
 *
 *   1. The data silently ages. The dashboard kept serving those snapshots for
 *      months with no date anywhere on screen, so six-month-old port calls
 *      looked like this morning's.
 *   2. It cannot recover. When the portal ingests newer weeks, nothing picks
 *      them up until a human edits this file.
 *
 * So each series now resolves the newest resource the datastore will actually
 * answer for. `datastore_active` is the thing to select on, and it is not the
 * same as "published": the maritime datasets get a CSV every week, but the
 * portal's datastore ingestion runs behind and has stalled — as of 2026-08-25
 * CSVs exist through 2026-07-05 while the newest *queryable* snapshot in all
 * three datasets is 2026-03-01, and querying an inactive resource id returns
 * 404. Discovery therefore yields the freshest data that exists as far as the
 * API is concerned, and it starts serving newer weeks on its own the moment
 * ingestion catches up.
 *
 * The response carries `dataAsOf` so the UI can say how old that is. The
 * staleness *judgement* is deliberately left to the client: this response is
 * cached for an hour here and for longer in the browser, so a boolean computed
 * on the server would itself go stale.
 */

/** Datasets, and the filename prefix identifying each series within them. */
const SERIES = {
  shipVisits: {
    dataset: 'ar-juras-parvadajumiem-un-ostas-formalitatem-saistito-formalitasu-statistika',
    prefix: 'REJVESLS_',
    snapshots: 3,
    rowLimit: 50,
  },
  ferry: {
    dataset: 'pasazieru-parvadajumu-statistika-parvadajumiem-ar-juras-transportu',
    prefix: 'PSNGFERRY_',
    snapshots: 3,
    rowLimit: 50,
  },
  cargo: {
    dataset: 'parvadajamo-juras-kravu-veidi-apjomi-dinamika',
    prefix: 'LOADCRG_',
    snapshots: 1,
    rowLimit: 200,
  },
  cargoTurnover: {
    dataset: 'parvadajamo-juras-kravu-veidi-apjomi-dinamika',
    prefix: 'CRGTURNBYTYPEYEAR_',
    snapshots: 1,
    rowLimit: 200,
  },
};

function warn(label, err) {
  console.warn('[port-data] ' + label + ' unavailable: ' + ((err && err.message) || err));
}

function mapShipVisitType(raw) {
  if (!raw) return 'completed';
  const s = raw.toLowerCase();
  if (s.indexOf('atcel') !== -1 || s.indexOf('cancel') !== -1) return 'cancelled';
  if (s.indexOf('noraid') !== -1 || s.indexOf('reject') !== -1) return 'rejected';
  return 'completed';
}

/**
 * Newest snapshots of one series, each with its records.
 *
 * A failing series resolves to an empty list rather than failing the whole
 * response — losing the ferry panel is better than losing the page — but each
 * snapshot keeps its own date, so the UI can tell "no data" apart from
 * "current data that happens to be empty".
 */
async function loadSeries(key, packages) {
  const spec = SERIES[key];
  try {
    const pkg = await packages[spec.dataset];
    const resources = ckan.pickLatestActive(pkg, spec.prefix, spec.snapshots);

    return await Promise.all(resources.map(async function (resource) {
      try {
        const result = await ckan.ckan('datastore_search', {
          resource_id: resource.id,
          limit: String(spec.rowLimit),
        });
        return { snapshotDate: resource.snapshotDate, records: (result && result.records) || [] };
      } catch (err) {
        warn(key + ' snapshot ' + resource.snapshotDate, err);
        return { snapshotDate: resource.snapshotDate, records: [] };
      }
    }));
  } catch (err) {
    warn(key, err);
    return [];
  }
}

/** Most recent snapshot date across every series that returned one. */
function newestSnapshot(seriesResults) {
  let newest = null;
  seriesResults.forEach(function (snapshots) {
    snapshots.forEach(function (s) {
      if (s.snapshotDate && (!newest || s.snapshotDate > newest)) newest = s.snapshotDate;
    });
  });
  return newest;
}

function datesOf(snapshots) {
  return snapshots
    .map(function (s) { return s.snapshotDate; })
    .filter(function (d) { return Boolean(d); });
}

module.exports = async function (context, req) {
  // The rate limiter was imported here but never called, so this endpoint —
  // the most expensive one in the app, now that it reads three catalogue
  // documents — was the only unmetered route.
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  try {
    // Two of the four series share a dataset; fetch each catalogue once.
    // Every consumer attaches its handler in this same tick via Promise.all
    // below, so a rejection here is always observed.
    const packages = {};
    Object.keys(SERIES).forEach(function (key) {
      const dataset = SERIES[key].dataset;
      if (!packages[dataset]) packages[dataset] = ckan.ckan('package_show', { id: dataset });
    });

    const results = await Promise.all([
      loadSeries('shipVisits', packages),
      loadSeries('ferry', packages),
      loadSeries('cargo', packages),
      loadSeries('cargoTurnover', packages),
    ]);

    const shipSnapshots = results[0];
    const ferrySnapshots = results[1];
    const cargoSnapshots = results[2];
    const turnoverSnapshots = results[3];

    const shipVisits = [];
    shipSnapshots.forEach(function (snap) {
      snap.records.forEach(function (r) {
        shipVisits.push({
          portCode: r['Osta (Kods)'] || '',
          portName: r['Osta (Nosaukums)'] || '',
          ship: r['Ku\u0123is'] || '',
          visitDate: r['Viz\u012btes datums'] || '',
          type: mapShipVisitType(r['Statuss']),
          snapshotDate: snap.snapshotDate,
        });
      });
    });

    const ferryData = [];
    ferrySnapshots.forEach(function (snap) {
      snap.records.forEach(function (r) {
        ferryData.push({
          portCode: r['Osta'] || '',
          previousNextPort: r['Iepriek\u0161\u0113j\u0101/n\u0101kam\u0101 osta'] || '',
          flagCode: r['Pr\u0101mja pieraksta valsts (karogs) (Kods)'] || '',
          flagName: r['Pr\u0101mja pieraksta valsts (karogs) (Nosaukums)'] || '',
          passengers: parseInt(r['Pasa\u017eieri'] || '0', 10),
          snapshotDate: snap.snapshotDate,
        });
      });
    });

    const cargoData = [];
    cargoSnapshots.forEach(function (snap) {
      snap.records.forEach(function (r) {
        cargoData.push({
          year: r['Gads'] || '',
          portCode: r['Ostas (Kods)'] || '',
          portName: r['Ostas (Nosaukums)'] || '',
          direction: r['Virziens'] || '',
          cargoGroupCode: r['Kravas grupa (Kods)'] || 0,
          cargoGroupName: r['Kravas grupa (Nosaukums)'] || '',
        });
      });
    });

    const cargoTurnover = [];
    turnoverSnapshots.forEach(function (snap) {
      snap.records.forEach(function (r) {
        cargoTurnover.push({
          cargoTypeCode: r['Kravas veids'] || '',
          weight: parseFloat(r['(Svars)']) || 0,
        });
      });
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        shipVisits: shipVisits,
        ferryData: ferryData,
        cargoData: cargoData,
        cargoTurnover: cargoTurnover,
        // The date the statistics describe — not the date we fetched them.
        dataAsOf: newestSnapshot(results),
        snapshotDates: {
          shipVisits: datesOf(shipSnapshots),
          ferry: datesOf(ferrySnapshots),
          cargo: datesOf(cargoSnapshots),
          cargoTurnover: datesOf(turnoverSnapshots),
        },
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
