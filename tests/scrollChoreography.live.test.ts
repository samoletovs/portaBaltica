import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { tierAArticle } from './fixtures/articles';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

describe('motion and reading controls in the rendered experience', () => {
  it('opens a moving market tape, lets readers pause it, and stops for reduced motion', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
      await page.goto(`${BASE}/data`, { waitUntil: 'domcontentloaded' });
      const tape = page.locator('.ticker-track');
      await page.getByRole('button', { name: 'Pause market ticker' }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.ticker-group').length === 2);
      expect(await page.locator('.desk-market-snapshot').evaluate(el => (el as HTMLDetailsElement).open)).toBe(true);
      await page.locator('.ticker-shell').scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const before = await tape.evaluate(el => getComputedStyle(el).transform);
      await page.waitForFunction(previous => getComputedStyle(document.querySelector('.ticker-track')!).transform !== previous, before);
      const groups = await page.locator('.ticker-group').evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
      expect(groups).toHaveLength(2);
      expect(Math.abs(groups[0] - groups[1]), 'unequal copies jump at the loop seam').toBeLessThan(1);
      expect(groups[0]).toBeGreaterThanOrEqual(await page.locator('.ticker-viewport').evaluate(el => el.clientWidth));
      await page.getByRole('button', { name: 'Pause market ticker' }).click();
      expect(await tape.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused');
      await page.getByRole('button', { name: 'Resume market ticker' }).click();
      expect(await tape.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('running');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await tape.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    } finally {
      await browser.close();
    }
  });

  it('reveals recorded evidence without changing values and clears the sticky navigation on jumps', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const article = tierAArticle({ slug: 'scroll-evidence-fixture' });
      const source = article.provenance.sources[0];
      const common = {
        article_id: article.id, slug: article.slug, headline: article.headline,
        signal_id: article.provenance.signal_id,
        metric: 'salary', metric_label: 'Hourly labour cost', unit: 'EUR/hour',
        period: '2025', observed_at: source.retrieved_at, published_at: article.published_at!,
        source_id: source.source_id, dataset: source.dataset ?? null,
      };
      article.provenance.published_observations = [
        { ...common, geography: 'Baltic', value: 4.8, raw_source: false, summary: true },
        { ...common, geography: 'LV', value: 16.3, raw_source: true, summary: false },
        { ...common, geography: 'EE', value: 21.1, raw_source: true, summary: false },
        { ...common, geography: 'LT', value: 17.8, raw_source: true, summary: false },
      ];
      for (const width of [375, 1366]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
        await page.route('**/scroll-evidence-fixture.json', route => route.fulfill({ json: article }));
        await page.goto(`${BASE}/article/${article.slug}`, { waitUntil: 'domcontentloaded' });
        const graphic = page.locator('.story-evidence-graphic');
        await graphic.waitFor();
        expect(await page.locator('.region-artwork').count()).toBe(0);
        expect(await graphic.locator('.story-evidence-fill').count()).toBe(3);
        const values = await graphic.locator('dd').allTextContents();
        await graphic.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.story-evidence-fill')].every(el => !el.style.transform));
        expect(await graphic.locator('dd').allTextContents()).toEqual(values);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await graphic.locator('.story-evidence-fill').evaluateAll(els => els.every(el => getComputedStyle(el).transform === 'none'))).toBe(true);
        await graphic.getByRole('link', { name: /Inspect the source record/ }).click();
        await page.waitForFunction(() => document.activeElement?.id === 'article-evidence');
        expect(await page.locator('#article-evidence').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(
          await page.locator('.folio-story-reading-nav').evaluate(el => el.getBoundingClientRect().bottom),
        );
        await page.getByRole('navigation', { name: 'Article reading navigation' }).getByRole('link', { name: /^Story/ }).click();
        const clearance = await page.evaluate(() => ({
          target: document.querySelector('#article-story')!.getBoundingClientRect().top,
          navigation: document.querySelector('.folio-story-reading-nav')!.getBoundingClientRect().bottom,
        }));
        expect(clearance.target, `${width}px: opening text is hidden behind sticky navigation`).toBeGreaterThanOrEqual(clearance.navigation);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
