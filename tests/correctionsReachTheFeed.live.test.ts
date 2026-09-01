/**
 * Does a corrected article say so where a reader meets it?
 *
 * WHAT WAS WRONG, MEASURED
 * ------------------------
 * On 2026-09-01, against production: 18 of the 93 articles in the live index
 * carried a correction and **none of them said so** on `/` or on `/weekly`.
 * Several of those headlines are the withdrawn claim — "hits record 38.5%",
 * "drops to a record low", "set record with 1,175 thousand tonnes". The article
 * page and `/corrections` both rendered the notice correctly, so every check we
 * had was green while the front page carried the retracted superlative unmarked.
 *
 * WHY A BROWSER, AND WHY NOT A UNIT TEST
 * --------------------------------------
 * `tests/feedCorrections.test.tsx` proves the components mark what they are
 * told to mark. It cannot prove a reader gets it: the site is a single-page app
 * whose served `<body>` is 51 bytes, jsdom does not lay out, and a marker can be
 * present in the DOM and absent from every reader. So this reads the
 * accessibility tree the browser itself computes, the same instrument and for
 * the same reason as `tests/correctionsRender.live.test.ts`, which covers the
 * two surfaces that already worked.
 *
 * WHY IT IS SCOPED TO EACH ARTICLE
 * --------------------------------
 * A page-scoped `toContain('Corrected')` would pass on a feed where one card is
 * marked and seventeen are not, and would pass again on a page that merely
 * mentions corrections in its footer — this site links to `/corrections` from
 * the masthead of every page. Every assertion here is tied to the container
 * holding one headline, so it can only be satisfied by the marker being where
 * the claim is. That is the same lesson `DESIGN.md` records about the chart
 * checks: a file-scoped version read green over an undescribed chart because
 * something unrelated in the same file happened to match.
 *
 * WHY IT FOLLOWS THE LOG RATHER THAN NAMING A SLUG
 * ------------------------------------------------
 * Naming an article would pass forever for that one and say nothing about the
 * next correction, which is the one that will be broken. Every subject is
 * derived from `corrections.json`, so the check grows with the log.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchForLiveCheck } from './liveBrowser';

/**
 * Derived rather than imported — `tests/liveBrowserWiring.test.ts` forbids any
 * other file naming playwright, and a type-only import would trip it just the
 * same.
 */
type LiveBrowser = NonNullable<Awaited<ReturnType<typeof launchForLiveCheck>>>;

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** The marker itself. */
const BADGE = 'Corrected';
/** A badge every one of our own cards carries, whatever else is true of it. */
const CONTROL_BADGE = 'Our analysis';

/**
 * Where the deployed bundle reads articles from, read out of the workflow.
 *
 * A copy here would be a second source of truth that can disagree with the one
 * that ships, and it would disagree *silently*: a wrong path 404s into the SPA
 * fallback, which answers HTTP 200 with HTML. Same helper, same reasoning, as
 * `correctionsRender.live.test.ts`.
 */
function articlesBase(): string {
  const workflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf-8');
  const match = /VITE_ARTICLES_BASE_URL:\s*(\S+)/.exec(workflow);
  if (!match) {
    throw new Error(
      'deploy.yml no longer sets VITE_ARTICLES_BASE_URL, so this check does not ' +
        'know where the deployed site reads articles from and must not guess.',
    );
  }
  return match[1].replace(/\/$/, '');
}

interface LogEntry {
  slug: string;
  headline: string;
  corrected_at: string;
  description: string;
}

interface IndexEntry {
  slug: string;
  headline: string;
  tier: string;
  format?: string;
}

