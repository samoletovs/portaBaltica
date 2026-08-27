import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const newsroom = require('../api/shared/newsroom.js');

/**
 * Regression tests for the feed endpoints.
 *
 * On 2026-08-24 /rss.xml and /sitemap.xml served an empty but valid HTTP 200
 * for hours while three articles were published and live. Two faults combined:
 * the base URL defaulted to a same-origin path the Static Web App does not
 * serve, and a missing index was treated as "no news" rather than as an error.
 * Each test below fails if either is reintroduced.
 */

describe('feed base URL', () => {
  it('never defaults to a same-origin path the SWA does not serve', () => {
    // /articles/* is 404 on the Static Web App; the articles are in blob
    // storage. Defaulting there produced a feed that was empty and green.
    expect(newsroom.ARTICLES_BASE_URL).not.toMatch(/portabaltica\.naurolabs\.com\/articles/);
    expect(newsroom.ARTICLES_BASE_URL).toMatch(/^https:\/\//);
  });

  it('points at a location that actually holds the index', () => {
    expect(newsroom.ARTICLES_BASE_URL).toMatch(/blob\.core\.windows\.net|\/articles$/);
  });
});

describe('parseIndex', () => {
  it('returns the articles from a well-formed index', () => {
    const articles = newsroom.parseIndex({ articles: [{ slug: 'a', tier: 'A' }] }, 'x');

    expect(articles).toHaveLength(1);
  });

  it('treats an index that lists nothing as a quiet day, not an error', () => {
    // The newsroom publishes only when the data warrants it. An empty feed is
    // a legitimate state and must stay a 200.
    expect(newsroom.parseIndex({ articles: [] }, 'x')).toEqual([]);
  });

  it('throws when the index is missing rather than serving an empty feed', () => {
    // This is the bug: a 404 became [], which became a valid empty feed, which
    // nothing flagged. It must be loud.
    expect(() => newsroom.parseIndex(null, 'https://example.com/index.json')).toThrow(
      /not found/i,
    );
  });

  it('throws when the index is malformed', () => {
    expect(() => newsroom.parseIndex({ nope: true }, 'x')).toThrow(/malformed/i);
    expect(() => newsroom.parseIndex('a string', 'x')).toThrow(/malformed/i);
  });
});

describe('ourArticles', () => {
  it('carries our own tiers only', () => {
    const items = newsroom.ourArticles([
      { tier: 'A', slug: 'ours' },
      { tier: 'B', slug: 'official' },
      { tier: 'C', slug: 'theirs' },
    ]);

    // Tier C is somebody else's journalism; syndicating their snippet through
    // our feed would be reuse we have no right to.
    expect(items.map((a: { slug: string }) => a.slug)).toEqual(['ours', 'official']);
  });

  it('drops entries with no slug, which would build a broken URL', () => {
    expect(newsroom.ourArticles([{ tier: 'A' }])).toHaveLength(0);
  });
});

describe('escapeXml', () => {
  it('escapes everything that would break a feed document', () => {
    expect(newsroom.escapeXml('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });

  it('renders a headline containing markup as text, not as elements', () => {
    // Feed items are untrusted input everywhere else in this system; they are
    // untrusted here too.
    expect(newsroom.escapeXml('<item><title>hijack</title>')).not.toContain('<title>');
  });

  it('handles null and undefined without emitting "null"', () => {
    expect(newsroom.escapeXml(null)).toBe('');
    expect(newsroom.escapeXml(undefined)).toBe('');
  });
});

describe('a withdrawn article never reaches the feed', () => {
  /**
   * Five articles were retracted the morning this was written, and the feeds
   * cleaned themselves because `drop_from_index` removes a retracted entry
   * from `index.json` and both RSS and the sitemap read that pruned index.
   *
   * That is one lock on the door. If `write_published` succeeds and
   * `drop_from_index` does not — a partial write, a transient blob error — the
   * article stays retracted in storage and keeps appearing in RSS. A feed
   * reader does not come back to see the correction, so it is the single
   * surface where a withdrawn claim goes on circulating after we have publicly
   * taken it back.
   *
   * The guard is deliberately not `status !== 'retracted'`. Index entries
   * carry no `status` at all — verified against the live index, nought of
   * seventy — so that comparison is true for every article that has ever
   * existed, and it could never fire. It would read as protection and be
   * inert.
   */
  it('drops a retracted article even when the index still lists it', () => {
    const kept = newsroom.ourArticles([
      { tier: 'A', slug: 'live-one', status: 'published' },
      { tier: 'A', slug: 'withdrawn', status: 'retracted' },
    ]);

    expect(kept.map((a: { slug: string }) => a.slug)).toEqual(['live-one']);
  });

  it('drops every state that is not a live page, not only retraction', () => {
    // The schema's statuses are draft, pending_approval, published, rejected,
    // corrected and retracted. A guard written only against retraction would
    // syndicate a rejected or half-finished article just as happily.
    const kept = newsroom.ourArticles([
      { tier: 'A', slug: 'draft', status: 'draft' },
      { tier: 'A', slug: 'awaiting', status: 'pending_approval' },
      { tier: 'A', slug: 'refused', status: 'rejected' },
      { tier: 'A', slug: 'withdrawn', status: 'retracted' },
    ]);

    expect(kept).toEqual([]);
  });

  it('keeps a corrected article, which is the version a reader should see', () => {
    // `corrected` is reader-facing in the pipeline. Withholding it would
    // suppress the amended article and leave only the record of the error.
    const kept = newsroom.ourArticles([{ tier: 'A', slug: 'amended', status: 'corrected' }]);
    expect(kept.map((a: { slug: string }) => a.slug)).toEqual(['amended']);
  });

  it('still serves the live index, which carries no status field at all', () => {
    // The real shape today: tier and slug, no status. A fail-closed rule on
    // `status === "published"` would drop all twenty tier A and B articles and
    // serve an empty feed, so absence cannot be treated as disqualifying.
    const asPublished = [
      { tier: 'A', slug: 'one', headline: 'One' },
      { tier: 'B', slug: 'two', headline: 'Two' },
      { tier: 'C', slug: 'three', headline: 'Link out' },
    ];

    expect(newsroom.ourArticles(asPublished).map((a: { slug: string }) => a.slug)).toEqual(['one', 'two']);
  });

  it('is a guard that can actually fire, unlike a bare retracted check', () => {
    // Guarding the guard. A `status !== 'retracted'` rule passes every entry
    // in the live index, so this asserts the rule discriminates on a real
    // status rather than being satisfied by its absence.
    const naive = (a: { status?: string }) => a.status !== 'retracted';
    const rejected = { tier: 'A', slug: 'refused', status: 'rejected' };

    expect(naive(rejected), 'the bare check would syndicate a rejected article').toBe(true);
    expect(newsroom.ourArticles([rejected])).toEqual([]);
  });
});
