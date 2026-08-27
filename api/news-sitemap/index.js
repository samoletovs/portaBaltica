const newsroom = require('../shared/newsroom.js');
const rateLimit = require('../shared/rateLimit.js');
const { withSecurity } = require('../shared/securityHeaders.js');

const CORRESPONDENTS = ['nida', 'akmensrags', 'kolka', 'ristna', 'irbene'];
const SECTIONS = [
  'economy', 'trade', 'government', 'labour', 'energy',
  'property', 'environment', 'business', 'maritime',
];

/**
 * GET /sitemap.xml (rewritten to /api/news-sitemap)
 *
 * Our own pages only. Tier C items live on other people's domains and belong
 * in other people's sitemaps.
 */
const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  try {
    const site = newsroom.SITE_URL;
    const escape = newsroom.escapeXml;
    const articles = newsroom.ourArticles(await newsroom.fetchIndex());
    const today = new Date().toISOString().slice(0, 10);

    const urls = [];

    function add(path, lastmod, priority) {
      urls.push(
        '  <url>\n' +
        '    <loc>' + escape(site + path) + '</loc>\n' +
        (lastmod ? '    <lastmod>' + escape(lastmod) + '</lastmod>\n' : '') +
        '    <priority>' + priority + '</priority>\n' +
        '  </url>'
      );
    }

    add('/', today, '1.0');
    add('/data', today, '0.8');
    add('/about/ai', today, '0.6');
    add('/corrections', today, '0.5');
    CORRESPONDENTS.forEach(function (id) { add('/correspondents/' + id, today, '0.5'); });
    SECTIONS.forEach(function (section) { add('/data/' + section, today, '0.6'); });

    articles.forEach(function (article) {
      const lastmod = article.published_at ? String(article.published_at).slice(0, 10) : today;
      add('/article/' + article.slug, lastmod, '0.9');
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urls.join('\n'),
      '</urlset>',
    ].join('\n');

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
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
