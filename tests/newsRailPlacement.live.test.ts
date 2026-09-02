import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * The "Elsewhere in the Baltics" rail must be a sidebar wherever there is room
 * for one.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * The rail is the second child of the front page's grid, so in a single column
 * it lands after the *whole* feed rather than beside it. That is correct on a
 * phone and wrong on a tablet, and nothing measured which of the two a given
 * width got.
 *
 * The breakpoint was `lg:` (1024px). Measured against production at
 * 2026-09-02T07:3xZ, with the rail located by its heading text:
 *
 *     w=  768   railTop=11042   12.3 screens down   sidebar=no
 *     w= 1023   railTop= 9750   10.8 screens down   sidebar=no
 *     w= 1024   railTop=  334    0.4 screens down   sidebar=YES
 *
 * A tablet reader never reached it. The band below the cliff was not short of
 * room either: the newsroom container is `max-w-5xl`, so 1023px carries 975px
 * of content against 976px at 1024px — one pixel of viewport on either side of
 * a completely different layout.
 *
 * WHY POSITION AND NOT A CLASS NAME
 * ---------------------------------
 * The obvious check is that `NewsFeed.tsx` contains `md:grid-cols-...`. That is
 * a lexical proxy for a layout property, which `AGENTS.md` is explicit about:
 * it encodes today's spelling rather than the rule, and it would keep passing
 * if a container width, a `max-w`, or the grid's own nesting changed underneath
 * it. This reads the rendered geometry in a browser instead, which is the only
 * place the question is actually decided.
 *
 * WHY THE NEGATIVE CONTROL IS NOT DECORATION
 * ------------------------------------------
 * "The rail is near the top" passes trivially on an empty feed, on a page that
 * failed to render its articles, and on any bug that collapses the main column.
 * So the phone width is asserted in the *opposite* direction: at 375px the rail
 * must still be far below the column it follows. Without that, this file could
 * report a pass for a front page with no journalism on it.
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Widths that have room for a sidebar and must therefore render one. */
const SIDEBAR_WIDTHS = [768, 900, 1023, 1024, 1280];

/** A width that must NOT, so the measurement is proved able to say no. */
const STACKED_WIDTH = 375;

/**
 * How far the rail's top may sit below the main column's top and still count as
 * "the same grid row".
 *
 * Not zero: the two columns start at the same grid line but the rail's first
 * painted box is its heading, which carries its own border and padding, and the
 * main column leads with a card. Measured on the fix, the gap is 0-52px across
 * the five widths. 200 leaves room for a heading to grow without turning this
 * into a test of the heading.
 */
const SAME_ROW_PX = 200;

/**
 * How far below it must sit to count as stacked.
 *
 * The stacked case puts the entire feed in between, which is over ten thousand
 * pixels with the corpus this site carries. 1000 is far outside any plausible
 * same-row gap and far inside any plausible stacked one, so the two verdicts
 * cannot meet in the middle.
 */
const STACKED_PX = 1000;

type Measurement = {
  railFound: boolean;
  railTop: number | null;
  mainTop: number | null;
  mainHeight: number | null;
  articles: number;
};

/**
 * Just enough of a page to ask it a question.
 *
 * Typed structurally rather than as `import('playwright').Page` because
 * `tests/liveBrowserWiring.test.ts` asserts that `liveBrowser.ts` is the only
 * file naming playwright — a lexical guard, so a type-only reference trips it
 * too. That guard is right to be blunt: the failure it prevents is a live file
 * launching its own browser and skipping silently on a runner. Naming the one
 * method this file uses is cheaper than an exemption, and states more.
 */
type PageUnderMeasurement = {
  evaluate<T>(fn: () => T): Promise<T>;
};

