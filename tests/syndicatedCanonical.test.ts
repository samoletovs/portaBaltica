import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

import { canonicalForArticle, syndicatedOriginalUrl, SITE_ORIGIN } from '../src/newsroom/canonical';
import type { Article } from '../src/news-types';

const require = createRequire(import.meta.url);
const meta = require(resolve('api/shared/articleMeta.js')) as {
  canonicalFor(article: unknown, slug?: string): string;
  buildHead(article: unknown, slug: string, kind?: string): string;
};
const newsroom = require(resolve('api/shared/newsroom.js')) as {
  syndicatedOriginal(article: unknown): string | null;
  ourArticles(articles: unknown[]): unknown[];
};

/**
 * A page may not declare itself the canonical version of somebody else's work.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * `articleMeta.js` refuses to emit `NewsArticle` JSON-LD for anything that is
 * not tier A, because a syndicated item is not our journalism. Three hundred
 * lines below that, the canonical URL was built with no tier gate at all. So
 * the same document said both things: *this is not our article* in the
 * structured data, and *we are the canonical copy of it* in the `<link>`.
 *
 * Measured live on 2026-09-02 before the fix:
 *
 *   tier B  a European Commission press release  canonical=ours  in sitemap
 *   tier C  an LSM report                        canonical=ours  not in sitemap
 *
 * That is the shape `AGENTS.md` calls the correct sibling concealing the
 * broken one — a reader who checks whether tier is respected finds the JSON-LD
 * gate, and stops.
 *
 * WHY AN EQUALITY OVER TIERS
 * --------------------------
 * The implementation keys on the `syndicated` block rather than on the tier
 * letter, because that is the property that actually decides the question and
 * it stays right for a tier nobody has invented yet. The risk in that is the
 * opposite of the usual one: a new tier would be handled *silently*. So the
 * mapping is asserted here as an equality against the full set of tiers, per
 * `AGENTS.md`: state the exemption as an equality, not as a subtraction, so it
 * goes red when the set changes in either direction.
 */

const TIERS = ['A', 'B', 'C'] as const;

/** Which tiers may name themselves as canonical. Exactly these, no more. */
const SELF_CANONICAL_TIERS: readonly string[] = ['A'];

const ORIGINAL = 'https://ec.europa.eu/commission/presscorner/detail/en/mex_26_1768';

function article(tier: string, overrides: Record<string, unknown> = {}): Article {
  const base: Record<string, unknown> = {
    id: '01M115W57T56VK9HZ69EY80WAV',
    slug: 'a-slug-that-is-ours-abc123',
    tier,
    status: 'published',
    section: 'government',
    headline: 'A headline',
    published_at: '2026-08-28T10:04:38Z',
    validator: { passed: true, checks: [{ name: 'x', passed: true }] },
  };
  if (tier !== 'A') {
    base.syndicated = {
      source_id: 'ec_presscorner',
      original_url: ORIGINAL,
      attribution: 'Source: European Commission',
      snippet_is_verbatim: true,
    };
  }
  return { ...base, ...overrides } as unknown as Article;
}

describe('which tiers may claim to be the canonical copy', () => {
  it('is exactly the set that is declared, on both implementations', () => {
    const clientSelf = TIERS.filter((tier) => {
      const a = article(tier);
      return canonicalForArticle(a, 'a-slug-that-is-ours-abc123').startsWith(SITE_ORIGIN);
    });
    const serverSelf = TIERS.filter((tier) =>
      meta.canonicalFor(article(tier), 'a-slug-that-is-ours-abc123').startsWith(SITE_ORIGIN),
    );

    // An equality rather than a filter: a tier added to the vocabulary without
    // a decision about whose page it is turns this red, instead of being
    // absorbed by whichever branch happens to catch it.
    expect(
      clientSelf,
      'a tier claims our origin as its canonical when it should not, or has stopped claiming it',
    ).toEqual(SELF_CANONICAL_TIERS);
    expect(serverSelf, 'the served head disagrees with the client about which tiers are ours').toEqual(
      SELF_CANONICAL_TIERS,
    );
  });

  it('points a syndicated piece at the source it reproduces', () => {
    for (const tier of TIERS.filter((t) => !SELF_CANONICAL_TIERS.includes(t))) {
      expect(canonicalForArticle(article(tier), 'a-slug-that-is-ours-abc123')).toBe(ORIGINAL);
      expect(meta.canonicalFor(article(tier), 'a-slug-that-is-ours-abc123')).toBe(ORIGINAL);
    }
  });

  it('agrees between the served bytes and the client, for every tier', () => {
    // The client runs last, so a disagreement is silently won by whichever the
    // browser executes — which is the surface a search engine reads.
    for (const tier of TIERS) {
      const a = article(tier);
      expect(
        canonicalForArticle(a, 'a-slug-that-is-ours-abc123'),
        `${tier}: client and server disagree about the canonical`,
      ).toBe(meta.canonicalFor(a, 'a-slug-that-is-ours-abc123'));
    }
  });
});

