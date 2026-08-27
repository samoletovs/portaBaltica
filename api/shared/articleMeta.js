// ─── Per-article metadata for the HTML as served ───
//
// WHY THIS EXISTS
// ---------------
// Social crawlers do not run JavaScript. LinkedIn, Slack, Facebook, X, WhatsApp
// and Discord read the bytes the server sends and nothing else. Every article on
// this site is rendered client-side, so until this module existed the raw HTML
// for all seventy-three articles was byte-identical: the same `og:title`, the
// same description, no headline anywhere in the document, and no `ld+json`.
// Measured against production on 2026-08-27, three different tier A articles all
// previewed as "portaBaltica — Baltic open data, reported".
//
// For a news site the shared link *is* the distribution channel, so that is the
// whole of the distribution channel saying nothing about the story.
//
// This module is deliberately pure — no I/O, no network, no clock. Everything
// here is a string in and a string out, so every rule below is directly
// testable rather than reachable only through a deployed function.
//
// THE ONE RULE THAT MATTERS
// -------------------------
// The metadata must never describe a page the client refuses to render. That is
// not a general principle looking for an application: article
// `lithuania-s-business-bankruptcy-declarations-spike-to-130-9-index-364200` is
// retracted, still served at its stable URL by design, and `ArticleView` goes
// out of its way *not* to print its headline — because in that fault the
// headline was the error. It described a metric the article never measured.
//
// Injecting `index.json`'s headline into `og:title` for every slug would have
// republished that withdrawn claim as the Open Graph title of the very page
// built to suppress it, and it would have travelled further as a share card
// than it ever did as a page. So the gate here is `isServable`, mirroring
// `src/news-types.ts` exactly, and nothing else will do:
//
//   - `ourArticles()` in api/shared/newsroom.js permits `corrected` and falls
//     back to tier when `status` is absent. Right for a feed built from index
//     summaries; wrong here, where we hold the full document and its verdict.
//   - `status !== 'retracted'` is the guard this codebase has twice shipped
//     inert. Full articles do carry `status`, so it would fire — but it would
//     let a failed validator verdict through, which is the other half of what
//     `isServable` refuses.

'use strict';

const SITE_URL = 'https://portabaltica.naurolabs.com';
const SITE_NAME = 'portaBaltica';

/**
 * The head this site serves when it has nothing article-specific to say.
 *
 * Copied from index.html rather than imported, because the Function App is
 * deployed from `api/` alone and never sees the site's static files.
 * `tests/articleMeta.test.ts` reads the real index.html and fails if these
 * drift, which is the only thing that makes a copy safe.
 */
const GENERIC_TITLE = 'portaBaltica — Baltic open data, reported';
const GENERIC_DESCRIPTION =
  'Original analysis of Baltic open data, written by disclosed AI correspondents and checked against the source before publication.';

/** Mirrors the `slug` pattern in newsroom/schemas/article.schema.json. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Mirrors `isValidSlug` in src/news-api.ts, including its limitations.
 *
 * Eight live slugs fail this — seven tier C and one tier B, all carrying
 * Latvian or other diacritics, e.g.
 * `eiropas-komisāra-valda-dombrovska-runa-rīgas-tehniskajā-universitātē-df6376be`.
 * The client rejects them before it fetches anything, so those pages render
 * "Article not found" today. Measured in a browser, not inferred.
 *
 * Being more permissive here was the tempting mistake. It would have made the
 * server answer 200 with a full set of rich metadata for a URL the reader's own
 * browser renders as not-found — a crawler indexing a page nobody can read,
 * which is a worse failure than the one being fixed. The divergence belongs to
 * the slug generator and to `src/news-api.ts`, and it is reported rather than
 * papered over here.
 *
 * It is also the only thing standing between a URL segment and a blob path, so
 * it must run before any URL is built from a slug.
 */
function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

/**
 * Mirrors `isServable` in src/news-types.ts. Same rule, same reason, and it
 * must stay the same: `tests/articleMeta.test.ts` runs both implementations
 * over the same fixtures and fails if they ever disagree.
 */
function isServable(article) {
  return (
    !!article &&
    article.status === 'published' &&
    !!article.provenance &&
    !!article.provenance.validator &&
    article.provenance.validator.passed === true
  );
}

