const https = require('https');
const http = require('http');

function httpGet(url) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise(function (resolve, reject) {
    lib.get(url, { timeout: 12000 }, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { resolve(data); });
    }).on('error', reject);
  });
}

function jsonGet(url) {
  return httpGet(url).then(function (text) {
    return JSON.parse(text);
  });
}

const CKAN_API = 'https://data.gov.lv/dati/api/3/action';
const ECB_RATES_URL = 'https://www.bank.lv/vk/ecb.xml';
const ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';

async function fetchECBRates() {
  try {
    const xml = await httpGet(ECB_RATES_URL);
    const rates = [];
    const currencyNames = {
      USD: 'US Dollar', GBP: 'British Pound', PLN: 'Polish Zloty',
      SEK: 'Swedish Krona', NOK: 'Norwegian Krone', CHF: 'Swiss Franc',
      JPY: 'Japanese Yen', CZK: 'Czech Koruna', DKK: 'Danish Krone',
    };
    for (const code of Object.keys(currencyNames)) {
      const regex = new RegExp('currency="' + code + '" rate="([\\d.]+)"');
      const match = xml.match(regex);
      if (match) {
        rates.push({ currency: code, rate: parseFloat(match[1]), name: currencyNames[code] });
      }
    }
    return rates;
  } catch (e) {
    return [];
  }
}

async function fetchElectricityPrices() {
  try {
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const url = ELERING_URL + '?start=' + start.toISOString() + '&end=' + end.toISOString();
    const data = await jsonGet(url);
    const lvPrices = (data.data && data.data.lv) || [];
    const prices = lvPrices.map(function (p) {
      return { timestamp: new Date(p.timestamp * 1000).toISOString(), price: p.price };
    });
    const currentHour = now.getHours();
    const currentEntry = lvPrices.find(function (p) {
      return new Date(p.timestamp * 1000).getHours() === currentHour;
    });
    return { prices: prices, current: currentEntry ? currentEntry.price : 0 };
  } catch (e) {
    return { prices: [], current: 0 };
  }
}

async function fetchCKANCount(datasetId) {
  try {
    const pkg = await jsonGet(CKAN_API + '/package_show?id=' + datasetId);
    const resources = (pkg.result && pkg.result.resources) || [];
    const active = resources.filter(function (r) { return r.datastore_active; });
    if (active.length === 0) return 0;
    const latest = active[active.length - 1];
    const countData = await jsonGet(CKAN_API + '/datastore_search?resource_id=' + latest.id + '&limit=0');
    return (countData.result && countData.result.total) || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = async function (context, req) {
  try {
    const [exchangeRates, electricity, vatCount, suspendedCount] = await Promise.all([
      fetchECBRates(),
      fetchElectricityPrices(),
      fetchCKANCount('pvn-maksataji'),
      fetchCKANCount('saimnieciskas-darbibas-apstiprinasana-atjaunosana'),
    ]);

    const result = {
      exchangeRates: exchangeRates,
      electricityPrices: electricity.prices,
      electricityCurrent: electricity.current,
      indicators: [
        { label: 'GDP Growth', value: '2.1%', unit: 'YoY', change: '+0.3%' },
        { label: 'Avg Salary', value: '€1,680', unit: '/month', change: '+5.2%' },
        { label: 'CPI Inflation', value: '3.4%', unit: 'YoY', change: '-0.2%' },
        { label: 'Unemployment', value: '6.1%', unit: '', change: '-0.4%' },
      ],
      businessPulse: {
        newVatRegistrations: vatCount,
        suspendedBusinesses: suspendedCount,
        suspendedChangePercent: 0,
        newCompanies: 0,
      },
      fetchedAt: new Date().toISOString(),
    };

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
