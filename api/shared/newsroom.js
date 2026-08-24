// Shared helpers for the newsroom feed endpoints.
//
// These read the same finished static JSON the browser reads. No credential,
// no key, no managed identity — generation is the only step that needs one,
// and it happens on a timer elsewhere.

const https = require('https');

const SITE_URL = process.env.SITE_URL || 'https://portabaltica.naurolabs.com';

// Articles live in a public blob container, not on the Static Web App. The
// frontend gets this at build time via VITE_ARTICLES_BASE_URL (deploy.yml); the
// Functions get it from an ARTICLES_BASE_URL app setting.
//
// The fallback used to be SITE_URL + '/articles', which the SWA does not serve —
// it 404s. Combined with the fail-open below, that meant /rss.xml and
// /sitemap.xml returned a valid, empty, HTTP 200 feed while three articles were
// live. Nothing was red anywhere. The default now points where the articles
// actually are, so a missing app setting degrades to the right place.
const DEFAULT_ARTICLES_BASE_URL =
  'https://stportabalticabpmff5so.blob.core.windows.net/articles';
const ARTICLES_BASE_URL = (process.env.ARTICLES_BASE_URL || DEFAULT_ARTICLES_BASE_URL).replace(/\/$/, '');

function jsonGet(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 15000 }, function (res) {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('Timeout: ' + url)); });
    req.on('error', reject);
  });
}

/**
 * Turns a fetched index into an article list, or throws.
 *
 * The distinction this draws is the whole point:
 *
 *   - an index that exists and lists nothing is a QUIET DAY. Empty feed, 200.
 *     The newsroom publishes only when the data warrants it, so that is a
 *     legitimate state and must not be an error.
 *   - an index that is MISSING or MALFORMED is a misconfiguration. It must
 *     throw, so the endpoint 500s and someone notices.
 *
 * Collapsing those two into "return []" is what let a wrong base URL masquerade
 * as "no news today" — a green endpoint serving a silently wrong answer, which
 * is the most expensive kind of failure this project keeps running into.
 */
function parseIndex(raw, sourceUrl) {
  if (raw === null || raw === undefined) {
    throw new Error('Article index not found at ' + sourceUrl);
  }
  if (typeof raw !== 'object' || !Array.isArray(raw.articles)) {
    throw new Error('Article index at ' + sourceUrl + ' is malformed');
  }
  return raw.articles;
}

function fetchIndex() {
  const url = ARTICLES_BASE_URL + '/index.json';
  return jsonGet(url).then(function (raw) { return parseIndex(raw, url); });
}

/**
 * Our own pages only.
 *
 * Tier C is a link out to somebody else's journalism; syndicating their
 * snippet through our feed would be reuse we have no right to, and would make
 * the feed look like an aggregator's. Tier A and B have pages of their own.
 */
function ourArticles(articles) {
  return articles.filter(function (article) {
    return article && (article.tier === 'A' || article.tier === 'B') && typeof article.slug === 'string';
  });
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { SITE_URL, ARTICLES_BASE_URL, jsonGet, fetchIndex, parseIndex, ourArticles, escapeXml };
