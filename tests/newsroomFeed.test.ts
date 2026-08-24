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
