import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { navigableRoutes } from './routes';

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
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Apple HIG and Material both ask 44. `index.css` sets 2.75rem for the same reason. */
const MIN_PX = 44;

/** Where touch happens. The floor is about thumbs, so it is measured on a phone. */
const WIDTH = 375;

const ROUTES = navigableRoutes();

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
type Driver = {
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

      for (const route of ROUTES) {
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

        const measured = await page.evaluate(
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

        seen += measured.counted;
        for (const s of measured.small) offenders.push({ route, ...s });
        if (measured.skip) skipLink.push({ route, ...measured.skip });
      }
    } finally {
      await browser.close();
    }

    // VACUITY GUARD. A page that rendered no controls, or a selector that
    // stopped matching, would otherwise report a clean sweep.
    expect(
      seen,
      `only ${seen} interactive controls across ${ROUTES.length} routes; the selector has ` +
        'stopped matching, or the pages did not render, and the pass below would mean nothing',
    ).toBeGreaterThan(300);

    // The skip link must be reachable and sized. Asserted separately because it
    // is the one control that is deliberately invisible until focused, so a
    // sweep that did not tab to it would silently never measure it.
    expect(skipLink.length, 'no skip link found on any route').toBe(ROUTES.length);
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
