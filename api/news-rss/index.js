const newsroom = require('../shared/newsroom.js');
const rateLimit = require('../shared/rateLimit.js');
const { withSecurity } = require('../shared/securityHeaders.js');

/**
 * GET /rss.xml (rewritten to /api/news-rss)
 *
 * RSS 2.0 for portaBaltica's own articles. Tier C link-outs are excluded —
 * see api/shared/newsroom.js for why.
 */
const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  try {
    const articles = newsroom.ourArticles(await newsroom.fetchIndex());
    const site = newsroom.SITE_URL;
    const escape = newsroom.escapeXml;

    const items = articles.map(function (article) {
      const url = site + '/article/' + article.slug;
      const published = article.published_at ? new Date(article.published_at).toUTCString() : '';
      const author = article.persona && article.persona.byline
        ? article.persona.byline
        : (article.persona ? article.persona.name + ' \u00b7 AI correspondent' : 'portaBaltica');

      return [
        '    <item>',
        '      <title>' + escape(article.headline) + '</title>',
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

module.exports = withSecurity(handler);
