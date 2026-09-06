import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { tierASummary } from './fixtures/articles';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

describe('news search keyboard editing', () => {
  it('keeps the caret and every character when editing before existing text', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage();
      await page.route('**/articles/index.json', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ articles: [tierASummary({ headline: 'Labour market update' })] }),
      }));
      await page.route('**/articles/corrections.json', (route) => route.fulfill({
        contentType: 'application/json', body: '[]',
      }));
      await page.goto(`${BASE}/?q=labour`);
      const input = page.getByRole('searchbox', { name: 'Search headlines and summaries' });
      await input.waitFor();
      for (const delay of [150, 50]) {
        await input.fill('labour');
        await page.waitForURL((url) => url.searchParams.get('q') === 'labour');
        await input.press('Home');
        await input.pressSequentially('ab', { delay });
        expect(await input.inputValue()).toBe('ablabour');
        expect(await input.evaluate((element) => element instanceof HTMLInputElement ? element.selectionStart : null)).toBe(2);
        await page.waitForURL((url) => url.searchParams.get('q') === 'ablabour');
      }
    } finally {
      await browser.close();
    }
  });
});
