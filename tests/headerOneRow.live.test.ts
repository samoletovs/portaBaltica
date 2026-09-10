import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const WIDTHS = [320, 375, 390, 640, 900, 1366, 1440];

describe('the coherent site header', () => {
  it('keeps data controls and the active sector within reach after narrowing a laptop view', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 844 } });
      for (const route of ['/data/energy', '/data/maritime']) {
        await page.setViewportSize({ width: 1366, height: 844 });
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.dashboard-sector-nav [aria-current="page"]').waitFor();
        await page.setViewportSize({ width: 375, height: 844 });
        await page.waitForFunction(() => {
          const nav = document.querySelector('.dashboard-sector-nav')!;
          const selected = nav.querySelector('[aria-current="page"]')!.getBoundingClientRect();
          const bounds = nav.getBoundingClientRect();
          return selected.left >= bounds.left && selected.right <= bounds.right;
        });
        const layout = await page.evaluate(() => {
          const nav = document.querySelector('.dashboard-sector-nav')!;
          const active = nav.querySelector('[aria-current="page"]')!.getBoundingClientRect();
          const bounds = nav.getBoundingClientRect();
          const buttons = [...document.querySelectorAll('.desk-data-controls button')].map(el => el.getBoundingClientRect());
          return {
            selectedVisible: active.left >= bounds.left && active.right <= bounds.right,
            controls: buttons.length,
            controlsVisible: buttons.every(rect => rect.left >= 0 && rect.right <= innerWidth),
          };
        });
        expect(layout.selectedVisible, `${route}: the selected sector is offscreen`).toBe(true);
        expect(layout.controls).toBe(8);
        expect(layout.controlsVisible, `${route}: a global data control is clipped`).toBe(true);
      }
    } finally {
      await browser.close();
    }
  });

  it('keeps all four destinations visible on phones and laptops without a menu toggle', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 } });
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('.desk-masthead');
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const measured = await page.evaluate(() => {
          const bar = document.querySelector('.desk-masthead')!;
          const boxes = [...bar.querySelectorAll('a,button')].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
          return {
            height: bar.getBoundingClientRect().height,
            controls: boxes.length,
            oneRow: boxes.every(a => boxes.every(b => a.top < b.bottom && b.top < a.bottom)),
            contained: boxes.every(box => box.left >= 0 && box.right <= innerWidth),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(measured.controls, `${width}px: missing masthead controls`).toBe(6);
        if (width >= 1100) expect(measured.oneRow, `${width}px: desktop masthead wrapped`).toBe(true);
        expect(measured.height, `${width}px: masthead is too tall`).toBeLessThanOrEqual(width < 480 ? 180 : width < 1100 ? 132 : 88);
        expect(measured.contained, `${width}px: a destination is clipped`).toBe(true);
        expect(measured.overflow, `${width}px: document scrolls horizontally`).toBe(false);
        const directory = page.getByRole('navigation', { name: 'Primary' });
        const paths = await directory.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
        expect(paths).toEqual(['/', '/data', '/explore', '/briefings']);
        expect(await page.getByRole('button', { name: /menu/i }).count()).toBe(0);
        expect(await page.getByRole('link', { name: 'Data explorer', exact: true }).isVisible()).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const theme of ['light', 'dark']) {
        const current = await page.locator('html').getAttribute('data-theme');
        if (current !== theme) await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
        const primary = page.getByRole('link', { name: 'Data explorer', exact: true });
        await primary.hover();
        await page.waitForTimeout(250);
        const contrast = await primary.evaluate(link => {
          const style = getComputedStyle(link);
          const luminance = (color: string) => {
            const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return 0;
          const [high, low] = [luminance(style.color), luminance(getComputedStyle(document.body).backgroundColor)].sort((a, b) => b - a);
          return (high + 0.05) / (low + 0.05);
        });
        expect(contrast, `${theme}: the primary link disappears on hover`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await browser.close();
    }
  });
});
