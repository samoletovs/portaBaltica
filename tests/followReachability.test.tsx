/**
 * Can a reader who has never seen this site find a way to follow it?
 *
 * WHAT WAS MEASURED, AND WHY THESE ASSERTIONS
 * -------------------------------------------
 * BFS over visible internal links in real Chromium against the live site,
 * `2026-08-28T12:25:08Z`, before any of this existed. Depth to `/follow`:
 *
 *     from                     /follow   /weekly   /feed.json   /rss.xml
 *     front page                 2         3          3            1
 *     an article                 1         2          2            1
 *     the dashboard /data        3         —          —            2
 *     /data/economy              3         —          —            2
 *     a correspondent            2         3          3            1
 *
 * Every one of those paths ran through `/article/*`. There was no link to
 * `/follow` from the front page, from the footer, or from anywhere in the
 * site's standing chrome — so the whole affordance hung off a single sentence
 * at the end of an article, and a reader who did not open one never saw it.
 * Meanwhile `/rss.xml` was one click from every newsroom page, so the older and
 * less capable feed was the discoverable one.
 *
 * These tests pin the two structural facts that fixed it. They are deliberately
 * about the site's CHROME rather than about any one page: an affordance that
 * lives only on a leaf page is one deletion away from being unreachable again,
 * and that is precisely how the previous state arose.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NewsroomLayout } from '../src/components/news/NewsroomLayout';
import NewsFeed from '../src/components/news/NewsFeed';
import { tierASummary } from './fixtures/articles';

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

afterEach(() => vi.unstubAllGlobals());

describe('the standing chrome', () => {
  function renderChrome() {
    return render(
      <MemoryRouter>
        <NewsroomLayout />
      </MemoryRouter>,
    );
  }

  it('carries a link to /follow on every newsroom page', () => {
    // The footer is on the front page, every article, every correspondent, the
    // corrections log and the AI policy. One click from all of them, which is
    // what stops the affordance depending on a reader opening an article.
    const { container } = renderChrome();
    const footer = container.querySelector('footer');

    expect(footer).toBeTruthy();
    const link = within(footer as HTMLElement).getByRole('link', { name: 'Follow' });
    expect(link.getAttribute('href')).toBe('/follow');
  });

  it('no longer sends a reader straight at the raw XML', () => {
    // `/rss.xml` in a browser renders as a wall of markup or downloads a file,
    // depending on the browser. It is the right destination for a feed reader
    // and the wrong one for a person, and the head's `<link rel="alternate">`
    // is what serves the feed reader — no visible anchor is needed for that.
    const { container } = renderChrome();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).not.toContain('/rss.xml');
    expect(hrefs).toContain('/follow');
  });

  it('keeps the section nav at the four items it fits', () => {
    // Measured against production at 2026-08-28T12:2xZ, this nav ALREADY
    // scrolls sideways on a phone with four items: scrollWidth 371 against
    // clientWidth 288 at 320px, and 371 against 343 at 375px. At 768px it is
    // exactly 720 of 720. A fifth item would therefore push "How we use AI"
    // further out of reach in order to make one more thing easier to find,
    // which is a net loss — so the follow affordance went in the footer.
    //
    // This is not a rule against ever adding a nav item. It is a marker that
    // the row is at its limit, so the next addition has to remove something.
    const { container } = renderChrome();
    const nav = container.querySelector('nav[aria-label="Sections"]');

    expect(nav).toBeTruthy();
    expect([...(nav as HTMLElement).querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Latest',
      'Newsroom',
      'Corrections',
      'How we use AI',
    ]);
  });
});

describe('the front page', () => {
  function renderFeed() {
    return render(
      <MemoryRouter>
        <NewsFeed />
      </MemoryRouter>,
    );
  }

  it('offers a way to follow without opening an article first', async () => {
    stubIndex([tierASummary()]);
    renderFeed();

    const link = await screen.findByRole('link', {
      name: /RSS, JSON Feed and the weekly review/i,
    });
    expect(link.getAttribute('href')).toBe('/follow');
  });

  it('says how we publish rather than promising a schedule', async () => {
    stubIndex([tierASummary()]);
    renderFeed();

    // The claim, not the wording: some days carry nothing. A reader who hears
    // nothing for a fortnight should be able to tell a quiet fortnight from a
    // dead site, and this is the sentence that lets them.
    expect(await screen.findByText(/some carry none/i)).toBeTruthy();
  });

  it('offers it on a quiet day too, which is when it matters most', async () => {
    // "We publish only when the data warrants it" is the exact moment a reader
    // needs to know how they will hear about the day we do. Before this, the
    // empty state offered the dashboard and nothing else.
    stubIndex([]);
    renderFeed();

    await waitFor(() => expect(screen.getByText('Nothing to report yet today')).toBeTruthy());
    const link = screen.getByRole('link', { name: /Get the next one by RSS or JSON Feed/i });
    expect(link.getAttribute('href')).toBe('/follow');
  });

  it('offers it when the index could not be read, which is not a quiet day', async () => {
    // The control for the test above: it proves the empty-state assertion is
    // about the empty state rather than about whatever the page renders by
    // default. These are different messages and both must carry the way out.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderFeed();

    await waitFor(() =>
      expect(screen.getByText('The front page could not be loaded')).toBeTruthy(),
    );
    expect(screen.queryByText('Nothing to report yet today')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Get the next one by RSS or JSON Feed/i })
        .getAttribute('href'),
    ).toBe('/follow');
  });
});
