import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { launchForLiveCheck } from './liveBrowser';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const require = createRequire(import.meta.url);
const definitions = require('../api/shared/indicators.js') as Record<string, {
  title: string; unit: string; dataset: string; freq: string;
}>;
const periods: Record<string, string[]> = {
  A: ['2024', '2025'], S: ['2025-S1', '2025-S2'], Q: ['2026-Q1', '2026-Q2'],
  M: ['2026-01', '2026-02'], W: ['2026-W01', '2026-W02'],
};
const CASES = [390, 696, 1280].flatMap(width =>
  (['light', 'dark'] as const).map(theme => ({ width, theme })),
);

describe('the primary destinations share one presentation system', () => {
  it.each(CASES)('$width $theme: repeated roles have the same rendered style', async ({ width, theme }) => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await page.addInitScript(value => localStorage.setItem('pb-theme', value), theme);
      // Synthetic readings isolate presentation from publication lag and outages.
      // Catalogue labels/units come from the real registry; no upstream fan-out.
      await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (!/^\/api\/[a-z][a-z-]*$/.test(url.pathname)) return route.continue();
        if (url.pathname === '/api/baltic-compare' && url.searchParams.has('list')) {
          return route.fulfill({ json: {
            indicators: Object.entries(definitions).map(([id, definition]) => ({ id, ...definition })),
          } });
        }
        if (url.pathname === '/api/baltic-compare-batch') {
          const years = Number(url.searchParams.get('years'));
          return route.fulfill({ json: {
            results: (url.searchParams.get('indicators') ?? '').split(',').map(indicator => {
              const definition = definitions[indicator];
              if (!definition) return { indicator, years, status: 400, error: 'Unknown fixture indicator' };
              return {
                indicator, years, status: 200, cache: { ageSeconds: 0, state: 'miss' },
                data: {
                  indicator, years, ...definition, source: `Eurostat (${definition.dataset})`,
                  fetchedAt: '2026-09-11T12:00:00Z', assumptions: [],
                  countries: Object.fromEntries(['LV', 'EE', 'LT'].map((country, index) => [country, {
                    label: country,
                    series: (periods[definition.freq] ?? periods.M).map((period, offset) => ({
                      period, value: index + offset + 1,
                    })),
                  }])),
                },
              };
            }),
          } });
        }
        return route.fulfill({
          status: 503, contentType: 'application/json', body: '{"error":"Style-contract offline fixture"}',
        });
      });
      await page.route('https://*.blob.core.windows.net/articles/**', route => route.fulfill({
        contentType: 'application/json',
        body: route.request().url().endsWith('/index.json') ? '{"articles":[]}' : '[]',
      }));
      const response = await page.goto(BASE);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-type']).toContain('text/html');
      await page.locator('.desk-primary-nav a').first().waitFor();
      const destinations = await page.locator('.desk-primary-nav a').evaluateAll(links =>
        links.map(link => link.getAttribute('href')!),
      );
      expect(destinations).toEqual(expect.arrayContaining(['/', '/data', '/explore', '/briefings']));
      expect(new Set(destinations).size).toBe(destinations.length);
      const opportunities = { action: 0, input: 0, section: 0, table: 0, panel: 0 };

      for (const destination of destinations) {
        await page.goto(new URL(destination, BASE).href);
        const heading = page.locator('main h1');
        await heading.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const reading = await heading.evaluate(node => {
          const css = getComputedStyle(node);
          const intro = node.closest('.site-page-intro');
          const masthead = document.querySelector('.desk-masthead')!;
          return {
            text: node.textContent ?? '',
            family: css.fontFamily,
            size: parseFloat(css.fontSize),
            weight: css.fontWeight,
            leading: parseFloat(css.lineHeight),
            tracking: parseFloat(css.letterSpacing),
            bottom: css.marginBottom,
            sharedIntro: Boolean(intro),
            openingOffset: node.getBoundingClientRect().top - masthead.getBoundingClientRect().bottom,
            overflow: document.documentElement.scrollWidth > innerWidth,
            fontLoaded: document.fonts.check('600 40px "Baltic Editorial"'),
          };
        });
        const size = width < 768 ? 40 : 56;
        const label = `${destination}, ${width}px, ${theme}`;
        expect.soft(reading.family, label).toContain('Baltic Editorial');
        expect.soft(reading.fontLoaded, label).toBe(true);
        expect.soft(reading.size, label).toBe(size);
        expect.soft(reading.weight, label).toBe('600');
        expect.soft(reading.leading, label).toBeCloseTo(size * 1.1, 1);
        expect.soft(reading.tracking, label).toBeCloseTo(size * -0.02, 2);
        expect.soft(reading.bottom, label).toBe('0px');
        expect.soft(reading.sharedIntro, label).toBe(true);
        expect.soft(reading.openingOffset, label).toBeCloseTo(width < 768 ? 24 : 32, 1);
        expect.soft(reading.text, label).not.toBe(reading.text.toUpperCase());
        expect.soft(reading.overflow, label).toBe(false);
        if (destination === '/explore') await page.getByRole('button', { name: 'Table', exact: true }).click();
        if (destination === '/explore' || destination === '/briefings') await page.locator('.site-table').first().waitFor();

        for (const [role, selector] of Object.entries({
          action: '.site-action', input: '.site-input', section: '.site-section-title',
          table: '.site-table', panel: '.site-panel, .dash-card',
        })) {
          const samples = await page.locator(selector).evaluateAll(nodes => nodes.filter(node =>
            node.getBoundingClientRect().height > 0,
          ).map(node => {
            const css = getComputedStyle(node);
            const cell = node.querySelector('th');
            return {
              family: css.fontFamily, size: parseFloat(css.fontSize), leading: parseFloat(css.lineHeight),
              radius: css.borderTopLeftRadius, height: node.getBoundingClientRect().height,
              cellWeight: cell ? getComputedStyle(cell).fontWeight : null,
              cellPadding: cell ? getComputedStyle(cell).paddingLeft : null,
            };
          }));
          opportunities[role as keyof typeof opportunities] += samples.length;
          for (const sample of samples) {
            expect.soft(sample.family, `${label} ${role}`).toContain('Baltic Editorial');
            if (role === 'action' || role === 'input') {
              expect.soft(sample.height, `${label} ${role}`).toBeGreaterThanOrEqual(44);
              expect.soft(sample.size, `${label} ${role}`).toBe(14);
              expect.soft(sample.radius, `${label} ${role}`).toBe('8px');
            }
            if (role === 'section') {
              expect.soft([22, 28], `${label} section`).toContain(sample.size);
              expect.soft(sample.leading, `${label} section`).toBeCloseTo(sample.size * 1.2, 1);
            }
            if (role === 'table') {
              expect.soft(sample.size, `${label} table`).toBe(14);
              expect.soft(sample.cellWeight, `${label} table header`).toBe('600');
              expect.soft(sample.cellPadding, `${label} table cell`).toBe('12px');
            }
            if (role === 'panel') expect.soft(sample.radius, `${label} panel`).toBe('12px');
          }
        }
      }
      for (const [role, count] of Object.entries(opportunities)) {
        expect(count, `${role}: the rendered contract must exercise this role`).toBeGreaterThan(0);
      }
    } finally {
      await browser.close();
    }
  });
});
