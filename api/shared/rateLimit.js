/**
 * Per-IP sliding-window rate limit for portaBaltica's anonymous public API.
 *
 * The Functions in this app proxy free public data (Eurostat, data.gov.lv,
 * Elering, ECB, Open-Meteo, etc.) so there's no dollar risk per request.
 * The risks this guards against are:
 *
 *   1. SWA Free tier monthly quotas (1M requests, 100 GB bandwidth). A
 *      drive-by abuser could blow through these and take the site offline.
 *   2. Upstream rate-limiting. If a stranger hammers `/api/historical-data`,
 *      Eurostat may IP-block the Function host, hurting real users.
 *
 * State lives in process memory. On a Consumption plan the runtime may
 * scale out so the true ceiling per IP is `N_instances × MAX`. Acceptable
 * defense-in-depth for a static-data dashboard; a single misbehaving IP
 * still gets cut off on the instance it lands on.
 *
 * WHY THE MAP IS SWEPT
 * --------------------
 * It previously grew forever. `pruneOldHits` trims the timestamps *inside* an
 * entry, but the entry itself was never removed, so every IP that ever called
 * kept a permanent slot. Measured directly: 50,000 distinct addresses produced
 * 50,000 retained entries and none were released.
 *
 * That is a leak that grows with the audience, which makes it precisely the
 * wrong shape of bug for a site expecting more visitors. It is also reachable
 * on purpose rather than only by popularity: `getClientIp` reads the first
 * value of `X-Forwarded-For`, and while the platform sets that header, nothing
 * stops a caller sending their own. So one client rotating a fabricated address
 * per request both evades the limit *and* allocates unbounded memory on the way
 * past it — the evasion was always possible, the allocation is what turns it
 * from a nuisance into a way to exhaust the worker.
 *
 * The sweep is amortised rather than run per request: a full pass is O(tracked
 * IPs) and doing that on every call would make the guard against heavy traffic
 * itself scale badly with heavy traffic.
 *
 * App Settings (override the default):
 *   PB_RATE_LIMIT_PER_MIN  — requests per IP per minute (default 60)
 */

const WINDOW_MS = 60 * 1000;

/**
 * Hard ceiling on tracked addresses.
 *
 * Every entry left after a sweep has been active within the last minute, so
 * reaching this means either genuine traffic far beyond anything this site
 * serves or a caller forging `X-Forwarded-For`. Both are answered the same way:
 * forget whoever has been quiet longest. An evicted attacker gets a fresh
 * allowance, which is no worse than the forged address they would have used
 * anyway, and the memory stays bounded.
 */
const MAX_TRACKED_IPS = 10000;

function getLimit() {
  const raw = parseInt(process.env.PB_RATE_LIMIT_PER_MIN || '60', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

const ipHits = new Map();

function getClientIp(req) {
  const xff =
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  if (xff && typeof xff === 'string') return xff.split(',')[0].trim();
  if (req.headers && req.headers['client-ip']) return req.headers['client-ip'];
  return 'unknown';
}

function pruneOldHits(timestamps, now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  return i > 0 ? timestamps.slice(i) : timestamps;
}

let lastSweepAt = 0;

/** Forget every address with no hit inside the window. */
function sweep(now) {
  const cutoff = now - WINDOW_MS;
  ipHits.forEach(function (timestamps, ip) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
      ipHits.delete(ip);
    }
  });
  lastSweepAt = now;
}

/**
 * Drop the lightest callers until the map is back under its ceiling.
 *
 * Fewest hits first, oldest last seen as a tie-break. Evicting on last-seen
 * alone was wrong in the one case that matters: a caller rotating forged
 * addresses arrives *after* the client actually hammering us, so every forged
 * entry looks more recent than the real one and the flood evicts the record of
 * the abuser it was meant to bound. Ranking by hit count inverts that — the
 * busiest caller is by definition never the lightest, so it cannot be flushed
 * by traffic, while single-hit strangers are exactly the entries the limiter
 * has no use for.
 *
 * WHY IT EVICTS IN BULK
 * ---------------------
 * The first version trimmed one entry per call, which meant sorting the whole
 * map on *every* request once the ceiling was reached. Measured: 50,000
 * requests took 33 seconds, against well under a second before the cap existed.
 * That is the same mistake this file's sweep is written to avoid — a guard
 * against heavy traffic that itself degrades under heavy traffic — and it is
 * worse than the leak it replaced, because a leak costs memory while this cost
 * latency on every request.
 *
 * Cutting back to a headroom mark instead amortises the sort over roughly
 * `MAX_TRACKED_IPS / 10` insertions.
 */
const EVICT_TO = Math.floor(MAX_TRACKED_IPS * 0.9);

function evictLightest() {
  const ranked = [];
  ipHits.forEach(function (timestamps, ip) {
    ranked.push([ip, timestamps.length, timestamps.length ? timestamps[timestamps.length - 1] : 0]);
  });
  ranked.sort(function (a, b) { return a[1] - b[1] || a[2] - b[2]; });
  const excess = ipHits.size - EVICT_TO;
  for (let i = 0; i < excess; i++) ipHits.delete(ranked[i][0]);
}

/**
 * Returns a 429 response object suitable for `context.res = ...` when the
 * caller's IP has exceeded the per-minute limit. Returns null otherwise
 * and records the hit. Use this as the first thing in every public endpoint.
 */
function check(req) {
  const limit = getLimit();
  const ip = getClientIp(req);
  const now = Date.now();

  // Amortised: a pass costs O(tracked IPs), so it runs at most once a window
  // rather than on every request. The ceiling check is separate and immediate,
  // because a burst of forged addresses can cross it well inside one window.
  if (now - lastSweepAt >= WINDOW_MS) sweep(now);

  const hits = pruneOldHits(ipHits.get(ip) || [], now);

  if (hits.length >= limit) {
    // Record nothing on a rejection. Counting blocked calls would let a caller
    // hold their own window open indefinitely by continuing to hammer it, and
    // it would let an unknown address occupy a slot without ever being served.
    ipHits.set(ip, hits);
    const retryAfter = Math.ceil((hits[0] + WINDOW_MS - now) / 1000);
    return {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
      body: JSON.stringify({
        error: 'Too many requests. Slow down.',
        retryAfter,
        limit,
        windowSeconds: WINDOW_MS / 1000,
      }),
    };
  }

  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > MAX_TRACKED_IPS) evictLightest();
  return null;
}

function getStats() {
  return { limitPerMin: getLimit(), trackedIps: ipHits.size, maxTrackedIps: MAX_TRACKED_IPS };
}

/** Forget every address. Tests only. */
function reset() {
  ipHits.clear();
  lastSweepAt = 0;
}

module.exports = { check, getClientIp, getStats, reset, MAX_TRACKED_IPS, WINDOW_MS };
