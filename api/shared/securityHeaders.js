// ─── Security headers for every managed-function response ───
//
// MEASURED, NOT ASSUMED
// ---------------------
// `globalHeaders` in staticwebapp.config.json does not reach a managed
// function's response. Measured against production on 2026-08-27, after
// `/article/*` moved onto a function:
//
//   /article/<slug>  (function, wrapped)  → CSP, XFO, nosniff, Referrer, Permissions
//   /                (static)             → CSP, XFO, nosniff, Referrer, Permissions
//   /data            (static)             → CSP, XFO, nosniff, Referrer, Permissions
//   /favicon.svg     (static)             → CSP, XFO, nosniff, Referrer, Permissions
//   /rss.xml         (function)           → none of them
//   /sitemap.xml     (function)           → none of them
//   /api/*           (function, ×14)      → none of them
//
// Sixteen of seventeen function routes served bare. The give-away is
// Strict-Transport-Security, which comes back as
// `max-age=10886400; includeSubDomains; preload` for static content and
// `max-age=31536000; includeSubDomains` for every function — two different
// pieces of infrastructure answering, and only one of them reads our config.
//
// That makes `globalHeaders` a name that overstates itself. It reads, in the
// one file anyone would check, as a site-wide guarantee; it is a static-content
// guarantee. Nobody had noticed because nothing surfaces it: the config is
// present, the endpoints work, and the header is absent only where nobody
// looks.
//
// WHAT THIS IS AND IS NOT
// -----------------------
// This is defence in depth, not a fix for a live exploit, and it is worth
// saying so plainly. Every endpoint that takes user input was probed with
// `<script>alert(1)</script>` on 2026-08-27: `business-search` and
// `address-search` strip it to `scriptalert1script` before echoing, and the
// 400s from `baltic-compare` and `historical-data` name the valid indicators
// rather than the invalid one. Nothing reflects raw input today.
//
// `nosniff` is the header that carries the weight. It is what stops a browser
// deciding for itself that a response is HTML — and these endpoints relay text
// this project does not author, from data.gov.lv company names to headlines
// quoted verbatim from other outlets in `/rss.xml`. Today's sanitising is a
// property of today's code; the header is a property of the response.
//
// The set is applied whole rather than tailored per content type. A JSON
// response arguably needs `nosniff` and little else, but two definitions of
// "our security headers" is how the next reader ends up guessing which applies
// where — and the point of this change is that the config file should mean what
// it says. `tests/swaConfig.test.ts` requires this object to deep-equal
// `globalHeaders`, so the two cannot drift; the Function App is deployed from
// `api/` alone and cannot read that file at runtime, which is why a
// compile-time equality check is the only thing available.
//
// Two headers the static pipeline adds are deliberately absent, because they
// are not in our config and are not ours to reproduce: `X-XSS-Protection`,
// which is deprecated and whose filter is itself a known XSS vector, and
// `X-DNS-Prefetch-Control`. `Strict-Transport-Security` is likewise left to the
// platform, which already sets a longer max-age on the function path than the
// static one carries.

'use strict';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://stportabalticabpmff5so.blob.core.windows.net https://ec.europa.eu https://api.open-meteo.com https://air-quality-api.open-meteo.com https://data.stat.gov.lv https://data.gov.lv https://opendata.riga.lv https://marine-api.open-meteo.com https://dashboard.elering.ee https://www.ecb.europa.eu; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
};

/** Returns the security headers merged with whatever the caller adds. */
function withSecurityHeaders(headers) {
  return Object.assign({}, SECURITY_HEADERS, headers || {});
}

/**
 * Wraps a Function handler so every response it produces carries the headers.
 *
 * WHY A WRAPPER RATHER THAN 57 EDITS
 * ----------------------------------
 * These seventeen functions assign `context.res` in fifty-seven places between
 * them — a success, a 400 for a bad parameter, a 429 from the rate limiter, a
 * 500 in a catch, and in `baltic-compare` five separate paths. Adding
 * `withSecurityHeaders(...)` at each one is a change that is *finished* only if
 * all fifty-seven were found, and a miss is invisible: the endpoint keeps
 * working, the tests keep passing, and the one response that lost its headers
 * is the error path nobody looks at.
 *
 * This is the shape of defect this codebase keeps finding — a guard that reads
 * as protection in review and is inert on the path that matters. So the header
 * is applied once, at the boundary, where it cannot be partially applied. A
 * response path added tomorrow is covered without anyone remembering to.
 *
 * `finally` rather than after the await: a handler that sets `context.res` and
 * then throws still has its response sent by the host, so it still needs the
 * headers. The throw is deliberately not swallowed — an unhandled fault should
 * go on being a 500 from the platform, not become a silent 200.
 *
 * The merge lets a handler override: `article-page` sets `Cache-Control:
 * no-store` on its 503 and that must win over anything set here. Nothing in
 * SECURITY_HEADERS is a header a handler has a legitimate reason to weaken,
 * and `tests/functionSecurityHeaders.test.ts` asserts none of them does.
 */
function withSecurity(handler) {
  return async function (context, req) {
    try {
      return await handler(context, req);
    } finally {
      const res = context && context.res;
      if (res && typeof res === 'object') {
        res.headers = withSecurityHeaders(res.headers);
      }
    }
  };
}

module.exports = { SECURITY_HEADERS, withSecurityHeaders, withSecurity };