/**
 * Mirrors the retracted branch of `loadArticle` in src/news-api.ts.
 *
 * A retracted article is withdrawn, not unservable, and the published
 * corrections policy promises its "page stays up, showing why. We do not
 * delete the evidence." It still needs a passing verdict — a draft does not
 * become readable by being marked retracted.
 */
function isRetracted(article) {
  return (
    !!article &&
    article.status === 'retracted' &&
    !!article.provenance &&
    !!article.provenance.validator &&
    article.provenance.validator.passed === true
  );
}

/**
 * What this document is, in the same order `loadArticle` decides it.
 *
 * Order matters and is not arbitrary: retracted is tested before servable,
 * because `isServable` would otherwise reject a retracted article and collapse
 * it into the generic refusal — which is the exact bug #113 fixed on the page.
 */
function classify(article) {
  if (isRetracted(article)) return 'retracted';
  if (isServable(article)) return 'ok';
  return 'none';
}

/** Escapes a string for use inside a double-quoted HTML attribute. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a JSON payload for embedding in a `<script>` element.
 *
 * A headline containing `</script>` would otherwise close the element and turn
 * the rest of the document into executable markup. Headlines are quoted
 * verbatim from other outlets for tiers B and C, so this is attacker-adjacent
 * input rather than our own prose. Escaping `<` handles `</script`, `<!--` and
 * `<script` in one go; the result is still valid JSON.
 */
