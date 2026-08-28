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
 * Statuses whose article is a live, reader-facing page.
 *
 * `corrected` belongs here: a corrected article is a valid one that has been
 * amended, and withholding it from the feed would suppress the very version a
 * reader should see. `retracted` does not, and neither do the pre-publication
 * states — the pipeline keeps a retracted article at its stable URL on purpose
 * ("we do not delete the evidence"), so its absence from the feed is the only
 * thing that stops a withdrawn headline continuing to circulate.
 */
const SYNDICATABLE_STATUSES = ['published', 'corrected'];

/**
 * Our own pages only, and only ones still standing.
 *
 * Tier C is a link out to somebody else's journalism; syndicating their
 * snippet through our feed would be reuse we have no right to, and would make
 * the feed look like an aggregator's. Tier A and B have pages of their own.
 *
 * The status check is the second lock on a door that currently has one. A
 * retracted article is removed from `index.json` by `drop_from_index`, and
 * that is what cleaned the feeds when five articles were withdrawn. But it is
 * a single point of failure: if `write_published` succeeds and
 * `drop_from_index` does not — a partial write, a transient blob error — the
 * article stays retracted in storage *and* keeps appearing in RSS. A feed
 * reader does not come back to see the correction, so that is the one surface
 * where a withdrawn claim goes on circulating after we have publicly taken it
 * back.
 *
 * It is deliberately not `status !== 'retracted'`. Index entries carry no
 * `status` at all today — verified against the live index, nought of seventy —
 * so that comparison is true for every article that has ever existed and the
 * guard could never fire. It would read as protection in review and be inert
 * in production, which is the failure this codebase keeps finding rather than
 * one worth adding.
 *
 * Nor is it `status === 'published'`, matching `isServable` on the client.
 * That is the right rule for a full article, which carries its status and its
 * validator verdict; applied to an index entry that carries neither it would
 * drop all twenty tier A and B articles and serve an empty feed.
 *
 * So: honour the status strictly when it is there, and fall back to tier and
 * slug when it is not. Correct today, and genuinely protective — against every
 * withheld state, not only retraction — the day the index carries the field.
 * Until then the real fix is upstream, and it is one line in the newsroom's
 * index writer rather than anything here.
 */
function ourArticles(articles) {
  return articles.filter(function (article) {
    if (!article || typeof article.slug !== 'string') return false;
    if (article.tier !== 'A' && article.tier !== 'B') return false;
    if (typeof article.status === 'string' &&
        SYNDICATABLE_STATUSES.indexOf(article.status) < 0) return false;
    return true;
  });
}

/**
 * Who a feed item is credited to.
 *
 * One implementation, because two feeds now ask this question and the article
 * page already answers it a third way — and the three disagreed.
 *
 * Tier A always discloses. `persona.byline` contains "AI correspondent" by
 * schema; the fallback rebuilds the suffix rather than dropping to a bare name,
 * because a feed reader shows the author and never shows our masthead, so the
 * disclosure travels here or it does not travel at all.
 *
 * Tier B is the case that was wrong. It is somebody else's release, reproduced
 * verbatim under a licence that permits it, and `ArticleView` says so on the
 * page: "No portaBaltica byline: we did not write this." /rss.xml credited it
 * to `portaBaltica` anyway — the site contradicting its own stated rule on the
 * one surface where the contradiction leaves the site and is read by people who
 * will never see the page that corrects it.
 *
 * The order matters and is not arbitrary: a persona means we wrote it, so it
 * wins; `syndicated.attribution` is consulted only when there is no byline of
 * ours to give.
 */
function bylineFor(article) {
  if (!article || typeof article !== 'object') return 'portaBaltica';

  const persona = article.persona;
  if (persona && typeof persona === 'object') {
    if (typeof persona.byline === 'string' && persona.byline) return persona.byline;
    if (typeof persona.name === 'string' && persona.name) {
      return persona.name + ' \u00b7 AI correspondent';
    }
  }

  const syndicated = article.syndicated;
  if (syndicated && typeof syndicated === 'object' &&
      typeof syndicated.attribution === 'string' && syndicated.attribution) {
    return syndicated.attribution;
  }

  return 'portaBaltica';
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  SITE_URL,
  ARTICLES_BASE_URL,
  jsonGet,
  fetchIndex,
  parseIndex,
  ourArticles,
  bylineFor,
  escapeXml,
};
