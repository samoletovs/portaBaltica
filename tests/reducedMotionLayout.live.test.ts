import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { navigableRoutes } from './routes';

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
 *
 * **The list is derived now, not written.** Widening it from four to seventeen
 * fixed the instance and left the mechanism: a list of examples cannot notice
 * that the thing it samples has changed shape, and the reason the original four
 * were wrong is that they were chosen correctly for the *ticker* — their own
 * comment said so — and then left answering a question about every route. A
 * fresh list has exactly the same future.
 *
 * `navigableRoutes()` reads the router and the navigation, so a section added
 * to the nav tomorrow is swept tomorrow with nobody remembering anything.
 * Measured against the seventeen it replaces, it agreed in one direction —
 * nothing reachable was unlisted, so the widening had been complete — and
 * disagreed in the other: `/data/overview` is not a section. `App.tsx` falls
 * back to `'all'` for a name `DashboardSection` does not carry, so that entry
 * rendered `/data` a second time under a different label, and a green line
 * reported a page that was never drawn.
 */

/**
 * Routes that need a real parameter, which no derivation can invent.
 *
 * An id has to be chosen by a human because it has to exist: `/indicator/gdp`
 * renders a chart, `/indicator/whatever` renders a not-found page, and a
 * not-found page cannot overflow — so an invented one is a pass for the wrong
 * reason rather than coverage. Kept deliberately short; each entry is a claim
 * that this specific page is worth measuring.
 */
const CONCRETE_PARAM_ROUTES = ['/indicator/gdp'];

const ROUTES = [...navigableRoutes(), ...CONCRETE_PARAM_ROUTES];

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

/**
 * Strips that scroll sideways without saying so.
 *
 * **Empty, and it emptied itself twice.** It carried two entries one PR ago —
 * the insights row and the policy table. Fixing those turned this red, which
 * is how the third was found: `/follow`'s feed URL chips, added by #195 and
 * not covered by any check that reads a rendered mask.
 *
 * That third one is worth recording because a fade would have been the wrong
 * fix. Measured against production at 320 / 375 / 414px, both chips rendered
 * **byte-identical visible text** — `https://portabaltica.` — since the path
 * is the only thing distinguishing RSS from JSON Feed and the path is what the
 * cut removed. Fading the edge would have made two indistinguishable controls
 * look deliberate. They wrap now, so the whole URL is on screen and nothing
 * here scrolls at all.
 *
 * The insights row was the sharpest of the three: that file **did** call
 * `useOverflowFade` and **did** spread its class, and rendered no fade, because
 * the hook attaches in an effect and the component's first commit renders a
 * separate "Loading insights" element, so the effect ran against a null ref. A
 * source-reading check calls that file correct; only a live read of the
 * computed mask does not. That is why this assertion lives here rather than in
 * the unit suite.
 *
 * An equality, not a subtraction. Written as
 * `expect(found.filter(notKnown)).toEqual([])` this would still name three
 * strips that no longer offend, matching nothing and reporting success
 * indefinitely — and it would never have surfaced the second or the third.
 */
const KNOWN_UNFADED: string[] = [];

describe('the deployed site under prefers-reduced-motion', () => {
  it('does not scroll horizontally, and every strip that does says so', async () => {
    // Skips locally without a browser; throws in CI, where a skip would be
    // the runner reporting a pass for a check it never ran. See
    // `tests/liveBrowser.ts` — this file spent weeks doing exactly that.
    const browser = await launchForLiveCheck();
    if (!browser) return;

    const offenders: string[] = [];
    const unfaded = new Set<string>();
    let probedScrollables = 0;
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

            // Every strip that is scrolling sideways right now, and whether it
            // says so. Measured here rather than read from the source because
            // the interesting failure is a fade that is wired and dead: the
            // insights row calls `useOverflowFade` and renders a *different*
            // element while loading, so the hook's effect runs against a null
            // ref and never re-attaches. Statically that file looks correct.
            const unfaded: string[] = [];
            for (const element of document.querySelectorAll<HTMLElement>('body *')) {
              const style = getComputedStyle(element);
              if (!/auto|scroll/.test(style.overflowX)) continue;
              if (element.scrollWidth <= element.clientWidth + 1) continue;
              const masked =
                (style.maskImage && style.maskImage !== 'none') ||
                (style.webkitMaskImage && style.webkitMaskImage !== 'none');
              if (masked) continue;
              const label = element.getAttribute('aria-label');
              unfaded.push(
                element.tagName.toLowerCase() +
                  (label ? `[${label}]` : '') +
                  '.' +
                  element.className.trim().split(/\s+/).slice(0, 3).join('.'),
              );
            }

            return {
              maxScrollLeft,
              scrollWidth: doc.scrollWidth,
              clientWidth: doc.clientWidth,
              unfaded,
              // A control: if nothing on the page scrolls sideways at all, an
              // empty `unfaded` is a claim about the probe, not the page.
              scrollableCount: [...document.querySelectorAll<HTMLElement>('body *')].filter((e) =>
                /auto|scroll/.test(getComputedStyle(e).overflowX),
              ).length,
              reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            };
          });

          // If the emulation did not take, the run proves nothing — say so
          // rather than reporting a pass.
          expect(measured.reduced, `${route} did not receive the reduced-motion preference`).toBe(true);
          probedScrollables += measured.scrollableCount;
          for (const strip of measured.unfaded) unfaded.add(strip);

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

    expect(offenders, 'these routes scroll sideways into blank space').toEqual([]);

    // The probe has to be able to see a strip before "no unfaded strip" means
    // anything. Every route carries the masthead controls and the section
    // tabs, so zero here is a broken instrument.
    expect(probedScrollables, 'no scrollable strip was found on any route — the probe is broken')
      .toBeGreaterThan(0);

    // An equality, not a subtraction. `expect(found.filter(notKnown)).toEqual([])`
    // also passes today and goes on passing forever once the offender is
    // fixed, matching nothing and reporting success — so the exemption has to
    // fail when it stops being true. Fix either of these and this line goes
    // red, which is the only thing that gets the list pruned.
    expect([...unfaded].sort(), 'a strip that scrolls sideways must look like one')
      .toEqual([...KNOWN_UNFADED].sort());
  }, 600_000);
});
