import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { navigableRoutes } from './routes';
import { revealAllFeedArticles } from './liveFeed';
import type { FeedDriver } from './liveFeed';

/**
 * Every control on the deployed site is big enough to hit with a thumb.
 *
 * WHAT WAS ALREADY GUARDED, AND WHAT IT COULD NOT SEE
 * ---------------------------------------------------
 * `design-system.test.ts` asserts that `index.css` contains a `min-height` of
 * at least 44px and that the rule reaches `button`. That is a check on the
 * *stylesheet*, and it can only ever confirm that a rule exists for the
 * selectors somebody thought of. The selector list is:
 *
 *     button, [role=button], summary, nav a, label, select, input
 *
 * The site's skip link is a standalone `<a href="#main">` in `SiteLayout`,
 * outside any `nav`. No rule reached it, the source check could not see that,
 * and it rendered **139x40** focused — under the floor the same repository
 * asserts elsewhere, on the FIRST control a keyboard or switch user meets.
 *
 * So this is the rendered version of that check. It is not duplication: one
 * measures the stylesheet, the other measures the page, and the gap between
 * them is exactly where the defect lived. `AGENTS.md`: the set the guard walks
 * and the set the behaviour walks must be the same set.
 *
 * WHAT THE POPULATION IS
 * ----------------------
 * Measured across all 17 navigable routes at 375px before the fix: **903
 * interactive elements, 886 of them clearing 44x44**, and the 17 that did not
 * were the same skip link once per route. So this assertion is a floor the
 * site already meets everywhere else, not an aspiration.
 *
 * Links inside running prose are excluded, deliberately and for the reason
 * `index.css` gives: WCAG 2.2 SC 2.5.8 exempts them, and padding them would
 * wreck the leading of the text they sit in. The exclusion is by computed
 * `display: inline`, which is what "inside running prose" actually means in
 * layout terms — not a list of components.
 *
 * THE POPULATION WAS SMALLER THAN THE SITE, AND THAT IS WHERE THE NEXT DEFECT WAS
 * ------------------------------------------------------------------------------
 * `navigableRoutes()` drops every route whose path contains a `:`, because an
 * invented id renders a not-found page and a not-found page passes for the
 * wrong reason. Correct — and it left `/article/:slug`, the most-read route
 * type on a news site, measured by nothing. Its sibling
 * `reducedMotionLayout.live.test.ts` had already noticed this and carries
 * `CONCRETE_PARAM_ROUTES`; this file did not, so the two guards walked
 * different populations and this one walked the smaller.
 *
 * Measured against production at affe582, eight articles, identical every time:
 *
 *      67x18   "Economy"                the section kicker
 *     116x18   "Open the full series"   the chart's link to /data
 *     104x18   "Open the dataset"       the provenance link
 *
 *   /indicator/gdp        38 controls, 0 under 44   <- control, param route, clean
 *   /correspondents/nida  31 controls, 0 under 44   <- control, param route, clean
 *
 * So the answer was not "parameterised routes are broken" — two of them were
 * already clean, which is what makes the article finding a finding rather than
 * a property of the probe.
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Where the finished articles live. Same source `tabStopNames.live.test.ts` reads. */
const BLOB = 'https://stportabalticabpmff5so.blob.core.windows.net/articles';

/** Apple HIG and Material both ask 44. `index.css` sets 2.75rem for the same reason. */
const MIN_PX = 44;

/**
 * Where touch happens. The floor is about thumbs, so it is measured on a phone.
 *
 * **375-only is a decision, not a fact, and it is arguable.** Measured at
 * affe582, `/follow`'s two feed-URL chips render `513x31` at 768 and 1280 and
 * are comfortably over the floor at 320 and 375, because they wrap to more
 * lines on a phone and get taller. So widening this constant would report them
 * — and tablets are thumbed, which is the argument for doing so.
 *
 * They are deliberately left alone. `DESIGN.md` §4.7 already reasoned about
 * those chips and chose wrapping over a fade so the whole address stays on
 * screen; growing them to 44px at desktop widths is a separate decision about
 * pointer targets, not about thumbs, and it belongs to whoever wants to make
 * it. Recorded here so the next session that measures 768, finds `513x31` and
 * reasonably wonders whether it is a defect gets the answer at the site rather
 * than having to re-derive it.
 */
