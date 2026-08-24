/**
 * Shared Eurostat access layer.
 *
 * Two jobs, both learned from a live audit of the deployed dashboard:
 *
 * 1. `httpJson` gives every upstream call a hard deadline. The old per-call
 *    `timeout` option only armed a socket idle timer, so a source that accepted
 *    the connection and then stalled could hold a request open far longer than
 *    its stated budget — that is how /api/system-status came to report a 16s
 *    response for an 8s timeout.
 *
 * 2. `parseJsonStat` no longer guesses silently. The previous parser used index
 *    0 for any dimension the query had not pinned. When Eurostat retired a code
 *    (or a definition named the wrong one) the query still returned a valid
 *    cube, the parser read a slice of it, and the chart rendered either nothing
 *    or — worse — a completely different statistic under the old label. The
 *    parser now picks the slice that actually carries data and reports every
 *    such choice in `assumptions`, so an unpinned dimension is visible in the
 *    API response and can be asserted against in tests.
 */

const https = require('https');

const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

function httpText(url, options) {
  const opts = options || {};
  const deadlineMs = opts.deadlineMs || 15000;

  return new Promise(function (resolve, reject) {
    let settled = false;
    const finish = function (err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      if (err) reject(err); else resolve(value);
    };

    const timer = setTimeout(function () {
      finish(new Error('Deadline ' + deadlineMs + 'ms exceeded for ' + url));
    }, deadlineMs);

    const req = https.get(url, {
      timeout: deadlineMs,
      headers: Object.assign({ 'User-Agent': 'portaBaltica/1.0 (+https://portabaltica.naurolabs.com)' }, opts.headers || {}),
    }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return finish(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { finish(null, data); });
      res.on('error', finish);
    });

    req.on('timeout', function () { finish(new Error('Timeout: ' + url)); });
    req.on('error', finish);
  });
}

function httpJson(url, options) {
  return httpText(url, options).then(function (text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('JSON parse failed for ' + url);
    }
  });
}

function strides(sizes) {
  const out = new Array(sizes.length);
  let mult = 1;
  for (let d = sizes.length - 1; d >= 0; d--) {
    out[d] = mult;
    mult *= sizes[d];
  }
  return out;
}

function valueAt(data, flatIdx) {
  const v = data.value[flatIdx];
  return v === undefined ? data.value[String(flatIdx)] : v;
}

function sortedCodes(category) {
  return Object.keys(category.index).sort(function (a, b) {
    return category.index[a] - category.index[b];
  });
}

/**
 * Count non-null cells for a candidate set of fixed positions on the
 * non-geo/non-time dimensions.
 */
function coverage(data, dims, sizes, str, geoIdx, timeIdx, fixed, geoCodes, timeCount) {
  const geoCat = data.dimension.geo.category;
  let found = 0;
  for (let g = 0; g < geoCodes.length; g++) {
    for (let t = 0; t < timeCount; t++) {
      let idx = 0;
      for (let d = 0; d < dims.length; d++) {
        let pos;
        if (d === geoIdx) pos = geoCat.index[geoCodes[g]];
        else if (d === timeIdx) pos = t;
        else pos = fixed[d] || 0;
        idx += pos * str[d];
      }
      const v = valueAt(data, idx);
      if (v !== null && v !== undefined) found++;
    }
  }
  return found;
}

/**
 * Parse a JSON-stat 2.0 cube into per-country series.
 *
 * Returns { countries, assumptions }. `assumptions` is non-empty only when the
 * query left a dimension with more than one category — which a correct
 * indicator definition never should.
 */
function parseJsonStat(data, wanted) {
  const empty = { countries: {}, assumptions: [] };
  if (!data || !data.value || !data.id || !data.dimension) return empty;

  const dims = data.id;
  const sizes = data.size;
  const geoIdx = dims.indexOf('geo');
  const timeIdx = dims.indexOf('time');
  if (geoIdx < 0 || timeIdx < 0) return empty;

  const geoCat = data.dimension.geo.category;
  const timeCat = data.dimension.time.category;
  const geoCodes = sortedCodes(geoCat).filter(function (g) { return wanted.indexOf(g) >= 0; });
  const timeCodes = sortedCodes(timeCat);
  if (geoCodes.length === 0 || timeCodes.length === 0) return empty;

  const str = strides(sizes);
  const fixed = new Array(dims.length).fill(0);
  const assumptions = [];

  // Resolve unpinned dimensions greedily: for each, keep the category that
  // yields the most data. A well-specified indicator has none of these.
  for (let d = 0; d < dims.length; d++) {
    if (d === geoIdx || d === timeIdx || sizes[d] <= 1) continue;
    const codes = sortedCodes(data.dimension[dims[d]].category);
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < codes.length; c++) {
      fixed[d] = c;
      const score = coverage(data, dims, sizes, str, geoIdx, timeIdx, fixed, geoCodes, timeCodes.length);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    fixed[d] = best;
    assumptions.push({
      dimension: dims[d],
      chosen: codes[best],
      optionCount: codes.length,
      reason: 'dimension not pinned by the indicator definition',
    });
  }

  const countries = {};
  for (let g = 0; g < geoCodes.length; g++) {
    const geo = geoCodes[g];
    const series = [];
    for (let t = 0; t < timeCodes.length; t++) {
      let idx = 0;
      for (let d = 0; d < dims.length; d++) {
        let pos;
        if (d === geoIdx) pos = geoCat.index[geo];
        else if (d === timeIdx) pos = timeCat.index[timeCodes[t]];
        else pos = fixed[d];
        idx += pos * str[d];
      }
      const v = valueAt(data, idx);
      series.push({
        period: timeCodes[t],
        value: v !== null && v !== undefined ? +v : null,
      });
    }
    countries[geo] = {
      label: (geoCat.label && geoCat.label[geo]) || geo,
      series: series,
    };
  }

  return { countries: countries, assumptions: assumptions };
}

/**
 * Earliest period to request, expressed in the granularity the dataset uses.
 *
 * Eurostat rejects or silently mismatches a quarterly bound on a monthly or
 * semi-annual dataset, so the frequency has to come from the definition rather
 * than be inferred from a substring of the query string.
 */
function sincePeriod(freq, years) {
  const since = new Date().getFullYear() - Math.max(1, years || 5);
  if (freq === 'M') return since + '-01';
  if (freq === 'Q') return since + '-Q1';
  if (freq === 'S') return since + '-S1';
  return String(since);
}

function buildUrl(def, years, geos) {
  return EUROSTAT_BASE + '/' + def.dataset +
    '?' + geos.map(function (g) { return 'geo=' + g; }).join('&') +
    '&' + def.params +
    '&sinceTimePeriod=' + sincePeriod(def.freq, years);
}

module.exports = {
  EUROSTAT_BASE: EUROSTAT_BASE,
  httpText: httpText,
  httpJson: httpJson,
  parseJsonStat: parseJsonStat,
  sincePeriod: sincePeriod,
  buildUrl: buildUrl,
};
