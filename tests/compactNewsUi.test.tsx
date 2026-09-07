import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { Header } from '../src/components/Header';
import NewsFeed from '../src/components/news/NewsFeed';
import { tierASummary } from './fixtures/articles';
import type { ArticleSummary } from '../src/news-types';

const stories = Array.from({ length: 15 }, (_, index) => tierASummary({
  id: `item-${index}`, slug: `item-${index}`, headline: `Estonia labour update ${index}`,
  section: 'labour', published_at: new Date(Date.UTC(2026, 8, 6, 0, -index)).toISOString(),
}));

function serve(articles: ArticleSummary[] = stories) {
  const request = vi.fn(async (input: RequestInfo | URL) => Response.json(
    String(input).endsWith('/index.json') ? { articles, count: articles.length } : [],
  ));
  vi.stubGlobal('fetch', request);
  return request;
}

async function mountNews(initial = '/') {
  await act(async () => {
    render(<MemoryRouter initialEntries={[initial]}><NewsFeed /></MemoryRouter>);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('compact news controls', () => {
  it('uses a labelled topic selector rather than a second row of section tabs', async () => {
    serve();
    await mountNews();
    expect(screen.getByRole('combobox', { name: 'News topic' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter by section' })).toBeNull();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Showing 12 of 15 matching articles');
    expect(screen.getByRole('status').className).toContain('sr-only');
  });

  it('filters immediately without a new network request and exposes clear and keyboard controls', async () => {
    const request = serve();
    await mountNews();
    const calls = request.mock.calls.length;
    fireEvent.keyDown(document.body, { key: '/' });
    const input = screen.getByRole('searchbox', { name: 'Search headlines and summaries' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'zz-absent' } });
    expect(screen.getByRole('heading', { name: 'No matching articles' })).toBeTruthy();
    expect(screen.getByRole('status').className).not.toContain('sr-only');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Estonia labour update 0')).toBeTruthy();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Estonia' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('value')).toBe('');
    expect(request).toHaveBeenCalledTimes(calls);
  });

  it('keeps search usable and focused while the article index arrives', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith('/index.json') ? pending : Promise.resolve(Response.json([]))));
    await mountNews();
    const input = screen.getByRole('searchbox');
    const skeleton = document.querySelector('.news-skeleton');
    expect(skeleton).not.toBeNull();
    input.focus();
    fireEvent.change(input, { target: { value: 'labour' } });
    await act(async () => { resolve(Response.json({ articles: stories })); });
    expect(screen.getByRole('searchbox')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('value')).toBe('labour');
    expect(screen.getByText('Estonia labour update 0')).toBeTruthy();
    expect(document.contains(skeleton)).toBe(false);
  });

  it('retries a failed index without discarding the query', async () => {
    let failing = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/index.json')) {
        if (failing) throw new Error('offline');
        return Response.json({ articles: stories });
      }
      return Response.json([]);
    }));
    await mountNews('/?q=labour');
    expect(screen.getByRole('heading', { name: 'The front page could not be loaded' })).toBeTruthy();
    failing = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry loading articles' })); });
    expect(screen.getByText('Estonia labour update 0')).toBeTruthy();
    expect(screen.getByRole('searchbox').getAttribute('value')).toBe('labour');
  });

  it('restores topic, query and expanded articles after reading an article and going back', async () => {
    serve();
    function Article() {
      const navigate = useNavigate();
      return <button onClick={() => navigate(-1)}>Back to results</button>;
    }
    await act(async () => {
      render(<MemoryRouter initialEntries={['/?q=Estonia&topic=labour&page=2']}>
        <Routes>
          <Route path="/" element={<NewsFeed />} />
          <Route path="/article/:slug" element={<Article />} />
        </Routes>
      </MemoryRouter>);
    });
    expect(screen.getByText('Estonia labour update 14')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Estonia labour update 14' })); });
    expect(screen.queryByRole('searchbox')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to results' })); });
    expect(screen.getByRole('searchbox').getAttribute('value')).toBe('Estonia');
    expect(screen.getByRole('combobox', { name: 'News topic' }).querySelector('option:checked')?.getAttribute('value')).toBe('labour');
    expect(screen.getByText('Estonia labour update 14')).toBeTruthy();
  });
});

describe('contextual header controls', () => {
  function mountHeader(path: string) {
    render(<ThemeProvider><CountryProvider><FilterProvider><MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter></FilterProvider></CountryProvider></ThemeProvider>);
  }

  it.each(['/', '/about/ai', '/api-docs', '/article/example'])('does not pretend chart controls filter %s', (path) => {
    mountHeader(path);
    expect(screen.queryByRole('group', { name: 'Date range filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Draw chart lines/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Market country' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Switch to .* theme/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Economy' }).getAttribute('href')).toBe('/data/economy');
  });

  it('keeps data controls on indicator pages', () => {
    mountHeader('/indicator/gdp');
    expect(screen.getByRole('group', { name: 'Date range filter' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Country' })).toBeTruthy();
  });

  it('opens secondary resources on demand and supports Escape and outside dismissal', () => {
    mountHeader('/');
    const summary = screen.getByText('About');
    const details = summary.closest('details')!;
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details.querySelector('a[href="/corrections"]')).not.toBeNull();
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    fireEvent.click(summary);
    fireEvent.pointerDown(document.body);
    expect(details.open).toBe(false);
  });
});