function escapeJsonForScript(json) {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function articleUrl(slug) {
  return SITE_URL + '/article/' + slug;
}

/** Mirrors `renderByline` in src/newsroom/correspondents.ts. */
const BYLINE_SUFFIX = 'AI correspondent';

/**
 * The correspondent roster, id → current name and beat.
 *
 * This is not defensive duplication, it is load-bearing. Every tier A article
 * in blob storage stores a persona name the newsroom has since changed:
 *
 *   stored              roster
 *   Gintaras Vaitkus →  Gintaras Kolka
 *   Ilze Bērziņa     →  Ilze Nida
 *   Kadri Lepik      →  Kadri Ristna
 *   Marek Soosaar    →  Marek Akmeņrags
 *   Rasa Petrauskaitė→  Rasa Irbene
 *
 * The correspondents were renamed to the house's lighthouse surnames and the
 * stored documents were left alone, exactly as `PREVIOUS_PUBLISHER_NAMES` does
 * for the publisher — provenance is not rewritten, the display resolves. So
 * `renderByline` prefers the roster, and a mirror that used the stored name
 * would serve crawlers a structured-data author the site itself no longer
 * prints. Measured against the live index on 2026-08-27: five distinct stored
 * names, none of them current.
 *
 * `tests/articleMetaParity.test.ts` fails if this drifts from CORRESPONDENTS.
 */
const CORRESPONDENT_ROSTER = {
  nida: { name: 'Ilze Nida', beat: 'Economy & Labour' },
  akmensrags: { name: 'Marek Akme\u0146rags', beat: 'Energy & Markets' },
  kolka: { name: 'Gintaras Kolka', beat: 'Maritime & Trade' },
  ristna: { name: 'Kadri Ristna', beat: 'Environment & Climate' },
  irbene: { name: 'Rasa Irbene', beat: 'Government, EU & Society' },
};

function renderByline(persona) {
  if (!persona) return BYLINE_SUFFIX;
  const known = persona.id ? CORRESPONDENT_ROSTER[persona.id] : undefined;
  const name = known ? known.name : (typeof persona.name === 'string' ? persona.name.trim() : '');
  const beat = known ? known.beat : (typeof persona.beat === 'string' ? persona.beat.trim() : '');
  if (!name) {
    const stored = typeof persona.byline === 'string' ? persona.byline.trim() : '';
    if (stored && stored.indexOf(BYLINE_SUFFIX) >= 0) return stored;
    return BYLINE_SUFFIX;
  }
  return beat ? name + ' \u00b7 ' + BYLINE_SUFFIX + ', ' + beat : name + ' \u00b7 ' + BYLINE_SUFFIX;
}

/** Mirrors `publisherName` in src/newsroom/editorial.ts. */
const ACCOUNTABLE_PUBLISHER = 'Andre K\u00f5pu';
const PREVIOUS_PUBLISHER_NAMES = ['Sam Samoletovs', 'Sam Samoletov', 'Andre Ov\u012b\u0161i'];

function publisherName(stored) {
  const value = typeof stored === 'string' ? stored.trim() : '';
  if (!value) return ACCOUNTABLE_PUBLISHER;
  return PREVIOUS_PUBLISHER_NAMES.indexOf(value) >= 0 ? ACCOUNTABLE_PUBLISHER : value;
}

// EU AI Act Article 50 disclosure codes. Kept identical to
// src/newsroom/structured-data.ts — see that file for why these particular
// IPTC codes and not schema.org.
const AI_DISCLOSURE =
  'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
const HUMAN_DISCLOSURE =
  'https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture';

function disclosureFor(tier) {
  return tier === 'A' ? AI_DISCLOSURE : HUMAN_DISCLOSURE;
}

/**
 * Mirrors `newsArticleJsonLd` in src/newsroom/structured-data.ts.
 *
 * Two implementations of one contract is a drift risk, and the alternative was
 * worse: `src/` is TypeScript compiled for the browser and `api/` is CommonJS
 * on the Function host, with no shared build step between them. So they are
 * kept honest by `tests/articleMetaParity.test.ts`, which runs the client's
 * function and this one over the same fixtures and requires deep equality.
 *
 * Tier A only, exactly as the client does it. Claiming a press release or a
 * link-out as our own original reporting is a lie told to a crawler, which is
 * the same lie as telling it to a reader, only harder to catch.
 */
function newsArticleJsonLd(article) {
  if (!article || article.tier !== 'A' || !article.persona) return null;

  const provenance = article.provenance || {};
  const corrections = Array.isArray(article.corrections) ? article.corrections : null;
  const lastCorrection = corrections && corrections.length ? corrections[corrections.length - 1] : undefined;

  const dataCitations = (Array.isArray(provenance.sources) ? provenance.sources : [])
    .filter(function (source) { return Boolean(source && source.url); })
    .map(function (source) {
      const entry = {
        '@type': 'Dataset',
        name: source.dataset != null ? source.dataset : source.source_id,
        url: source.url,
      };
      if (source.dataset_version) entry.version = source.dataset_version;
      return entry;
    });

  const researchCitations = (provenance.research && Array.isArray(provenance.research.consulted)
    ? provenance.research.consulted
    : []
  ).map(function (source) {
    return {
      '@type': 'CreativeWork',
      name: source.title,
      url: source.url,
      publisher: { '@type': 'Organization', name: source.source_name },
    };
  });

  const citations = dataCitations.concat(researchCitations);
  const published = article.published_at != null ? article.published_at : article.created_at;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl(article.slug) },
    headline: article.headline,
  };
  if (article.dek) jsonLd.description = article.dek;
  jsonLd.articleSection = article.section;
  jsonLd.inLanguage = 'en';
  jsonLd.digitalSourceType = disclosureFor(article.tier);
  jsonLd.datePublished = published;
  jsonLd.dateModified = lastCorrection && lastCorrection.corrected_at
    ? lastCorrection.corrected_at
    : published;
  jsonLd.author = {
    '@type': 'Organization',
    name: renderByline(article.persona),
    url: SITE_URL + '/newsroom/' + article.persona.id,
  };
  jsonLd.publisher = { '@type': 'Organization', name: SITE_NAME, url: SITE_URL };
  jsonLd.editor = { '@type': 'Person', name: publisherName(provenance.accountable_editor) };
  jsonLd.creativeWorkStatus = article.status === 'corrected' ? 'Corrected' : 'Published';
  if (citations.length > 0) {
    jsonLd.isBasedOn = citations;
    jsonLd.citation = citations;
  }
  if (corrections && corrections.length) {
    jsonLd.correction = corrections.map(function (correction) {
      return {
        '@type': 'CorrectionComment',
        text: correction.description,
        datePublished: correction.corrected_at,
      };
    });
  }
  return jsonLd;
}

