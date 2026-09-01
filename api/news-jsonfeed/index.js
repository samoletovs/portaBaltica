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
 *
 * THE ONE FIELD THAT IS NOT IN /rss.xml
 * -------------------------------------
 * `date_modified`. "The same items" is a claim about WHICH articles each feed
 * carries and what it says about them, not a promise that neither format may
 * use a field the other lacks. RSS 2.0 simply has no element meaning "this
 * entry changed after you fetched it"; JSON Feed does, and the readers honouring
 * it re-read the entry — which is the only mechanism in either format that can
 * reach a subscriber already holding a headline we have since corrected. See
 * the item body for why that is worth the asymmetry.
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
    // Both reads, or neither — see `fetchCorrections` in the shared module.
    const [articles, corrected] = await Promise.all([
      newsroom.fetchIndex().then(newsroom.ourArticles),
      newsroom.fetchCorrections(),
    ]);
    const site = newsroom.SITE_URL;

    const items = articles.map(function (article, index) {
      const url = site + '/article/' + article.slug;
      const summary = typeof article.dek === 'string' && article.dek ? article.dek : '';
      const isCorrected = corrected.has(article.slug);

      const item = {
        // The permalink, which is what the spec recommends an id be: stable,
        // globally unique, and never reused for a different piece. Deliberately
        // unchanged by a correction, so a reader treats a marked item as the
        // same story rather than a new one.
        id: url,
        url: url,
        // Marked through the shared helper rather than here, so this feed and
        // /rss.xml cannot disagree about which headline has been withdrawn.
        title: newsroom.feedTitle(article, corrected),
        // The feed carries the standfirst, not the article. `url` is where the
        // piece is, and the provenance block a reader is entitled to see —
        // sources, model, checks — only exists on the page.
        //
        // The fallback goes through `feedTitle` rather than taking the raw
        // headline, because when there is no dek this field IS the headline
        // and an unmarked copy of a withdrawn claim would sit beside a marked
        // one in the same item. Latent rather than live — measured on
        // 2026-09-01, 4 of the 43 syndicated articles have no dek and none of
        // those 4 is corrected — but it is one branch away from the defect this
        // whole change is about, and it costs a function call.
        content_text: summary || newsroom.feedTitle(article, corrected),
        // Always discloses AI on our own work. A feed reader shows the author
        // and never shows our masthead, so the disclosure has to travel with
        // the item or it does not travel at all.
        authors: [{ name: newsroom.bylineFor(article) }],
      };

      if (summary) item.summary = summary;

      const published = rfc3339(article.published_at);
      if (published) item.date_published = published;

      // THE ONE THING THIS FEED CAN SAY THAT /rss.xml CANNOT
      // ----------------------------------------------------
      // The title prefix marks every item served from now on, and cannot reach
      // an item a reader already holds — `feedTitle` says so itself. JSON Feed
      // 1.1 has `date_modified` for exactly that: it means "this entry changed
      // after you fetched it", and the readers that honour it re-read the entry
      // rather than trusting their stored copy. RSS 2.0 has no such element, so
      // this is not an inconsistency between the two feeds but the extra thing
      // one format offers.
      //
      // It is the LATEST correction, from `parseCorrections`. Three of the 25
      // corrected articles carry more than one entry in an append-only,
      // unsorted log, so the first would date them to a correction we have
      // since superseded.
      //
      // Absent rather than equal to `date_published` when nothing was
      // corrected: a reader honouring the field would otherwise be told every
      // item had changed, every time, which is the same lesson as
      // `corrected: false` below.
      //
      // Dropped rather than emitted as `Invalid Date` if the log ever carries a
      // timestamp we cannot parse — see `rfc3339`. The mark on the title does
      // not depend on it, so a bad timestamp costs the date and not the notice.
      if (isCorrected) {
        const modified = rfc3339(corrected.get(article.slug));
        if (modified) item.date_modified = modified;
      }

      const tags = [];
      if (article.section) tags.push(String(article.section));
      // What KIND of piece this is, as against what it is about. A weekly wrap
      // filed under `maritime` is a cross-beat digest, not a maritime report,
      // and the section alone cannot say so — which is the category error the
      // `format` field was added to fix.
      if (article.format) tags.push(String(article.format));
      if (tags.length > 0) item.tags = tags;

      // Custom objects must be prefixed with an underscore, per the spec, so a
      // reader that does not know them ignores them rather than choking. The
      // spec also asks for an `about` pointing somewhere a human can find out
      // what the extension means, "preferably in the first use" — which is why
      // it is attached once rather than repeated on all seventy-odd items.
      const extra = { tier: article.tier };
      if (article.format) extra.format = String(article.format);
      // The marker again, structured, for a consumer that would otherwise have
      // to parse a prefix off the title. It is `true` or absent rather than
      // `false`, because absent means "not corrected" the same way a missing
      // `format` means "an ordinary report" two lines above — and a feed that
      // says `corrected: false` on seventy items teaches a reader to stop
      // reading the field.
      if (isCorrected) extra.corrected = true;
      if (index === 0) extra.about = site + '/follow';
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
  // The same horizon as /rss.xml, and for the same reason — see the comment
  // there. The two feeds must not disagree about how long a withdrawn headline
  // may keep going out any more than they may disagree about who was corrected.
  staleWhileRevalidateMs: 960000,
}));
