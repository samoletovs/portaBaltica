/**
 * /follow — the page that answers "how do I keep up with this?".
 *
 * The site served 670 requests a day with one text link reading "RSS" and no
 * other path back. This page is the fix, and the two things it must not do are
 * what this suite is mostly about:
 *
 *   - promise a cadence the pipeline does not have. Scheduled runs frequently
 *     write nothing, so "daily analysis" would be false on the one page whose
 *     job is to set an expectation. The rate is therefore MEASURED from the
 *     published index, and the test proves that by changing the index and
 *     requiring the number to follow — a hardcoded figure passes the first
 *     case and fails the second.
 *
 *   - render a zero when it could not measure. "0 articles in the last 30 days"
 *     is a sentence about the newsroom; a failed fetch is a sentence about the
 *     network, and substituting one for the other tells a reader we stopped
 *     publishing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FollowPage from '../src/components/news/FollowPage';
import { ArticleView } from '../src/components/news/ArticleView';
import { tierAArticle, tierASummary, tierCArticle, tierCSummary } from './fixtures/articles';

// The chart embed pulls recharts through a lazy boundary. Nothing here is about
// charts, so it is stubbed to keep the render synchronous.
vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId }: { indicatorId: string }) => <div>{indicatorId}</div>,
}));

function stubIndex(articles: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated_at: '2026-08-28T06:00:00Z', count: articles.length, articles }),
    } as unknown as Response),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <FollowPage />
    </MemoryRouter>,
  );
}

/** `n` of our own articles, each `n` days before now, one per day. */
function recent(count: number) {
  return Array.from({ length: count }, (_, index) =>
    tierASummary({
      id: `id-${index}`,
      slug: `article-${index}`,
      headline: `Headline ${index}`,
      published_at: new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the feeds', () => {
  it('lists both feeds with the URL a reader has to paste', async () => {
    stubIndex([]);
    renderPage();

    const rss = await screen.findByText(`${window.location.origin}/rss.xml`);
    const json = screen.getByText(`${window.location.origin}/feed.json`);

    // Absolute, because a feed reader is not a browser and cannot resolve a
    // path against a page it never loaded.
    expect(rss.getAttribute('href')).toBe('/rss.xml');
    expect(json.getAttribute('href')).toBe('/feed.json');
  });

  it('names the format of each, so a reader knows what they are subscribing to', async () => {
    stubIndex([]);
    renderPage();

    expect(await screen.findByText('RSS 2.0')).toBeTruthy();
    expect(screen.getByText('JSON Feed 1.1')).toBeTruthy();
  });

  it('says the feeds carry our work and not other outlets’', async () => {
    stubIndex([]);
    renderPage();

    expect(await screen.findByText(/belongs in their feed/i)).toBeTruthy();
  });

  it('points at the weekly review as the low-frequency option', async () => {
    stubIndex([]);
    renderPage();

    const link = await screen.findByRole('link', { name: /latest weekly review/i });
    expect(link.getAttribute('href')).toBe('/weekly');
  });

  it('states plainly that there is no email list', async () => {
    // Not an omission. There is no managed identity on a Free-tier SWA and no
    // shared key on the storage account, so there is nowhere an address could
    // be stored — and a reader looking for a newsletter deserves an answer
    // rather than an absence.
    stubIndex([]);
    renderPage();

    expect(await screen.findByRole('heading', { name: /no email list/i })).toBeTruthy();
    expect(screen.getByText(/nothing to unsubscribe from/i)).toBeTruthy();
  });
});

describe('how often we publish', () => {
  /** The measured sentence, whitespace-normalised across its spans. */
  function cadenceText(): string {
    return (screen.getByText(/In the last 30 days/i).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('reports a rate measured from the index rather than written down', async () => {
    stubIndex(recent(3));
    const first = renderPage();

    await waitFor(() => expect(cadenceText()).toMatch(/we published 3 articles on 3 of those days/));
    first.unmount();

    // The same page, a different index. A hardcoded figure passes the case
    // above and fails here, which is the whole point of asserting twice.
    stubIndex(recent(7));
    renderPage();

    await waitFor(() => expect(cadenceText()).toMatch(/we published 7 articles on 7 of those days/));
  });

  it('counts our own work, not the link-outs to other outlets', async () => {
    stubIndex([...recent(2), tierCSummary({ published_at: new Date().toISOString() })]);
    renderPage();

    // Two of ours plus one of theirs is still two of ours, on two days.
    await waitFor(() => expect(cadenceText()).toMatch(/we published 2 articles on 2 of those days/));
  });

  it('ignores anything older than the window it names', async () => {
    stubIndex([
      ...recent(1),
      tierASummary({ id: 'old', slug: 'old', published_at: '2025-01-01T09:00:00Z' }),
    ]);
    renderPage();

    await waitFor(() => expect(cadenceText()).toMatch(/we published 1 article on 1 of those days/));
  });

  it('buckets days in Riga, not UTC', async () => {
    // Riga is UTC+3 in August. These two are the same UTC day and two different
    // Riga days, so a UTC implementation reports one publishing day where there
    // were two — a plausible figure, one out, that no reader could ever catch.
    // This is the trap AGENTS.md records against the traffic counter, arriving
    // in a second place.
    vi.setSystemTime(new Date('2026-08-22T09:00:00Z'));
    stubIndex([
      tierASummary({ id: 'a', slug: 'a', published_at: '2026-08-20T12:00:00Z' }), // 15:00 Riga, 20th
      tierASummary({ id: 'b', slug: 'b', published_at: '2026-08-20T21:30:00Z' }), // 00:30 Riga, 21st
    ]);

    renderPage();

    await waitFor(() => expect(cadenceText()).toMatch(/we published 2 articles on 2 of those days/));

    vi.useRealTimers();
  });

  it('shows nothing at all when it could not measure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderPage();

    // The rest of the page is still useful, so it must still render.
    expect(await screen.findByText(`${window.location.origin}/rss.xml`)).toBeTruthy();

    // And the measurement must be absent, not zero.
    await waitFor(() => expect(screen.queryByText(/In the last 30 days/i)).toBeNull());
    expect(screen.queryByText(/we published 0/i)).toBeNull();
  });
});

describe('the path back from an article', () => {
  /**
   * The highest-value placement on the site: a reader who has just finished a
   * piece is the one most likely to want another, and until this existed the
   * only follow affordance anywhere was the word "RSS" in the footer.
   */
  function renderArticle(article: Parameters<typeof ArticleView>[0]['article']) {
    return render(
      <MemoryRouter>
        <ArticleView article={article} />
      </MemoryRouter>,
    );
  }

  it('offers the feeds at the end of an ordinary article', () => {
    renderArticle(tierAArticle());

    const link = screen.getByRole('link', { name: /Follow by RSS or JSON Feed/i });
    expect(link.getAttribute('href')).toBe('/follow');
  });

  it('says we publish irregularly rather than implying a schedule', () => {
    renderArticle(tierAArticle());

    expect(screen.getByText(/which is not every day/i)).toBeTruthy();
  });

  it('sends a weekly review to the archive as well as to the feeds', () => {
    renderArticle(tierAArticle({ format: 'weekly_wrap' }));

    expect(screen.getByRole('link', { name: 'Earlier reviews' }).getAttribute('href')).toBe(
      '/weekly',
    );
    expect(screen.getByRole('link', { name: 'How to follow us' }).getAttribute('href')).toBe(
      '/follow',
    );
  });

  it('offers nothing of the sort on a link-out to another outlet', () => {
    // Tier C is somebody else's journalism shown as a card and nothing else.
    // A portaBaltica call to action under their headline would read as ours.
    renderArticle(tierCArticle());

    expect(screen.queryByRole('link', { name: /Follow by RSS/i })).toBeNull();
  });
});