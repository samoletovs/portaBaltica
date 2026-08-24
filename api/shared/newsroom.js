// Shared helpers for the newsroom feed endpoints.
//
// These read the same finished static JSON the browser reads. No credential,
// no key, no managed identity — generation is the only step that needs one,
// and it happens on a timer elsewhere.

const https = require('https');

const SITE_URL = process.env.SITE_URL || 'https://portabaltica.naurolabs.com';
const ARTICLES_BASE_URL = (process.env.ARTICLES_BASE_URL || SITE_URL + '/articles').replace(/\/$/, '');

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

function fetchIndex() {
  return jsonGet(ARTICLES_BASE_URL + '/index.json').then(function (raw) {
    if (!raw || !Array.isArray(raw.articles)) return [];
    return raw.articles;
  });
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

module.exports = { SITE_URL, ARTICLES_BASE_URL, jsonGet, fetchIndex, ourArticles, escapeXml };
