const eurostat = require('../shared/eurostat.js');
const ports = require('../shared/ports.js');
const countries = require('../shared/country.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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
 * Months a port's last filing trails the newest quarter any port reached.
 *
 * Uses `periodToMonthIndex` rather than parsing quarters here, so the whole
 * codebase compares periods one way.
 */
function monthsBehind(period, reference) {
  const a = eurostat.periodToMonthIndex(period);
  const b = eurostat.periodToMonthIndex(reference);
  if (a === null || b === null) return null;
  return b - a;
}

/**
 * How far behind a port may fall before it is reported as stopped rather than
 * late.
 *
 * Four quarters. Eurostat's maritime tables run one to two quarters in arrears
 * as normal operation and individual ports slip a quarter routinely, so a
 * tighter bound would label healthy ports dead. Twelve months matches
 * `MAX_AGE_MONTHS.Q` in `shared/eurostat.js` and
 * `PORT_DATA_STALE_AFTER_MONTHS` in `src/dataFreshness.ts`, so server, client
 * and health probe all draw the line in the same place.
 */
const DISCONTINUED_AFTER_MONTHS = 12;

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
 *
 * Ports are otherwise intersected with the registry, which is what keeps the
 * country aggregate and Eurostat's `LV_0LV888` "other Latvian ports" bucket —
 * all zeroes, every quarter — out of a chart of named ports.
 *
 * Each entry is then marked `discontinued` when its own newest filing trails
 * the newest quarter any port reached by more than a year. Riga's sea passenger
 * series ends at 2021-Q4 with four literal zeroes behind it, and the bars drop
 * it because it has no value for the quarter on screen. Dropping it is right;
 * dropping it with nothing in the payload to say it ever existed leaves every
 * consumer of this endpoint — the tile, the newsroom, anyone reading the public
 * JSON — unable to tell a closed route from a broken feed.
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

    const newest = newestOf(entries.map(function (e) { return e.latest; }));
    entries.forEach(function (e) {
      const behind = monthsBehind(e.latest, newest);
      e.monthsBehind = behind;
      e.discontinued = behind !== null && behind >= DISCONTINUED_AFTER_MONTHS;
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
 *
 * `breakdown` says which of three different things an empty `categories` means,
 * because the UI cannot tell them apart and a reader deserves to:
 *
 *   - `published`  — the six categories are here.
 *   - `unpublished` — Eurostat answered, and its `cargo` dimension carries
 *     nothing but `TOTAL`. This is Estonia: `mar_go_qm_ee` has exactly one
 *     cargo code, so there is no breakdown to show and there never was one to
 *     lose. A settled fact about the source, not a fault.
 *   - `unavailable` — the request failed, or the cube came back with no total
 *     either. A fault, possibly transient.
 *
 * Collapsing all three into `categories: []` is what let the endpoint ship
 * Estonia a total of 4,833 with no components — a headline figure that no
 * chart could account for, and no way for the client to say why.
 */
async function loadCargoMix(country, url) {
  const unavailable = { period: null, total: null, categories: [], breakdown: 'unavailable' };
  try {
    const raw = await eurostat.httpJson(url, { deadlineMs: 12000 });
    const codes = ports.CARGO_MIX.map(function (c) { return c.code; });
    const parsed = eurostat.parseJsonStatDim(raw, 'cargo', codes.concat(['TOTAL']));

    const totalSeries = (parsed.series.TOTAL && parsed.series.TOTAL.series) || [];
    const period = latestPeriod(totalSeries);
    if (!period) return unavailable;

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
      breakdown: categories.length > 0 ? 'published' : 'unpublished',
    };
  } catch (err) {
    warn('cargo mix', err);
    return unavailable;
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

/** Oldest of several period labels — the quarter every measure has reached. */
function oldestOf(candidates) {
  let oldest = null;
  let oldestIdx = Infinity;
  candidates.filter(Boolean).forEach(function (period) {
    const idx = eurostat.periodToMonthIndex(period);
    if (idx === null || idx >= oldestIdx) return;
    oldestIdx = idx;
    oldest = period;
  });
  return oldest;
}

function groupLatest(group) {
  return newestOf(group.entries.map(function (e) { return e.latest; }));
}

const handler = async function (context, req) {
  // Case-insensitive, and an unrecognised country is a bad request rather than
  // a silent request for Latvia. This endpoint already upper-cased while the
  // other three did not normalise at all — that disagreement is what made the
  // whole class of fault possible, so all four now read the parameter one way.
  const requested = countries.normaliseCountry(req.query && req.query.country);
  if (requested === null) {
    context.res = countries.badCountry(req.query && req.query.country);
    return;
  }
  // `ports.PORTS` and `ports.COUNTRIES` key upper case, which is the Eurostat
  // convention for `geo`; the shared normaliser is canonically lower.
  const country = requested.toUpperCase();

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

    const measurePeriods = [groupLatest(goods), groupLatest(passengers), groupLatest(vessels)];
    const newestPeriod = newestOf(measurePeriods);
    const oldestPeriod = oldestOf(measurePeriods);

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
        dataAsOf: newestPeriod,
        // The quarter *every* measure has reached. The three tables are
        // published independently and do drift apart — the vessel cube was
        // padded to 2026-Q2 while Latvian goods stopped at 2025-Q4 — so a tile
        // headed with `dataAsOf` alone would date two of its three panels to a
        // quarter they had not reached. When these agree the UI states one
        // quarter; when they differ it states the span.
        dataFrom: oldestPeriod,
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

module.exports = withSecurity(withCache(handler, {
  name: 'port-data',
  keyOn: ['country'],
  ttlMs: 21600000,
  graceMs: 86400000,
  staleWhileRevalidate: true,
}));
