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

module.exports = { memo: memo, clear: clear, MAX_ENTRIES: MAX_ENTRIES };
