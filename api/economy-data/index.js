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
const ECB_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
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
      const regex = new RegExp("currency='" + code + "' rate='([\\d.]+)'");
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

// CSP PxWeb API queries for live economic indicators
const PXWEB = 'https://data.stat.gov.lv/api/v1/en/OSP_PUB';

function httpsPost(url, body) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var postData = JSON.stringify(body);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      timeout: 12000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('PxWeb parse failed')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function fetchPxWebIndicators() {
  var indicators = [];
  try {
    // GDP quarterly growth (seasonally adjusted, % of corresponding period prev year)
    var gdpData = await httpsPost(PXWEB + '/VEK/IS/ISI/ISI010c', {
      query: [
        { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
        { code: 'INDICATOR', selection: { filter: 'item', values: ['B1GQ'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['ISI010c1'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (gdpData && gdpData.value) {
      var vals = gdpData.value.filter(function (v) { return v !== null; });
      var latest = vals[vals.length - 1];
      var prev = vals.length > 4 ? vals[vals.length - 5] : null;
      var growthPct = latest ? (latest - 100).toFixed(1) : null;
      indicators.push({
        label: 'GDP Growth',
        value: growthPct != null ? growthPct + '%' : 'N/A',
        unit: 'YoY',
        change: prev != null ? ((latest - prev) >= 0 ? '+' : '') + (latest - prev).toFixed(1) + 'pp' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'GDP Growth', value: 'N/A', unit: '', change: '' }); }

  try {
    // Average gross salary (quarterly, TOTAL sector)
    var salData = await httpsPost(PXWEB + '/EMP/DS/DSV/DSV010c', {
      query: [
        { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
        { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
        { code: 'INDICATOR', selection: { filter: 'item', values: ['AVWAG_M'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV010c'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (salData && salData.value) {
      var salVals = salData.value.filter(function (v) { return v !== null; });
      var latestSal = salVals[salVals.length - 1];
      var prevSal = salVals.length > 4 ? salVals[salVals.length - 5] : null;
      var change = prevSal ? (((latestSal - prevSal) / prevSal) * 100) : 0;
      indicators.push({
        label: 'Avg Salary',
        value: '€' + Math.round(latestSal).toLocaleString(),
        unit: '/month',
        change: prevSal ? (change >= 0 ? '+' : '') + change.toFixed(1) + '%' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'Avg Salary', value: 'N/A', unit: '', change: '' }); }

  try {
    // CPI inflation (monthly, 12-month average over prev 12-month average)
    var cpiData = await httpsPost(PXWEB + '/VEK/PC/PCI/PCI021m', {
      query: [
        { code: 'ECOICOP_V2', selection: { filter: 'item', values: ['0'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI021m4'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (cpiData && cpiData.value) {
      var cpiVals = cpiData.value.filter(function (v) { return v !== null; });
      var latestCpi = cpiVals[cpiVals.length - 1];
      var prevCpi = cpiVals.length > 12 ? cpiVals[cpiVals.length - 13] : null;
      indicators.push({
        label: 'CPI Inflation',
        value: latestCpi != null ? latestCpi.toFixed(1) + '%' : 'N/A',
        unit: 'YoY',
        change: prevCpi != null ? ((latestCpi - prevCpi) >= 0 ? '+' : '') + (latestCpi - prevCpi).toFixed(1) + 'pp' : '',
      });
    }
  } catch (e) { indicators.push({ label: 'CPI Inflation', value: 'N/A', unit: '', change: '' }); }

  // Unemployment rate (monthly, seasonally adjusted)
  try {
    var unemData = await httpsPost(PXWEB + '/EMP/NBBA/NBBB/NBB150m', {
      query: [
        { code: 'SEX', selection: { filter: 'item', values: ['T'] } },
        { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['NBB1501m'] } },
      ],
      response: { format: 'json-stat2' },
    });
    if (unemData && unemData.value) {
      var uVals = unemData.value.filter(function (v) { return v !== null; });
      var latestU = uVals[uVals.length - 1];
      indicators.push({
        label: 'Unemployment',
        value: latestU != null ? latestU.toFixed(1) + '%' : 'N/A',
        unit: '',
        change: '',
      });
    }
  } catch (e) { indicators.push({ label: 'Unemployment', value: 'N/A', unit: '', change: '' }); }

  return indicators;
}

module.exports = async function (context, req) {
  try {
    const [exchangeRates, electricity, vatCount, suspendedCount, indicators] = await Promise.all([
      fetchECBRates(),
      fetchElectricityPrices(),
      fetchCKANCount('pvn-maksataji'),
      fetchCKANCount('saimnieciskas-darbibas-apstiprinasana-atjaunosana'),
      fetchPxWebIndicators(),
    ]);

    const result = {
      exchangeRates: exchangeRates,
      electricityPrices: electricity.prices,
      electricityCurrent: electricity.current,
      indicators: indicators.length > 0 ? indicators : [
        { label: 'GDP Growth', value: 'N/A', unit: '', change: '' },
        { label: 'Avg Salary', value: 'N/A', unit: '', change: '' },
        { label: 'CPI Inflation', value: 'N/A', unit: '', change: '' },
        { label: 'Unemployment', value: 'N/A', unit: '', change: '' },
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