const ARTICLES = articlesBase();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The aria serialiser emits YAML, so a quote inside a name comes back escaped. */
const axText = (snapshot: string) => norm(snapshot).replace(/\\(["\\])/g, '$1');

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

let browser: LiveBrowser | null = null;
let log: LogEntry[] = [];
let indexed: IndexEntry[] = [];
/** Corrected slugs that are actually on the front page, and clean ones. */
let correctedOnFeed: string[] = [];
let cleanOnFeed: string[] = [];

beforeAll(async () => {
  log = await getJson<LogEntry[]>(`${ARTICLES}/corrections.json`);
  const index = await getJson<{ articles: IndexEntry[] }>(`${ARTICLES}/index.json`);
  indexed = index.articles ?? [];

  const correctedSlugs = new Set(log.map((entry) => entry.slug));
  // Tier C is somebody else's story behind a link out; we do not correct those.
  const ours = indexed.filter((entry) => entry.tier !== 'C');
  correctedOnFeed = ours.filter((e) => correctedSlugs.has(e.slug)).map((e) => e.slug);
  cleanOnFeed = ours.filter((e) => !correctedSlugs.has(e.slug)).map((e) => e.slug);

  browser = await launchForLiveCheck();
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * The accessibility tree of the block holding one article's link, on one route.
 *
 * `article, li` covers both surfaces: the feed renders each item as an
 * `<article>`, and `/weekly`'s archive renders a bare `<li>` that is not a card
 * at all — which is exactly the surface a card-only fix leaves unmarked.
 * `.last()` takes the innermost of the two when both match.
 *
 * Returns `null` when the article is not on the page, so a caller can tell "not
 * shown" apart from "shown and unmarked". Those are different facts and only
 * one of them is a defect.
 */
async function blockFor(page: LivePage, slug: string): Promise<string | null> {
  const block = page
    .locator('article, li')
    .filter({ has: page.locator(`a[href="/article/${slug}"]`) });
  if ((await block.count()) === 0) return null;
  return axText(await block.last().ariaSnapshot());
}

type LivePage = Awaited<ReturnType<LiveBrowser['newPage']>>;

async function open(path: string, settleFor = 8000) {
  const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleFor);
  return { page, status: response?.status() ?? 0 };
}

describe('a correction reaches the surfaces that list headlines', () => {
  it('has corrected articles on the feed, so none of this passes vacuously', () => {
    expect(log.length, 'the corrections log is empty').toBeGreaterThan(0);
    expect(indexed.length, 'the index is empty').toBeGreaterThan(0);
    expect(
      correctedOnFeed.length,
      'no corrected article is on the front page, so every check below is true of nothing',
    ).toBeGreaterThan(0);
    expect(
      cleanOnFeed.length,
      'every article on the feed is corrected, so the negative control cannot fire',
    ).toBeGreaterThan(0);
  });

  it('marks every corrected article on the front page, and no other', async () => {
    if (!browser) return;
    const { page, status } = await open('/');
    try {
      expect(status).toBe(200);

      // THE POSITIVE CONTROL, on this surface and read this way.
      //
      // It is here because the obvious control cannot fire: searching the page
      // for the word "corrected" and finding nothing is equally consistent with
      // "none of these qualify" and with "there is no marker at all". So the
      // control is a badge that is definitely present — the tier badge every
      // one of our cards carries — read out of the same containers by the same
      // method. If this fails, an absent marker below is a claim about this
      // instrument rather than about the site.
      const controlBlock = await blockFor(page, cleanOnFeed[0]);
      expect(controlBlock, `${cleanOnFeed[0]} is not on the front page`).not.toBeNull();
      expect(
        controlBlock,
        'the control failed: this probe cannot read a badge out of a feed card at all',
      ).toContain(CONTROL_BADGE);

      const unmarked: string[] = [];
      let checked = 0;
      for (const slug of correctedOnFeed) {
        const block = await blockFor(page, slug);
        if (block === null) continue; // filtered out of view, not a defect
        checked += 1;
        if (!block.includes(BADGE)) unmarked.push(slug);
      }

      // The loop found something to judge. Without this, a selector that
      // matched nothing would report a clean sweep.
      expect(checked, 'no corrected article was located on the page').toBeGreaterThan(0);
      expect(
        unmarked,
        'these carry a published correction and the front page does not say so',
      ).toEqual([]);

      // THE NEGATIVE CONTROL. An uncorrected article must not be marked, or the
      // assertion above would be satisfied by a badge painted onto every card.
      const wronglyMarked: string[] = [];
      for (const slug of cleanOnFeed) {
        const block = await blockFor(page, slug);
        if (block === null) continue;
        if (block.includes(BADGE)) wronglyMarked.push(slug);
      }
      expect(
        wronglyMarked,
        'these have no correction in the log and are marked as corrected anyway',
      ).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('marks corrected reviews on /weekly, in the archive as well as the lead', async () => {
    if (!browser) return;
    const { page, status } = await open('/weekly');
    try {
      expect(status).toBe(200);

      // Only the wraps reach this page. There may be none — the weekly review
      // publishes only when the week warrants it — so an absent wrap is not a
      // defect and this reports it rather than failing.
      const wraps = indexed.filter((e) => e.format === 'weekly_wrap');
      const correctedSlugs = new Set(log.map((entry) => entry.slug));

      const unmarked: string[] = [];
      let checked = 0;
      let control: string | null = null;
      for (const wrap of wraps) {
        const block = await blockFor(page, wrap.slug);
        if (block === null) continue;
        control ??= block;
        checked += 1;
        if (correctedSlugs.has(wrap.slug) && !block.includes(BADGE)) unmarked.push(wrap.slug);
        if (!correctedSlugs.has(wrap.slug) && block.includes(BADGE)) {
          unmarked.push(`${wrap.slug} (marked but not corrected)`);
        }
      }

      if (checked === 0) {
        // No review is published. Said out loud rather than passing quietly,
        // because a silent pass here is indistinguishable from a selector that
        // stopped matching.
        expect(wraps.filter((w) => correctedSlugs.has(w.slug))).toEqual([]);
        return;
      }

      expect(
        unmarked,
        'the weekly page disagrees with the corrections log about these',
      ).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('reads the reader\u2019s view, not the DOM', async () => {
    if (!browser) return;
    const { page } = await open('/');
    try {
      const slug = correctedOnFeed[0];
      const before = await blockFor(page, slug);
      expect(before, `${slug} is not on the front page`).not.toBeNull();
      expect(before).toContain(BADGE);

      // The instrument control, and the reason the sweep above means anything.
      // `display:none` and `aria-hidden` both leave text in the DOM, so a method
      // that still reports the marker present is reading the DOM and would go on
      // passing over a badge no reader can see.
      for (const mode of ['aria-hidden', 'display'] as const) {
        await page.evaluate(
          ([target, how]) => {
            const link = document.querySelector(`a[href="/article/${target}"]`);
            const block = link?.closest('article, li');
            const badge = [...(block?.querySelectorAll('span') ?? [])].find(
              (el) => el.textContent?.trim() === 'Corrected',
            );
            if (!badge) return;
            if (how === 'display') badge.style.display = 'none';
            else badge.setAttribute('aria-hidden', 'true');
          },
          [slug, mode] as const,
        );

        const hidden = await blockFor(page, slug);
        expect(hidden, `${mode} did not remove the marker, so this reads the DOM`).not.toContain(
          BADGE,
        );
        // ...and the read still worked, so "absent" means hidden rather than
        // broken.
        expect(hidden, `${mode} removed the whole block, so the absence proves nothing`).toContain(
          CONTROL_BADGE,
        );

        await page.evaluate(
          (target) => {
            const link = document.querySelector(`a[href="/article/${target}"]`);
            const block = link?.closest('article, li');
            const badge = [...(block?.querySelectorAll('span') ?? [])].find(
              (el) => el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none',
            );
            if (!badge) return;
            badge.removeAttribute('aria-hidden');
            badge.style.display = '';
          },
          slug,
        );
      }

      // Reverting restores it, which is what makes the two readings causal
      // rather than a coincidence of timing.
      expect(await blockFor(page, slug)).toContain(BADGE);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('agrees with /corrections about who, without claiming to agree about how many', async () => {
    // The two surfaces count different populations on purpose: the log lists
    // ENTRIES and the feed marks ARTICLES. Measured on 2026-09-01 that is 28
    // against 25, because three articles have been corrected more than once —
    // one of them because we corrected our own correction. Asserting the counts
    // match would assert something false; asserting the SETS agree is the
    // invariant that actually holds.
    const entries = log.length;
    const articles = new Set(log.map((e) => e.slug)).size;
    expect(entries).toBeGreaterThanOrEqual(articles);

    // And the feed's subjects are a subset of the log's, never an invention of
    // its own. `drop_from_index` removes retracted articles, so the feed sees
    // fewer — which is why this is containment rather than equality.
    const logged = new Set(log.map((e) => e.slug));
    expect(correctedOnFeed.filter((slug) => !logged.has(slug))).toEqual([]);
  });
});
