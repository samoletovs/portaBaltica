const newsroom = require('../shared/newsroom.js');
const indicators = require('../shared/indicators.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

const CORRESPONDENTS = ['nida', 'akmensrags', 'kolka', 'ristna', 'irbene'];
const SECTIONS = [
  'economy', 'trade', 'government', 'labour', 'energy',
  'property', 'environment', 'business', 'maritime',
];

/**
 * Every indicator with a page, read from the registry the dashboard renders
 * from rather than listed here.
 *
 * DERIVED, NOT MIRRORED, AND THIS IS THE WHOLE POINT
 * ---------------------------------------------------
 * `SECTIONS` and `CORRESPONDENTS` above are hand-written copies that a test
 * holds to an equality, because the Function App cannot import from `src/`. It
 * *can* import from `api/shared/`, so this one needs no copy at all — and a
 * shared enumeration cannot drift, where two always will.
 *
 * That distinction is not academic here. This file was one of THREE
 * enumerations of the same thing: `INDICATOR_INFO` in `IndicatorPage.tsx`
 * knew 24, `DASHBOARD_INDICATORS` in `chart-ref.ts` knew 71, and the registry
 * serves 71. Fifty-seven indicators were therefore linkable from an article and
 * rendered "Unknown indicator" — measured against production on 2026-08-28,
 * 14 of the 19 published articles carrying a resolvable chart reference sent
 * their reader to that dead end from the "Check it yourself" link.
 */
function indicatorIds() {
  return Object.keys(indicators).sort();
}

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
 *
 * `/indicator/:id` was here until 2026-08-28, excluded because the page set no
 * canonical of its own and 71 URLs each declaring the home page canonical would
 * have been 71 duplicates of one page rather than coverage. The equality is
 * what forced that entry to be removed rather than quietly kept: the page now
 * claims itself, so the exclusion had to go and the URLs had to be listed in
 * the same change.
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
};

/**
 * GET /sitemap.xml (rewritten to /api/news-sitemap)
 *
 * Our own pages only. Tier C items live on other people's domains and belong
 * in other people's sitemaps.
 *
 * ⚠️ That sentence was true of tier C and quietly false of tier B. `#374`
 * pointed every syndicated page's `rel=canonical` at the source it reproduces,
 * which is correct — and a sitemap entry whose page names a *foreign*
 * canonical is a contradiction we would be publishing: `<loc>` here says
 * "index this URL", and the page it names says "no, index theirs". This file
 * already carries that argument twice, for `/indicator/:id` and for
 * `/correspondents/:id`. So the filter below is forced by the canonical
 * change, not chosen alongside it.
 *
 * Four tier B pages were listed before this. RSS and the JSON feed still carry
 * them, deliberately: those credit the source in `dc:creator` ("Source:
 * European Commission") and make no claim about which copy is the original.
 */
const handler = async function (context, req) {
  try {
    const site = newsroom.SITE_URL;
    const escape = newsroom.escapeXml;
    // Both reads, or neither, on the same terms as the two feeds — see
    // `fetchCorrections` in the shared module. A sitemap that quietly fell back
    // to publication dates would be the same masquerade one field over: it would
    // tell a crawler nothing had changed, which is exactly the claim a
    // correction makes false.
    const [articles, corrected] = await Promise.all([
      newsroom
        .fetchIndex()
        .then(newsroom.ourArticles)
        .then(function (list) {
          return list.filter(function (article) {
            return newsroom.syndicatedOriginal(article) === null;
          });
        }),
      newsroom.fetchCorrections(),
    ]);
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
    // One page per indicator, from the registry the dashboard renders from.
    // Lower priority than a section: an indicator page is one series, where a
    // section page is nine or more, and a sitemap priority is a statement about
    // relative importance within our own site rather than a bid for ranking.
    indicatorIds().forEach(function (id) { add('/indicator/' + id, today, '0.4'); });

    articles.forEach(function (article) {
      // `lastmod` is "the date of last modification of the file", and a
      // corrected article was modified on the day we corrected it. Measured
      // against production at 2026-09-01T14:24Z: 18 of the 43 syndicated
      // articles carried a published correction, and every one of them was
      // dated here to its original publication — telling a crawler nothing had
      // changed on the day we changed it, and inviting it to keep serving the
      // withdrawn claim from its own cache.
      //
      // `#349` marked the two feeds and did not reach this file, because a set
      // of slugs answers "was it corrected" and `lastmod` needs to know WHEN.
      // That is why `parseCorrections` now carries the date.
      //
      // The same computation `src/newsroom/structured-data.ts` already makes for
      // `dateModified` — the latest correction wins, publication is the fallback
      // — so the sitemap and the JSON-LD on the page now agree about when a
      // piece last moved. They did not before.
      //
      // Sliced to a date because that is what every other entry here emits and
      // what the sitemap protocol's W3C-datetime profile permits. An empty
      // string from a log entry with no timestamp falls through to publication
      // rather than emitting a blank `<lastmod>`.
      const modified = corrected.get(article.slug) || article.published_at;
      const lastmod = modified ? String(modified).slice(0, 10) : today;
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
  // No `staleWhileRevalidateMs`, deliberately, and the two feeds have one.
  //
  // The horizon exists because a body built before a correction may still go
  // out, and on /rss.xml that means a human reads a headline we have publicly
  // withdrawn. Here the reader is a crawler and the staleness costs a `lastmod`
  // that is a few hours behind — which is smaller than the interval at which a
  // crawler returns anyway, against a six-hour grace protecting a page that
  // rebuilds the whole indicator registry on every miss.
  //
  // `tests/staleHorizons.test.ts` asserts the set of endpoints declaring a
  // horizon as an EQUALITY, so adding this file to it is a decision someone has
  // to make on purpose rather than a line that drifts in.
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
module.exports.indicatorIds = indicatorIds;
