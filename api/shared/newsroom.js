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
 * Turns a fetched corrections log into slug → the timestamp of its most recent
 * correction, or throws.
 *
 * The same three-way distinction `parseIndex` draws, and it lands differently
 * on each branch:
 *
 *   - `null` is a 404, which is an ANSWER. `corrections.json` does not exist
 *     until the first correction is ever issued, so "nobody has been corrected"
 *     is a legitimate state and must not be an error.
 *   - anything that is not an array is a MISCONFIGURATION. A wrong base URL
 *     that happened to return a JSON object would otherwise read as an empty
 *     log, which is the same masquerade `parseIndex` exists to prevent — except
 *     here the masquerade is "no article has been corrected", which is the
 *     exact claim these feeds must never make falsely.
 *   - an entry without a string slug is skipped rather than fatal. The log is
 *     append-only and written by a different process; one malformed row must
 *     not take down a feed that can still mark the other twenty-seven.
 *
 * WHY A MAP AND NOT THE SET THIS RETURNED FIRST
 * ---------------------------------------------
 * A set answers "was this corrected", which is all a title prefix needs, and it
 * is all this returned when `#349` added it. Two callers since need to know
 * WHEN: `date_modified` in the JSON feed and `<lastmod>` in the sitemap both
 * name a moment rather than a fact. A `Map` answers both — `.has()` behaves
 * exactly as the set's did, so `feedTitle` is unchanged — and it keeps ONE
 * parser over this file. Two would drift, and the drift would be silent in the
 * direction that marks the wrong articles.
 *
 * The value is the LATEST correction, not the first. The log is append-only and
 * not sorted, and measured against production on 2026-09-01 it holds 28 entries
 * over 25 slugs — so three articles carry more than one, and taking whichever
 * came first would date them to a correction we have since superseded.
 *
 * Compared as strings rather than parsed. The pipeline writes ISO-8601 UTC and
 * `src/news-api.ts` already sorts this very field with `localeCompare`, so a
 * lexicographic maximum is the same answer the client gets — and a timestamp we
 * cannot parse cannot silently become `Invalid Date` on the way through.
 *
 * A count is deliberately not available. `src/news-api.ts` gives the reason: one
 * of those three articles is doubly corrected because we corrected our own
 * correction, and a "2" would present that to a reader as two errors.
 */
function parseCorrections(raw, sourceUrl) {
  if (raw === null || raw === undefined) return new Map();
  if (!Array.isArray(raw)) {
    throw new Error('Corrections log at ' + sourceUrl + ' is malformed');
  }
  const latest = new Map();
  raw.forEach(function (entry) {
    if (!entry || typeof entry.slug !== 'string' || !entry.slug) return;
    const at = typeof entry.corrected_at === 'string' ? entry.corrected_at : '';
    const known = latest.get(entry.slug);
    // The comparison must not require `at` to be truthy. A log row with no
    // timestamp yields `''`, and gating the assignment on it — `if (at && ...)`
    // — would drop the slug from the map entirely and serve that article's
    // withdrawn headline unmarked. Losing the date costs a `date_modified`;
    // losing the slug costs the notice, which is the part a reader acts on.
    //
    // `known === undefined` rather than `!known` is honesty about intent rather
    // than a behaviour change: measured with a planted mutation, the two are
    // indistinguishable on every input this log can produce, because an empty
    // string loses every `>` comparison anyway. The explicit form says which
    // question is being asked.
    if (known === undefined || at > known) latest.set(entry.slug, at);
  });
  return latest;
}

/**
 * Which articles carry a published correction, for a feed that lists headlines.
 *
 * WHY THE LOG AND NOT THE INDEX
 * -----------------------------
 * The index does not know. `apply_correction_note` in
 * `newsroom/pipeline/revisions.py` writes `<slug>.json` and appends to
 * `corrections.json`, and never touches `index.json`; `write_index` then merges
 * pre-existing entries verbatim, so no later run retrofits the field either.
 * Measured against production on 2026-09-01: 0 of 93 index entries carried
 * anything about a correction, while 18 of the 43 articles these feeds syndicate
 * had one. `src/news-api.ts` reads the same file for the same reason, so the
 * feeds, the front page and `/corrections` cannot disagree about who was
 * corrected — it is one file.
 *
 * WHY A FAILURE HERE IS FATAL TO THE FEED
 * ---------------------------------------
 * A feed has no per-item way to say "we could not find out". The front page can
 * — and does — print a line admitting it, but an RSS item is a title and a link,
 * so serving one unmarked is indistinguishable from asserting the headline
 * stands. That assertion is also irreversible in a way the site's is not: it
 * lands in somebody else's reader, and `ourArticles` below already says such a
 * reader "will never see the page that corrects it".
 *
 * So this throws, the endpoint 500s, and a feed reader answers a 500 by keeping
 * what it has and retrying — which loses nothing. The cost is smaller than it
 * looks: `withCache` stores only 200s and holds an hour of grace, so an outage
 * shorter than that serves the last good, correctly marked feed with
 * `X-Cache: stale` and nobody notices at all.
 */