const WIDTH = 375;

/**
 * Routes that need a real parameter, which no derivation can invent.
 *
 * Each entry is a claim that this specific page is worth measuring. `gdp` and
 * `nida` are stable ids; an article slug is not, so it is derived below rather
 * than written down — the archive turns over and a hardcoded slug would 404
 * into a not-found page, which cannot have an undersized control and would
 * therefore pass for the wrong reason.
 */
const CONCRETE_PARAM_ROUTES = ['/indicator/gdp', '/correspondents/nida'];

/**
 * One real article, derived from the published index.
 *
 * Throws rather than returning nothing: an empty result here would silently
 * drop `/article/:slug` from the sweep and restore the exact gap this change
 * closes, while everything stayed green.
 */
async function articleRoute(): Promise<string> {
  const index = await (await fetch(`${BLOB}/index.json`)).json();
  const list = Array.isArray(index) ? index : (index.articles ?? []);
  const article = list.find(
    (a: { status?: string; tier?: string }) => a.status === 'published' && a.tier !== 'C',
  );
  if (!article?.slug) {
    throw new Error(
      'no published non-tier-C article in the index, so /article/:slug cannot be measured. ' +
        'Failing rather than sweeping one route fewer and reporting a pass.',
    );
  }
  return `/article/${article.slug}`;
}

const SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';

/**
 * Just the browser surface this file uses.
 *
 * Not `import('playwright').Page`: `liveBrowserWiring.test.ts` asserts that
 * `liveBrowser.ts` is the only file naming playwright, and it is lexical, so a
 * type-only reference trips it. Naming the methods used is cheaper than an
 * exemption and documents the dependency more precisely.
 */
type Driver = FeedDriver & {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  keyboard: { press(key: string): Promise<void> };
};

type Offender = { route: string; tag: string; w: number; h: number; label: string };

