const https = require('https');
const newsroom = require('../shared/newsroom.js');
const rateLimit = require('../shared/rateLimit.js');
const meta = require('../shared/articleMeta.js');
const { withSecurityHeaders } = require('../shared/securityHeaders.js');

/**
 * GET /article/<slug> (rewritten to /api/article-page)
 *
 * Serves the app's own shell with this article's title, description, Open
 * Graph, Twitter card and JSON-LD already in the bytes, because social
 * crawlers do not run JavaScript and every article on this site previewed
 * identically before this existed.
 *
 * WHAT THIS MUST NOT DO
 * ---------------------
 * Break reading. The shell it returns is the live shell, fetched from the
 * site's own `/index.html`, so the content-hashed asset URLs are always the
 * ones the current deployment serves and the React app boots exactly as it
 * does from the static file. Nothing here renders the article; the client
 * still fetches the JSON and still applies its own gate. This changes the
 * head and nothing below it.
 */

const SHELL_URL = newsroom.SITE_URL + '/index.html';

/** How long a fetched shell is trusted before revalidating. */
const SHELL_TTL_MS = 30 * 1000;

/**
 * Matches the `max-age=30` the platform already puts on the static shell.
 *
 * The shell carries content-hashed asset URLs, so any HTML cached across a
 * deployment points at files that no longer exist and boots to a blank page.
 * Thirty seconds is what that risk is worth today and this route must not make
 * it worse than the route it replaces.
 */
const CACHE_CONTROL = 'public, must-revalidate, max-age=30';

const shellCache = { html: null, fetchedAt: 0 };
const articleCache = new Map();
const ARTICLE_TTL_MS = 60 * 1000;
const ARTICLE_CACHE_MAX = 200;

function httpText(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { timeout: timeoutMs }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { resolve(data); });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

/**
 * The app shell, fetched from our own origin and cached in process.
 *
 * On a fetch failure the last good shell is served however old it is. A stale
 * shell still boots the app in the overwhelming majority of cases — the asset
 * hashes only move on deploy — whereas failing the request serves nothing at
 * all. Freshness is the thing worth losing here; the page is not.
 */
async function getShell(context) {
  const now = Date.now();
  if (shellCache.html && now - shellCache.fetchedAt < SHELL_TTL_MS) return shellCache.html;

  try {
    const html = await httpText(SHELL_URL, 5000);
    // Refuse anything that is not this site's shell rather than injecting into
    // it. A body without `id="root"` means we fetched something else — an error
    // page, a redirect interstitial — and dressing that up with an article's
    // metadata would advertise a page that cannot render.
    if (html.indexOf('id="root"') >= 0 && html.indexOf('</head>') >= 0) {
      shellCache.html = html;
      shellCache.fetchedAt = now;
      return html;
    }
    if (context) context.log.warn('shell fetch returned something that is not the app shell');
  } catch (error) {
    if (context) context.log.warn('shell fetch failed: ' + error.message);
  }

  return shellCache.html;
}

/**
 * One article, or null when there is none at that slug.
 *
 * Throws only when the upstream itself failed, so the caller can tell "no such
 * article" from "we could not find out" — a distinction that decides whether
 * this route tells a crawler an article is gone.
 */
async function getArticle(slug) {
  const cached = articleCache.get(slug);
  if (cached && Date.now() - cached.at < ARTICLE_TTL_MS) return cached.article;

  const article = await newsroom.jsonGet(newsroom.ARTICLES_BASE_URL + '/' + slug + '.json');

  if (articleCache.size >= ARTICLE_CACHE_MAX) articleCache.clear();
  articleCache.set(slug, { article: article, at: Date.now() });
  return article;
}

