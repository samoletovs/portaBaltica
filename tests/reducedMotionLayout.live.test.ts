import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

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

/**
 * Widths either side of every breakpoint, and inside every band a defect has
 * actually occupied.
 *
 * This list used to be `[1440, 1274, 768, 375]`, and that was not wrong so
 * much as too sparse to describe what it found. When the EU27 reference line
 * gave chart legends a fourth entry, the page overflowed at **98 of the 177
 * widths between 320 and 1024**, in two bands — 768–960 where
 * `md:grid-cols-2` halves the card, and 320–512 where the viewport itself is
 * narrower than the legend. The four widths above caught it, at 768 and 375,
 * and reported two numbers for a defect that spans half the useful range.
 *
 * The width list is the resolution of the finding. Sampling every breakpoint
 * edge and the middle of each band means the next report says *where* the
 * problem lives, which is what turns "the page scrolls" into a diagnosis.
 */
const WIDTHS = [
  1440, 1274, 1024, // desktop, and the widest clean width
  960, 900, 820, 768, // the two-column band: 768–960
  700, 600, 540, // clean between the bands
  512, 480, 414, 375, 320, // the narrow band: 320–512
];

describe('the deployed site under prefers-reduced-motion', () => {
  it('does not scroll horizontally on any route', async () => {
    // Skips locally without a browser; throws in CI, where a skip would be
    // the runner reporting a pass for a check it never ran. See
    // `tests/liveBrowser.ts` — this file spent weeks doing exactly that.
    const browser = await launchForLiveCheck();
    if (!browser) return;

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
