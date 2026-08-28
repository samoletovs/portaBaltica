const newsroom = require('../shared/newsroom.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

/**
 * GET /feed.json (rewritten to /api/news-jsonfeed)
 *
 * JSON Feed 1.1 — https://jsonfeed.org/version/1.1 — carrying exactly the same
 * items as /rss.xml.
 *
 * WHY THE SAME ITEMS, AND WHY THAT IS NOT A FIGURE OF SPEECH
 * ----------------------------------------------------------
 * `fetchIndex` and `ourArticles` are called here rather than re-derived,
 * because "which articles are ours" is a rule with a documented history in this
 * repo: tier C is somebody else's journalism and syndicating their snippet
 * would be reuse we have no right to, and a withdrawn article must stop
 * circulating the moment we take it back. A second copy of that rule is a
 * second place it can quietly stop being true, and the failure would be silent
 * in the direction that keeps a retracted headline moving.
 *
 * `tests/jsonFeed.test.ts` asserts the two feeds carry the same slugs from the
 * same index, so a divergence is a red test rather than a discovery.
 */

const VERSION = 'https://jsonfeed.org/version/1.1';

const DESCRIPTION =
  'Original analysis of Baltic open data, written by disclosed AI correspondents ' +
  'and checked against the source before publication.';

/**
 * RFC 3339, or nothing.
 *
 * The spec requires `date_published` to be RFC 3339 when it is present, and
 * says nothing about what to do with a date we cannot parse. Emitting
 * `Invalid Date` would be a well-formed feed carrying a malformed field that
 * every reader would render as garbage, so an unparseable timestamp is dropped
 * instead: absent is a state a feed reader already handles.
 */
function rfc3339(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const handler = async function (context, req) {
  try {
    const articles = newsroom.ourArticles(await newsroom.fetchIndex());
    const site = newsroom.SITE_URL;

    const items = articles.map(function (article) {
      const url = site + '/article/' + article.slug;
      const summary = typeof article.dek === 'string' && article.dek ? article.dek : '';

      const item = {
        // The permalink, which is what the spec recommends an id be: stable,
        // globally unique, and never reused for a different piece.
        id: url,
        url: url,
        title: article.headline,
        // The feed carries the standfirst, not the article. `url` is where the
        // piece is, and the provenance block a reader is entitled to see —
        // sources, model, checks — only exists on the page.
        content_text: summary || article.headline,
        // Always discloses AI on our own work. A feed reader shows the author
        // and never shows our masthead, so the disclosure has to travel with
        // the item or it does not travel at all.
        authors: [{ name: newsroom.bylineFor(article) }],
      };

      if (summary) item.summary = summary;

      const published = rfc3339(article.published_at);
      if (published) item.date_published = published;

      const tags = [];
      if (article.section) tags.push(String(article.section));
      // What KIND of piece this is, as against what it is about. A weekly wrap
      // filed under `maritime` is a cross-beat digest, not a maritime report,
      // and the section alone cannot say so — which is the category error the
      // `format` field was added to fix.
      if (article.format) tags.push(String(article.format));
      if (tags.length > 0) item.tags = tags;

      // Custom objects must be prefixed with an underscore, per the spec, so a
      // reader that does not know them ignores them rather than choking.
      const extra = { tier: article.tier };
      if (article.format) extra.format = String(article.format);
      item._portabaltica = extra;

      return item;
    });

    const feed = {
      version: VERSION,
      title: 'portaBaltica',
      home_page_url: site,
      feed_url: site + '/feed.json',
      description: DESCRIPTION,
      language: 'en',
      authors: [{ name: 'portaBaltica', url: site }],
      items: items,
    };

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 'public, max-age=900',
      },
      body: JSON.stringify(feed),
    };
  } catch (error) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'news-jsonfeed',
  keyOn: [],
  ttlMs: 900000,
  graceMs: 3600000,
  staleWhileRevalidate: true,
}));
