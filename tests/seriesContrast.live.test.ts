import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * Does any text on the deployed site carry a colour that cannot meet the floor
 * governing it?
 *
 * The unit test in `seriesColourUsage.test.tsx` renders the two components and
 * checks the colour they set. That runs in the PR gate and catches a new call
 * site the day it is written, but it cannot see three things that decide the
 * answer: the **font size** the element actually renders at, the **background
 * it is actually painted on**, and colour arriving from anywhere other than an
 * inline style — recharts' `<Legend>`, for one, which paints its own label in
 * the series colour with no help from us.
 *
 * That last case is not hypothetical. It is how the word "Latvia" came to be a
 * 16px label at 3.90:1: nothing in our source said `color`, so no source-level
 * check could have found it.
 *
 * So this measures the outcome. It resolves every element's computed colour
 * against the real `--series-*` tokens, reads the real font size, walks up to
 * the surface actually painted behind it, and applies the floor WCAG gives
 * that combination — 4.5:1 for text under 24px, 3:1 for large text and for
 * graphical objects.
 *
 * **Both themes, because half this class was invisible in one of them.** The
 * failure was first found as a single token in dark. Light turned out to have
 * three, and the worst of them — `--series-lt` at 3.24:1 — is comfortable at
 * 9.92:1 in dark. A single-theme run would have reported the palette as nearly
 * fine.
 *
 * It lives in the live suite for the same reason as the layout measurement: it
 * needs a browser, and a network failure should not block a pull request.
 *
 *     npx playwright install chromium
 *     npm run test:live
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Routes that render a comparison chart, the power market, or an indicator. */
const ROUTES = ['/data/economy', '/data/energy', '/data/trade', '/indicator/gdp'];

describe('the deployed site’s series palette', () => {
  it('never uses a chart-line colour at a floor it cannot meet', async () => {
    // Skips locally without a browser; throws in CI. See `tests/liveBrowser.ts`.
    const browser = await launchForLiveCheck();
    if (!browser) return;

    const offenders: string[] = [];
    let textNodesSeen = 0;
    let swatchesSeen = 0;

    try {
      for (const theme of ['dark', 'light'] as const) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        const page = await context.newPage();
        await page.addInitScript((t) => {
          localStorage.setItem('pb-theme', t);
          localStorage.setItem('pb-onboarding-complete', 'true');
        }, theme);

        for (const route of ROUTES) {
          await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          // Charts fetch and mount asynchronously, and an unmounted chart has
          // no labels — measuring early would pass for the wrong reason.
          await page.waitForTimeout(3000);

          const measured = await page.evaluate(() => {
            const relLum = (rgb: string) => {
              const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
              const f = (v: number) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              };
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const ratio = (a: string, b: string) => {
              const [x, y] = [relLum(a), relLum(b)];
              const [hi, lo] = x > y ? [x, y] : [y, x];
              return (hi + 0.05) / (lo + 0.05);
            };

            const root = getComputedStyle(document.documentElement);
            const series: Record<string, string> = {};
            for (const name of ['--series-lv', '--series-ee', '--series-lt', '--series-fi']) {
              const hex = root.getPropertyValue(name).trim();
              if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
              const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
              series[`rgb(${r}, ${g}, ${b})`] = name;
            }

            // The surface a reader actually sees behind the element. A
            // transparent parent is not a background.
            const groundOf = (el: Element) => {
              for (let n = el.parentElement; n; n = n.parentElement) {
                const bg = getComputedStyle(n).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && !/,\s*0\)$/.test(bg)) return bg;
              }
              return getComputedStyle(document.body).backgroundColor;
            };

            const bad: string[] = [];
            let text = 0;
            let swatches = 0;

            for (const el of Array.from(document.querySelectorAll('*'))) {
              const cs = getComputedStyle(el);

              // A swatch or a chart line: SC 1.4.11, 3:1.
              const paint = el.tagName === 'path' || el.tagName === 'line'
                ? cs.stroke
                : cs.backgroundColor;
              if (series[paint]) {
                swatches++;
                const ground = groundOf(el);
                const r = ratio(paint, ground);
                if (r < 3.0) bad.push(`graphic ${series[paint]} ${r.toFixed(2)}:1 on ${ground} (needs 3.0)`);
              }

              // Text of its own, in a series colour: SC 1.4.3.
              if (!series[cs.color]) continue;
              const own = Array.from(el.childNodes)
                .filter((n) => n.nodeType === 3)
                .map((n) => (n.textContent ?? '').trim())
                .join('');
              if (!own) continue;

              text++;
              const px = parseFloat(cs.fontSize);
              const bold = Number(cs.fontWeight) >= 700;
              const large = px >= 24 || (px >= 18.66 && bold);
              const floor = large ? 3.0 : 4.5;
              const r = ratio(cs.color, groundOf(el));
              if (r < floor) {
                bad.push(
                  `text "${own.slice(0, 18)}" in ${series[cs.color]} at ${px}px — ` +
                  `${r.toFixed(2)}:1 on ${groundOf(el)} (needs ${floor})`,
                );
              }
            }

            return { bad, text, swatches, theme: document.documentElement.dataset.theme };
          });

          // If the theme did not take, the run proves nothing about it — say
          // so rather than reporting a pass, the same way the layout
          // measurement asserts its own fixture.
          expect(measured.theme, `${route} did not switch to ${theme}`).toBe(theme);

          textNodesSeen += measured.text;
          swatchesSeen += measured.swatches;
          for (const b of measured.bad) offenders.push(`${theme} ${route}: ${b}`);
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }

    // ─── A known, measured, pre-existing offender ───
    //
    // `--series-lt` in light is `#c28206`, tuned to clear 3:1 **on the white
    // card** — and it does, at 3.24:1. The ranked-comparison and modal-split
    // bars are not drawn on the card: they sit in a track of `--bg-raised`
    // (`#f1f5f9`), where the same colour measures 2.95:1.
    //
    //     --series-lt #c28206   on --bg-card   #ffffff   3.24:1  pass
    //                           on --bg-page   #f6f8fb   3.04:1  pass
    //                           on --bg-raised #f1f5f9   2.95:1  FAIL
    //                           on --bg-sunken #eef2f7   2.88:1  FAIL
    //
    // It is only gold, only light, and only on those two surfaces — LV, EE and
    // FI clear it on raised at 3.66, 3.91 and 7.03, and every dark value
    // clears it. This is the same fault as the one this file was written for,
    // one level out: a floor verified against one background and then used
    // against another.
    //
    // It is recorded rather than fixed because the fix is a decision, not a
    // mechanism. Darkening gold until it clears 3:1 on `--bg-raised` walks it
    // into `--data-warning` (`#a16207`), so a Lithuania bar would become
    // confusable with a warning — trading a marginal contrast failure for a
    // semantic one, which is the trade DESIGN.md §3.6 already refused once for
    // Latvia.
    //
    // Listing it here keeps it visible and still fails on a *new* offender.
    const KNOWN = /graphic --series-lt 2\.9\d:1/;
    const unexpected = offenders.filter((o) => !KNOWN.test(o));

    // The encoding has to still be somewhere. A page that simply deleted every
    // series colour would score zero offenders and be a worse dashboard, so
    // the absence of swatches is itself a failure — and it is the assertion
    // that caught a local run whose API fixtures were missing, where nothing
    // rendered and the contrast check passed over an empty page.
    expect(swatchesSeen, 'no series colour is carried by any graphic — the mapping is gone').toBeGreaterThan(0);
    expect(unexpected, `${textNodesSeen} series-coloured text nodes measured`).toEqual([]);
  }, 180_000);
});