describe('the predicate refuses anything it cannot resolve safely', () => {
  // `rel=canonical` resolves against the document, so a relative or
  // `javascript:` value would become a claim about one of OUR urls, or worse.
  // The negative cases matter more than the positive one here.
  const REFUSED = [
    undefined,
    null,
    '',
    '   ',
    '/article/not-ours',
    'article/not-ours',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example.com/x',
    42,
  ];

  it('takes an absolute http(s) url and nothing else', () => {
    for (const value of REFUSED) {
      const a = article('C', { syndicated: { original_url: value, attribution: 'x' } });
      expect(syndicatedOriginalUrl(a), `client accepted ${JSON.stringify(value)}`).toBeNull();
      expect(newsroom.syndicatedOriginal(a), `server accepted ${JSON.stringify(value)}`).toBeNull();
    }

    // CONTROL: the same shape with a real URL must be accepted, or the loop
    // above is satisfied by a predicate that returns null for everything.
    const good = article('C');
    expect(syndicatedOriginalUrl(good)).toBe(ORIGINAL);
    expect(newsroom.syndicatedOriginal(good)).toBe(ORIGINAL);
  });

  it('falls back to our own page when a piece is ours', () => {
    expect(canonicalForArticle(article('A'), 'a-slug-that-is-ours-abc123')).toBe(
      `${SITE_ORIGIN}/article/a-slug-that-is-ours-abc123`,
    );
    // And resolves against a supplied origin, so a preview claims itself.
    expect(canonicalForArticle(article('A'), 'a-slug-that-is-ours-abc123', 'http://localhost:4173')).toBe(
      'http://localhost:4173/article/a-slug-that-is-ours-abc123',
    );
  });
});

describe('the served head', () => {
  it('names the source as canonical but keeps og:url on our page', () => {
    const head = meta.buildHead(article('B'), 'a-slug-that-is-ours-abc123', 'ok');

    expect(head).toContain(`<link rel="canonical" href="${ORIGINAL}" />`);
    // og:url is the identity a social platform dedupes shares against, not an
    // indexing claim, so a share of our page must stay a share of our page.
    expect(head).toContain(
      `<meta property="og:url" content="${SITE_ORIGIN}/article/a-slug-that-is-ours-abc123" />`,
    );
    // robots keys on servable and is deliberately untouched: the page should
    // still be reachable and readable. Only the canonical claim was false.
    expect(head).toContain('<meta name="robots" content="index, follow" />');
  });

  it('still claims our own articles', () => {
    const head = meta.buildHead(article('A'), 'a-slug-that-is-ours-abc123', 'ok');
    expect(head).toContain(
      `<link rel="canonical" href="${SITE_ORIGIN}/article/a-slug-that-is-ours-abc123" />`,
    );
  });
});

describe('the sitemap and the canonical cannot contradict each other', () => {
  it('lists no article whose page names a foreign canonical', () => {
    // `<loc>` says "index this URL"; a foreign canonical on the page it names
    // says "no, index theirs". Publishing both is the contradiction this
    // filter exists to prevent, and the sitemap file already makes the same
    // argument for /indicator/:id and /correspondents/:id.
    const index = [article('A'), article('B'), article('C')];
    const ours = newsroom.ourArticles(index) as Article[];
    const listed = ours.filter((a) => newsroom.syndicatedOriginal(a) === null);

    // CONTROL: `ourArticles` alone still admits the tier B page, so the filter
    // below is doing work rather than agreeing with something upstream.
    expect(ours.map((a) => a.tier).sort()).toEqual(['A', 'B']);
    expect(listed.map((a) => a.tier)).toEqual(['A']);
  });
});