module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const slug = meta.slugFromRequest(req);
  const shell = await getShell(context);

  if (!shell) {
    // No shell has ever been fetched on this instance and the origin is not
    // answering. Serving a body without the asset tags would be a blank page
    // that caches and gets indexed; 503 is the truthful answer and the one
    // every crawler is built to retry.
    context.res = {
      status: 503,
      headers: withSecurityHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '5',
      }),
      body: '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<title>portaBaltica</title><meta name="robots" content="noindex">' +
        '</head><body><p>This page is temporarily unavailable. Please try again.</p></body></html>',
    };
    return;
  }

  if (slug === null) {
    /**
     * We could not tell which article this is.
     *
     * That should not happen — Static Web Apps passes the reader's original
     * URL in `x-ms-original-url` — but it is the one failure that would take
     * the whole article section down at once, and it has form: SWA shipped a
     * period where that header carried the *rewritten* URL instead. If the
     * contract ever changes again, every `/article/*` request arrives here
     * with nothing to look up.
     *
     * So this degrades to exactly what the route did before this function
     * existed: the untouched shell, 200, indexable. Sharing goes back to being
     * broken, which is the bug we started with and survivable; 404-ing every
     * article, or de-indexing the entire newsroom, is not.
     */
    context.log.warn('no slug in request; serving the shell untouched');
    context.res = {
      status: 200,
      headers: withSecurityHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': CACHE_CONTROL,
      }),
      body: shell,
    };
    return;
  }

  // What this URL is, decided the same way `loadArticle` decides it.
  //   'ok'        — servable, full metadata, 200.
  //   'retracted' — withdrawn, kept on purpose, marked title, noindex, 200.
  //   'none'      — nothing servable here.
  let kind = 'none';
  let document = null;
  // Whether we know there is nothing here, as opposed to not knowing.
  let known = false;

  if (meta.isValidSlug(slug)) {
    try {
      const fetched = await getArticle(slug);
      known = true;
      kind = meta.classify(fetched);
      if (kind !== 'none') document = fetched;
    } catch (error) {
      // Upstream failure. We do not know what is at this URL, so we do not say.
      context.log.warn('article fetch failed for ' + slug + ': ' + error.message);
    }
  } else {
    // A slug the client itself would reject before fetching anything. It
    // renders "Article not found", so that is what this URL is.
    known = true;
  }

  const html = meta.renderShell(shell, document, slug, kind);

  /**
   * Status.
   *
   * 200 for a retracted article, because the page is deliberately still there.
   * The published corrections policy promises "the page stays up, showing why.
   * We do not delete the evidence", `publish.py` keeps the blob at its
   * reader-facing address to honour that, and #113 made the page render the
   * withdrawal notice rather than a false "it did not pass our checks". A 404
   * would be this layer contradicting all three. It is kept out of search by
   * `noindex, nofollow` instead, which is what "removed from feeds" means and
   * what the client already does.
   *
   * 404 when we established there is genuinely nothing here — an unknown slug,
   * a slug the client rejects, or a document with no passing verdict.
   *
   * 200 when we could not find out. A transient blob failure must never tell a
   * crawler that a live article is gone, so availability fails open while
   * indexing fails closed: the head still carries `noindex, nofollow`, which
   * is reversible on the next crawl in a way that a cached 404 is not.
   *
   * A note on the one thing this deliberately does NOT hide. A retracted URL
   * answers 200 and an unknown one answers 404, so the two are distinguishable.
   * That cannot leak unpublished work, because unpublished work is not reachable
   * here at all: `publish.py` keeps only `published`, `corrected` and
   * `retracted` at `<slug>.json` and files every other status under a dated,
   * status-prefixed path. The only fact this discloses is that we withdrew
   * something — which we announce ourselves, by name and slug, in the public
   * corrections log.
   *
   * The body is the app shell in every case. The client's own not-found,
   * not-available and retraction screens are good, and a 404 status with a
   * working page is the goal — not an error page.
   */
  const status = kind === 'none' && known ? 404 : 200;

  context.res = {
    status: status,
    headers: withSecurityHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    }),
    body: html != null ? html : shell,
  };
};