// ─── Head rewriting ───
//
// The shell is fetched at runtime rather than kept as a copy here, so that the
// content-hashed asset URLs Vite emits are always the ones the current
// deployment actually serves. A stale copy would boot a reader into a blank
// page pointing at `/assets/index-<old hash>.js`, which is precisely the
// "fix sharing, break reading" trade this must not make.
//
// Which means the tags below are removed rather than appended to. Appending
// would leave two `og:title` elements in one document, and crawlers disagree
// about which wins — Facebook takes the first, some take the last — so a
// duplicate is not a cosmetic problem but a coin toss over which headline gets
// shared.

/** Tags this module owns. Anything else in the shell's head is left alone. */
const MANAGED_TAG_PATTERNS = [
  /<title>[\s\S]*?<\/title>/gi,
  /<meta\s+name="description"[^>]*>/gi,
  /<meta\s+property="og:(?:title|description|type|url|image:alt)"[^>]*>/gi,
  /<meta\s+name="twitter:(?:title|description|image:alt)"[^>]*>/gi,
  /<meta\s+name="robots"[^>]*>/gi,
  /<link\s+rel="canonical"[^>]*>/gi,
];

/**
 * Removes the tags this module replaces.
 *
 * `og:site_name`, `og:image`, `og:image:width/height`, `og:locale` and
 * `twitter:card` are deliberately NOT in the list: they are correct for every
 * page on the site and re-emitting them would only create a second chance to
 * get them wrong.
 */
function stripManagedTags(html) {
  return MANAGED_TAG_PATTERNS.reduce(function (acc, pattern) {
    return acc.replace(pattern, '');
  }, html);
}

function metaTag(attribute, name, content) {
  return '<meta ' + attribute + '="' + name + '" content="' + escapeHtml(content) + '" />';
}

/**
 * Builds the head fragment for one page.
 *
 * `article` is the document, and `kind` is what `classify` made of it:
 *
 *   'ok'        — servable. Full per-article head plus JSON-LD for tier A.
 *   'retracted' — withdrawn but deliberately still served. The title carries
 *                 the marking, exactly as ArticlePage sets it; nothing else
 *                 claims the piece as journalism.
 *   'none'      — an unknown slug, a failed verdict, or an upstream we could
 *                 not reach. The generic head.
 *
 * Everything but 'ok' is `noindex, nofollow`, which is what the client's
 * `usePageMeta({ index: Boolean(article) })` already does once JavaScript runs.
 * This only moves that decision into the bytes.
 */
