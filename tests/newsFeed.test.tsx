import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeed from '../src/components/news/NewsFeed';
import { ArticleCard } from '../src/components/news/NewsCard';
import { SECRET_PROSE, tierASummary, tierCSummary } from './fixtures/articles';

function stubIndex(articles: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated_at: '2026-08-24T06:20:00Z', count: articles.length, articles }),
    } as unknown as Response),
  );
}

function renderFeed() {
  return render(
    <MemoryRouter>
      <NewsFeed />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('News feed', () => {
  it('leads with our own reporting', async () => {
    const lead = tierASummary();
    stubIndex([lead, tierCSummary()]);

    renderFeed();

    await waitFor(() => expect(screen.getByText(lead.headline)).toBeTruthy());
    expect(screen.getByText('Our analysis')).toBeTruthy();
  });

  it('keeps third-party items in a separate rail and never as our prose', async () => {
    const external = tierCSummary();
    stubIndex([tierASummary(), external]);

    renderFeed();

    await waitFor(() => expect(screen.getByText(external.headline)).toBeTruthy());

    // The rail is labelled as somebody else's work...
    expect(screen.getByRole('heading', { name: 'Elsewhere in the Baltics' })).toBeTruthy();
    // ...the outlet's own snippet is shown verbatim...
    expect(screen.getByText(external.syndicated!.snippet!)).toBeTruthy();
    // ...and the rewritten standfirst on the fixture never reaches the page.
    expect(screen.queryByText(SECRET_PROSE)).toBeNull();
  });

  it('says so plainly rather than padding when there is nothing to report', async () => {
    stubIndex([]);

    renderFeed();

    await waitFor(() => expect(screen.getByText('Nothing to report yet today')).toBeTruthy());
    expect(screen.getByText(/never padded ones/i)).toBeTruthy();
  });

  it('degrades to a message rather than a blank page when the index cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderFeed();

    await waitFor(() =>
      expect(screen.getByText('The front page could not be loaded')).toBeTruthy(),
    );
  });

  it('points the reader at the dashboard the reporting is built on', async () => {
    stubIndex([tierASummary()]);

    const { container } = renderFeed();

    await waitFor(() => expect(screen.getByText('The dashboard is the evidence')).toBeTruthy());
    expect(container.querySelector('a[href="/data"]')).not.toBeNull();
  });
});


describe('FormatBadge — what kind of piece this is', () => {
  // The first weekly wrap was filed under `maritime`, bylined to the maritime
  // correspondent, and sat in the feed indistinguishable from the two genuine
  // maritime stories beside it -- one of which it cited. `section` was the
  // only field answering any identity question, and `section` answers the
  // subject.
  it('marks a wrap in the feed', () => {
    render(
      <MemoryRouter>
        <ArticleCard summary={tierASummary({ format: 'weekly_wrap' })} />
      </MemoryRouter>,
    );

    expect(screen.getByText('The week')).toBeTruthy();
  });

  it('says nothing about an ordinary report', () => {
    // Labelling the normal case teaches a reader to stop reading the label.
    render(
      <MemoryRouter>
        <ArticleCard summary={tierASummary()} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('The week')).toBeNull();
  });

  it('keeps the section badge beside it, not instead of it', () => {
    // Format sits alongside the subject. A `weekly` section would be a section
    // with no dashboard tile behind it, and the article-to-/data round trip
    // would point at nothing.
    render(
      <MemoryRouter>
        <ArticleCard summary={tierASummary({ format: 'weekly_wrap', section: 'maritime' })} />
      </MemoryRouter>,
    );

    expect(screen.getByText('The week')).toBeTruthy();
    expect(screen.getByText(/maritime/i)).toBeTruthy();
  });
});
