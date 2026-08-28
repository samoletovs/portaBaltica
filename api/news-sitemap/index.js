const newsroom = require('../shared/newsroom.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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
    // How to keep up, and the stable address for the latest weekly review.
    // `/weekly` is listed even when no review is currently published: the page
    // is a real page that answers the question either way, and de-listing it on
    // the quiet weeks would drop it from search exactly when a reader is most
    // likely to be wondering where the wrap went.
    add('/follow', today, '0.7');
    add('/weekly', today, '0.7');
    add('/about/ai', today, '0.6');
    add('/corrections', today, '0.5');
    // Canonical URLs only. `/correspondents/:id` still resolves, but `main.tsx`
    // routes it to `LegacyCorrespondentRedirect` and the page it lands on
    // declares `canonicalPath: /newsroom/:id` — so listing the old form told
    // search engines to index a URL whose destination disowns it.
    CORRESPONDENTS.forEach(function (id) { add('/newsroom/' + id, today, '0.5'); });
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

module.exports = withSecurity(withCache(handler, {
  name: 'news-sitemap',
  keyOn: [],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