describe('touch targets on the deployed site', () => {
  it('gives every control at least 44x44, and the skip link first of all', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;

    // Built here rather than at module scope because one member is derived from
    // the live index. `navigableRoutes()` alone is what left `/article/:slug`
    // unmeasured while this file's own header claimed "every route".
    const routes = [...navigableRoutes(), ...CONCRETE_PARAM_ROUTES, await articleRoute()];

    // The population is asserted before it is walked, as an equality on the
    // parameterised members. `routeCoverage.test.ts` guards the *derivation* of
    // `navigableRoutes()` with floors and `toContain`, and knows nothing about
    // these three — so without this, a `:param` route dropping back out of the
    // sweep reopens exactly the gap this change closed, and every signal stays
    // green. A filter would not do: it would match nothing and report success.
    expect(
      routes.filter((r) => !navigableRoutes().includes(r)).map((r) => r.replace(/^(\/article)\/.+/, '$1/:slug')),
      'the parameterised routes are no longer in the sweep. They are the population this ' +
        'guard was missing when three 18px links shipped on every article.',
    ).toEqual([...CONCRETE_PARAM_ROUTES, '/article/:slug']);

    /** Every route actually walked, so a route that silently drops out fails. */
    const walked: string[] = [];

    const offenders: Offender[] = [];
    const skipLink: { route: string; w: number; h: number; focused: boolean }[] = [];
    let seen = 0;

    try {
      const context = await browser.newContext({ viewport: { width: WIDTH, height: 812 } });
      const page = (await context.newPage()) as unknown as Driver;
      await context.addInitScript(() => {
        // Otherwise the onboarding overlay is up and the controls measured are
        // the modal's, not the page's.
        localStorage.setItem('pb-onboarding-complete', 'true');
      });

      for (const route of routes) {
        walked.push(route);
        await page.setViewportSize({ width: WIDTH, height: 812 });
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // Charts, the ticker and the feed all arrive after first paint, and a
        // control that has not rendered cannot be too small — measuring early
        // would pass for the wrong reason.
        await page.waitForTimeout(2000);

        // The skip link is `sr-only` until focused, so unfocused it is 1x1 by
        // design and measuring it in that state would be meaningless. Tab once
        // to put it in the state a user actually sees.
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);

        const measure = () => page.evaluate(
          ({ selector, min }: { selector: string; min: number }) => {
            const active = document.activeElement;

            /** Tailwind's `sr-only`: absolutely positioned and clipped to a pixel. */
            function isScreenReaderOnly(el: Element, cs: CSSStyleDeclaration) {
              const r = el.getBoundingClientRect();
              return (
                cs.position === 'absolute' &&
                cs.overflow === 'hidden' &&
                r.width <= 1 &&
                r.height <= 1
              );
            }

            const skip = document.querySelector('a[href="#main"]');
            const skipRect = skip ? skip.getBoundingClientRect() : null;

            const small: { tag: string; w: number; h: number; label: string }[] = [];
            let counted = 0;

            for (const el of document.querySelectorAll(selector)) {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              // A link inside running prose is text, and SC 2.5.8 exempts it.
              if (el.tagName === 'A' && cs.display === 'inline') continue;
              // Hidden-until-focused controls are not targets in that state.
              if (el !== active && isScreenReaderOnly(el, cs)) continue;

              counted++;
              if (r.height + 0.5 < min || r.width + 0.5 < min) {
                small.push({
                  tag: el.tagName.toLowerCase(),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  label: (el.getAttribute('aria-label') || el.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 40),
                });
              }
            }

            return {
              counted,
              small,
              skip: skipRect
                ? {
                    w: Math.round(skipRect.width),
                    h: Math.round(skipRect.height),
                    focused: skip === active,
                  }
                : null,
            };
          },
          { selector: SELECTOR, min: MIN_PX },
        );

        const snapshots = [await measure()];
        if (route === '/') {
          // Keep the natural first-Tab and pagination-button measurements,
          // then also measure controls on every subsequently revealed card.
          await revealAllFeedArticles(page);
          snapshots.push(await measure());
        }
        seen += Math.max(...snapshots.map((snapshot) => snapshot.counted));
        for (const snapshot of snapshots) {
          for (const s of snapshot.small) offenders.push({ route, ...s });
        }
        if (snapshots[0].skip) skipLink.push({ route, ...snapshots[0].skip });
      }
    } finally {
      await browser.close();
    }

    // Every intended route was actually visited. `seen > 300` is a floor over
    // the whole sweep and would not notice one route dropping out, because the
    // other nineteen carry it past the floor on their own.
    expect(
      walked,
      'a route was not walked. The sweep is only as good as its population, and this ' +
        'guard has already shipped one defect by walking a smaller set than the site.',
    ).toEqual(routes);

    // VACUITY GUARD. A page that rendered no controls, or a selector that
    // stopped matching, would otherwise report a clean sweep.
    expect(
      seen,
      `only ${seen} interactive controls across ${routes.length} routes; the selector has ` +
        'stopped matching, or the pages did not render, and the pass below would mean nothing',
    ).toBeGreaterThan(300);

    // The skip link must be reachable and sized. Asserted separately because it
    // is the one control that is deliberately invisible until focused, so a
    // sweep that did not tab to it would silently never measure it.
    expect(skipLink.length, 'no skip link found on any route').toBe(routes.length);
    const unfocused = skipLink.filter((s) => !s.focused).map((s) => s.route);
    expect(
      unfocused,
      'one Tab did not land on the skip link. It must be the first thing in the tab order, ' +
        'and if it is not, this check has been measuring some other control',
    ).toEqual([]);

    const printed = offenders
      .map((o) => `${o.route} <${o.tag}> ${o.w}x${o.h} "${o.label}"`)
      .sort();

    expect(
      printed,
      `a control below ${MIN_PX}x${MIN_PX} on the deployed site. Apple's HIG and Material ` +
        'both ask 44, index.css sets 2.75rem for that reason, and design-system.test.ts ' +
        'asserts the rule exists — but that check reads the stylesheet, so a control the ' +
        'selector list does not name slips past it.',
    ).toEqual([]);
  }, 300_000);
});
