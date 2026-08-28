const appShell = require('../shared/appShell.js');
const pageMeta = require('../shared/pageMeta.js');
const meta = require('../shared/articleMeta.js');
const rateLimit = require('../shared/rateLimit.js');
const { withSecurity } = require('../shared/securityHeaders.js');

/**
 * Serves the app shell with THIS page's title, description and canonical
 * already in the bytes, for every route that is not an article.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/article/*` has had its own head since social crawlers were found previewing
 * every article identically. Nothing else did. Measured against production on
 * 2026-08-28, fetching the raw HTML with no JavaScript executed:
 *
 *   /data           canonical=https://portabaltica.naurolabs.com   title=GENERIC
 *   /data/economy   canonical=…                                    title=GENERIC
 *   /api-docs       canonical=…                                    title=GENERIC
 *   /follow         canonical=…                                    title=GENERIC
 *   /weekly, /newsroom, /corrections, /about/ai, /indicator/*      same
 *   /article/<slug> canonical=/article/<slug>   title=own          <- the control
 *
 * `usePageMeta` fixes the rendered document, so Google — which executes
 * JavaScript — sees the right head. These do not: X, Facebook, LinkedIn, Slack
 * and WhatsApp render no JavaScript, and neither does Bing reliably. Share
 * `/api-docs` and the card reads "portaBaltica — Baltic open data, reported".
 *
 * It is the "correct sibling conceals the broken one" pattern from AGENTS.md,
 * exactly: the article path does this properly, so a spot check of any article
 * says the site handles per-route metadata correctly.
 *
 * WHAT IT MUST NOT DO
 * -------------------
 * Invent a head. `pageMeta.metaFor` returns `null` for a URL it does not
 * recognise — including `/article/*`, which has its own function — and this
 * serves the untouched shell for those. Every route on this SPA answers HTTP
 * 200, so an invented head cannot be caught by a status check, by us or by a
 * crawler.
 */

const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const path = pathFromRequest(req);
  const shell = await appShell.getShell(context, appShell.wantsFreshShell(req));

  if (!shell) {
    // No shell has ever been fetched on this instance and the origin is not
    // answering. Serving a body without the asset tags would be a blank page
    // that caches and gets indexed; 503 is the truthful answer.
    context.res = {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '5',
      },
      body: appShell.UNAVAILABLE_HTML,
    };
    return;
  }

  const page = path === null ? null : pageMeta.metaFor(path);

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': appShell.CACHE_CONTROL,
    },
    // A route with nothing to say gets the shell exactly as the static pipeline
    // would have served it. That is the same degradation `article-page` makes
    // when it cannot identify a slug: sharing goes back to being generic, which
    // is the state we started from and is survivable. Injecting a guess is not.
    body: page ? (renderPageShell(shell, path, page) || shell) : shell,
  };
};

/**
 * The reader's path, from whatever the host gives us.
 *
 * Shaped like `articleMeta.slugFromRequest` and for its reasons: Static Web
 * Apps passes the original URL in `x-ms-original-url` while `req.url` is the
 * rewritten function path, and the SWA CLI emulator populates these
 * differently. Returning `null` rather than guessing means the shell is served
 * untouched, which is the safe direction.
 */
function pathFromRequest(req) {
  const headers = (req && req.headers) || {};
  const candidates = [
    headers['x-ms-original-url'],
    headers['X-MS-Original-Url'],
    req && req.originalUrl,
    req && req.url,
  ];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (typeof candidate !== 'string' || !candidate) continue;
    const path = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0];
    // The rewritten path tells us nothing about what the reader asked for.
    if (path === '/api/page-shell' || path.indexOf('/api/') === 0) continue;
    try { return decodeURIComponent(path) || '/'; } catch (e) { return path || '/'; }
  }
  return null;
}

/**
 * Replaces the managed head tags with this page's.
 *
 * Reuses `articleMeta`'s strip list rather than defining a second one: the set
 * of tags this site manages is one fact, and two copies of it would let an
 * article and a section page disagree about whether `og:image` is ours to
 * rewrite. Duplicating rather than replacing would leave two `og:title`
 * elements in one document, and crawlers disagree about which wins.
 */
function renderPageShell(shell, path, page) {
  if (typeof shell !== 'string' || shell.indexOf('</head>') < 0) return null;
  if (shell.indexOf('id="root"') < 0) return null;

  const parts = [];
  const canonical = page.canonical;
  const title = page.title;
  const description = page.description;

  if (title) {
    parts.push('<title>' + meta.escapeHtml(title) + '</title>');
    // `og:title` drops the site suffix, exactly as the article head does: every
    // card renderer prints `og:site_name` beside it already.
    const ogTitle = title.replace(/ \| portaBaltica$/, '');
    parts.push(tag('property', 'og:title', ogTitle));
    parts.push(tag('name', 'twitter:title', ogTitle));
    parts.push(tag('property', 'og:image:alt', ogTitle));
    parts.push(tag('name', 'twitter:image:alt', ogTitle));
  }
  if (description) {
    parts.push(tag('name', 'description', description));
    parts.push(tag('property', 'og:description', description));
    parts.push(tag('name', 'twitter:description', description));
  }
  parts.push(tag('property', 'og:type', 'website'));
  if (canonical) parts.push(tag('property', 'og:url', canonical));
  parts.push(tag('name', 'robots', page.index ? 'index, follow' : 'noindex, nofollow'));
  if (canonical) {
    parts.push('<link rel="canonical" href="' + meta.escapeHtml(canonical) + '" />');
  }

  // Nothing to say and nothing to withhold: leave the document alone rather
  // than stripping the shell's own head and putting less back.
  if (!title && !description && page.index) return null;

  const stripped = meta.stripManagedTags(shell);
  return stripped.replace('</head>', '    ' + parts.join('\n    ') + '\n  </head>');
}

function tag(attribute, name, content) {
  return '<meta ' + attribute + '="' + name + '" content="' + meta.escapeHtml(content) + '" />';
}

module.exports = withSecurity(handler);
module.exports.pathFromRequest = pathFromRequest;
module.exports.renderPageShell = renderPageShell;
