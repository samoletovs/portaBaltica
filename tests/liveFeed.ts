import { expect } from 'vitest';

export interface FeedDriver {
  locator(selector: string): {
    count(): Promise<number>;
    textContent(): Promise<string | null>;
  };
  getByRole(role: 'button', options: { name: string; exact: boolean }): {
    isVisible(): Promise<boolean>;
    click(): Promise<void>;
  };
}

/** Walk the real pagination control so a whole-feed check still covers every card. */
export async function revealAllFeedArticles(page: FeedDriver): Promise<number> {
  const status = await page.locator('[role="status"]:has-text("matching articles")').textContent();
  const match = /^Showing \d+ of (\d+) matching articles$/.exec(status?.trim() ?? '');
  if (!match) throw new Error(`The feed did not declare its population: ${status}`);
  const total = Number(match[1]);
  const cards = page.locator('#news-results article');
  const more = page.getByRole('button', { name: 'Show more articles', exact: true });
  let visible = await cards.count();

  expect(total, 'the published feed is empty').toBeGreaterThan(0);
  while (visible < total) {
    expect(await more.isVisible(), `${visible}/${total} cards, but no pagination control`).toBe(true);
    await more.click();
    await expect.poll(() => cards.count(), {
      timeout: 5000,
      message: 'Show more articles did not reveal any additional cards',
    }).toBeGreaterThan(visible);
    visible = await cards.count();
  }
  expect(visible, 'rendered cards do not match the declared feed population').toBe(total);
  expect(await more.isVisible(), 'pagination remains after the entire feed is visible').toBe(false);
  return total;
}