async function measure(page: PageUnderMeasurement): Promise<Measurement> {
  return page.evaluate(() => {
    const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Found by its heading rather than by a class, so a class rename shows up
    // as a failure here rather than as a probe that quietly finds nothing.
    const heading = [...document.querySelectorAll('h1,h2,h3')].find((h) =>
      norm(h.textContent).includes('elsewhere'),
    );
    const rail = heading ? heading.closest('aside') : null;

    const links = [...document.querySelectorAll('a[href^="/article/"]')];
    const main = links.length ? links[0].closest('div[class*="grid"] > div') : null;

    const top = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;

    return {
      railFound: Boolean(heading),
      railTop: top(rail),
      mainTop: top(main),
      mainHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
      articles: links.length,
    };
  });
}

describe('the elsewhere rail on the deployed front page', () => {
  it('is a sidebar at every width with room for one, and stacked where there is not', async () => {
    // Skips locally without a browser; throws in CI, where a skip would be a
    // pass for a check that never ran. See `tests/liveBrowser.ts`.
    const browser = await launchForLiveCheck();
    if (!browser) return;

    const readings: (Measurement & { width: number })[] = [];

    try {
      const context = await browser.newContext({
        viewport: { width: SIDEBAR_WIDTHS[0], height: 900 },
      });
      const page = await context.newPage();

      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // The feed is fetched, so measuring before it lands would find one
      // article and a rail near the top — a pass for the wrong reason, which
      // is precisely what the negative control below exists to refuse.
      await page.waitForTimeout(2500);

      for (const width of [...SIDEBAR_WIDTHS, STACKED_WIDTH]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(600);
        readings.push({ width, ...(await measure(page)) });
      }
    } finally {
      await browser.close();
    }

    const byWidth = new Map(readings.map((r) => [r.width, r]));

    // VACUITY GUARD. Everything below is a statement about where the rail sits
    // relative to a long column of articles. On a short or empty feed the
    // question is not being asked at all, and both the assertion and its
    // control would pass without measuring anything.
    for (const reading of readings) {
      expect(
        reading.railFound,
        `no "Elsewhere" heading at ${reading.width}px — the rail is missing from the ` +
          'deployed front page, or its heading was renamed and this check can no ' +
          'longer see it. Either way nothing below is measuring the layout.',
      ).toBe(true);

      expect(
        reading.articles,
        `only ${reading.articles} articles at ${reading.width}px; this check needs a ` +
          'feed long enough for a stacked rail to be far away',
      ).toBeGreaterThanOrEqual(5);

      expect(
        reading.mainHeight ?? 0,
        `the main column is ${reading.mainHeight}px at ${reading.width}px, which is too ` +
          'short for the stacked and side-by-side cases to be distinguishable',
      ).toBeGreaterThan(1500);
    }

    // THE ASSERTION. A sidebar starts on the same grid row as the column it
    // sits beside.
    const notSidebar = SIDEBAR_WIDTHS.filter((width) => {
      const r = byWidth.get(width)!;
      return (r.railTop ?? Infinity) - (r.mainTop ?? 0) > SAME_ROW_PX;
    }).map((width) => {
      const r = byWidth.get(width)!;
      return `${width}px: rail at ${r.railTop}, column starts at ${r.mainTop}`;
    });

    expect(
      notSidebar,
      'the elsewhere rail is stacked below the whole feed at a width with room for a ' +
        'sidebar. A reader at this width has to scroll past every article to find out ' +
        'that other outlets are covered at all.',
    ).toEqual([]);

    // THE NEGATIVE CONTROL. If this also came out "same row", the measurement
    // above would be satisfied by any page and would prove nothing.
    const stacked = byWidth.get(STACKED_WIDTH)!;
    expect(
      (stacked.railTop ?? 0) - (stacked.mainTop ?? 0),
      `at ${STACKED_WIDTH}px the rail should follow the feed, not sit beside it. ` +
        'It reading as a sidebar here means this check cannot tell the two layouts ' +
        'apart, and its pass above is worthless.',
    ).toBeGreaterThan(STACKED_PX);
  }, 120_000);
});
