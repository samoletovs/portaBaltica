/**
 * Nothing on the deployed site is a tab stop without a name.
 *
 * WHAT THIS IS REALLY WATCHING FOR
 * -------------------------------
 * Not the charts — `chartNames.live.test.ts` owns those, and recharts names
 * them explicitly. This watches for the case nobody writes on purpose: **a
 * scroll container with no focusable children**.
 *
 * Chromium 127+ makes an overflowing scroll container keyboard-focusable so it
 * can be scrolled by keyboard. If it contains a link or a button, the browser
 * leaves it alone. If it contains only text, it becomes a tab stop of its own —
 * `role="generic"`, no accessible name, announced as nothing.
 *
 * `InsightsBanner` was that case, and the population measurement is the reason
 * this guard is worth its runtime. Forcing every scroll strip on the site to
 * overflow at 375px:
 *
 *     <div>  kids= 9  header controls        ok
 *     <nav>  kids=11  "Site sections"        ok
 *     <div>  kids= 0  InsightsBanner         TAB STOP, UNNAMED
 *     <div>  kids= 9  SectionRail            ok
 *     <nav>  kids= 4  "Sections"             ok
 *     <div>  kids=10  "Filter by section"    ok
 *
 * **The other five are safe by accident, not by design.** They contain links,
 * and a focusable child suppresses the container's own stop. So the next
 * link-free strip anyone adds inherits the bug, and inherits it silently —
 * there is nothing to notice in review, because the defect is the browser's
 * default rather than anything in the diff.
 *
 * WHY THE NARROW WIDTH
 * --------------------
 * Overflow depends on how much the strip is asked to hold, and the insights row
 * renders a variable number of cards. Sampled four times at each width within
 * one minute:
 *
 *     375px    over=1006  cards=4      over=1006  cards=4      4 of 4 overflow
 *    1440px    over= 117  cards=4      over=   0  cards=2      3 of 4 overflow
 *
 * So the defect is **permanent at phone width and intermittent at desktop**,
 * and the intermittency is not subtle content drift — it is whether the row
 * happens to render four cards or two. An earlier audit at desktop width saw
 * the unnamed stop in one run of four; this sample saw it in three of four.
 * Either way a desktop-only check reports clean on some runs while every phone
 * user meets the defect on every visit.
 *
 * This is not a claim that a desktop check would never catch it — measured, it
 * usually would. It is that only the narrow width answers the same way twice.
 *
 * WHAT IT DOES NOT ASSERT
 * -----------------------
 * The stop *count*, which moves legitimately with that same card count. Only
 * that none of them is anonymous.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const BLOB = 'https://stportabalticabpmff5so.blob.core.windows.net/articles';

/**
 * Narrow enough that every scroll strip on the site overflows.
 *
 * One width, not two. A width costs about half a minute for three routes —
 * measured 29.0s at 375px and 31.3s at 1440px — so a second would roughly
 * double this file's share of a post-deploy suite that already runs for five
 * minutes, and the charts are walked at desktop width by
 * `chartNames.live.test.ts` regardless.
 */
const WIDTH = 375;

/** A floor for "the page rendered", not a count anyone should maintain. */
const MIN_STOPS = 20;

type Stop = { idx: number; tag: string; id: string | null; text: string; name: string | null; role: string | null };
type RouteResult = { label: string; stops: Stop[]; controlNamed: string | null; controlAnon: string | null; hasFocus: boolean };

let browser: Awaited<ReturnType<typeof launchForLiveCheck>> = null;
const results: RouteResult[] = [];

