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
 * App Settings (override the default):
 *   PB_RATE_LIMIT_PER_MIN  — requests per IP per minute (default 60)
 */

const WINDOW_MS = 60 * 1000;

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

/**
 * Returns a 429 response object suitable for `context.res = ...` when the
 * caller's IP has exceeded the per-minute limit. Returns null otherwise
 * and records the hit. Use this as the first thing in every public endpoint.
 */
function check(req) {
  const limit = getLimit();
  const ip = getClientIp(req);
  const now = Date.now();
  const hits = pruneOldHits(ipHits.get(ip) || [], now);

  if (hits.length >= limit) {
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
  return null;
}

function getStats() {
  return { limitPerMin: getLimit(), trackedIps: ipHits.size };
}

module.exports = { check, getClientIp, getStats };
