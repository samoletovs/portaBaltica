/**
 * Chart series stay legible when the reader forces a high-contrast palette.
 *
 * WHAT THIS CATCHES
 * -----------------
 * A Windows high-contrast theme remaps CSS colours to the user's palette. It
 * does not remap an SVG `stroke`, which is author paint rather than a colour
 * property. So the surface under a chart is replaced and the lines on it are
 * not, and the pairing that `seriesContrast.live.test.ts` verified no longer
 * describes what is on screen.
 *
 * Measured against production before the fix, `/data`, 222 stroke elements in
 * eight distinct colours:
 *
 *     forced-colors  scheme  surface              below 3:1
 *     none           light   rgb(10, 15, 26)      0 of 8
 *     none           dark    rgb(10, 15, 26)      0 of 8
 *     active         dark    rgb(0, 0, 0)         0 of 8
 *     active         light   rgb(255,255,255)     4 of 8  -- 1.67 1.77 2.21 2.51
 *
 * WHY THE CONTROL ROW IS NOT OPTIONAL
 * -----------------------------------
 * Three of those four rows pass, and a check that only ran the failing one
 * could not tell "the fix worked" from "the page did not load, so there were
 * no strokes to measure". So every run asserts a stroke count first, and walks
 * both forced-colours states: the `none` rows are the positive control, and
 * they are measured on the same page by the same code.
 *
 * This is a different question from the one `tests/design-system.test.ts`
 * answers. That guard reads declared colour families out of the stylesheet and
 * computes ratios between tokens. Here neither side is a token: the surface is
 * chosen by the browser at runtime and the stroke is whatever recharts painted,
 * so it can only be measured in a real engine on the real page.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { launchForLiveCheck } from './liveBrowser';

/**
 * Typed from the helper's own return rather than imported from `playwright`.
 * `tests/liveBrowserWiring.test.ts` fails any live file that imports the
 * package directly — a type-only import is erased at runtime and would not
 * have skipped anything, but the guard is a population check and an exception
 * for "only a type" is how that population stops being the whole one.
 */
type LiveBrowser = Awaited<ReturnType<typeof launchForLiveCheck>>;

const BASE = 'https://portabaltica.naurolabs.com';

/** WCAG 2.2 SC 1.4.11: a graphical object needed to understand the content. */
const NON_TEXT_FLOOR = 3;

/** Enough strokes that an empty page cannot be mistaken for a clean result. */
const MIN_STROKES = 8;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: number[]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number[], b: number[]): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function rgb(value: string): number[] | null {
  const parts = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return parts.length === 3 ? parts : null;
}

type Painted = { stroke: string; surface: string };

describe('chart series under a forced-colours palette (live)', () => {
  let browser: LiveBrowser | null = null;

  beforeAll(async () => {
    browser = await launchForLiveCheck();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  /**
   * Each stroke paired with the surface actually painted behind it.
   *
   * The nearest painted ancestor, not `body`: the whole point of the fix is
   * that the chart carries its own background again, so reading the page
   * background would report the state we are trying to leave rather than the
   * one we are in.
   */
  async function paintedPairs(forcedColors: 'active' | 'none', colorScheme: 'light' | 'dark') {
    const context = await browser!.newContext({
      viewport: { width: 1440, height: 1200 },
      forcedColors,
      colorScheme,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE}/data`, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForTimeout(2_500);
      return (await page.evaluate(() => {
        const out: { stroke: string; surface: string }[] = [];
        const paths = document.querySelectorAll('path.recharts-curve, .recharts-line path');
        for (const path of paths) {
          const stroke = getComputedStyle(path).stroke;
          if (!stroke || stroke === 'none') continue;
          let node: Element | null = path.parentElement;
          let surface: string | null = null;
          while (node) {
            const background = getComputedStyle(node).backgroundColor;
            if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
              surface = background;
              break;
            }
            node = node.parentElement;
          }
          out.push({ stroke, surface: surface ?? getComputedStyle(document.body).backgroundColor });
        }
        return out;
      })) as Painted[];
    } finally {
      await context.close();
    }
  }

  function failures(pairs: Painted[]) {
    const seen = new Map<string, number>();
    for (const { stroke, surface } of pairs) {
      const a = rgb(stroke);
      const b = rgb(surface);
      if (!a || !b) continue;
      const ratio = contrast(a, b);
      if (ratio < NON_TEXT_FLOOR) seen.set(`${stroke} on ${surface}`, ratio);
    }
    return [...seen.entries()].map(([pair, ratio]) => `${pair} = ${ratio.toFixed(2)}:1`);
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    it(`keeps every series above the non-text floor with forced colours and a ${colorScheme} palette`, async () => {
      const pairs = await paintedPairs('active', colorScheme);

      expect(
        pairs.length,
        'no chart strokes were found, so this assertion would pass on a blank page',
      ).toBeGreaterThanOrEqual(MIN_STROKES);

      expect(
        failures(pairs),
        `a reader using a ${colorScheme} high-contrast theme cannot see these lines`,
      ).toEqual([]);
    }, 120_000);

    it(`is measured against a passing control with forced colours off and a ${colorScheme} palette`, async () => {
      // The positive control. If this ever fails, the run above proves nothing:
      // the fault would be in the page or the probe rather than in the mode.
      const pairs = await paintedPairs('none', colorScheme);

      expect(pairs.length, 'no chart strokes were found in the control either').toBeGreaterThanOrEqual(
        MIN_STROKES,
      );
      expect(
        failures(pairs),
        'the control failed, so the forced-colours result above is not attributable to the mode',
      ).toEqual([]);
    }, 120_000);
  }
});