async function walk(label: string, path: string): Promise<RouteResult> {
  const page = await browser!.newPage({ viewport: { width: WIDTH, height: 800 } });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // `:focus-visible` cannot be observed in an unfocused window, and every
  // element would report no outline. Assert it rather than discovering it.
  const hasFocus = await page.evaluate(() => document.hasFocus());

  // Two planted stops, walked with everything else: one named, one deliberately
  // nameless. Without the second, "0 unnamed" and "the detector stopped
  // working" are the same reading.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'pb-ctl';
    host.innerHTML = '<button id="pb-ctl-named">Control: named</button><button id="pb-ctl-anon"></button>';
    document.body.prepend(host);
    // Focus a known element rather than blurring: Chromium keeps a sequential
    // focus navigation starting point that `blur()` does not reset, and a walk
    // begun from wherever focus happened to be starts mid-page and truncates.
    document.getElementById('pb-ctl-named')!.focus();
  });

  const raw: Omit<Stop, 'name' | 'role'>[] = [];
  for (let i = 0; i < 500; i++) {
    const stop = await page.evaluate((idx) => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      // Wrap detected on the element's own identity. A synthesised
      // tag/position key can collide, and a collision silently truncates.
      if (el.hasAttribute('data-tab-stop')) return null;
      el.setAttribute('data-tab-stop', String(idx));
      return { idx, tag: el.tagName.toLowerCase(), id: el.id || null,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44) };
    }, i);
    if (!stop) break;
    raw.push(stop);
    await page.keyboard.press('Tab');
  }

  // Names from Chromium's own accessibility tree: an `aria-label` can be
  // present while the computed name is empty, and it is the computed name a
  // reader receives. Detached after use — a session held across routes enables
  // agents that survive navigation and truncate the next route's walk.
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const marks = new Map<number, string>();
  (function collect(node: { attributes?: string[]; children?: unknown[]; contentDocument?: unknown; backendNodeId: number }) {
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'data-tab-stop') marks.set(node.backendNodeId, attrs[i + 1]);
    for (const child of (node.children ?? []) as typeof node[]) collect(child);
    if (node.contentDocument) collect(node.contentDocument as typeof node);
  })(root as never);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const ax = new Map<string, { name: string | null; role: string | null }>();
  for (const node of nodes as { backendDOMNodeId?: number; role?: { value?: string }; name?: { value?: string } }[]) {
    const mark = node.backendDOMNodeId === undefined ? undefined : marks.get(node.backendDOMNodeId);
    if (mark === undefined) continue;
    ax.set(mark, { name: (node.name?.value ?? '').trim() || null, role: node.role?.value ?? null });
  }
  await cdp.detach();

  const all: Stop[] = raw.map((s) => ({ ...s, ...(ax.get(String(s.idx)) ?? { name: null, role: null }) }));
  await page.close();

  return {
    label,
    hasFocus,
    stops: all.filter((s) => s.id !== 'pb-ctl-named' && s.id !== 'pb-ctl-anon'),
    controlNamed: all.find((s) => s.id === 'pb-ctl-named')?.name ?? null,
    controlAnon: all.find((s) => s.id === 'pb-ctl-anon')?.name ?? null,
  };
}

beforeAll(async () => {
  browser = await launchForLiveCheck();
  if (!browser) return;

  // The article is derived rather than named, so this keeps working as the
  // archive turns over.
  const index = await (await fetch(`${BLOB}/index.json`)).json();
  const list = Array.isArray(index) ? index : (index.articles ?? []);
  const article = list.find((a: { status?: string; tier?: string }) => a.status === 'published' && a.tier !== 'C');

  for (const [label, path] of [
    ['/data', '/data'],
    ['/', '/'],
    ['/article/:slug', `/article/${article.slug}`],
  ] as const) {
    results.push(await walk(label, path));
  }
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

describe('no tab stop on the deployed site is anonymous', () => {
  it('walked every route and found stops, so nothing passes vacuously', () => {
    if (!browser) return;
    expect(results.length, 'no routes were walked').toBe(3);
    for (const route of results) {
      expect(route.stops.length, `${route.label}: no tab stops found at all`).toBeGreaterThanOrEqual(MIN_STOPS);
    }
  });

  it('read focus in a focused window, so the walk means anything', () => {
    if (!browser) return;
    for (const route of results) {
      expect(route.hasFocus, `${route.label}: document.hasFocus() is false, so focus readings are void`).toBe(true);
    }
  });

  it('can still tell a named stop from a nameless one', () => {
    if (!browser) return;
    // The instrument control, walked with the real stops rather than measured
    // separately. If a nameless button reads as named, the assertion below
    // cannot fail and its pass means nothing.
    for (const route of results) {
      expect(route.controlNamed, `${route.label}: the named control lost its name`).toBe('Control: named');
      expect(route.controlAnon, `${route.label}: a nameless control read as named, so this check cannot fail`).toBeNull();
    }
  });

  it('gives every stop an accessible name', () => {
    if (!browser) return;
    const anonymous = results.flatMap((route) =>
      route.stops
        .filter((s) => !s.name)
        .map((s) => ({ route: route.label, tag: s.tag, role: s.role, text: s.text })),
    );
    expect(
      anonymous,
      'these are reachable by keyboard and announce as nothing. A scroll container ' +
        'with no focusable children is the usual cause: Chromium makes it focusable ' +
        'so it can be scrolled, and names it only if you do.',
    ).toEqual([]);
  });
});
