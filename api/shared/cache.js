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

/**
 * How many answers to keep.
 *
 * This was 64, chosen when the cache held a handful of Open-Meteo URLs. It is
 * now far too small for what it must cover: `/api/baltic-compare` alone has
 * **65 indicators**, so a single pass over the indicator list evicted every
 * entry before it was read a second time, and that is before the per-country
 * economy, property, environment, port and EU-funds keys are counted.
 *
 * Measured on the old cap: a key read on every round was still re-fetched four
 * times over three rounds, because eviction ran on insertion order and could
 * not tell a hot key from a cold one.
 *
 * 512 entries of parsed JSON — the largest response on the site is
 * `/api/power-prices` at 21KB — is a few megabytes against a Consumption
 * instance's 1.5GB. The cap is here to bound an unbounded key space, not to
 * conserve memory that is not scarce.
 */
const MAX_ENTRIES = 512;

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
 * That is not a hypothetical risk here. Thirty-seven of the dashboard's
 * seventy-one indicators share a cube with at least one other, across eleven
 * cubes: `bop_c6_q` alone serves ten, `prc_hicp_minr` eight, and
 * `road_freight` and `road_freight_tkm` differ by nothing but `unit`. A
 * params-blind key would make the freight modal split read tonnes lifted
 * instead of tonne-kilometres, which puts Latvia's rail share at about 4%
 * instead of 18.9% — a chart that looks entirely fine and says the opposite.
 *
 * Those counts are prose and prose goes stale: they read "thirty-four of
 * sixty-five" until 2026-08-28, when `#189` took the registry to seventy-one
 * and nobody updated them. The number that matters is not maintained here —
 * `tests/cache.test.ts` derives the population from `INDICATORS` itself and
 * asserts a floor, so the guard scales with the registry whatever this
 * paragraph happens to say.
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

/**
 * Fetches that have been started and not yet settled, keyed exactly as the
 * store is.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without it, a cache miss is not one upstream call — it is one call *per
 * concurrent visitor*. Measured directly against `memo` as it was written:
 * twenty concurrent requests for a single key produced **twenty** upstream
 * calls, because the entry is only written once the fetch resolves, so every
 * request that arrives during the fetch sees an empty store and starts its own.
 *
 * That is the one defect here that gets worse in exact proportion to the thing
 * we are trying to support. At one visitor a minute it is invisible. At a
 * hundred concurrent visitors on a cold key it is a hundred simultaneous calls
 * to Eurostat from a single address — which is how a shared egress address gets
 * throttled, and this project has already been throttled once, by Open-Meteo,
 * for asking too often. The remedy for "we ask too much" cannot itself multiply
 * asking by the number of readers.
 *
 * So the first caller starts the fetch and every caller that arrives while it
 * is in flight awaits the same promise. Failure is shared too, and each waiter
 * then applies the grace rule independently against its own view of the store.
 */
const inFlight = new Map();

/**
 * Start a fetch, or join the one already running for this key.
 *
 * A synchronous throw from `fetcher` is converted to a rejection so that one
 * malformed caller cannot leave a permanent entry in `inFlight` and wedge the
 * key for the life of the process.
 */
function fetchShared(key, fetcher) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  let started;
  try {
    started = Promise.resolve(fetcher());
  } catch (err) {
    return Promise.reject(err);
  }

  const tracked = started.then(
    function (value) { inFlight.delete(key); return value; },
    function (err) { inFlight.delete(key); throw err; }
  );

  inFlight.set(key, tracked);
  return tracked;
}

function remember(key, value, at) {
  if (!store.has(key) && store.size >= MAX_ENTRIES) evictLeastRecentlyUsed();
  store.set(key, { value: value, at: at, readAt: at });
}

/**
 * Evict the entry nobody has read for the longest.
 *
 * This used to evict the entry written longest ago, which is a different thing
 * and the wrong one: a key that is read on every single request is, by
 * definition, one whose value was written a while back. Insertion-order
 * eviction therefore targets precisely the entries that are earning their
 * place. Measured on the old implementation, a key read every round was
 * re-fetched four times over three rounds while colder keys survived.
 */
function evictLeastRecentlyUsed() {
  let victim = null;
  let seenLongestAgo = Infinity;
  store.forEach(function (entry, key) {
    const lastSeen = entry.readAt === undefined ? entry.at : entry.readAt;
    if (lastSeen < seenLongestAgo) { seenLongestAgo = lastSeen; victim = key; }
  });
  if (victim !== null) store.delete(victim);
}

/**
 * Fetch through the cache.
 *
 * Returns `{ value, ageMs, cached, servedAfterFailure, error }`. `ageMs` is how
 * old the answer is, always — a caller that wants to say "as of four minutes
 * ago" has what it needs without asking twice.
 *
 * Concurrent callers for one key share a single upstream fetch; see `inFlight`.
 *
 * @param {string}   key      identity of the thing being fetched
 * @param {number}   ttlMs    how long an answer is served without asking again
 * @param {number}   graceMs  how long a stale answer stands once fetches fail
 * @param {Function} fetcher  produces a fresh value; may reject
 * @param {number|object} [opts] legacy `now`, or
 *   `{ now, staleWhileRevalidate, staleWhileRevalidateMs }`
 */