function fetchCorrections() {
  const url = ARTICLES_BASE_URL + '/corrections.json';
  return jsonGet(url).then(function (raw) { return parseCorrections(raw, url); });
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
 * The foreign original this piece reproduces, or `null` when the piece is ours.
 *
 * WHY THIS IS THE PROPERTY AND NOT THE TIER
 * -----------------------------------------
 * Tier A never carries a `syndicated` block and tiers B and C always do —
 * measured against the live index on 2026-09-02: A 0/45, B 4/4, C 50/50. So
 * keying on the block gives exactly the tier answer today, and stays right for
 * a tier that does not exist yet. `tests/syndicatedCanonical.test.ts` asserts
 * the tier mapping as an equality anyway, so a new tier is still noticed.
 *
 * WHY ANYTHING READS THIS
 * -----------------------
 * `articleMeta.js` already refuses to emit `NewsArticle` JSON-LD for anything
 * that is not tier A — `newsArticleJsonLd` returns null — because a syndicated
 * item is not our journalism and must not be described as though it were.
 * Three hundred lines below that, `buildHead` built the canonical URL with no
 * tier gate at all, so every one of those pages declared **itself** the
 * canonical version of somebody else's article. Measured live before the fix:
 * a European Commission press release and an LSM report, both `index, follow`,
 * both `rel=canonical` pointing at us.
 *
 * The scheme test is not decoration. A `<link rel="canonical">` is resolved
 * against the document, so a relative or `javascript:` value in stored data
 * would silently become a claim about one of our own URLs, or worse.
 */
function syndicatedOriginal(article) {
  const syndicated = article && article.syndicated;
  const url = syndicated && syndicated.original_url;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

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
 * It is deliberately not `status !== 'retracted'`. Most index entries carry no
 * usable `status` for this purpose, so that comparison would be true for
 * almost every article and the guard would read as protection in review while
 * being inert in production — the failure this codebase keeps finding rather
 * than one worth adding.
 *
 * ⚠️ The measurement behind that sentence has MOVED, and in the direction that
 * makes this fallback look retirable when it is more load-bearing than ever.
 * It used to read "nought of seventy". Measured against the live index on
 * 2026-08-31:
 *
 *     88 entries · 67 carry a status · 21 do not
 *     the 21 are 19 tier A and 2 tier B — our own journalism
 *     all 50 tier C entries carry `published`
 *
 * So a reader who re-measures now finds most entries populated and could
 * conclude the fallback is obsolete. Deleting it would drop those 21 articles
 * from RSS, the JSON feed and the sitemap at once — every surface `ourArticles`
 * guards. `tests/newsroomFeed.test.ts` pins the behaviour rather than the
 * number, so the guarantee survives the next time these counts move.
 *
 * Nor is it `status === 'published'`, matching `isServable` on the client.
 * That is the right rule for a full article, which carries its status and its
 * validator verdict; applied to an index entry that carries neither it would
 * drop those same articles and serve a feed missing more than half of our own
 * output.
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

/**
 * The headline as a feed must carry it: marked when the article was corrected.
 *
 * ONE IMPLEMENTATION, BECAUSE TWO FEEDS ASK THIS
 * ----------------------------------------------
 * `bylineFor` above exists for exactly this reason, and its comment records
 * what happened when the answer was written twice: the three copies disagreed.
 * The same argument applies with more force here, because a divergence would
 * mean one feed marking a withdrawn claim and the other not, and nothing would
 * say which was right. `tests/jsonFeed.test.ts` already asserts the two feeds
 * carry the same slugs; marking has to be the same question, not a second one.
 *
 * WHY IT GOES IN THE TITLE
 * ------------------------
 * Neither RSS 2.0 nor JSON Feed 1.1 has a correction element, and a namespaced
 * one would be invisible in every reader ever written. What a reader's list
 * view shows is the title, so a marker that is not in the title is not a
 * marker. This is the feed's equivalent of the badge the site puts BEFORE the
 * headline, and it is a prefix for the same reason: a suffix is the first thing
 * a narrow column truncates.
 *
 * The permalink is deliberately untouched, so `<guid>` and JSON Feed's `id`
 * still identify the same item and no reader treats this as a new story.
 *
 * WHAT IT CANNOT DO, AND WHAT PARTLY CAN
 * --------------------------------------
 * An item already delivered keeps the title in the reader's own store. Nothing
 * we serve now rewrites it. This marks every item served from here on, which is
 * most of what a feed can promise — but not all of it: JSON Feed 1.1 has
 * `date_modified`, which the readers that honour it use to re-read an entry they
 * already hold. `api/news-jsonfeed/index.js` emits it for exactly this gap. RSS
 * 2.0 has no equivalent element, so for that feed this really is the limit.
 */
function feedTitle(article, corrected) {
  const headline = String(article && article.headline != null ? article.headline : '');
  // A `Map` from `parseCorrections`, but only `.has` is used — the same call
  // that worked when this was a `Set`, which is why widening it to carry dates
  // left this function alone.
  if (!corrected || !corrected.has(article && article.slug)) return headline;
  return 'Corrected: ' + headline;
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
  fetchCorrections,
  parseCorrections,
  feedTitle,
  ourArticles,
  syndicatedOriginal,
  bylineFor,
  escapeXml,
};
