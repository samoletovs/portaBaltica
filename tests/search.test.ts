import { describe, expect, it } from 'vitest';
import { searchArticles } from '../src/news-api';
import { tierASummary, tierCSummary } from './fixtures/articles';

describe('searchArticles', () => {
  const articles = [
    tierASummary({
      slug: 'estonian-labour-costs',
      headline: 'Labour costs rise',
      dek: 'Businesses face higher hiring costs.',
      section: 'labour',
      countries: ['EE'],
      published_at: '2025-01-15T09:30:00Z',
    }),
    tierASummary({
      slug: 'latvian-energy-prices',
      headline: 'Energy prices in Latvia',
      section: 'energy',
      countries: ['LV'],
      published_at: '2026-03-02T09:30:00Z',
    }),
    tierCSummary({
      slug: 'other-outlet-story',
      headline: 'An external report',
      section: 'labour',
      published_at: '2025-01-15T09:30:00Z',
    }),
  ];

  it('matches all query words across headline and summary, ignoring case', () => {
    expect(searchArticles(articles, '  ESTONIA hiring ').map(({ slug }) => slug))
      .toEqual(['estonian-labour-costs']);
  });

  it('matches topic and country metadata by code or country name', () => {
    expect(searchArticles(articles, 'labour Estonia').map(({ slug }) => slug))
      .toEqual(['estonian-labour-costs']);
  });

  it('matches ISO publication dates, including partial dates', () => {
    expect(searchArticles(articles, '2025-01').map(({ slug }) => slug))
      .toEqual(['estonian-labour-costs', 'other-outlet-story']);
  });

  it('matches a body-only term in indexed text', () => {
    const article = tierASummary({
      slug: 'body-only-finding',
      headline: 'A separate headline',
      dek: '',
      searchable_text: 'The distinctive body-only finding names a transmission bottleneck.',
    });

    expect(searchArticles([article], 'transmission bottleneck').map(({ slug }) => slug))
      .toEqual(['body-only-finding']);
  });

  it('never searches Tier C snippets, URLs, or an accidental indexed-text field', () => {
    const external = tierCSummary({
      searchable_text: 'restricted-body-term',
      syndicated: {
        attribution: 'ERR News',
        original_url: 'https://news.err.ee/url-only-term',
        snippet: 'snippet-only-term',
      },
    });

    for (const term of ['restricted-body-term', 'url-only-term', 'snippet-only-term']) {
      expect(searchArticles([external], term)).toEqual([]);
    }
  });

  it('returns all provided articles for an empty query', () => {
    expect(searchArticles(articles, '  ')).toEqual(articles);
  });
});
