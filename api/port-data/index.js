const rateLimit = require('../shared/rateLimit.js');
const eurostat = require('../shared/eurostat.js');
const ports = require('../shared/ports.js');

/**
 * Baltic port statistics: cargo tonnage, passengers and vessel arrivals.
 *
 * Previously this read four weekly series from data.gov.lv's CKAN datastore.
 * That feed is discontinued, not slow — see `api/shared/ports.js` for the
 * evidence — so the endpoint now serves Eurostat's maritime tables, which are
 * still being published and cover Estonia and Lithuania as well as Latvia.
 *
 * Two properties of the old endpoint are deliberately kept:
 *
 *   1. A failing series degrades to an empty list instead of failing the whole
 *      response. Losing the passenger panel is better than losing the page.
 *   2. The response states the period the data *describes*, never implying it
 *      is current. The staleness judgement still belongs to the client,
 *      because this response is cached for hours downstream and a boolean
 *      computed here would itself go stale.
 */

const CACHE_SECONDS = 6 * 60 * 60;

function warn(label, err) {
  console.warn('[port-data] ' + label + ' unavailable: ' + ((err && err.message) || err));
}

/** Newest period in a series that actually carries a value. */
function latestPeriod(points) {
  let newest = null;
  let newestIdx = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || p.value === null || p.value === undefined) continue;
    const idx = eurostat.periodToMonthIndex(p.period);
    if (idx === null || idx <= newestIdx) continue;
    newestIdx = idx;
    newest = p.period;
  }
  return newest;
}

function valueAt(entry, period) {
  const hit = entry.series.find(function (p) { return p.period === period; });
  return hit ? hit.value : null;
}

/**
 * Drop trailing periods no port has reported yet.
 *
 * Eurostat pads the cube to the newest quarter any country has filed, so a
 * country two quarters in arrears comes back with nulls on the end. Charting
 * those draws a line that falls off a cliff at the right-hand edge.
 */
function trimTrailingGaps(entries) {
  let last = -1;
  entries.forEach(function (e) {
    for (let i = 0; i < e.series.length; i++) {
      const v = e.series[i].value;
      if (v !== null && v !== undefined && i > last) last = i;
    }
  });
  if (last < 0) return entries;
  return entries.map(function (e) {
    return Object.assign({}, e, { series: e.series.slice(0, last + 1) });
  });
}

/**
 * One port-keyed series.
 *
 * Eurostat publishes some countries at country level only, so whatever
 * `rep_mar` codes come back are used as-is rather than intersected with a
 * hardcoded port list — that is what lets Estonia render its national total
 * instead of an empty panel. `countryOnly` records which of the two happened
 * so the UI can say so rather than mislabel a national figure as a port.
 */
async function loadPortSeries(label, country, url) {
  try {
    const raw = await eurostat.httpJson(url, { deadlineMs: 12000 });
    const parsed = eurostat.parseJsonStatDim(raw, 'rep_mar', null);

    const wanted = ports.PORTS[country].map(function (p) { return p.code; });
    const codes = Object.keys(parsed.series);
    const portCodes = codes.filter(function (c) { return wanted.indexOf(c) >= 0; });
    const countryOnly = portCodes.length === 0;
    const use = countryOnly ? codes.filter(function (c) { return c === country; }) : portCodes;

    const entries = use.map(function (code) {
      const entry = parsed.series[code];
      return {
        code: code,
        name: ports.portName(country, code, entry.label) || entry.label,
        series: entry.series,
        latest: latestPeriod(entry.series),
      };
    }).filter(function (e) { return e.latest !== null; });

    // Largest port first, measured on its own most recent reported quarter.
    entries.sort(function (a, b) {
      return (valueAt(b, b.latest) || 0) - (valueAt(a, a.latest) || 0);
    });

    return {
      entries: trimTrailingGaps(entries),
      countryOnly: countryOnly,
      assumptions: parsed.assumptions,
    };
  } catch (err) {
    warn(label, err);
    return { entries: [], countryOnly: false, assumptions: [] };
  }
}

/**
 * Cargo split by type for the newest quarter that has one.
 *
 * Only the six categories that partition the total are read; Eurostat's
 * `cargo` dimension also carries their subdivisions, and summing the dimension
 * as delivered would count every tonne twice.
 */
async function loadCargoMix(country, url) {
  const empty = { period: null, total: null, categories: [] };
  try {
    const raw = await eurostat.httpJson(url, { deadlineMs: 12000 });
    const codes = ports.CARGO_MIX.map(function (c) { return c.code; });
    const parsed = eurostat.parseJsonStatDim(raw, 'cargo', codes.concat(['TOTAL']));

    const totalSeries = (parsed.series.TOTAL && parsed.series.TOTAL.series) || [];
    const period = latestPeriod(totalSeries);
    if (!period) return empty;

    const categories = ports.CARGO_MIX.map(function (c) {
      const entry = parsed.series[c.code];
      const point = entry && entry.series.find(function (p) { return p.period === period; });
      return { code: c.code, name: c.name, weight: point && point.value !== null ? point.value : 0 };
    }).filter(function (c) { return c.weight > 0; })
      .sort(function (a, b) { return b.weight - a.weight; });

    const totalPoint = totalSeries.find(function (p) { return p.period === period; });

    return {
      period: period,
      total: totalPoint ? totalPoint.value : null,
      categories: categories,
    };
  } catch (err) {
    warn('cargo mix', err);
    return empty;
  }
}

/** Newest of several period labels, so the UI can date the whole tile. */
function newestOf(candidates) {
  let newest = null;
  let newestIdx = -Infinity;
  candidates.filter(Boolean).forEach(function (period) {
    const idx = eurostat.periodToMonthIndex(period);
    if (idx === null || idx <= newestIdx) return;
    newestIdx = idx;
    newest = period;
  });
  return newest;
}

function groupLatest(group) {
  return newestOf(group.entries.map(function (e) { return e.latest; }));
}

module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const requested = String((req.query && req.query.country) || 'LV').toUpperCase();
  const country = ports.COUNTRIES.indexOf(requested) >= 0 ? requested : 'LV';

  try {
    const urls = ports.seriesUrls(country);

    const results = await Promise.all([
      loadPortSeries('goods', country, urls.goods),
      loadPortSeries('passengers', country, urls.passengers),
      loadPortSeries('vessels', country, urls.vessels),
      loadCargoMix(country, urls.cargoMix),
    ]);

    const goods = results[0];
    const passengers = results[1];
    const vessels = results[2];
    const cargoMix = results[3];

    const assumptions = goods.assumptions
      .concat(passengers.assumptions)
      .concat(vessels.assumptions);

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=' + CACHE_SECONDS,
      },
      body: JSON.stringify({
        country: country,
        goods: {
          unit: 'THS_T',
          countryOnly: goods.countryOnly,
          latest: groupLatest(goods),
          ports: goods.entries,
        },
        passengers: {
          unit: 'THS',
          countryOnly: passengers.countryOnly,
          latest: groupLatest(passengers),
          ports: passengers.entries,
        },
        vessels: {
          unit: 'NR',
          countryOnly: vessels.countryOnly,
          latest: groupLatest(vessels),
          ports: vessels.entries,
        },
        cargoMix: cargoMix,
        // The period the statistics describe, not when we fetched them.
        dataAsOf: newestOf([groupLatest(goods), groupLatest(passengers), groupLatest(vessels)]),
        source: 'Eurostat maritime transport (mar_go_qm, mar_pa_qm, mar_tf_qm)',
        // Empty for a correct definition; a value here means a dimension went
        // unpinned and a slice was chosen for us.
        assumptions: assumptions,
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
