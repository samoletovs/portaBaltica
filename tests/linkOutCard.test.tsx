import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeedItem } from '../src/components/news/NewsCard';
import { SECRET_PROSE, tierASummary, tierCSummary } from './fixtures/articles';

function renderItem(summary: Parameters<typeof FeedItem>[0]['summary']) {
  return render(
    <MemoryRouter>
      <FeedItem summary={summary} />
    </MemoryRouter>,
  );
}

/**
 * Tier C is the tier that can cost us a lawsuit or a deindexing, so it gets
 * the harshest tests: every assertion here describes something the card must
 * refuse to do, and each fixture carries the forbidden material so that a
 * renderer which stopped filtering would be caught rather than assumed safe.
 */
describe('Tier C link-out card', () => {
  it('shows the outlet’s own snippet, verbatim', () => {
    const summary = tierCSummary();

    renderItem(summary);

    expect(screen.getByText(summary.syndicated!.snippet!)).toBeTruthy();
  });

  it('never renders our own prose about the item', () => {
    // The fixture's dek is the sort of rewritten standfirst a careless
    // pipeline might attach. It must not reach the page.
    renderItem(tierCSummary());

    expect(screen.queryByText(SECRET_PROSE)).toBeNull();
  });

  it('never renders as one of our articles', () => {
    const summary = tierCSummary();

    const { container } = renderItem(summary);

    // No internal article link — a tier C item has no page of ours.
    expect(container.querySelector(`a[href="/article/${summary.slug}"]`)).toBeNull();
    expect(screen.queryByText(/AI correspondent/)).toBeNull();
    expect(screen.queryByText('Our analysis')).toBeNull();
  });

  it('attributes the outlet and links out in a new tab', () => {
    renderItem(tierCSummary());

    expect(screen.getAllByText('ERR News').length).toBeGreaterThan(0);

    const link = screen.getByRole('link', { name: /Estonia’s grid operator/ });
    expect(link.getAttribute('href')).toBe('https://news.err.ee/example-story');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('says plainly that the reader is leaving', () => {
    renderItem(tierCSummary());

    expect(screen.getByText(/this link leaves portaBaltica/i)).toBeTruthy();
  });

  it('is dropped entirely if the attribution or outbound link is missing', () => {
    const summary = tierCSummary({
      syndicated: { attribution: 'ERR News', original_url: '', snippet: 'anything' },
    });

    const { container } = renderItem(summary);

    // Better to show nothing than to show someone else's words unattributed.
    expect(container.textContent).toBe('');
  });
});

describe('Tier A feed card', () => {
  it('links to our article page and discloses the AI byline', () => {
    const summary = tierASummary();

    const { container } = renderItem(summary);

    expect(container.querySelector(`a[href="/article/${summary.slug}"]`)).not.toBeNull();
    expect(screen.getByText(/AI correspondent/)).toBeTruthy();
  });

  it('discloses even when the stored byline lost its disclosure', () => {
    const summary = tierASummary({
      persona: { id: 'nida', name: 'Nida', byline: 'Nida' },
    });

    renderItem(summary);

    expect(screen.getByText(/AI correspondent/)).toBeTruthy();
  });
});
