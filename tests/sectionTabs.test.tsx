/**
 * The section tabs describe our journalism, not other people's.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `syndicate.py` files every link-out under a hardcoded `section = "government"`,
 * so in the live index all 154 tier C cards were "government" and none of the 7
 * originals were. The feed built its tab list from *every* article and applied
 * the chosen section to both columns, so a reader clicking "Government" got
 * "Nothing to report yet today" in the main column beside a rail full of items.
 *
 * A tab that always leads to an empty page is worse than a missing tab: it reads
 * as a broken site, and it is caused entirely by us asserting a classification
 * over articles we did not write.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeed from '../src/components/news/NewsFeed';
import { tierASummary, tierCSummary } from './fixtures/articles';

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

/** The live shape: originals in labour/energy, every link-out in "government". */
function liveShape() {
  return [
    { ...tierASummary(), id: 'a1', slug: 'a1', section: 'labour', headline: 'Latvian pay rises' },
    { ...tierASummary(), id: 'a2', slug: 'a2', section: 'energy', headline: 'Power spread widens' },
    ...Array.from({ length: 12 }, (_, n) => ({
      ...tierCSummary(),
      id: `c${n}`,
      slug: `c${n}`,
      section: 'government',
      headline: `Someone else reported this ${n}`,
    })),
  ];
}

afterEach(() => vi.unstubAllGlobals());

describe('Section tabs', () => {
  it('offers no tab for a section only other outlets occupy', async () => {
    stubIndex(liveShape());

    renderFeed();

    await waitFor(() => expect(screen.getByText('Latvian pay rises')).toBeTruthy());

    const tabs = screen.getByRole('group', { name: 'Filter by section' });
    expect(tabs.textContent).toContain('Labour');
    expect(tabs.textContent).toContain('Energy');
    expect(tabs.textContent).not.toContain('Government');
  });

  it('never offers a tab that leads to an empty front page', async () => {
    stubIndex(liveShape());

    renderFeed();
    await waitFor(() => expect(screen.getByText('Latvian pay rises')).toBeTruthy());

    const tabs = screen.getByRole('group', { name: 'Filter by section' });
    const buttons = [...tabs.querySelectorAll('button')].filter(
      (b) => b.textContent !== 'Everything',
    );
    expect(buttons.length).toBeGreaterThan(0);

    for (const button of buttons) {
      fireEvent.click(button);
      await waitFor(() =>
        expect(screen.queryByText('Nothing to report yet today')).toBeNull(),
      );
    }
  });

  it('keeps the elsewhere rail available while a section is selected', async () => {
    // The rail is a standing pointer to other people's work. Emptying it on a
    // section filter would be filtering by a classification we invented for
    // articles we did not write.
    stubIndex(liveShape());

    renderFeed();
    await waitFor(() => expect(screen.getByText('Latvian pay rises')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Energy' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Elsewhere in the Baltics' })).toBeTruthy(),
    );
    expect(screen.getByText('Power spread widens')).toBeTruthy();
    expect(screen.queryByText('Latvian pay rises')).toBeNull();
  });

  it('hides the tab strip when all our work sits in one section', async () => {
    stubIndex([
      { ...tierASummary(), id: 'a1', slug: 'a1', section: 'labour', headline: 'Only story' },
      ...Array.from({ length: 5 }, (_, n) => ({
        ...tierCSummary(),
        id: `c${n}`,
        slug: `c${n}`,
        section: 'government',
      })),
    ]);

    renderFeed();
    await waitFor(() => expect(screen.getByText('Only story')).toBeTruthy());

    expect(screen.queryByRole('group', { name: 'Filter by section' })).toBeNull();
  });
});
