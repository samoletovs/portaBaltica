const newsroom = require('../shared/newsroom.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

/**
 * GET /rss.xml (rewritten to /api/news-rss)
 *
 * RSS 2.0 for portaBaltica's own articles. Tier C link-outs are excluded —
 * see api/shared/newsroom.js for why.
 */
const handler = async function (context, req) {
  try {
    // Both reads, or neither. A corrections log that cannot be read is fatal
    // here on purpose — see `fetchCorrectedSlugs` for why a feed cannot serve
    // an unmarked item the way the front page can print a caveat.
    const [articles, corrected] = await Promise.all([
      newsroom.fetchIndex().then(newsroom.ourArticles),
      newsroom.fetchCorrectedSlugs(),
    ]);
    const site = newsroom.SITE_URL;
    const escape = newsroom.escapeXml;

    const items = articles.map(function (article) {
      const url = site + '/article/' + article.slug;
      const published = article.published_at ? new Date(article.published_at).toUTCString() : '';
      // Shared with /feed.json rather than rebuilt here. The two feeds must
      // credit the same article to the same author, and "must" is worth as much
      // as the thing that checks it — see tests/jsonFeed.test.ts.
      const author = newsroom.bylineFor(article);
      // Shared for the same reason, and the reason is sharper: two feeds
      // disagreeing about which headline has been withdrawn would be a
      // contradiction with nothing to say which side was right.
      const title = newsroom.feedTitle(article, corrected);

      return [
        '    <item>',
        '      <title>' + escape(title) + '</title>',
        '      <link>' + escape(url) + '</link>',
        '      <guid isPermaLink="true">' + escape(url) + '</guid>',
        article.dek ? '      <description>' + escape(article.dek) + '</description>' : '',
        published ? '      <pubDate>' + escape(published) + '</pubDate>' : '',
        article.section ? '      <category>' + escape(article.section) + '</category>' : '',
        '      <dc:creator>' + escape(author) + '</dc:creator>',
        '    </item>',
      ].filter(Boolean).join('\n');
    }).join('\n');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
      '  <channel>',
      '    <title>portaBaltica</title>',
      '    <link>' + escape(site) + '</link>',
      '    <atom:link href="' + escape(site + '/rss.xml') + '" rel="self" type="application/rss+xml" />',
      '    <description>Original analysis of Baltic open data, written by disclosed AI correspondents and checked against the source before publication.</description>',
      '    <language>en</language>',
      '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>',
      items,
      '  </channel>',
      '</rss>',
    ].filter(Boolean).join('\n');

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=900',
      },
      body: xml,
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
  name: 'news-rss',
  keyOn: [],
  ttlMs: 900000,
  graceMs: 3600000,
  staleWhileRevalidate: true,
}));
