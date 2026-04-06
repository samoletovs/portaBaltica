const https = require('https');

function httpsPost(url, body) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var postData = JSON.stringify(body);
    var opts = {
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse failed')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

var PXWEB = 'https://data.stat.gov.lv/api/v1/en/OSP_PUB';

// Indicator definitions: PxWeb path, query params, label extraction
var INDICATORS = {
  gdp: {
    path: '/VEK/IS/ISI/ISI010c',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['B1GQ'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ISI010c1'] } },
    ],
    transform: function (v) { return v !== null ? +(v - 100).toFixed(1) : null; },
    unit: '% YoY',
    title: 'GDP Growth Rate',
    source: 'CSP Latvia (PxWeb)',
  },
  salary: {
    path: '/EMP/DS/DSV/DSV010c',
    query: [
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['AVWAG_M'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV010c'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Average Gross Salary',
    source: 'CSP Latvia (PxWeb)',
  },
  cpi: {
    path: '/VEK/PC/PCI/PCI021m',
    query: [
      { code: 'ECOICOP_V2', selection: { filter: 'item', values: ['0'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI021m4'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'CPI Inflation',
    source: 'CSP Latvia (PxWeb)',
  },
  unemployment: {
    path: '/EMP/NBBA/NBBB/NBB150m',
    query: [
      { code: 'SEX', selection: { filter: 'item', values: ['T'] } },
      { code: 'SESON', selection: { filter: 'item', values: ['SA'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['NBB1501m'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Unemployment Rate',
    source: 'CSP Latvia (PxWeb)',
  },
  house_prices: {
    path: '/VEK/PC/PCI/PCI050c',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['PCI050c1'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'House Price Change',
    source: 'CSP Latvia (PxWeb)',
  },
  retail_sales: {
    path: '/TIR/TI/TIT/TIT010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TIT010m'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'Retail Sales Growth',
    source: 'CSP Latvia (PxWeb)',
  },
  industrial: {
    path: '/NOZ/RU/RUI/RUI020m',
    query: [
      { code: 'NACE_MIG', selection: { filter: 'item', values: ['MIG_ING'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['RUI020m4'] } },
    ],
    transform: null,
    unit: '% YoY',
    title: 'Industrial Production Growth',
    source: 'CSP Latvia (PxWeb)',
  },
  population: {
    path: '/POP/IR/IRS/IRS010',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['POP_SY'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['IRS010'] } },
    ],
    transform: null,
    unit: 'persons',
    title: 'Population',
    source: 'CSP Latvia (PxWeb)',
  },
  hotel_occupancy: {
    path: '/NOZ/TU/TUV/TUV010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TUV010m'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Hotel occupancy rate',
    source: 'CSP Latvia (PxWeb)',
  },
  tourist_arrivals: {
    path: '/NOZ/TU/TUV/TUV020c',
    query: [
      { code: 'ACCOMMODATION', selection: { filter: 'item', values: ['I551-I553'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TUV020c'] } },
    ],
    transform: null,
    unit: 'thousands',
    title: 'Tourist arrivals',
    source: 'CSP Latvia (PxWeb)',
  },
  gov_revenue: {
    path: '/VEK/VF/VFV/VFV010c',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['P11_P12_P131'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['VFV010c1'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Government revenue',
    source: 'CSP Latvia (PxWeb)',
  },
  gov_debt: {
    path: '/VEK/VF/VFV/VFV020c',
    query: [
      { code: 'INDICATOR', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'SECTOR', selection: { filter: 'item', values: ['S13'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['VFV020c1'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Government debt',
    source: 'CSP Latvia (PxWeb)',
  },
  exports: {
    path: '/TIR/AT/ATD/ATD110m',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SCA'] } },
      { code: 'FLOW', selection: { filter: 'item', values: ['EXP'] } },
      { code: 'COUNTRY_GROUP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ATD110m'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Exports (seasonally adjusted)',
    source: 'CSP Latvia (PxWeb)',
  },
  imports: {
    path: '/TIR/AT/ATD/ATD110m',
    query: [
      { code: 'SESON', selection: { filter: 'item', values: ['SCA'] } },
      { code: 'FLOW', selection: { filter: 'item', values: ['IMP'] } },
      { code: 'COUNTRY_GROUP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ATD110m'] } },
    ],
    transform: null,
    unit: 'M EUR',
    title: 'Imports (seasonally adjusted)',
    source: 'CSP Latvia (PxWeb)',
  },
  biz_confidence: {
    path: '/VEK/KR/KRE/KRE010m',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['KRE010m'] } },
    ],
    transform: null,
    unit: 'index',
    title: 'Economic sentiment',
    source: 'CSP Latvia (PxWeb)',
  },
  construction_output: {
    path: '/NOZ/BU/BUP/BUP010c',
    query: [
      { code: 'NACE', selection: { filter: 'item', values: ['F'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['BUP010c'] } },
    ],
    transform: null,
    unit: 'index',
    title: 'Construction output',
    source: 'CSP Latvia (PxWeb)',
  },
  new_vehicles: {
    path: '/NOZ/TR/TRC/TRC010c',
    query: [
      { code: 'VEHICLE', selection: { filter: 'item', values: ['CAR'] } },
      { code: 'INDICATOR', selection: { filter: 'item', values: ['VEH_REG_1ST_NEW'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TRC010c'] } },
    ],
    transform: null,
    unit: 'vehicles',
    title: 'New car registrations',
    source: 'CSP Latvia (PxWeb)',
  },
  wages_industry: {
    path: '/EMP/DS/DSV/DSV030',
    query: [
      { code: 'ECONOMIC_ACTIV', selection: { filter: 'item', values: ['C'] } },
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV030'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Wages: manufacturing',
    source: 'CSP Latvia (PxWeb)',
  },
  wages_it: {
    path: '/EMP/DS/DSV/DSV030',
    query: [
      { code: 'ECONOMIC_ACTIV', selection: { filter: 'item', values: ['J'] } },
      { code: 'GRS_NET', selection: { filter: 'item', values: ['GRS'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['DSV030'] } },
    ],
    transform: null,
    unit: 'EUR/month',
    title: 'Wages: IT sector',
    source: 'CSP Latvia (PxWeb)',
  },
  energy_price_gas: {
    path: '/NOZ/EN/ENC/ENC020',
    query: [
      { code: 'CONSUMER_GRP', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ENC020'] } },
    ],
    transform: null,
    unit: 'EUR/GJ',
    title: 'Gas price (households)',
    source: 'CSP Latvia (PxWeb)',
  },
  building_permits: {
    path: '/NOZ/BU/BUE/BUE010c',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['BUE010c'] } },
    ],
    transform: null,
    unit: 'permits',
    title: 'Building permits issued',
    source: 'CSP Latvia (PxWeb)',
  },
  renewable_share: {
    path: '/NOZ/EN/ENA/ENA010',
    query: [
      { code: 'ContentsCode', selection: { filter: 'item', values: ['ENA010'] } },
    ],
    transform: null,
    unit: '%',
    title: 'Renewable energy share',
    source: 'CSP Latvia (PxWeb)',
  },
};

/**
 * GET /api/historical-data?indicator=gdp
 * GET /api/historical-data?indicator=gdp&years=5
 *
 * Returns time-series data from CSP PxWeb API for charting.
 */
module.exports = async function (context, req) {
  var indicator = (req.query && req.query.indicator) || '';
  var def = INDICATORS[indicator];
  if (!def) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', '),
      }),
    };
    return;
  }

  try {
    var data = await httpsPost(PXWEB + def.path, {
      query: def.query,
      response: { format: 'json-stat2' },
    });

    if (!data || !data.value) {
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicator: indicator, series: [], meta: def }),
      };
      return;
    }

    // Extract time labels from the dimension
    var timeDim = data.id ? data.id[data.id.length - 1] : 'TIME';
    var timeLabels = [];
    if (data.dimension && data.dimension[timeDim] && data.dimension[timeDim].category) {
      var cat = data.dimension[timeDim].category;
      timeLabels = cat.index ? Object.keys(cat.index).sort(function (a, b) {
        return (cat.index[a] || 0) - (cat.index[b] || 0);
      }) : [];
    }

    var values = data.value || [];
    var fn = def.transform;
    var series = [];
    for (var i = 0; i < values.length && i < timeLabels.length; i++) {
      var v = values[i];
      series.push({
        period: timeLabels[i],
        value: fn ? fn(v) : v,
      });
    }

    // Optional: limit to last N years
    var years = parseInt(req.query && req.query.years, 10) || 0;
    if (years > 0) {
      var cutoff = series.length - (years * (indicator === 'gdp' || indicator === 'salary' || indicator === 'house_prices' ? 4 : 12));
      if (cutoff > 0) series = series.slice(cutoff);
    }

    // Calculate summary stats
    var validVals = series.filter(function (s) { return s.value !== null; }).map(function (s) { return s.value; });
    var latest = validVals.length > 0 ? validVals[validVals.length - 1] : null;
    var previous = validVals.length > 1 ? validVals[validVals.length - 2] : null;
    var min = validVals.length > 0 ? Math.min.apply(null, validVals) : null;
    var max = validVals.length > 0 ? Math.max.apply(null, validVals) : null;
    var avg = validVals.length > 0 ? validVals.reduce(function (a, b) { return a + b; }, 0) / validVals.length : null;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        indicator: indicator,
        title: def.title,
        unit: def.unit,
        source: def.source,
        series: series,
        summary: {
          latest: latest,
          previous: previous,
          change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null,
          min: min !== null ? +min.toFixed(2) : null,
          max: max !== null ? +max.toFixed(2) : null,
          avg: avg !== null ? +avg.toFixed(2) : null,
          count: validVals.length,
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
