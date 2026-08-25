/**
 * Latvian business-registry counts for the Economy tile's "Business pulse".
 *
 * Both figures on that row were wrong, in the same way and for the same
 * reason: the code took `result.total` of a whole CKAN dataset and presented
 * it as an answer to a question the dataset does not answer.
 *
 * ── Suspended activities ────────────────────────────────────────────────────
 *
 * The tile always read 0 because it requested the dataset
 * `saimnieciskas-darbibas-apstiprinasana-atjaunosana`, which the portal 404s.
 * The real dataset is `saimnieciskas-darbibas-apturesana`, published by the
 * State Revenue Service (VID).
 *
 * It is a *decision log*, not a register of current state. Its 53,250 rows are
 * every suspension decision since 2014, so printing the row count would swap
 * one wrong number for a much larger wrong number. A suspension is still in
 * force only when both hold:
 *
 *   - `Lemuma_par_atjaunosanu_datums` (restoration decision) is blank, and
 *   - `Aizliegts_veikt_darijumus_lidz` (banned until) is either open-ended or
 *     still in the future.
 *
 * Measured on 2026-08-25: 53,250 decisions, 50,592 never restored, of which
 * 45,362 had already lapsed — leaving 5,230 actually in force. That last
 * number is the only one that matches the label.
 *
 * ── VAT payers ──────────────────────────────────────────────────────────────
 *
 * The PVN dataset is likewise cumulative: 283,684 rows, of which 198,962 are
 * marked `Aktivs: "nav"` — not active. The first row in the file is a company
 * struck off in 1996. Only `Aktivs: "ir"` is a VAT payer today (~84,700).
 *
 * Neither function returns a number it could not compute. They throw, and the
 * caller renders an explicit "unavailable" state, because a fabricated zero is
 * what hid the original bug for months.
 */

const ckan = require('./ckan.js');

/** VID — "Saimnieciskās darbības apturēšana" (suspension of economic activity). */
const SUSPENSIONS_DATASET = 'saimnieciskas-darbibas-apturesana';

/** VID — "PVN maksātāji" (VAT payers). */
const VAT_DATASET = 'pvn-maksataji';

const FIELD_RESTORED = 'Lemuma_par_atjaunosanu_datums';
const FIELD_BANNED_UNTIL = 'Aizliegts_veikt_darijumus_lidz';

/** True for null, undefined, and any string that is only whitespace. */
function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Is a suspension decision still in force at `now`?
 *
 * A blank end date means open-ended, not expired — most live suspensions have
 * no end date at all. An unparseable end date is treated the same way: the
 * column is a Postgres `timestamp` so this should not occur, and if it ever
 * does, "we hold no valid end date" is the open-ended case, not an expiry.
 */
function isSuspensionInForce(row, now) {
  if (!isBlank(row[FIELD_RESTORED])) return false;

  const until = row[FIELD_BANNED_UNTIL];
  if (isBlank(until)) return true;

  const parsed = Date.parse(until);
  if (Number.isNaN(parsed)) return true;
  return parsed > now;
}

/** Count the decisions in `rows` that are still in force at `now`. */
function countSuspensionsInForce(rows, now) {
  const at = now === undefined ? Date.now() : now;
  let inForce = 0;
  for (let i = 0; i < rows.length; i++) {
    if (isSuspensionInForce(rows[i], at)) inForce++;
  }
  return inForce;
}

/** The single datastore-backed resource of a VID dataset. */
async function primaryResource(datasetId, options) {
  const resources = await ckan.latestActiveResources(datasetId, null, 1, options);
  if (resources.length === 0) {
    throw new Error('No datastore-active resource in ' + datasetId);
  }
  return resources[0];
}

/**
 * Businesses whose economic activity is suspended right now.
 *
 * Scans the two decision-date columns for the whole log — two requests, a few
 * MB — because the portal disables `datastore_search_sql` (HTTP 409) and
 * `filters` only does equality, so neither "is blank" nor "later than today"
 * can be pushed to the server.
 */
async function fetchSuspendedBusinesses(options) {
  const resource = await primaryResource(SUSPENSIONS_DATASET, options);
  const rows = await ckan.scanFields(
    resource.id,
    [FIELD_RESTORED, FIELD_BANNED_UNTIL],
    null,
    options,
  );
  if (rows.length === 0) throw new Error('Suspension log returned no rows');
  return countSuspensionsInForce(rows, (options && options.now) || Date.now());
}

/**
 * Businesses currently registered for VAT.
 *
 * `Aktivs` is exact-match, so unlike the suspension count this one the portal
 * can answer on its own.
 */
async function fetchActiveVatPayers(options) {
  const resource = await primaryResource(VAT_DATASET, options);
  const active = await ckan.countRows(resource.id, { Aktivs: 'ir' }, options);
  if (active === 0) {
    // The registry is never empty, so zero means the `Aktivs` encoding moved
    // and the filter stopped matching. Fail loudly rather than print a zero.
    throw new Error('VAT registry reported 0 active payers — filter is stale');
  }
  return active;
}

module.exports = {
  SUSPENSIONS_DATASET: SUSPENSIONS_DATASET,
  VAT_DATASET: VAT_DATASET,
  FIELD_RESTORED: FIELD_RESTORED,
  FIELD_BANNED_UNTIL: FIELD_BANNED_UNTIL,
  isBlank: isBlank,
  isSuspensionInForce: isSuspensionInForce,
  countSuspensionsInForce: countSuspensionsInForce,
  fetchSuspendedBusinesses: fetchSuspendedBusinesses,
  fetchActiveVatPayers: fetchActiveVatPayers,
};
