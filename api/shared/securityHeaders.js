// ─── Security headers for HTML served by a managed function ───
//
// MEASURED, NOT ASSUMED
// ---------------------
// `globalHeaders` in staticwebapp.config.json does not reach a managed
// function's response. Measured against production on 2026-08-27:
//
//   GET /article/<slug>   (static shell)   → CSP, X-Frame-Options,
//                                            X-Content-Type-Options,
//                                            Referrer-Policy, Permissions-Policy
//   GET /rss.xml          (function)       → none of them
//   GET /sitemap.xml      (function)       → none of them
//   GET /api/system-status(function)       → none of them
//
// The give-away is Strict-Transport-Security, which comes back as
// `max-age=10886400; includeSubDomains; preload` for static content and
// `max-age=31536000; includeSubDomains` for every function — two different
// pieces of infrastructure answering, and only one of them reads our config.
//
// So moving `/article/*` onto a function silently drops the Content-Security
// Policy from the one route that renders model-written prose and third-party
// headlines. That is a regression that would have shipped looking like a
// feature, and it is why these are set explicitly on the response.
//
// The copy is kept honest by `tests/swaConfig.test.ts`, which requires this
// object to deep-equal `globalHeaders` in public/staticwebapp.config.json. The
// Function App is deployed from `api/` alone and cannot read that file at
// runtime, so a compile-time equality check is the only thing available — and
// it is enough, because drift can then only reach production through a test
// somebody deleted on purpose.
//
// Two headers the static pipeline adds are deliberately absent, because they
// are not in our config and are not ours to reproduce: `X-XSS-Protection`,
// which is deprecated and whose filter is itself a known XSS vector, and
// `X-DNS-Prefetch-Control`. `Strict-Transport-Security` is likewise left to the
// platform, which already sets a longer max-age on this path than the static
// one carries.

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

module.exports = { SECURITY_HEADERS, withSecurityHeaders };
