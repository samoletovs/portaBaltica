/**
 * Baltic port statistics, from Eurostat's maritime transport collection.
 *
 * This replaced data.gov.lv as the maritime source because that feed did not
 * merely lag — it stopped. From 2026-03-08 the publisher emitted a weekly CSV
 * containing the column header and no rows: REJVESLS at 64 bytes, PSNGFERRY at
 * 146, LOADCRG at 106, eighteen weeks running. The portal's datastore was
 * right to refuse them (`datastore_active` stayed false), so the previous
 * "pick the newest active resource" strategy was permanently pinned to the
 * 2026-03-01 snapshot with nothing behind it to advance to. No amount of
 * waiting would have fixed it, which is why the banner apologising for
 * ingestion lag was describing a cause that did not exist.
 *
 * Eurostat is a genuine substitute rather than a consolation prize:
 *
 *   - It is alive. `mar_tf_qm` was refreshed the day this was written and
 *     carries 2026-Q2.
 *   - It covers all three Baltic states, so the maritime tile stops being the
 *     one Latvia-only section of a Baltic dashboard.
 *   - It reports volumes — tonnes, passengers, vessel arrivals — where the old
 *     feed reported a handful of individual rows a week, and in the case of
 *     vessels only the *cancelled and rejected* calls.
 *
 * The honest trade is granularity: quarterly, not weekly, and published a
 * couple of quarters in arrears. `/api/port-data` reports the period each
 * series actually reaches so the UI can state that rather than imply currency.
 *
 * Every dimension of every cube below is pinned. An unpinned dimension makes
 * `parseJsonStatDim` choose a slice on our behalf and report it in
 * `assumptions`; the tests fail on a non-empty `assumptions`, because that is
 * how a chart ends up confidently plotting the wrong statistic.
 */

const eurostat = require('./eurostat.js');

/** Countries the dashboard offers, and their Eurostat country-level code. */
const COUNTRIES = ['LV', 'EE', 'LT'];

/**
 * Main ports per country, in the order they should be displayed.
 *
 * Codes come from the `rep_mar` dimension. Not every cube breaks every country
 * down by port — Eurostat publishes Estonia's goods and passenger tables at
 * country level only — so `loadSeries` falls back to the country aggregate
 * rather than rendering an empty panel.
 */
const PORTS = {
  LV: [
    { code: 'LV_0LVRIX', name: 'Riga' },
    { code: 'LV_0LVVNT', name: 'Ventspils' },
    { code: 'LV_0LVLPX', name: 'Liep\u0101ja' },
    { code: 'LV_0LVSKU', name: 'Skulte' },
  ],
  EE: [
    { code: 'EE_0EETLL', name: 'Tallinn' },
    { code: 'EE_0EESLM', name: 'Sillam\u00e4e' },
    { code: 'EE_0EEKND', name: 'Kunda' },
    { code: 'EE_0EEPRN', name: 'P\u00e4rnu' },
  ],
  LT: [
    { code: 'LT_0LTKLJ', name: 'Klaip\u0117da' },
    { code: 'LT_0LTBOT', name: 'Butinge' },
  ],
};

/**
 * Cargo categories that partition the total exactly once.
 *
 * Eurostat's `cargo` dimension mixes levels: `LBK` is liquid bulk and
 * `LBK_ROIL` is refined oil *within* it. Charting the dimension as it arrives
 * double-counts every tonne. These six sum to `TOTAL` — verified against
 * 2025-Q4 Latvia, where they total 7,827 against a reported 7,828, the
 * difference being rounding in thousand-tonne units.
 */
const CARGO_MIX = [
  { code: 'LBK', name: 'Liquid bulk' },
  { code: 'DBK', name: 'Dry bulk' },
  { code: 'LCNT', name: 'Containers' },
  { code: 'RO_MSP', name: 'Ro-Ro self-propelled' },
  { code: 'RO_MNSP', name: 'Ro-Ro non-self-propelled' },
  { code: 'OTH', name: 'Other cargo' },
];

/** Quarters of history to request. Eight years keeps a pre-2022 baseline. */
const YEARS = 8;

function since() {
  return eurostat.sincePeriod('Q', YEARS);
}

function url(dataset, params) {
  return eurostat.EUROSTAT_BASE + '/' + dataset + '?format=JSON&lang=EN&' + params;
}

function repMarParams(codes) {
  return codes.map(function (c) { return 'rep_mar=' + encodeURIComponent(c); }).join('&');
}

/**
 * The three series the maritime tile renders, each fully pinned.
 *
 * `goods` and `passengers` read the per-country tables, which are small enough
 * to fetch whole and therefore do not pin `rep_mar` — the ports come back
 * enumerated in the response, which is how Estonia's country-only breakdown
 * is discovered rather than assumed. `vessels` reads the Europe-wide table,
 * which must pin `rep_mar` or Eurostat answers HTTP 413 and defers the request
 * to its asynchronous queue.
 */
function seriesUrls(country) {
  const cc = country.toLowerCase();
  const portCodes = PORTS[country].map(function (p) { return p.code; });

  return {
    goods: url('mar_go_qm_' + cc,
      'freq=Q&direct=TOTAL&cargo=TOTAL&unit=THS_T&par_mar=TOTAL&sinceTimePeriod=' + since()),

    // `unit=THS`, not the more specific-looking `THS_PASF`. Eurostat lists both
    // on this cube, and `THS_PASF` — "thousand passengers (excluding cruise
    // passengers)" — is very nearly empty: across Latvia 2024-Q1..2025-Q4 it
    // carries exactly one value while `THS` carries all eight. The whole table
    // already excludes cruise passengers per its own title, so `THS` is the
    // right slice and the tempting one is the trap.
    passengers: url('mar_pa_qm_' + cc,
      'freq=Q&natvessr=TOTAL&direct=TOTAL&unit=THS&par_mar=TOTAL&sinceTimePeriod=' + since()),

    vessels: url('mar_tf_qm',
      'freq=Q&tonnage=TOTAL&vessel=TOTAL&unit=NR&' + repMarParams(portCodes) +
      '&sinceTimePeriod=' + since()),

    // Cargo mix is a single country-level slice: `cargo` is deliberately left
    // unpinned here because it *is* the axis being read, and `rep_mar` is
    // pinned to the country so the six categories are not split across ports.
    cargoMix: url('mar_go_qm_' + cc,
      'freq=Q&direct=TOTAL&unit=THS_T&par_mar=TOTAL&rep_mar=' + country +
      '&sinceTimePeriod=' + since()),
  };
}

/** Display name for a `rep_mar` code, falling back to Eurostat's own label. */
function portName(country, code, fallback) {
  const known = (PORTS[country] || []).find(function (p) { return p.code === code; });
  if (known) return known.name;
  if (code === country) return null;
  return fallback || code;
}

module.exports = {
  COUNTRIES: COUNTRIES,
  PORTS: PORTS,
  CARGO_MIX: CARGO_MIX,
  YEARS: YEARS,
  seriesUrls: seriesUrls,
  portName: portName,
};
