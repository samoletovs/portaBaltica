import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArticleView } from '../src/components/news/ArticleView';
import { tierAArticle } from './fixtures/articles';

// See tests/articleView.test.tsx for the rationale: the chart embed pulls
// recharts through a lazy boundary that is irrelevant to what is under test
// here, so it is stubbed to keep these tests fast and synchronous.
vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId }: { indicatorId: string }) => (
    <div data-testid="chart-embed">{indicatorId}</div>
  ),
}));

function renderArticle(article: Parameters<typeof ArticleView>[0]['article']) {
  return render(
    <MemoryRouter>
      <ArticleView article={article} />
    </MemoryRouter>,
  );
}

// `ArticleStatus` is `'draft' | 'pending_approval' | 'published' | 'rejected'
// | 'corrected' | 'retracted'` (src/news-types.ts). `ArticleView` gates every
// one of them through `isServable`, which only admits `'published'` with a
// passing validator verdict — except `retracted`, checked first and given its
// own distinct rendering. These tests walk all six so a status that starts
// rendering fully (or stops) is caught here rather than downstream.
describe('ArticleView — every article status', () => {
  it('refuses a draft: nothing about it reaches the reader', () => {
    const article = tierAArticle({ status: 'draft' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.queryByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not passed the checks we run before publishing/i)).toBeTruthy();
  });

  it('refuses an article awaiting approval', () => {
    const article = tierAArticle({ status: 'pending_approval' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not passed the checks we run before publishing/i)).toBeTruthy();
  });

  it('renders a published article with a passing verdict in full', () => {
    const article = tierAArticle({ status: 'published' });

    renderArticle(article);

    expect(screen.getByRole('heading', { level: 1, name: article.headline })).toBeTruthy();
    expect(screen.getByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a rejected article', () => {
    const article = tierAArticle({ status: 'rejected' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not passed the checks we run before publishing/i)).toBeTruthy();
  });

  // `'corrected'` is a declared member of `ArticleStatus` and is read
  // elsewhere (src/news-api.ts's `SHOWABLE_STATUSES`, the structured-data
  // `creativeWorkStatus`), but `isServable` admits only `'published'`. The
  // generation pipeline does not currently emit `status: 'corrected'` — a
  // corrected article stays `'published'` and carries a populated
  // `corrections` array instead (see the next test). So this status, taken on
  // its own, refuses like any other non-published one; a naive reader of the
  // name might expect a distinct "corrected" view, and this pins that it does
  // not have one.
  it('refuses an article whose status is literally "corrected"', () => {
    const article = tierAArticle({ status: 'corrected' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not passed the checks we run before publishing/i)).toBeTruthy();
  });

  // The real shape a correction takes: status stays `'published'` and a
  // `corrections` entry is attached, which the article view surfaces as a
  // dedicated "Corrected" section above the body rather than refusing it.
  it('renders a published article carrying a correction, with the correction shown', () => {
    const article = tierAArticle({
      status: 'published',
      corrections: [
        {
          corrected_at: '2026-08-27T09:00:00Z',
          description: 'The comparison period was misstated; it has been fixed.',
        },
      ],
    });

    renderArticle(article);

    expect(screen.getByRole('heading', { level: 1, name: article.headline })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Corrected' })).toBeTruthy();
    expect(screen.getByText(/The comparison period was misstated/)).toBeTruthy();
    expect(screen.getByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeTruthy();
  });

  it('withdraws a retracted article, keeping the body but not the byline', () => {
    const article = tierAArticle({ status: 'retracted' });

    renderArticle(article);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/We have withdrawn this article/)).toBeTruthy();
    // The evidence is kept, marked, below the notice.
    expect(screen.getByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeTruthy();
    expect(screen.queryByText(/AI correspondent/)).toBeNull();
    expect(screen.queryByTestId('chart-embed')).toBeNull();
    // A retracted article did not fail the checks; it must not claim it did.
    expect(screen.queryByText(/not passed the checks we run before publishing/i)).toBeNull();
  });
});
