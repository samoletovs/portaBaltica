// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { revealAllFeedArticles } from './liveFeed';
import type { FeedDriver } from './liveFeed';

function feed(total: number, initial = 12) {
  let visible = Math.min(initial, total);
  const click = vi.fn(async () => { visible = Math.min(visible + 12, total); });
  const isVisible = vi.fn(async () => visible < total);
  const page: FeedDriver = {
    locator: (selector) => {
      expect(['#news-results article', '[role="status"]:has-text("matching articles")']).toContain(selector);
      return {
        count: async () => selector === '#news-results article' ? visible : 1,
        textContent: async () => `Showing ${visible} of ${total} matching articles`,
      };
    },
    getByRole: (role, options) => {
      expect(role).toBe('button');
      expect(options).toEqual({ name: 'Show more articles', exact: true });
      return { click, isVisible };
    },
  };
  return { page, click, isVisible };
}

describe('live checks traverse the complete paginated feed', () => {
  it('reveals every article through the reader control, including the final partial page', async () => {
    const { page, click } = feed(49);
    expect(await revealAllFeedArticles(page)).toBe(49);
    expect(click).toHaveBeenCalledTimes(4);
  });

  it('does not require pagination for a feed already shown in full', async () => {
    const { page, click } = feed(7);
    expect(await revealAllFeedArticles(page)).toBe(7);
    expect(click).not.toHaveBeenCalled();
  });

  it('fails rather than accepting a first page when pagination is missing', async () => {
    const { page, isVisible } = feed(49);
    isVisible.mockResolvedValue(false);
    await expect(revealAllFeedArticles(page)).rejects.toThrow('12/49 cards, but no pagination control');
  });

  it('fails when the pagination control stops revealing articles', async () => {
    const { page, click } = feed(49);
    click.mockImplementation(async () => {});
    await expect(revealAllFeedArticles(page)).rejects.toThrow('Show more articles did not reveal');
  }, 10_000);

  it('rejects an empty feed instead of certifying a vacuous sweep', async () => {
    await expect(revealAllFeedArticles(feed(0).page)).rejects.toThrow('published feed is empty');
  });
});
