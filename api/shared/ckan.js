/**
 * Shared client for the data.gov.lv CKAN portal.
 *
 * This exists because two dashboard numbers were confidently wrong for months
 * and the code had no way to tell anyone:
 *
 *   - "Suspended Activities" asked for the dataset
 *     `saimnieciskas-darbibas-apstiprinasana-atjaunosana`, which does not
 *     exist. The portal answered 404, a bare `catch` turned that into `0`, and
 *     the tile rendered a plausible-looking zero. A missing dataset and a real
 *     zero were indistinguishable on screen.
 *   - "VAT Registered Businesses" reported `result.total` of the whole PVN
 *     registry — 283,684 rows, including companies struck off in the 1990s.
 *     The live count of *active* payers is about 84,700.
 *
 * So two rules are enforced here rather than left to each caller:
 *
 *   1. Every failure throws. Callers decide what a missing number looks like,
 *      and the answer is never a fabricated zero.
 *   2. `success` is checked, not the status code. The portal answers HTTP 200
 *      with `{"success": false}` for an unknown action, so a status-only check
 *      reads an error as data.
 *
 * The portal's `datastore_search_sql` action is disabled (it answers HTTP 409),
 * and `filters` only does equality, so anything needing a range comparison has
 * to be counted here — see `scanColumn`.
 */

const eurostat = require('./eurostat.js');

const CKAN_BASE = 'https://data.gov.lv/dati/api/3/action';

/** CKAN caps a single datastore page well below the size of these datasets. */
const PAGE_SIZE = 32000;

/** Guard against an unbounded loop if the portal ever reports a bogus total. */
const MAX_PAGES = 10;

function buildUrl(action, params) {
  const query = Object.keys(params || {})
    .filter(function (k) { return params[k] !== undefined && params[k] !== null; })
    .map(function (k) {
      const raw = params[k];
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return encodeURIComponent(k) + '=' + encodeURIComponent(value);
    })
    .join('&');
  return CKAN_BASE + '/' + action + (query ? '?' + query : '');
}

/**
 * Call a CKAN action and return `result`.
 *
 * Throws on transport failure, on a non-2xx status, and on `success: false` —
 * the last of which arrives with HTTP 200 and would otherwise be read as data.
 */
async function ckan(action, params, options) {
  const opts = options || {};
  const url = buildUrl(action, params);
  const body = await eurostat.httpJson(url, { deadlineMs: opts.deadlineMs || 15000 });
  if (!body || body.success !== true) {
    const detail = body && body.error && (body.error.message || body.error.__type);
    throw new Error('CKAN ' + action + ' failed' + (detail ? ': ' + detail : '') + ' (' + url + ')');
  }
  return body.result;
}

/**
 * Rows matching `filters`, counted by the portal rather than downloaded.
 *
 * `filters` is exact-match only. `{"Aktivs": "ir"}` works; a date range does
 * not, and neither does IS NULL — CKAN renders a null filter as `= NULL`,
 * which matches nothing and quietly returns zero.
 */
async function countRows(resourceId, filters, options) {
  const result = await ckan('datastore_search', {
    resource_id: resourceId,
    limit: '0',
    filters: filters ? JSON.stringify(filters) : undefined,
  }, options);
  const total = result && result.total;
  if (typeof total !== 'number') throw new Error('CKAN returned no total for ' + resourceId);
  return total;
}

/**
 * Download just the named columns for every row matching `filters`.
 *
 * The projection is what makes a full scan affordable: two date columns across
 * ~53k rows is a few MB over two requests, because CKAN caps a page at 32k
 * rows. Asking for whole rows would be an order of magnitude larger.
 *
 * Scanning is not a fallback for filtering here, it is the safer option. VID
 * encodes "no decision recorded" as a *whitespace* string, so a server-side
 * `filters` match would depend on the publisher continuing to emit exactly two
 * spaces — and the day they emit one, the filter matches nothing and the tile
 * silently reads zero again. That is the bug this module exists to prevent, so
 * the emptiness test belongs in code that can be tested.
 */
async function scanFields(resourceId, fields, filters, options) {
  const rows = [];
  let offset = 0;
  let total = Infinity;

  for (let page = 0; page < MAX_PAGES && offset < total; page++) {
    const result = await ckan('datastore_search', {
      resource_id: resourceId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      fields: fields.join(','),
      filters: filters ? JSON.stringify(filters) : undefined,
    }, options);

    total = typeof result.total === 'number' ? result.total : rows.length;
    const records = result.records || [];
    if (records.length === 0) break;

    for (let i = 0; i < records.length; i++) rows.push(records[i]);
    offset += records.length;
  }

  if (rows.length < total) {
    throw new Error('CKAN scan of ' + resourceId + ' stopped at ' + rows.length + ' of ' + total + ' rows');
  }
  return rows;
}

/**
 * The most recent resources in an already-fetched dataset that the datastore
 * will actually serve.
 *
 * `datastore_active` is load-bearing, not cosmetic. The portal's ingestion runs
 * behind publication and a resource it has not ingested returns 404 when
 * queried, so the newest *active* resource is the newest data that exists as
 * far as the API is concerned, and it re-syncs on its own once ingestion
 * catches up.
 *
 * There is a limit to what that self-healing can do, and the maritime datasets
 * are the cautionary tale. They were read this way until the publisher began
 * emitting weekly CSVs containing a column header and nothing else — eighteen
 * of them. The datastore correctly refused every one, so this function kept
 * returning the last good resource, from 2026-03-01, indefinitely and without
 * complaint. Selecting the newest *queryable* resource cannot distinguish
 * "upstream is briefly behind" from "upstream has stopped", which is why the
 * port panels moved to Eurostat and why anything still read this way needs a
 * freshness assertion above it rather than trust in the fallback.
 *
 * `namePrefix` selects a series within a dataset that holds several, and is
 * null for a dataset with a single resource.
 */
function pickLatestActive(pkg, namePrefix, count) {
  const resources = (pkg && pkg.resources) || [];

  const matching = resources.filter(function (r) {
    if (!r || !r.datastore_active) return false;
    if (!namePrefix) return true;
    return typeof r.name === 'string' && r.name.indexOf(namePrefix) === 0;
  });

  matching.sort(function (a, b) {
    return (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0);
  });

  return matching.slice(0, count || 1).map(function (r) {
    return { id: r.id, name: r.name, created: r.created, snapshotDate: snapshotDateOf(r.name, r.created) };
  });
}

/** `pickLatestActive` against a dataset this function fetches itself. */
async function latestActiveResources(packageId, namePrefix, count, options) {
  const pkg = await ckan('package_show', { id: packageId }, options);
  return pickLatestActive(pkg, namePrefix, count);
}

/**
 * Snapshot date of a maritime resource, read from its `NAME_YYYYMMDD.csv`
 * filename and falling back to the upload timestamp.
 */
function snapshotDateOf(name, created) {
  const match = typeof name === 'string' ? name.match(/_(\d{4})(\d{2})(\d{2})\b/) : null;
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  const parsed = Date.parse(created || '');
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

module.exports = {
  CKAN_BASE: CKAN_BASE,
  PAGE_SIZE: PAGE_SIZE,
  buildUrl: buildUrl,
  ckan: ckan,
  countRows: countRows,
  scanFields: scanFields,
  pickLatestActive: pickLatestActive,
  latestActiveResources: latestActiveResources,
  snapshotDateOf: snapshotDateOf,
};
