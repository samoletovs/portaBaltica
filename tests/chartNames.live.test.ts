/**
 * Every chart on the deployed dashboard announces what it plots.
 *
 * WHY THIS CANNOT BE A SOURCE TEST, AND WHY THAT IS THE WHOLE POINT
 * ----------------------------------------------------------------
 * Recharts injects `role="application"` and `tabIndex={0}` onto its own `<svg>`
 * at runtime. Nothing in `src/` carries those attributes, so **no grep over the
 * source can ever see them** — a search for the rule returns only the comments
 * explaining it. That is not hypothetical: this gap was once marked fixed on
 * the strength of a grep whose single hit was such a comment, and the closure
 * had to be retracted.
 *
 * The existing unit tests are both good and both blind to this:
 *
 *   - `chartAccessibility.test.ts` proves `describeSeries` / `describeComparison`
 *     produce a true, useful sentence. It never asks whether any component calls
 *     them.
 *   - `chartKeyboard.test.tsx` proves what recharts puts in the tab order, using
 *     a synthetic chart. It never asks what the six real chart components do.
 *
 * So the describer is tested, the library's behaviour is tested, and **the
 * wiring between them is tested nowhere**. Six components render a recharts
 * surface — `BalticCompareChart`, `EconomyTile`, `GridStatePanel`,
 * `IndicatorCard`, `IndicatorTable`, `PowerMarketCard` — and a seventh added
 * tomorrow would inherit an unnamed, focusable `application` by default,
 * silently, because that is recharts' default rather than an omission anyone
 * would notice in review.
 *
 * WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------
 * It asserts that every chart surface carries an accessible name. It does NOT
 * assert that the page has no unnamed tab stops at all, which is the tempting
 * stronger claim and would be wrong today: an overflowing scroll strip with no
 * focusable children becomes an unnamed `generic` stop in Chromium 127+, and
 * that is a live, separately-reported defect rather than something this guard
 * should absorb. A check that fails for a reason it was not written to catch
 * teaches people to ignore it.
 *
 * Measured on production 2026-08-31T08:18Z: 43 surfaces, 43 with a name.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/**
 * The fewest chart surfaces `/data` can plausibly render.
 *
 * The anti-vacuity guard. "0 surfaces, 0 unnamed" passes every assertion below
 * while proving nothing, and that is the exact failure this file exists to
 * prevent one layer down — so the population is asserted before its contents
 * are. Deliberately far below the 43 measured, because this is a floor for
 * "the page rendered its charts", not a count anybody should have to update
 * when a tile is added or removed.
 */
const MIN_SURFACES = 20;

type Surface = { mark: string; label: string | null; axRole: string | null; axName: string | null };

let browser: Awaited<ReturnType<typeof launchForLiveCheck>> = null;
let surfaces: Surface[] = [];
/** A planted, deliberately nameless surface — the instrument control. */
let planted: Surface | undefined;

beforeAll(async () => {
  browser = await launchForLiveCheck();
  if (!browser) return;

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/data`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Mark every chart surface, plus one planted nameless one. The planted
  // surface is measured by the same path as the real ones, so a detector that
  // has stopped being able to report "unnamed" fails here rather than passing
  // the whole file.
  const labels: Record<string, string | null> = await page.evaluate(() => {
    const out: Record<string, string | null> = {};
    document.querySelectorAll('[role="application"]').forEach((el, i) => {
      el.setAttribute('data-chart-mark', String(i));
      out[String(i)] = (el.getAttribute('aria-label') || '').trim() || null;
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'application');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('data-chart-mark', 'planted');
    document.body.appendChild(svg);
    out.planted = null;
    return out;
  });

  // Names come from Chromium's own accessibility tree, not from reading the
  // `aria-label` attribute back — an attribute can be present and the computed
  // name still empty, and it is the computed name a reader receives.
  //
  // The session is detached after use. A single session held across routes
  // silently breaks the next page's keyboard walk, because `DOM.getDocument`
  // and `Accessibility.getFullAXTree` implicitly enable agents that survive
  // navigation. Only one route is visited here, but the habit is the fix.
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const marks = new Map<number, string>();
  (function walk(node: { attributes?: string[]; children?: unknown[]; contentDocument?: unknown; backendNodeId: number }) {
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'data-chart-mark') marks.set(node.backendNodeId, attrs[i + 1]);
    }
    for (const child of (node.children ?? []) as typeof node[]) walk(child);
    if (node.contentDocument) walk(node.contentDocument as typeof node);
  })(root as never);

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const found: Surface[] = [];
  for (const node of nodes as { backendDOMNodeId?: number; role?: { value?: string }; name?: { value?: string } }[]) {
    const mark = node.backendDOMNodeId === undefined ? undefined : marks.get(node.backendDOMNodeId);
    if (mark === undefined) continue;
    found.push({
      mark,
      label: labels[mark] ?? null,
      axRole: node.role?.value ?? null,
      axName: (node.name?.value ?? '').trim() || null,
    });
  }
  await cdp.detach();
  await page.close();

  planted = found.find((s) => s.mark === 'planted');
  surfaces = found.filter((s) => s.mark !== 'planted');
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

describe('every chart on the deployed dashboard says what it plots', () => {
  it('found charts to check, so none of this can pass vacuously', () => {
    if (!browser) return;
    expect(
      surfaces.length,
      'no chart surfaces were found on /data, so every assertion below is empty',
    ).toBeGreaterThanOrEqual(MIN_SURFACES);
  });

  it('can still report a surface as unnamed', () => {
    if (!browser) return;
    // The instrument control. A nameless surface was planted alongside the real
    // ones; if it comes back named, the detector cannot fail and the result
    // above means nothing.
    expect(planted, 'the planted control surface was not measured at all').toBeDefined();
    expect(planted!.axRole, 'the planted control is not being read as a chart surface').toBe('application');
    expect(planted!.axName, 'a surface with no label read as named, so this check cannot fail').toBeNull();
  });

  it('gives every one of them an accessible name', () => {
    if (!browser) return;
    const anonymous = surfaces.filter((s) => !s.axName);
    expect(
      anonymous.map((s) => s.mark),
      'these charts announce as anonymous graphics — recharts names nothing by default, ' +
        'so a chart component that does not pass a description gets this silently',
    ).toEqual([]);
  });

  it('names them with something descriptive rather than a placeholder', () => {
    if (!browser) return;
    // A name is not automatically a useful name. `describeSeries` says what is
    // plotted and over what span, so a real one is a sentence; "chart" would
    // satisfy the check above and tell a reader nothing.
    const thin = surfaces.filter((s) => (s.axName ?? '').length < 20);
    expect(thin.map((s) => ({ mark: s.mark, name: s.axName })), 'these names are too short to describe anything').toEqual([]);
  });
});
