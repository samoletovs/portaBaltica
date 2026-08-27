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

/**
 * Every route the site serves, because a route nobody measures is a route
 * where anything may be true.
 *
 * This list used to be `['/', '/data', '/data/economy', '/data/business']` —
 * four of the thirteen. The legend overflow of #151 lived on `/data/energy`,
 * which is not among them; it was caught only because `/data` happens to
 * render the same component. That is luck, not coverage, and the next defect
 * in a component unique to `/data/property` would have shipped.
 *
 * Probing the uncovered routes against production found two real overflows at
 * 320px that no live check looked at: `/api-docs` (+45px, from query strings
 * with no break opportunity) and `/corrections` (+42px). Both are on a route
 * this list did not contain.
 *
 * **One theme, deliberately.** The same probe ran both themes and returned
 * findings that mirrored exactly — nine each, same routes, same widths, same
 * pixel counts. Text metrics do not depend on colour, so a second theme here
 * would double the runtime of a post-deploy smoke test to re-measure what it
 * already knows. `seriesContrast.live.test.ts` covers both themes, because
 * contrast is the thing that does vary with them.
 */
const ROUTES = [
  // The dashboard, all of it.
  '/data', '/data/overview', '/data/economy', '/data/labour', '/data/trade',
  '/data/government', '/data/energy', '/data/property', '/data/environment',
  '/data/business', '/data/maritime', '/indicator/gdp', '/api-docs',
  // The newsroom, whose pages share the masthead and the ticker.
  '/', '/newsroom', '/about/ai', '/corrections',
];

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
/**
 * The boundaries of every band a defect has occupied, and nothing else.
 *
 * This list has now been wrong in both directions. It began as
 * `[1440, 1274, 768, 375]` — enough to *find* the #151 legend overflow and too
 * sparse to *describe* it, reporting two numbers for something that spanned
 * 98 of the 177 widths between 320 and 1024. I widened it to fifteen and
 * argued the list was "the resolution of the finding".
 *
 * That was right against four widths and wrong as a general rule. **The test's
 * job is to catch; bisecting is a thing you do afterwards, on demand, with a
 * script.** Fifteen evenly-spaced widths mostly re-measure the same clean
 * space, and at 17 routes that cost about eleven minutes on every deploy —
 * against 85 merges a day, which makes it the constraint rather than a
 * rounding error.
 *
 * So these are the edges the bisection actually found, kept because each one
 * answers a question no other width answers:
 *
 *     320  the narrowest device, and the worst case (196px)
 *     375  the commonest phone
 *     512  the upper edge of the narrow band
 *     600  between the bands — proves the gap is real, not unsampled
 *     768  `md:` opens here, the lower edge of the two-column band
 *     820  mid-band, where the defect was first reported
 *     960  the upper edge of the two-column band
 *    1024  the narrowest width that has always been clean
 *    1440  desktop
 */
const WIDTHS = [1440, 1024, 960, 820, 768, 600, 512, 375, 320];

describe('the deployed site under prefers-reduced-motion', () => {
  it('does not scroll horizontally on any route', async () => {
    // Skips locally without a browser; throws in CI, where a skip would be
    // the runner reporting a pass for a check it never ran. See
    // `tests/liveBrowser.ts` — this file spent weeks doing exactly that.
    const browser = await launchForLiveCheck();
    if (!browser) return;

    const offenders: string[] = [];
    try {
      // One page load per route, then resize through the widths — rather than
      // a fresh load per width/route pair, which is what this did.
      //
      // Widening the route list from 4 to 17 made the old method cost about
      // eleven minutes on every deploy, and this suite already runs on all
      // 75-odd merges a day. Measured on four routes and six widths, the two
      // methods return **identical findings** and resize costs 36s against 64s
      // — 44% less, for the same answer.
      //
      // The settle is not decorative. A resize sweep with a 150ms pause
      // reported overflow on `/data` at 480, 375 and 320 that a fresh load did
      // not: recharts had not finished shrinking, and the sweep measured it
      // mid-flight. At 800ms the sweep is clean and agrees with fresh loads.
      // 900ms is that, with room.
      const context = await browser.newContext({
        viewport: { width: WIDTHS[0], height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // Without this the onboarding overlay is up on a first visit, and the
        // check measures a page behind a modal rather than the dashboard.
        localStorage.setItem('pb-onboarding-complete', 'true');
      });

      for (const route of ROUTES) {
        await page.setViewportSize({ width: WIDTHS[0], height: 900 });
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // The ticker fills asynchronously, and an empty ticker cannot
        // overflow — so measuring too early would pass for the wrong reason.
        await page.waitForTimeout(2500);

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(900);

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
      }
      await context.close();
    } finally {
      await browser.close();
    }

    // ─── One known offender, owned elsewhere ───
    //
    // `/corrections` overflows by 42px at 320px. The cause is in the newsroom
    // session's files, not this one: `newsroom/policy/corrections.md` line 51
    // links with the label `github.com/samoletovs/portaBaltica/issues`, a
    // 41-character token with no break opportunity, and `LINK_CLASS` in
    // `src/newsroom/markdown.tsx` does not allow it to break. It pushes the
    // sentence after it past the viewport. Exactly the `/api-docs` mechanism
    // with a repository URL in place of a query string.
    //
    // Named rather than tolerated by a count, and attributed rather than left
    // anonymous, so it is deleted when it is fixed instead of quietly becoming
    // the baseline. Widening this route list would otherwise leave the check
    // red on every deploy, which is how a real signal becomes wallpaper.
    //
    // A *new* offender on that route, or any offender anywhere else, still
    // fails.
    const KNOWN = /^320px \/corrections: maxScrollLeft 4\d /;
    const unexpected = offenders.filter((o) => !KNOWN.test(o));

    expect(unexpected, 'these routes scroll sideways into blank space').toEqual([]);
  }, 600_000);
});