async function memo(key, ttlMs, graceMs, fetcher, opts) {
  // `now` was the fifth positional argument and several tests and callers pass
  // it that way. Accepting either shape keeps them working rather than making
  // an internal improvement into a breaking change.
  const options = typeof opts === 'number' ? { now: opts } : (opts || {});
  const pinnedNow = typeof options.now === 'number' ? options.now : null;
  const at = pinnedNow === null ? Date.now() : pinnedNow;
  const hit = store.get(key);

  /**
   * How old a body may be and still be served WHILE A REFRESH RUNS BEHIND IT.
   *
   * TWO QUESTIONS THAT SHARED ONE NUMBER
   * ------------------------------------
   * This used to be `graceMs`, whose documented meaning two lines above is "how
   * long a stale answer stands once fetches FAIL". The revalidate branch below
   * used the same number to answer a different question — how far past the TTL
   * a WORKING fetch may be anticipated — and nothing said so.
   *
   * They are not the same question and they do not want the same answer. A long
   * failure grace is protective: an upstream outage should not take an endpoint
   * down. A long revalidate horizon is the opposite, because it is exactly how
   * long a body known to be out of date may still go out.
   *
   * Measured across the twenty callers before this split, the horizon nobody had
   * chosen ran from 15 minutes to 24 hours — `port-data` and `trade-partners`
   * sat at 86400000. For a quarterly Eurostat cube that is harmless and the
   * comment below says why. For `/rss.xml` it meant a headline we had publicly
   * retracted could keep going out for an hour past its TTL, and the exposure
   * is worst on a QUIET feed: revalidation is request-triggered, so the reader
   * who arrives after a long silence is the one served the withdrawn claim.
   *
   * Defaults to `graceMs`, which is what it silently was, so no existing caller
   * changes behaviour by this split. It is a capability the callers that need it
   * opt into, not a new policy everyone inherits.
   *
   * CLAMPED, SO IT CAN ONLY EVER NARROW
   * -----------------------------------
   * `Math.min` because `graceMs` is documented two lines above as how long a
   * stale answer stands, and that sentence has to keep being true. This branch
   * is tested BEFORE the failure branch and swallows its own background
   * rejection, so a horizon larger than `graceMs` would go on serving stale
   * bodies past the grace with nothing to stop it — `graceMs` would quietly stop
   * being the ceiling it claims to be, which is the same defect this split
   * exists to remove, arriving from the other direction.
   *
   * Found by a test asserting the grace still ends, not by reasoning: it went
   * green when it should have gone red, and the reason was that the revalidate
   * branch had already answered.
   *
   * So the rule is one sentence: the horizon may tighten the window and can
   * never widen it.
   */
  const declaredRevalidateMs = typeof options.staleWhileRevalidateMs === 'number'
    ? options.staleWhileRevalidateMs
    : graceMs;
  const revalidateMs = Math.min(declaredRevalidateMs, graceMs);

  // Strictly less than, so `ttlMs: 0` means what it looks like — never reuse —
  // rather than "reuse for the remainder of this millisecond". An entry exactly
  // at its time to live has lived it.
  if (hit && at - hit.at < ttlMs) {
    hit.readAt = at;
    return { value: hit.value, ageMs: at - hit.at, cached: true, servedAfterFailure: false };
  }

  // Serve the stale answer and refresh behind it, when the caller has said the
  // data is worth more promptly than it is worth freshly.
  //
  // Opt-in, because it is not universally right: it is correct for a quarterly
  // Eurostat cube, where an answer a few minutes past its TTL is identical to
  // the one upstream would give, and wrong for anything whose whole purpose is
  // to report the current instant. Without it the unlucky visitor who arrives
  // at the moment a TTL lapses pays the full upstream latency — 1.3 to 2.2
  // seconds, measured on `/api/economy-data` — on behalf of everyone who
  // arrives after them.
  //
  // Bounded by `revalidateMs` rather than `graceMs`; see above for why those
  // are different questions.
  if (hit && options.staleWhileRevalidate && at - hit.at < revalidateMs) {
    hit.readAt = at;
    const revalidation = fetchShared(key, fetcher).then(
      function (value) {
        remember(key, value, pinnedNow === null ? Date.now() : pinnedNow);
        return value;
      },
      function () {
        // The stale entry stands and `graceMs` still governs how long it may
        // once fetches are failing — that is the failure question and this
        // split did not touch it. `revalidateMs` bounded only how far past the
        // TTL we were willing to anticipate a WORKING fetch.
        // Swallowed here so a background refresh cannot become an unhandled
        // rejection and take the worker down; the next foreground miss will
        // surface the failure to a caller that can act on it.
        return undefined;
      }
    );
    return {
      value: hit.value,
      ageMs: at - hit.at,
      cached: true,
      servedAfterFailure: false,
      revalidating: true,
      // Exposed so a test can await the refresh instead of sleeping, and so a
      // caller that wants to block on it may.
      revalidation: revalidation,
    };
  }

  try {
    const value = await fetchShared(key, fetcher);
    remember(key, value, at);
    return { value: value, ageMs: 0, cached: false, servedAfterFailure: false };
  } catch (err) {
    if (hit && at - hit.at < graceMs) {
      hit.readAt = at;
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
  inFlight.clear();
}

/** What the cache is holding. For `/api/system-status` to report on itself. */
function stats() {
  return { entries: store.size, inFlight: inFlight.size, maxEntries: MAX_ENTRIES };
}

module.exports = {
  memo: memo,
  clear: clear,
  stats: stats,
  requestKey: requestKey,
  MAX_ENTRIES: MAX_ENTRIES,
};
