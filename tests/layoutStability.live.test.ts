import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * The front page must not jump about while it loads.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * Nothing measured layout stability at all. Measured against production on
 * 2026-09-02, five runs per width with zero variance:
 *
 *     375  CLS 0.6892      768  CLS 0.6654
 *    1024  CLS 0.7273     1280  CLS 0.5819
 *
 * Google calls anything above 0.25 poor, so the page a reader most often
 * arrives at was between 2.2x and 2.9x that. One shift at 745-966ms did almost
 * all of it.
 *
 * WHY IT HAPPENED, WHICH IS THE PART WORTH KNOWING
 * ------------------------------------------------
 * The loading skeleton and the loaded feed were both a `<div>` containing a
 * `<div>` containing boxes, so React reconciled one into the other rather than
 * replacing it. Every skeleton bar became an article card **in place** — the
 * shift record named a node whose `previousRect` height was exactly 160px, the
 * `h-40` of the first bar. A node that moves is a layout shift; a node removed
 * and a different node inserted is not. Distinct `key`s on the two trees make
 * it the second thing.
 *
 * That alone took it to 0.079-0.131. Reserving the space the loaded page needs
 * — a viewport minimum, and the section filter's own height — took it to zero:
 *
 *     production        0.689   0.665   0.727   0.582
 *     keys only         0.131   0.097   0.099   0.079
 *     keys + reserve    0.000   0.000   0.000   0.000
 *
 * Both halves were measured separately, because a change that fixes nothing
 * measurable should not be kept. A third — moving the `Suspense` boundary into
 * the layouts so the masthead renders before the page chunk — produced numbers
 * byte-identical to without it, and was dropped for exactly that reason.
 *
 * WHY THE CONTROL IS NOT OPTIONAL
 * -------------------------------
 * This test's healthy reading is **zero**, and a zero is what a broken probe
 * returns. `PerformanceObserver` silently yields nothing if the entry type is
 * unsupported, if the observer is registered after the shifts happen, or if
 * the page never loaded. So after taking the reading, this deliberately causes
 * a shift and requires the same observer to report it. Without that, a pass
 * here is equally consistent with the instrument being dead.
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Google's "good" boundary. The fix measures 0.000; this is the ceiling. */
const GOOD_CLS = 0.1;

/** Either side of the layout's breakpoints, where the feed's shape changes. */
const WIDTHS = [375, 768, 1280];

type Driver = {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
};

describe('layout stability on the deployed front page', () => {
  it('settles without moving what a reader is already looking at', async () => {
    const browser = await launchForLiveCheck();
    if (!browser) return;

    const readings: { width: number; cls: number; articles: number; afterShift: number }[] = [];

    try {
      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        // Registered before any navigation, so the observer is live for the
        // very first frame. `buffered` alone would not cover a script that
        // arrives after the shift it is meant to see.
        await context.addInitScript(() => {
          localStorage.setItem('pb-onboarding-complete', 'true');
          (window as unknown as { __cls: number }).__cls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
              if (shift.hadRecentInput) continue;
              (window as unknown as { __cls: number }).__cls += shift.value ?? 0;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });

        const page = (await context.newPage()) as unknown as Driver;
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // Long enough for the feed fetch, the corrections fetch and the fonts.
        await page.waitForTimeout(6000);

        const measured = await page.evaluate(() => ({
          cls: Number(((window as unknown as { __cls: number }).__cls ?? 0).toFixed(4)),
          articles: document.querySelectorAll('a[href^="/article/"]').length,
        }));

        // THE POSITIVE CONTROL. Push everything down by a third of the
        // viewport and require the same observer to notice. A reading of zero
        // is only evidence once the instrument has been shown to be alive.
        const afterShift = await page.evaluate(() => {
          const spacer = document.createElement('div');
          spacer.style.height = '300px';
          document.body.insertBefore(spacer, document.body.firstChild);
          return new Promise<number>((resolve) => {
            setTimeout(
              () => resolve(Number(((window as unknown as { __cls: number }).__cls ?? 0).toFixed(4))),
              1200,
            );
          });
        });

        readings.push({ width, ...measured, afterShift });
        await context.close();
      }
    } finally {
      await browser.close();
    }

    for (const r of readings) {
      // VACUITY GUARD. An empty feed cannot shift, so it would pass this
      // trivially — the same trap that made a rail measurement look perfect
      // against a page carrying no articles.
      expect(
        r.articles,
        `only ${r.articles} articles at ${r.width}px; a page with no feed on it cannot ` +
          'demonstrate a stable feed',
      ).toBeGreaterThan(5);

      expect(
        r.afterShift,
        `at ${r.width}px the observer did not report a shift this test caused on purpose, ` +
          `so its reading of ${r.cls} is a fact about the instrument rather than about the page`,
      ).toBeGreaterThan(r.cls);
    }

    const poor = readings
      .filter((r) => r.cls > GOOD_CLS)
      .map((r) => `${r.width}px: CLS ${r.cls}`);

    expect(
      poor,
      'the front page moves under the reader while it loads. It was 0.58-0.73 before the ' +
        'skeleton was keyed separately from the feed and given the space the feed needs; ' +
        'anything above 0.1 means one of those has come undone.',
    ).toEqual([]);
  }, 300_000);
});
