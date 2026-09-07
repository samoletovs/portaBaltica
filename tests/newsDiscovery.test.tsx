import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeed from '../src/components/news/NewsFeed';
import { tierASummary, tierCSummary } from './fixtures/articles';
import type { ArticleSummary } from '../src/news-types';

async function renderFeed(articles: ArticleSummary[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    generated_at: '2026-09-05T06:00:00Z',
    count: articles.length,
    articles,
  }), { status: 200 })));
  await act(async () => {
    render(<MemoryRouter><NewsFeed /></MemoryRouter>);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('finding useful published reporting', () => {
  it('keeps every indexed article reachable without rendering the entire archive at once', async () => {
    const articles = Array.from({ length: 27 }, (_, index) => tierASummary({
      id: `story-${index}`, slug: `story-${index}`, headline: `Business report ${index}`,
      published_at: new Date(Date.UTC(2026, 8, 5, 0, -index)).toISOString(),
    }));
    await renderFeed(articles);
    expect(screen.getByText('Business report 0')).toBeTruthy();
    expect(screen.queryByText('Business report 12')).toBeNull();
    expect(screen.getByText('Showing 12 of 27 matching articles')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more articles' }));
    expect(screen.getByText('Business report 23')).toBeTruthy();
    expect(screen.queryByText('Business report 24')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more articles' }));
    for (const article of articles) expect(screen.getByText(article.headline)).toBeTruthy();
    expect(screen.getByText('Showing 27 of 27 matching articles')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more articles' })).toBeNull();
  });

  it('searches beyond the visible page and combines headline and summary terms', async () => {
    const recent = Array.from({ length: 15 }, (_, index) => tierASummary({
      id: `recent-${index}`, slug: `recent-${index}`, headline: `New report ${index}`, dek: '',
    }));
    await renderFeed([...recent, tierASummary({
      id: 'older', slug: 'older', headline: 'Hiring in Estonia', dek: 'Labour costs for business planning.',
      published_at: '2025-01-01T00:00:00Z',
    })]);
    expect(screen.queryByText('Hiring in Estonia')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search headlines and summaries'), { target: { value: '  ESTONIA costs ' } });
    expect(screen.getByText('Hiring in Estonia')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 1 matching articles')).toBeTruthy();
  });

  it('combines section and text filters and offers recovery from no matches', async () => {
    await renderFeed([
      tierASummary({ id: 'labour', slug: 'labour', section: 'labour', headline: 'Estonia hiring update' }),
      tierASummary({ id: 'economy', slug: 'economy', section: 'economy', headline: 'Latvia inflation update' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Economy' }));
    fireEvent.change(screen.getByLabelText('Search headlines and summaries'), { target: { value: 'hiring' } });
    expect(screen.getByRole('heading', { name: 'No matching articles' })).toBeTruthy();
    expect(screen.queryByText('Nothing to report yet today')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByText('Estonia hiring update')).toBeTruthy();
    expect(screen.getByText('Latvia inflation update')).toBeTruthy();
  });

  it('keeps third-party reporting separate and provides a visible route to the pilot', async () => {
    await renderFeed([tierASummary(), tierCSummary()]);
    fireEvent.change(screen.getByLabelText('Search headlines and summaries'), { target: { value: 'no-such-report' } });
    expect(screen.getByRole('heading', { name: 'Elsewhere in the Baltics' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Help shape our business briefing pilot/ }).getAttribute('href')).toBe('/briefings');
  });

  it('keeps the compact search named and its reporting scope accessible', async () => {
    await renderFeed([tierASummary()]);
    const search = screen.getByRole('searchbox', { name: 'Search headlines and summaries' });
    expect(search.getAttribute('placeholder')).toBe('Search our reporting');
    expect(document.getElementById(search.getAttribute('aria-describedby')!)?.textContent)
      .toContain('not article bodies or other outlets');
    expect(document.getElementById(search.getAttribute('aria-controls')!)).not.toBeNull();
  });

  it('clears text without clearing the selected topic and returns focus to search', async () => {
    await renderFeed([
      tierASummary({ id: 'wages', slug: 'wages', section: 'economy', headline: 'Wages rising' }),
      tierASummary({ id: 'prices', slug: 'prices', section: 'economy', headline: 'Prices falling' }),
      tierASummary({ id: 'energy', slug: 'energy', section: 'energy', headline: 'Power update' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Economy' }));
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'wages' } });
    expect(screen.queryByText('Prices falling')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Wages rising')).toBeTruthy();
    expect(screen.getByText('Prices falling')).toBeTruthy();
    expect(screen.queryByText('Power update')).toBeNull();
    expect(screen.getByRole('button', { name: 'Economy' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});
