const https = require('https');

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { timeout: 20000 }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse failed')); }
      });
    }).on('error', reject);
  });
}

var EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

// Eurostat dataset definitions for Baltic comparison
var DATASETS = {
  gdp: {
    dataset: 'namq_10_gdp',
    params: 'unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&freq=Q',
    title: 'GDP Growth Rate',
    unit: '% QoQ',
  },
  unemployment: {
    dataset: 'une_rt_m',
    params: 'unit=PC_ACT&s_adj=SA&age=TOTAL&sex=T&freq=M',
    title: 'Unemployment Rate',
    unit: '%',
  },
  inflation: {
    dataset: 'prc_hicp_manr',
    params: 'coicop=CP00&freq=M',
    title: 'HICP Inflation',
    unit: '% YoY',
  },
  house_prices: {
    dataset: 'prc_hpi_q',
    params: 'purchase=TOTAL&unit=RCH_A&freq=Q',
    title: 'House Price Change',
    unit: '% YoY',
  },
};

function parseJsonStat(data, countries) {
  // JSON-stat 2.0 flat array format
  // Dimensions: data.id array, data.size array
  // Values indexed as: dim0_idx * (size1*size2*...) + dim1_idx * (size2*...) + ...
  if (!data || !data.value || !data.id) return {};

  var dims = data.id;
  var sizes = data.size;
  var geoIdx = dims.indexOf('geo');
  var timeIdx = dims.indexOf('time');
  if (geoIdx < 0 || timeIdx < 0) return {};

  var geoCat = data.dimension.geo.category;
  var timeCat = data.dimension.time.category;

  var geoKeys = Object.keys(geoCat.index).sort(function (a, b) { return geoCat.index[a] - geoCat.index[b]; });
  var timeKeys = Object.keys(timeCat.index).sort(function (a, b) { return timeCat.index[a] - timeCat.index[b]; });

  // Build result per country
  var result = {};
  for (var gi = 0; gi < geoKeys.length; gi++) {
    var geo = geoKeys[gi];
    if (countries.indexOf(geo) < 0) continue;
    result[geo] = { label: geoCat.label[geo] || geo, series: [] };

    for (var ti = 0; ti < timeKeys.length; ti++) {
      // Calculate flat index
      var idx = 0;
      var multiplier = 1;
      for (var d = dims.length - 1; d >= 0; d--) {
        var dimKey;
        if (d === geoIdx) dimKey = geoCat.index[geo];
        else if (d === timeIdx) dimKey = timeCat.index[timeKeys[ti]];
        else dimKey = 0; // first element of other dimensions (already filtered by params)
        idx += dimKey * multiplier;
        multiplier *= sizes[d];
      }

      var val = data.value[idx];
      if (val === undefined) val = data.value[String(idx)];
      result[geo].series.push({
        period: timeKeys[ti],
        value: val !== undefined && val !== null ? +val : null,
      });
    }
  }
  return result;
}

/**
 * GET /api/baltic-compare?indicator=gdp&years=5
 *
 * Returns Latvia vs Estonia vs Lithuania comparison data from Eurostat.
 */
module.exports = async function (context, req) {
  var indicator = (req.query && req.query.indicator) || '';
  var def = DATASETS[indicator];
  if (!def) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown indicator. Available: ' + Object.keys(DATASETS).join(', ') }),
    };
    return;
  }

  var years = parseInt(req.query && req.query.years, 10) || 5;
  var sinceYear = new Date().getFullYear() - years;
  var freq = def.params.includes('freq=M') ? 'M' : 'Q';
  var sincePeriod = freq === 'M' ? sinceYear + '-01' : sinceYear + '-Q1';

  try {
    var url = EUROSTAT + '/' + def.dataset + '?geo=LV&geo=EE&geo=LT&' + def.params + '&sinceTimePeriod=' + sincePeriod;
    var data = await jsonGet(url);

    var countries = parseJsonStat(data, ['LV', 'EE', 'LT']);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        indicator: indicator,
        title: def.title,
        unit: def.unit,
        countries: countries,
        source: 'Eurostat (' + def.dataset + ')',
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