function buildHead(article, slug, kind) {
  const state = kind || (article ? 'ok' : 'none');
  const servable = state === 'ok';
  const withdrawn = state === 'retracted';
  const canonical = slug ? articleUrl(slug) : SITE_URL;

  // Mirrors ArticlePage's titles exactly, so the served head and the head
  // after hydration are the same strings:
  //
  //   servable   `${headline} | portaBaltica`
  //   retracted  `Retracted: ${headline} | portaBaltica`
  //
  // `og:title` drops the site suffix: every social card renderer already
  // prints `og:site_name` beside the title, so repeating it there spends
  // fourteen characters of a truncated headline saying what the card says
  // anyway. The "Retracted:" prefix is NOT dropped — it is the marking, and a
  // card is exactly where a withdrawn claim most needs one, because a share
  // card carries no page around it to say so.
  let title = GENERIC_TITLE;
  let ogTitle = GENERIC_TITLE;
  if (servable) {
    title = article.headline + ' | ' + SITE_NAME;
    ogTitle = article.headline;
  } else if (withdrawn) {
    title = 'Retracted: ' + article.headline + ' | ' + SITE_NAME;
    ogTitle = 'Retracted: ' + article.headline;
  }

  // The dek, when there is one and we stand behind the piece. Fifty-three of
  // seventy-three live articles have no dek — it is written for tier A and
  // omitted for the tier B and tier C entries — so most article pages keep the
  // site description. That is exactly what `usePageMeta` does today: it only
  // overrides the description when the article carries one, and it passes
  // `article?.dek`, which is undefined for a retracted piece.
  //
  // Deliberately not truncated. The schema caps `dek` at 300 characters, the
  // longest live one is 170, and Facebook, X and LinkedIn all render at or
  // above 300. A cap would be a guard that either never fires or fires only to
  // discard something the reader would have been shown — and cutting the
  // longest live dek at 160 ends it mid-word on "among Balt".
  const description = servable && article.dek ? article.dek : GENERIC_DESCRIPTION;

  const parts = [
    '<title>' + escapeHtml(title) + '</title>',
    metaTag('name', 'description', description),
    metaTag('property', 'og:title', ogTitle),
    metaTag('property', 'og:description', description),
    metaTag('property', 'og:type', servable ? 'article' : 'website'),
    metaTag('property', 'og:url', canonical),
    metaTag('property', 'og:image:alt', ogTitle),
    metaTag('name', 'twitter:title', ogTitle),
    metaTag('name', 'twitter:description', description),
    metaTag('name', 'twitter:image:alt', ogTitle),
    metaTag('name', 'robots', servable ? 'index, follow' : 'noindex, nofollow'),
    '<link rel="canonical" href="' + escapeHtml(canonical) + '" />',
  ];

  if (servable) {
    // Article-level Open Graph. Only meaningful once og:type is `article`,
    // and only honest for a piece we still stand behind.
    const published = article.published_at != null ? article.published_at : article.created_at;
    if (published) parts.push(metaTag('property', 'article:published_time', published));
    if (article.section) parts.push(metaTag('property', 'article:section', article.section));
    if (article.persona) {
      parts.push(metaTag('property', 'article:author', renderByline(article.persona)));
    }

    // NewsArticle structured data asserts this is journalism we publish. A
    // withdrawn piece gets none, for the same reason it gets no dek: the
    // marking is the only claim left to make about it.
    const jsonLd = newsArticleJsonLd(article);
    if (jsonLd) {
      parts.push(
        '<script type="application/ld+json">' +
          escapeJsonForScript(JSON.stringify(jsonLd)) +
          '</script>'
      );
    }
  }

  return parts.join('\n    ');
}

/**
 * Produces the document to serve for one article URL.
 *
 * Returns null when the shell does not look like this site's shell — a missing
 * `<div id="root">` or a missing `</head>` means we fetched something other
 * than the app, and injecting into it would serve a page that cannot boot.
 * Refusing is better than guessing; the caller falls back.
 */
function renderShell(shell, article, slug, kind) {
  if (typeof shell !== 'string' || shell.indexOf('</head>') < 0) return null;
  if (shell.indexOf('id="root"') < 0) return null;

  const stripped = stripManagedTags(shell);
  return stripped.replace('</head>', '    ' + buildHead(article, slug, kind) + '\n  </head>');
}

/**
 * Pulls the slug out of whatever the host gives us.
 *
 * Static Web Apps rewrites `/article/<slug>` to this function and passes the
 * reader's original URL in `x-ms-original-url`; `req.url` at that point is the
 * rewritten `/api/article-page`. Falling back through the other candidates
 * keeps the function testable and keeps it working under the SWA CLI emulator,
 * which populates these differently.
 */
function slugFromRequest(req) {
  const headers = (req && req.headers) || {};
  const candidates = [
    headers['x-ms-original-url'],
    headers['X-MS-Original-Url'],
    req && req.originalUrl,
    req && req.url,
  ];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (typeof candidate !== 'string' || !candidate) continue;
    // Strip scheme/host if present, then query and fragment.
    const path = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0];
    const match = /\/article\/([^/]+)\/?$/.exec(path);
    if (match) {
      let raw = match[1];
      try { raw = decodeURIComponent(raw); } catch (e) { /* keep the raw segment */ }
      return raw;
    }
  }

  if (req && req.query && typeof req.query.slug === 'string') return req.query.slug;
  return null;
}

module.exports = {
  SITE_URL,
  SITE_NAME,
  GENERIC_TITLE,
  GENERIC_DESCRIPTION,
  CORRESPONDENT_ROSTER,
  isValidSlug,
  isServable,
  isRetracted,
  classify,
  escapeHtml,
  escapeJsonForScript,
  articleUrl,
  renderByline,
  publisherName,
  disclosureFor,
  newsArticleJsonLd,
  stripManagedTags,
  buildHead,
  renderShell,
  slugFromRequest,
};
