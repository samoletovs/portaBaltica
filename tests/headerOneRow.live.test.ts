import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * Does the deployed header keep its controls on one row?
 *
 * The structural check in `siteHeader.test.tsx` asserts the classes that make
 * a single row possible, which is close to asserting that somebody wrote the
 * line they just wrote. jsdom does not lay out, so it cannot tell a row from a
 * stack. This measures the outcome in a real browser.
 *
 * The defect it guards, measured at 375px before the fix: the top bar wrapped
 * into **three** stacked rows — wordmark, the two segmented groups, then the
 * two toggles — and stood **148px** tall before a reader reached the section
 * tabs, let alone a figure. At 640 it was worse than tall: the row was pinned
 * to `h-14` and the wrapped controls overflowed it.
 *
 * Two things are asserted together, because either alone passes for the wrong
 * reason. One row is trivially true of a header that renders no controls, so
 * the count of controls found is asserted first — an instrument that sees
 * nothing must not report success. And a short bar is trivially true of a
 * clipped one, so the page is checked not to scroll sideways: the controls may
 * overflow *their own strip*, which scrolls, but never the document.
 */
const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Phone widths, plus the width where the wrapped row used to overflow `h-14`. */
const WIDTHS = [320, 375, 390, 640];

/** The bar is `h-14`. One row fits in it; two do not. */
const ONE_ROW_MAX_PX = 56;

describe('the deployed site header', () => {
  it('keeps every top-bar control on a single row at phone widths', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;

    try {
      const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 800 } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // The onboarding overlay is up on a first visit, and it renders its own
        // buttons — which would be counted as header controls below.
        localStorage.setItem('pb-onboarding-complete', 'true');
      });
      await page.goto(BASE + '/data', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('header');

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(300);

        const measured = await page.evaluate(() => {
          const bar = document.querySelector('header > div > div');
          if (!bar) return null;
          const boxes = [...bar.querySelectorAll('a, button')]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
          return {
            barHeight: Math.round(bar.getBoundingClientRect().height),
            controls: boxes.length,
            // One row means every control's vertical span overlaps every
            // other's. Comparing `top` alone would call a 26px wordmark beside
            // a 44px button two rows.
            oneRow: boxes.every((a) => boxes.every((b) => a.top < b.bottom && b.top < a.bottom)),
            documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        });

        expect(measured, `${width}px: no top bar found — the probe is measuring nothing`).not.toBeNull();
        expect(
          measured!.controls,
          `${width}px: only ${measured!.controls} controls found; one row is trivially true of an empty bar`,
        ).toBeGreaterThanOrEqual(9);
        expect(measured!.oneRow, `${width}px: the top bar controls are on more than one row`).toBe(true);
        expect(
          measured!.barHeight,
          `${width}px: the top bar is ${measured!.barHeight}px, which is more than one row`,
        ).toBeLessThanOrEqual(ONE_ROW_MAX_PX);
        expect(
          measured!.documentScrolls,
          `${width}px: the row fits by pushing the page sideways, which is not a fix`,
        ).toBe(false);
      }
    } finally {
      await browser.close();
    }
  });
});
