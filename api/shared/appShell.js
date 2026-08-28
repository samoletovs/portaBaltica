// ─── The app shell, fetched once and shared by every route that injects meta ───
//
// WHY THIS IS SHARED RATHER THAN COPIED
// -------------------------------------
// `api/article-page` has fetched and cached the shell since `/article/*` moved
// onto a function. A second route family now needs exactly the same thing, and
// the reasoning below — the conditional GET, the refusal to inject into
// something that is not our shell, the honouring of a revalidation request — is
// the kind that survives being read once and not being re-derived.
//
// Copying it would also create two in-process shell caches on one host, which
// is not merely wasteful: they would expire independently, so two routes could
// serve HTML naming two different asset sets within the same second.
//
// The whole module is lifted from `article-page` unchanged apart from being
// parameterised, and `tests/articlePageFunction.test.ts` still drives it
// through that route.

'use strict';

const https = require('https');
const newsroom = require('./newsroom.js');

const SHELL_URL = newsroom.SITE_URL + '/index.html';

/** How long a fetched shell is trusted before it is revalidated. */
const SHELL_TTL_MS = 30 * 1000;

/**
 * Matches the `max-age=30` the platform already puts on the static shell.
 *
 * The shell carries content-hashed asset URLs, so any HTML cached across a
 * deployment points at files that no longer exist and boots to a blank page.
 * Thirty seconds is what that risk is worth today and no route may make it
 * worse than the route it replaces.
 */
const CACHE_CONTROL = 'public, must-revalidate, max-age=30';

const shellCache = { html: null, etag: null, fetchedAt: 0 };

/**
 * Fetches the shell, conditionally when we already hold one.
 *
 * Resolves `{ status, html, etag }`. A 304 carries no body and means the copy
 * we hold is still current — which is the cheap answer, and the common one.
 */
function fetchShell(etag, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const options = { timeout: timeoutMs, headers: {} };
    if (etag) options.headers['If-None-Match'] = etag;

    const req = https.get(SHELL_URL, options, function (res) {
      if (res.statusCode === 304) {
        res.resume();
        return resolve({ status: 304, html: null, etag: etag });
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + SHELL_URL));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        resolve({ status: 200, html: data, etag: res.headers.etag || null });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + SHELL_URL)); });
    req.on('error', reject);
  });
}

/**
 * Did this reader just fail to load an asset?
 *
 * `location.reload()` sends `Cache-Control: max-age=0` — measured in Chromium,
 * not assumed — and the recovery script in index.html reloads exactly when a
 * hashed asset 404s. So a request carrying a revalidation directive is either a
 * reader asking for a fresh copy or the recovery asking on their behalf, and
 * both mean the same thing: do not hand back what is in memory.
 *
 * Honouring it is what makes the recovery terminate. Without this, a reader who
 * reloads because `/assets/index-OLDHASH.js` is gone is served the same cached
 * shell naming the same dead file, the recovery's own guard stops it reloading a
 * second time, and they are left on a blank page until the TTL happens to lapse.
 */
function wantsFreshShell(req) {
  const headers = (req && req.headers) || {};
  const cacheControl = String(
    headers['cache-control'] || headers['Cache-Control'] || ''
  ).toLowerCase();
  const pragma = String(headers['pragma'] || headers['Pragma'] || '').toLowerCase();
  return (
    cacheControl.indexOf('no-cache') >= 0 ||
    cacheControl.indexOf('max-age=0') >= 0 ||
    pragma.indexOf('no-cache') >= 0
  );
}

/**
 * The app shell, fetched from our own origin and cached in process.
 *
 * On a fetch failure the last good shell is served however old it is. A stale
 * shell still boots the app in the overwhelming majority of cases — the asset
 * hashes only move on deploy — whereas failing the request serves nothing at
 * all. Freshness is the thing worth losing here; the page is not.
 */
async function getShell(context, force) {
  const now = Date.now();
  if (!force && shellCache.html && now - shellCache.fetchedAt < SHELL_TTL_MS) {
    return shellCache.html;
  }

  try {
    const result = await fetchShell(shellCache.html ? shellCache.etag : null, 5000);

    if (result.status === 304) {
      // Still current. Nothing transferred, and the clock restarts.
      shellCache.fetchedAt = now;
      return shellCache.html;
    }

    // Refuse anything that is not this site's shell rather than injecting into
    // it. A body without `id="root"` means we fetched something else — an error
    // page, a redirect interstitial — and dressing that up with a page's
    // metadata would advertise a page that cannot render.
    if (result.html.indexOf('id="root"') >= 0 && result.html.indexOf('</head>') >= 0) {
      shellCache.html = result.html;
      shellCache.etag = result.etag;
      shellCache.fetchedAt = now;
      return result.html;
    }
    if (context) context.log.warn('shell fetch returned something that is not the app shell');
  } catch (error) {
    if (context) context.log.warn('shell fetch failed: ' + error.message);
  }

  return shellCache.html;
}

/** The body served when no shell has ever been fetched and the origin is down. */
const UNAVAILABLE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>portaBaltica</title><meta name="robots" content="noindex">' +
  '</head><body><p>This page is temporarily unavailable. Please try again.</p></body></html>';

module.exports = {
  SHELL_URL,
  SHELL_TTL_MS,
  CACHE_CONTROL,
  UNAVAILABLE_HTML,
  fetchShell,
  wantsFreshShell,
  getShell,
  /** Test seam: drop the cached shell so a case starts from nothing. */
  _resetShellCache: function () {
    shellCache.html = null;
    shellCache.etag = null;
    shellCache.fetchedAt = 0;
  },
};
