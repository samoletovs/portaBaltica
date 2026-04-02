const https = require('https');

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed')); }
      });
    }).on('error', reject);
  });
}

var CKAN = 'https://data.gov.lv/dati/api/3/action/datastore_search';

var SHIP_IDS = [
  { id: '07804f53-e238-46dc-bf5a-aae504668668', date: '2026-02-15' },
  { id: 'e93940ad-3bc3-4f9b-9e10-d097aff2a514', date: '2026-02-22' },
  { id: '57b39c5d-1f04-420f-ba36-69f85d35b359', date: '2026-03-01' },
];
var FERRY_IDS = [
  { id: 'a45c31a3-4088-478e-bf90-16954e7ea73e', date: '2026-02-15' },
  { id: '7a66dabe-c04c-44f3-b933-a7af14767206', date: '2026-02-22' },
  { id: '8a5f8ae8-de7a-4e76-9486-bbf739454d1c', date: '2026-03-01' },
];
var CARGO_IDS = [
  { id: '040ff4d5-6b05-4190-a882-069f4515104d', date: '2026-03-01' },
];

async function query(resourceId, limit) {
  try {
    var data = await httpsGet(CKAN + '?resource_id=' + resourceId + '&limit=' + (limit || 100));
    return (data.result && data.result.records) ? data.result.records : [];
  } catch(e) { return []; }
}

module.exports = async function (context) {
  var shipVisits = [];
  var ferryData = [];
  var cargoData = [];

  for (var i = 0; i < SHIP_IDS.length; i++) {
    var recs = await query(SHIP_IDS[i].id, 50);
    for (var j = 0; j < recs.length; j++) {
      shipVisits.push({
        portCode: recs[j]['Osta (Kods)'] || '',
        portName: recs[j]['Osta (Nosaukums)'] || '',
        ship: recs[j]['Ku\u0123is'] || '',
        visitDate: recs[j]['Viz\u012btes datums'] || '',
        type: 'rejected',
        snapshotDate: SHIP_IDS[i].date
      });
    }
  }

  for (var i = 0; i < FERRY_IDS.length; i++) {
    var recs = await query(FERRY_IDS[i].id, 50);
    for (var j = 0; j < recs.length; j++) {
      ferryData.push({
        portCode: recs[j]['Osta'] || '',
        previousNextPort: recs[j]['Iepriek\u0161\u0113j\u0101/n\u0101kam\u0101 osta'] || '',
        flagCode: recs[j]['Pr\u0101mja pieraksta valsts (karogs) (Kods)'] || '',
        flagName: recs[j]['Pr\u0101mja pieraksta valsts (karogs) (Nosaukums)'] || '',
        passengers: parseInt(recs[j]['Pasa\u017eieri'] || '0', 10),
        snapshotDate: FERRY_IDS[i].date
      });
    }
  }

  for (var i = 0; i < CARGO_IDS.length; i++) {
    var recs = await query(CARGO_IDS[i].id, 200);
    for (var j = 0; j < recs.length; j++) {
      cargoData.push({
        year: recs[j]['Gads'] || '',
        portCode: recs[j]['Ostas (Kods)'] || '',
        portName: recs[j]['Ostas (Nosaukums)'] || '',
        direction: recs[j]['Virziens'] || '',
        cargoGroupCode: recs[j]['Kravas grupa (Kods)'] || 0,
        cargoGroupName: recs[j]['Kravas grupa (Nosaukums)'] || ''
      });
    }
  }

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify({
      shipVisits: shipVisits,
      ferryData: ferryData,
      cargoData: cargoData,
      fetchedAt: new Date().toISOString()
    })
  };
};
