/**
 * One computed response, remembered and reused.
 *
 * WHY AT THE BOUNDARY
 * -------------------
 * Twelve of seventeen endpoints reached upstream on every single request. The
 * obvious remedy — add `cache.memo(...)` around each fetch inside each handler
 * — is the change that is *finished* only if every call site was found, and
 * `securityHeaders.js` already recorded what that costs: fifty-seven response
 * assignments across seventeen files, where a miss is invisible because the
 * endpoint keeps working. The same argument applies here and points the same
 * way. Wrap once, where it cannot be partially applied.
 *
 * Caching the finished response rather than the individual upstream calls also
 * buys the parsing and assembly, not just the network. `/api/port-data` reads
 * four Eurostat cubes and reduces them to 12KB of JSON; `/api/system-status`
 * runs fifteen probes. Remembering the four fetches still leaves that work to
 * be redone per request.
 *
 * WHAT IS AND IS NOT CACHED
 * -------------------------
 * Only `200`. A `400` is an answer about the request and costs nothing to
 * repeat; a `502` is an upstream failure and caching it would turn a blip into
 * a fixed outage for the length of the TTL.
 *
 * A non-200 is signalled by throwing, which hands the decision to `cache.memo`
 * and gives this a property the endpoints did not have before: when upstream
 * fails and a good answer is still within its grace, the reader gets the last
 * good data instead of a 502. That is not hiding the failure. The body carries
 * its own `fetchedAt`, the response carries a standard `Age`, and `X-Cache:
 * stale` names it outright — so it degrades to "here is what we knew, and when"
 * rather than to either a lie or a blank page.
 *
 * ON THE CACHE KEY
 * ----------------
 * `keyOn` is mandatory and there is no default of "no parameters". This project
 * has already published five wrong articles from a cache key that ignored the
 * query string — real figures, correctly parsed, from the wrong slice, attached
 * to metrics they did not measure. Nothing looked malformed, which is why
 * nothing caught it. A key that omits a parameter the handler reads will serve
 * Estonia's numbers under Latvia's heading, and it will look entirely fine.
 *
 * Declaring the parameters rather than hashing the whole query string is
 * deliberate: it also means an unknown parameter cannot be used to walk past
 * the cache and drive upstream load at will.
 */

'use strict';

const crypto = require('crypto');
const cache = require('./cache.js');
const rateLimit = require('./rateLimit.js');

/** Identity of a request, from the parameters the handler actually reads. */
function responseKey(name, query, keyOn) {
  const parts = keyOn.slice().sort().map(function (param) {
    const raw = query && query[param];
    return encodeURIComponent(param) + '=' + encodeURIComponent(raw === undefined || raw === null ? '' : String(raw));
  });
  return 'response|' + name + '|' + parts.join('&');
}

/** A strong ETag over exactly the bytes we are about to send. */
function etagFor(body) {
  return '"' + crypto.createHash('sha1').update(body || '', 'utf8').digest('base64') + '"';
}

/**
 * Does the client already hold this exact body?
 *
 * `If-None-Match` is a list, and `*` matches anything cached. Weak comparison
 * is the correct one for `If-None-Match` per RFC 9110, so a `W/` prefix on
 * either side is ignored rather than treated as a mismatch.
 */
