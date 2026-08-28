const newsroom = require('../shared/newsroom.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

const CORRESPONDENTS = ['nida', 'akmensrags', 'kolka', 'ristna', 'irbene'];
const SECTIONS = [
  'economy', 'trade', 'government', 'labour', 'energy',
  'property', 'environment', 'business', 'maritime',
];

/**
 * Routes in `src/main.tsx` that are deliberately NOT in the sitemap.
 *
 * Declared here, as a list, rather than left implicit by absence — because
 * absence is what let `/newsroom` and `/api-docs` fall out unnoticed. Both are
 * in the site's own navigation and both serve 200; nothing said they were
 * missing, and nothing could, because a sitemap has no way to know what it does
 * not contain.
 *
 * `tests/sitemapCoverage.test.ts` asserts this list EQUALS the set of routes
 * absent from the sitemap. Not a filter over it — an equality — so a route
 * added to `main.tsx` fails the suite until someone either lists it or names it
 * here. The decision is forced; it cannot default to absent.
 */
const NOT_IN_SITEMAP = {
  /**
   * A legacy redirect. The masthead used to live here; `main.tsx` sends both
   * forms to `/newsroom`, and the destination declares `/newsroom` as its
   * canonical — so listing the old form would ask a crawler to index a URL
   * whose own page disowns it.
   */
  '/correspondents': 'legacy redirect to /newsroom',
  '/correspondents/:id': 'legacy redirect to /newsroom/:id',

  /**
   * The legacy section redirect: `/economy` → `/data/economy`. Same reason.
   * It is also a catch-all, so it matches paths that resolve to nothing.
   */
  '/:section': 'legacy redirect to /data/:section',

  /**
   * 71 indicator pages, and this is a judgement rather than an oversight.
   *
   * Each serves HTTP 200 and is linked from the dashboard, so the case for
   * listing them is real: they are the long tail a small data site wants.
   * The reason they are out is measurable and specific. `IndicatorPage.tsx`
   * calls `usePageMeta` nowhere, so an indicator page sets no title, no
   * description and no canonical, and inherits the shell's — which names the
   * HOME PAGE. Measured in a rendering Chromium against production at
   * 2026-08-28T13:12:28Z: `/indicator/salary  canonical=/  DISOWNS ITSELF`.
   *
   * Submitting 71 URLs that each tell the crawler to index the home page
   * instead is not coverage, it is 71 duplicates of one page. The blocker is
   * not that the pages are thin — they carry a chart, three countries and a
   * source — it is that they do not yet claim to be pages at all.
   *
   * TRIGGER TO REVISIT: when `IndicatorPage` sets its own canonical and title.
   * The equality test above makes that conversation compulsory rather than
   * optional, because this entry will have to be removed for it to pass.
   */
  '/indicator/:id': 'sets no canonical of its own; would submit 71 URLs pointing at the home page',
};

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
    // The masthead index. It is in the site navigation, `main.tsx` routes it to
    // `CorrespondentPage`, it serves 200 and it declares `/newsroom` as its own
    // canonical — and it was absent, while all five `/newsroom/{id}` pages
    // beneath it were listed by the loop below. Nothing said so, because a
    // sitemap cannot report what it omits.
    add('/newsroom', today, '0.6');
    // The public API and its pricing. Absent for the same reason, and worth
    // more than most of what is here to a site with no revenue: it is the page
    // a prospective customer would search for.
    add('/api-docs', today, '0.6');
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

/**
 * Exposed for `tests/sitemapCoverage.test.ts`, which compares these against
 * `src/main.tsx`, `src/sections.ts` and `src/newsroom/correspondents.ts`.
 *
 * A compile-time equality is the only shape available: the Function App is
 * deployed from `api/` alone and cannot import from `src/` at runtime, which is
 * the same constraint `api/shared/securityHeaders.js` records about
 * `staticwebapp.config.json`. Two enumerations that cannot share a value can at
 * least be required to agree.
 *
 * Azure's JS host takes `module.exports` as the handler and ignores properties
 * on it, so this changes nothing at runtime.
 */
module.exports.NOT_IN_SITEMAP = NOT_IN_SITEMAP;
module.exports.SECTIONS = SECTIONS;
module.exports.CORRESPONDENTS = CORRESPONDENTS;
