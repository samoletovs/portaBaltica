import { describe, expect, it } from 'vitest';

/**
 * Does the deployed site scroll sideways?
 *
 * This is the test the structural one in `reducedMotionLayout.test.tsx` cannot
 * be. That one asserts `contain: paint` is present, which is close to
 * asserting that somebody wrote the line they just wrote: it passes for the
 * technique rather than for the outcome, and it would go green again if a
 * future change swapped the technique for one that does not work.
 *
 * This measures the outcome. It drives a real browser, sets
 * `prefers-reduced-motion: reduce`, scrolls the document as far right as it
 * will go, and reads back how far that was. Zero is the only acceptable
 * answer.
 *
 * **Reduced motion is the whole point of the fixture.** The defect this guards
 * existed only on that path: the ticker's containment was a side effect of the
 * marquee's transform, so turning the animation off turned the containment off
 * with it, and every route gained a 2064px horizontal scrollbar into blank
 * space. A run under default motion passed throughout the bug's life and would
 * pass again tomorrow. The accessible path is the one that has to be measured.
 *
 * It lives in the live suite because it needs a browser and a deployed site,
 * and because — like the rest of that suite — a network failure should not
 * block a pull request. Run it after a release:
 *
 *     npx playwright install chromium
 *     npm run test:live
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Routes that render the masthead, and therefore the ticker. */
const ROUTES = ['/', '/data', '/data/economy', '/data/business'];

/** Widths either side of the layout's breakpoints. */
const WIDTHS = [1440, 1274, 768, 375];

async function chromium() {
  try {
    const playwright = await import('playwright');
    return playwright.chromium;
  } catch {
    return null;
  }
}

describe('the deployed site under prefers-reduced-motion', () => {
  it('does not scroll horizontally on any route', async () => {
    const browserType = await chromium();
    if (!browserType) {
      console.warn('playwright is not installed; skipping the layout measurement');
      return;
    }

    let browser;
    try {
      browser = await browserType.launch();
    } catch {
      console.warn('no chromium binary — run `npx playwright install chromium`; skipping');
      return;
    }

    const offenders: string[] = [];
    try {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();

        for (const route of ROUTES) {
          await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          // The ticker fills asynchronously, and an empty ticker cannot
          // overflow — so measuring too early would pass for the wrong reason.
          await page.waitForTimeout(2500);

          const measured = await page.evaluate(async () => {
            const doc = document.documentElement;
            window.scrollTo(99_999, 0);
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            const maxScrollLeft = Math.round(window.scrollX);
            window.scrollTo(0, 0);
            return {
              maxScrollLeft,
              scrollWidth: doc.scrollWidth,
              clientWidth: doc.clientWidth,
              reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            };
          });

          // If the emulation did not take, the run proves nothing — say so
          // rather than reporting a pass.
          expect(measured.reduced, `${route} did not receive the reduced-motion preference`).toBe(true);

          if (measured.maxScrollLeft > 0) {
            offenders.push(
              `${width}px ${route}: maxScrollLeft ${measured.maxScrollLeft} ` +
                `(scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth})`,
            );
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }

    expect(offenders, 'these routes scroll sideways into blank space').toEqual([]);
  }, 240_000);
});