function matchesEtag(header, etag) {
  if (!header) return false;
  const stripWeak = function (t) { return t.trim().replace(/^W\//, ''); };
  const bare = stripWeak(etag);
  return header.split(',').some(function (candidate) {
    const c = stripWeak(candidate);
    return c === '*' || c === bare;
  });
}

function headerOf(req, name) {
  const headers = (req && req.headers) || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

/** Marks a handler response that must not be remembered. */
function NotCacheable(res) { this.res = res; }

/**
 * Wrap a Function handler so its response is computed once per key per TTL.
 *
 * @param {Function} handler                the endpoint, which assigns context.res
 * @param {object}   options
 * @param {string}   options.name           cache namespace; use the route name
 * @param {string[]} options.keyOn          every query parameter the handler reads
 * @param {number}   options.ttlMs          how long a response is reused
 * @param {number}   options.graceMs        how long it may stand once upstream fails
 * @param {boolean}  [options.staleWhileRevalidate] serve past the TTL and refresh behind
 * @param {number}   [options.staleWhileRevalidateMs] how far past the TTL that may
 *   go, defaulting to `graceMs`. Separate because those are different questions:
 *   `graceMs` is protection against an upstream outage and wants to be long,
 *   while this is how long a body known to be out of date may still be served
 *   and wants to be short wherever staleness is itself the harm. See `cache.js`.
 */
function withCache(handler, options) {
  const opts = options || {};
  if (!opts.name) throw new Error('withCache requires a name');
  if (!Array.isArray(opts.keyOn)) {
    throw new Error('withCache requires keyOn: every query parameter the handler reads');
  }
  const ttlMs = opts.ttlMs;
  const graceMs = opts.graceMs === undefined ? ttlMs * 4 : opts.graceMs;

  return async function (context, req) {
    const limited = rateLimit.check(req);
    if (limited) { context.res = limited; return; }

    const intervalMs = opts.timeBucketMs;
    const bucket = intervalMs > 0 ? Math.floor(Date.now() / intervalMs) : null;
    // A price marked "current" cannot survive into another delivery interval.
    const key = responseKey(opts.name, (req && req.query) || {}, opts.keyOn) +
      (bucket === null ? '' : '|interval=' + bucket);

    let result;
    try {
      result = await cache.memo(key, ttlMs, graceMs, async function () {
        // A private context, so a handler cannot see or disturb a sibling
        // request that is sharing this same fetch.
        const scratch = Object.create(context);
        scratch.res = undefined;
        await handler(scratch, req);
        const res = scratch.res;
        if (!res || res.status !== 200) throw new NotCacheable(res);
        return res;
      }, {
        staleWhileRevalidate: !!opts.staleWhileRevalidate,
        // Passed through rather than defaulted here, so `cache.memo` holds the
        // single definition of what an absent horizon means. A default computed
        // in both places is two enumerations of one rule, and they drift.
        staleWhileRevalidateMs: opts.staleWhileRevalidateMs,
      });
    } catch (err) {
      // The handler answered, just not with something worth keeping. Pass its
      // own response through untouched — its status and body are the answer.
      if (err instanceof NotCacheable) { context.res = err.res; return; }
      throw err;
    }

    const cached = result.value;
    const body = cached.body;
    const etag = etagFor(body);
    const ageSeconds = Math.max(0, Math.floor(result.ageMs / 1000));

    const headers = Object.assign({}, cached.headers, {
      ETag: etag,
      Age: String(ageSeconds),
      'X-Cache': result.servedAfterFailure ? 'stale' : (result.cached ? 'hit' : 'miss'),
    });
    if (bucket !== null) {
      const remaining = Math.max(0, Math.floor(((bucket + 1) * intervalMs - Date.now()) / 1000));
      const declared = /max-age=(\d+)/i.exec(headers['Cache-Control'] || '');
      headers['Cache-Control'] = 'public, max-age=' +
        Math.min(remaining, declared ? Number(declared[1]) : Math.floor(ttlMs / 1000)) + ', must-revalidate';
    }

    // A revalidation running behind this response is worth saying out loud:
    // it is the difference between "this is a few seconds old and nobody is
    // doing anything about it" and "a fresh copy is already on its way".
    if (result.revalidating) headers['X-Cache'] = 'revalidating';

    if (matchesEtag(headerOf(req, 'if-none-match'), etag)) {
      // 304 carries no body, so the client keeps the copy it already has. On
      // `/api/power-prices` that is 21KB not sent, per revalidation, per reader.
      context.res = {
        status: 304,
        headers: Object.assign({}, headers, { 'Content-Length': '0' }),
        body: '',
      };
      return;
    }

    context.res = { status: 200, headers: headers, body: body };
  };
}

module.exports = {
  withCache: withCache,
  responseKey: responseKey,
  etagFor: etagFor,
  matchesEtag: matchesEtag,
};
