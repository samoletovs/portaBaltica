/**
 * Remember what an upstream said, and keep saying it briefly when it stops
 * answering.
 *
 * Open-Meteo is the reason this exists. Measured against production, roughly
 * half of all calls from the Static Web App's egress address hang for the full
 * probe deadline and are rescued by the retry; about one call in four has both
 * attempts hang, which took the whole site to `degraded` a third of the time.
 * The same endpoint answers a laptop in 110–302ms, six times out of six. The
 * shared Azure egress address is being throttled, and the throttle is not
 * something a client can out-wait.
 *
 * Three things were on the table: cache it, retry harder, or stop treating it
 * as required. Retrying harder is knocking louder at a door that is being held
 * shut deliberately, and it makes us more of the problem. Demoting the source
 * hides a real outage along with the false ones.
 *
 * Caching is the only one that addresses the cause. **Open-Meteo publishes
 * hourly.** Asking it for a fresh reading on every status request — and on
 * every `environment-data` call — is asking a source that changes 24 times a
 * day for new data several times a minute. It could not be right even if it
 * worked, and it is a large part of why we are throttled.
 *
 * So: one call per key per TTL, and when a fetch fails, the last good answer
 * stands for a while longer. That second part is not a way of hiding a failure.
 * It is the correct reading of a noisy channel — with a 50% per-call hang rate,
 * "what a single call observed just now" is mostly noise, and the freshness the
 * probe actually reports is a property of the *data*, which is unchanged by our
 * socket being dropped. Every cached answer is returned with its age, and a
 * caller that served one after a failure is told so, so the flakiness shows up
 * on the status page as information rather than as an outage.
 *
 * Past `graceMs` the answer is withheld and the error is raised: at that point
 * we genuinely do not know, and "I don't know" must never render as "fine".
 */

/** Entries are tiny and few; the cap is a guard against an unbounded key space. */
const MAX_ENTRIES = 64;

/**
 * A cache key covering the request as it is actually made.
 *
 * Use this rather than hand-writing a key. The newsroom's Python collector
 * keyed its HTTP cache on the URL with the query string dropped, and because
 * Eurostat's URL is built from the cube name while the parameters are passed
 * separately, every definition sharing a cube collided: the first was fetched
 * and every later one inside the TTL was served *its* payload under a different
 * metric label. It published five wrong articles, three of them carrying the
 * identical figure under three different names. Nothing looked wrong, because
 * nothing was malformed — every value was a real value, correctly parsed, from
 * the wrong slice.
 *
 * That is not a hypothetical risk here. Thirty-four of the dashboard's
 * sixty-five indicators share a cube with at least one other: `bop_c6_q` alone
 * serves ten, `prc_hicp_minr` eight, and `road_freight` and `road_freight_tkm`
 * differ by nothing but `unit`. A params-blind key would make the freight modal
 * split read tonnes lifted instead of tonne-kilometres, which puts Latvia's
 * rail share at about 4% instead of 18.9% — a chart that looks entirely fine
 * and says the opposite.
 *
 * So the default is to include everything. `volatile` names the parameters
 * deliberately left out, which makes an omission a decision someone wrote down
 * rather than an oversight: `/api/live-grid` asks for a sliding twelve-hour
 * window, so its `start` and `end` change on every call and keying on them
 * would mean never reading the cache at all. Anything not named here lands in
 * the key automatically, so a parameter added later cannot be silently ignored.
 *
 * Parameters are sorted, so the same request written in a different order is
 * the same key rather than a second entry.
 */
function requestKey(namespace, url, volatile) {
  const skip = volatile || [];
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    // An unparseable URL is keyed whole. Better a key too specific — which
    // only costs a cache miss — than one too loose, which serves the wrong
    // answer under the right label.
    return namespace + '|' + String(url);
  }

  const params = [];
  parsed.searchParams.forEach(function (value, name) {
    if (skip.indexOf(name) >= 0) return;
    params.push(name + '=' + value);
  });
  params.sort();

  return namespace + '|' + parsed.origin + parsed.pathname +
    (params.length > 0 ? '?' + params.join('&') : '');
}

const store = new Map();

function evictOldest() {
  let oldestKey = null;
  let oldestAt = Infinity;
  store.forEach(function (entry, key) {
    if (entry.at < oldestAt) { oldestAt = entry.at; oldestKey = key; }
  });
  if (oldestKey !== null) store.delete(oldestKey);
}

/**
 * Fetch through the cache.
 *
 * Returns `{ value, ageMs, cached, servedAfterFailure, error }`. `ageMs` is how
 * old the answer is, always — a caller that wants to say "as of four minutes
 * ago" has what it needs without asking twice.
 *
 * @param {string}   key      identity of the thing being fetched
 * @param {number}   ttlMs    how long an answer is served without asking again
 * @param {number}   graceMs  how long a stale answer stands once fetches fail
 * @param {Function} fetcher  produces a fresh value; may reject
 */
async function memo(key, ttlMs, graceMs, fetcher, now) {
  const at = typeof now === 'number' ? now : Date.now();
  const hit = store.get(key);

  if (hit && at - hit.at <= ttlMs) {
    return { value: hit.value, ageMs: at - hit.at, cached: true, servedAfterFailure: false };
  }

  try {
    const value = await fetcher();
    if (!store.has(key) && store.size >= MAX_ENTRIES) evictOldest();
    store.set(key, { value: value, at: at });
    return { value: value, ageMs: 0, cached: false, servedAfterFailure: false };
  } catch (err) {
    if (hit && at - hit.at <= graceMs) {
      return {
        value: hit.value,
        ageMs: at - hit.at,
        cached: true,
        servedAfterFailure: true,
        error: (err && err.message) || String(err),
      };
    }
    throw err;
  }
}

/** Drop everything. Tests only — a warm process should never need this. */
function clear() {
  store.clear();
}

module.exports = { memo: memo, clear: clear, requestKey: requestKey, MAX_ENTRIES: MAX_ENTRIES };
