/**
 * /weekly — the weekly review, and the honest empty state.
 *
 * WHY THE EMPTY STATE IS THE MAIN SUBJECT HERE
 * --------------------------------------------
 * It is the live state. The newsroom has written a weekly wrap on a timer for
 * as long as it has had a timer, and exactly one has ever been published — which
 * was retracted, for filing a cross-beat digest under `maritime` with a maritime
 * byline. So `format` is empty on all 78 published articles today and this page
 * renders its absent case in production from the moment it ships.
 *
 * That makes the failure this suite guards against a real one rather than a
 * hypothetical: a page that fills the hole with a placeholder card, or with the
 * previous week's wrap under a heading implying it is current, would be
 * inventing an artefact we do not have. And the three states have to stay
 * apart — "we do not know yet", "we could not find out" and "there is none" are
 * three different sentences, and collapsing the middle one into the last is how
 * a network error becomes a claim that we stopped publishing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WeeklyPage from '../src/components/news/WeeklyPage';
import { weeklyWraps } from '../src/news-api';
import type { ArticleSummary } from '../src/news-types';
import { tierASummary } from './fixtures/articles';

function wrap(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return tierASummary({
    id: 'wrap-1',
    slug: 'the-week-in-baltic-data-2026-08-21',
    headline: 'The week: ports, prices and a three-month sentiment slide',
    dek: 'What we reported between 21 and 27 August, and what it added up to.',
    format: 'weekly_wrap',
    published_at: '2026-08-23T15:00:00Z',
    ...overrides,
  });
}

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
      <WeeklyPage />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('selecting the reviews', () => {
  it('selects on the declared format, not on the section or the headline', () => {
    // The first wrap was filed under `maritime` with a maritime byline and was
    // indistinguishable from the two genuine maritime stories beside it. That
    // is precisely why `format` exists as a real field rather than something
    // inferred, and why this reads it.
    const maritimeReport = tierASummary({
      id: 'ordinary',
      slug: 'latvian-ports-set-a-record',
      headline: 'The week Latvian ports set a record',
      section: 'maritime',
    });

    expect(weeklyWraps([maritimeReport, wrap()]).map((a) => a.slug)).toEqual([wrap().slug]);
  });

  it('orders newest first', () => {
    const older = wrap({ id: 'w0', slug: 'week-one', published_at: '2026-08-16T15:00:00Z' });
    const newer = wrap({ id: 'w1', slug: 'week-two', published_at: '2026-08-23T15:00:00Z' });

    expect(weeklyWraps([older, newer]).map((a) => a.slug)).toEqual(['week-two', 'week-one']);
  });

  it('returns nothing when there is nothing, rather than the closest thing', () => {
    expect(weeklyWraps([tierASummary()])).toEqual([]);
  });

  it('leaves the caller’s array alone', () => {
    const given = [wrap({ id: 'a', slug: 'a', published_at: '2026-08-16T15:00:00Z' }),
                   wrap({ id: 'b', slug: 'b', published_at: '2026-08-23T15:00:00Z' })];
    const before = given.map((a) => a.slug);

    weeklyWraps(given);

    expect(given.map((a) => a.slug)).toEqual(before);
  });
});

describe('when there is a review', () => {
  it('leads with it and links to the article', async () => {
    stubIndex([wrap(), tierASummary()]);
    renderPage();

    const headline = await screen.findByRole('link', { name: wrap().headline });
    expect(headline.getAttribute('href')).toBe(`/article/${wrap().slug}`);
    expect(screen.getByText('The latest')).toBeTruthy();
  });

  it('does not also claim there is none', async () => {
    stubIndex([wrap()]);
    renderPage();

    await screen.findByRole('link', { name: wrap().headline });
    expect(screen.queryByText(/No weekly review is published/i)).toBeNull();
  });

  it('lists earlier reviews below the latest, and only earlier ones', async () => {
    const older = wrap({
      id: 'w0',
      slug: 'week-one',
      headline: 'The week: an earlier review',
      published_at: '2026-08-16T15:00:00Z',
    });
    stubIndex([wrap(), older]);
    renderPage();

    await screen.findByRole('link', { name: wrap().headline });
    expect(screen.getByRole('heading', { name: 'Earlier reviews' })).toBeTruthy();
    expect(screen.getByRole('link', { name: older.headline })).toBeTruthy();
  });

  it('shows no archive heading when there is only ever been one', async () => {
    stubIndex([wrap()]);
    renderPage();

    await screen.findByRole('link', { name: wrap().headline });
    expect(screen.queryByRole('heading', { name: 'Earlier reviews' })).toBeNull();
  });
});

describe('when there is none — today’s live state', () => {
  it('says so, and renders no article at all', async () => {
    // 78 published articles, none of them a wrap. This is what production shows.
    stubIndex([tierASummary()]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No weekly review is published at the moment/i)).toBeTruthy(),
    );

    // No placeholder, no stale wrap, no empty card dressed as content: nothing
    // on the page links to an article.
    const articleLinks = screen
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('/article/'));
    expect(articleLinks).toEqual([]);
  });

  it('says why a week can be empty, without naming a case that will go stale', async () => {
    stubIndex([]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/did not produce enough to review/i)).toBeTruthy(),
    );
    expect(screen.getByRole('link', { name: /corrections log/i })).toBeTruthy();
  });

  it('drops a withdrawn review rather than showing it as current', async () => {
    // `drop_from_index` removes a retracted article, and `isRenderableSummary`
    // is the second lock in case that half-fails. A wrap we have publicly taken
    // back must not be what a reader finds under "The latest".
    stubIndex([wrap({ status: 'retracted' })]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No weekly review is published at the moment/i)).toBeTruthy(),
    );
    expect(screen.queryByText(wrap().headline)).toBeNull();
  });
});

describe('when we could not find out', () => {
  it('says the archive failed to load, and never that there is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/The archive could not be loaded/i)).toBeTruthy(),
    );

    // The distinction that matters: a network failure is not evidence about
    // what we have published.
    expect(screen.queryByText(/No weekly review is published/i)).toBeNull();
  });

  it('is a different state from having none, and the page proves it', async () => {
    // The control. Without this, the assertion above would pass on a page that
    // renders neither message — an instrument that cannot see either outcome.
    stubIndex([]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No weekly review is published at the moment/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/The archive could not be loaded/i)).toBeNull();
  });
});

describe('the way back out', () => {
  it('points at the feeds for a reader who wants everything', async () => {
    stubIndex([]);
    renderPage();

    const link = await screen.findByRole('link', { name: /Our feeds are here/i });
    expect(link.getAttribute('href')).toBe('/follow');
  });

  it('explains what the review is before saying whether there is one', async () => {
    stubIndex([]);
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'The weekly review' })).toBeTruthy();
    expect(screen.getByText(/written on Sundays/i)).toBeTruthy();
  });
});
