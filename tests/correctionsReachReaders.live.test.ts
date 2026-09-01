/**
 * Can a reader actually see a correction — on every surface they meet the claim?
 *
 * WHY THIS FILE HAS SIX SURFACES AND NOT TWO
 * ------------------------------------------
 * `#262` shipped this as `describe('a published correction reaches a reader')`
 * covering the article page and `/corrections`. Every assertion in it was
 * careful — a vacuity guard, an accessibility-tree read rather than a DOM
 * query, subjects derived from the log rather than named — and it was green
 * throughout the weeks in which **18 of the 43 articles on the front page
 * carried an unmarked correction**, several of those headlines being the
 * withdrawn claim itself.
 *
 * The guard did not merely miss that. It CONCEALED it. Anyone asking whether
 * corrections propagate would have searched for exactly that question, found a
 * green test named exactly that question, and stopped — so the name answered
 * the enquiry with a fact about a different population. `AGENTS.md` records
 * three instances of a guard enumerating a smaller set than its subject (`#149`,
 * `#178`, `389d1f9`) and separately warns about a name that lies about its
 * population; this file was both at once.
 *
 * So the population is written down, once, at the top, and asserted at the
 * bottom against what the run actually exercised. A future surface is then a
 * red test rather than a silence.
 *
 * WHY THE ACCESSIBILITY TREE RATHER THAN THE DOM
 * ----------------------------------------------
 * `display: none` and `aria-hidden` both leave the text in the DOM and remove
 * it from every reader, sighted or not. So a DOM query cannot answer the
 * question being asked. `ariaSnapshot()` serialises the tree the browser
 * itself computes, which is the closest thing to "what a reader gets" that a
 * test can hold — and one check here proves it behaves that way on this page
 * rather than assuming it.
 *
 * The two syndication feeds are the exception, deliberately: a feed is not
 * rendered by us — a reader's app decides that — so the document IS the
 * artefact, and fetching it is the honest instrument rather than a shortcut.
 *
 * WHY IT FOLLOWS THE LOG INSTEAD OF NAMING AN ARTICLE
 * --------------------------------------------------
 * Naming a slug would pass forever for one article and say nothing about the
 * next correction, which is the one that will be broken. Every subject here is
 * derived from `corrections.json`, so the check grows with the log and always
 * exercises the newest entry — the least-proven one.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchForLiveCheck } from './liveBrowser';

/**
 * The browser handle, derived from the helper rather than imported from
 * playwright — `tests/liveBrowserWiring.test.ts` forbids any other file
 * naming that package, and a type-only import would trip it just the same.
 */
type LiveBrowser = NonNullable<Awaited<ReturnType<typeof launchForLiveCheck>>>;

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/**
 * Where the deployed bundle reads articles from.
 *
 * Read out of the workflow rather than written down again. In production
 * `VITE_ARTICLES_BASE_URL` points at blob storage, not at the site origin, so
 * a copy here would be a second source of truth that can disagree with the one
 * that ships — and it would disagree *silently*, by 404ing into the SPA
 * fallback, which answers HTTP 200 with HTML. Guessing that path is how the
 * first pass at this measurement failed.
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

const ARTICLES = articlesBase();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Normalise an `ariaSnapshot()` for comparison against source text.
 *
 * The serialiser emits YAML, so a double quote inside an accessible name comes
 * back as `\"`. This correction quotes the phrase it is correcting — *a "record
 * low"* — so a verbatim search for its text fails against a page that renders
 * it perfectly. Measured: the same needle is absent before this unescaping and
 * present after, on a page a human can plainly read.
 *
 * Worth naming because the failure is an instrument artefact that looks exactly
 * like the defect this file exists to catch: a correction present in the JSON
 * and missing from the reader's view.
 */
const axText = (snapshot: string) => norm(snapshot).replace(/\\(["\\])/g, '$1');

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

/**
 * Every surface a reader can meet a published claim on.
 *
 * Written down once, here, because the previous version of this file covered
 * two of these and was named for all of them. A list at the top is not the
 * guard — the guard is `covers()` below and the equality at the bottom, which
 * records what the run ACTUALLY exercised and refuses to pass if it is short.
 * A list alone would be a second thing that can disagree with the tests.
 */
const SURFACES = {
  article: 'the article page — the notice itself',
  corrections: '/corrections — the public log',
  frontPage: '/ — the feed a reader lands on',
  weekly: '/weekly — the review and its archive',
  rss: '/rss.xml — syndicated, and unreachable afterwards',
  jsonFeed: '/feed.json — the same items, the same problem',
  socialMeta: 'og:title — the share card, which travels furthest of all',
} as const;

type Surface = keyof typeof SURFACES;

/**
 * The surfaces that need no browser, and therefore no early return.
 *
 * A feed and a served `<head>` are not rendered by us — a reader's app or a
 * crawler decides that — so the document IS the artefact and fetching it is the
 * honest instrument. The four browser surfaces are different: the served body
 * is 51 bytes, so only a real render answers the question.
 *
 * The split is load-bearing for the coverage equality below, not a note. That
 * assertion used to share the `if (!browser) return` it exists to detect, so
 * locally it was inert for exactly the reason the guards were — a meta-guard
 * with the failure mode of its subject. It now asserts these three
 * unconditionally and the full six only when a browser was obtained, which
 * makes it live in both environments rather than only in CI.
 */
const NO_BROWSER_NEEDED: readonly Surface[] = ['rss', 'jsonFeed', 'socialMeta'];

/** What this run actually exercised, recorded by the tests themselves. */
const covered = new Set<Surface>();
const covers = (surface: Surface) => covered.add(surface);

let browser: LiveBrowser | null = null;
let log: LogEntry[] = [];
/** Every corrected slug with the status its article actually carries. */
let statuses: { slug: string; status?: string }[] = [];
/**
 * The newest correction sitting on a still-published article.
 *
 * Not simply the newest entry: this log also records retractions, and a
 * retracted article renders a bespoke refusal rather than an inline notice, so
 * asserting a corrections section on one would be demanding the wrong screen.
 * Six of the eleven articles here are retracted, so this is the common case
 * rather than a corner.
 */
let newestVisible: LogEntry;
/** Our own articles in the live index, split by whether the log names them. */
let correctedOnFeed: string[] = [];
let cleanOnFeed: string[] = [];
/** Every indexed entry, so `/weekly` can select on the declared format. */
let indexed: { slug: string; headline: string; tier: string; format?: string }[] = [];

beforeAll(async () => {
  log = await getJson<LogEntry[]>(`${ARTICLES}/corrections.json`);
  const slugs = [...new Set(log.map((e) => e.slug))];
  statuses = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      status: (await getJson<{ status?: string }>(`${ARTICLES}/${slug}.json`)).status,
    })),
  );
  const published = new Set(statuses.filter((s) => s.status === 'published').map((s) => s.slug));
  newestVisible = [...log]
    .filter((e) => published.has(e.slug))
    .sort((a, b) => b.corrected_at.localeCompare(a.corrected_at))[0];

  const index = await getJson<{ articles: typeof indexed }>(`${ARTICLES}/index.json`);
  indexed = index.articles ?? [];
  // Tier C is somebody else's story behind a link out; we do not correct those.
  const ours = indexed.filter((entry) => entry.tier !== 'C');
  const correctedSlugs = new Set(log.map((entry) => entry.slug));
  correctedOnFeed = ours.filter((e) => correctedSlugs.has(e.slug)).map((e) => e.slug);
  cleanOnFeed = ours.filter((e) => !correctedSlugs.has(e.slug)).map((e) => e.slug);

  browser = await launchForLiveCheck();
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

/** Load a route, wait for the client render, and return its accessibility tree. */
async function axTreeOf(path: string, settleFor = 6000) {
  const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleFor);
  return { page, status: response?.status() ?? 0, ax: axText(await page.locator('body').ariaSnapshot()) };
}

/**
 * One live page.
 *
 * Derived from the DECLARED type, not from `typeof browser`. A `typeof` query
 * in a type position is narrowed by control flow, and `browser` is
 * `let ... = null` whose only assignment is inside `beforeAll` — which does not
 * run in source order. So at this line TypeScript narrowed it to `null`,
 * `NonNullable<null>` is `never`, and every page in this file silently became
 * `never`.
 *
 * `vitest` cannot see this: esbuild strips types without checking them. Only
 * `tsc -p tsconfig.test.json` does, which is what `npm test` runs and
 * `npx vitest run` does not — so it was green locally and red on master.
 */
type LivePage = Awaited<ReturnType<LiveBrowser['newPage']>>;

/**
 * The accessibility tree of the block holding one article's link, on one route.
 *
 * Element-scoped, not page-scoped, and that is the difference between a check
 * and a formality: `toContain('Corrected')` over a whole page passes on a feed
 * where one card is marked and seventeen are not, and passes again on any page
 * at all, because this site links to `/corrections` from every masthead.
 *
 * `article, li` covers both shapes: the feed renders each item as an
 * `<article>`, and `/weekly`'s archive renders a bare `<li>` that is not a card
 * — which is exactly the surface a card-only fix leaves unmarked. `.last()`
 * takes the innermost when both match.
 *
 * Returns `null` when the article is not on the page, so a caller can tell "not
 * shown" from "shown and unmarked". Those are different facts and only one is a
 * defect.
 */
async function blockFor(page: LivePage, slug: string): Promise<string | null> {
  const block = page
    .locator('article, li')
    .filter({ has: page.locator(`a[href="/article/${slug}"]`) });
  if ((await block.count()) === 0) return null;
  return axText(await block.last().ariaSnapshot());
}

async function open(path: string, settleFor = 8000) {
  const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleFor);
  return { page, status: response?.status() ?? 0 };
}

/** The marker, as every surface carries it. */
const BADGE = 'Corrected';
/** A badge every one of our own cards carries, whatever else is true of it. */
const CONTROL_BADGE = 'Our analysis';

// The two surfaces `#262` walked, named for the two surfaces `#262` walked.
//
// The old wording is kept nowhere: `a published correction reaches a reader`
// is the string that answered the question nobody then asked twice, and
// leaving it on a block covering two of six would hand the successor the
// same failure. The three blocks now read as one sentence, and each says
// what it walks.
describe('a published correction reaches a reader on the article and in the log', () => {
  it('has a correction to check, so none of this can pass vacuously', () => {
    // Without this, an empty log would make every assertion below true of
    // nothing at all — the shape this repo has caught five times.
    expect(log.length).toBeGreaterThan(0);
    expect(newestVisible.slug).toBeTruthy();
    expect(newestVisible.description.length).toBeGreaterThan(20);
  });

  it('renders the newest correction in the accessibility tree', async () => {
    if (!browser) return;
    const { page, status, ax } = await axTreeOf(`/article/${newestVisible.slug}`);
    try {
      // Still served at all. `status` is deliberately left `published` rather
      // than `corrected`; see the servability test below for what the other
      // word would do.
      expect(status, 'the corrected article is no longer served').toBe(200);

      // The control, on the same page and read the same way. If the headline
      // were missing too, an absent correction would be a claim about this
      // instrument rather than about the site.
      expect(ax, 'the control failed: the headline is not in the accessibility tree either').toContain(
        norm(newestVisible.headline),
      );

      expect(ax, 'the correction notice does not reach a reader').toContain(norm(newestVisible.description));
      expect(ax, 'the notice renders without its heading').toContain('Corrected');
      covers('article');
    } finally {
      await page.close();
    }
  }, 120_000);

  it('reads the accessibility tree rather than the DOM', async () => {
    if (!browser) return;
    const { page, ax } = await axTreeOf(`/article/${newestVisible.slug}`);
    try {
      expect(ax).toContain(norm(newestVisible.description));

      // The instrument control, and the reason the test above means anything.
      // `display:none` and `aria-hidden` both leave the text in the DOM, so a
      // method that still reports it present is reading the DOM and would go
      // on passing over a notice no reader can see.
      for (const hide of ['aria-hidden', 'display'] as const) {
        await page.evaluate((mode) => {
          const section = document.querySelector('section[aria-label="Corrections to this article"]');
          if (!section) return;
          if (mode === 'display') (section as HTMLElement).style.display = 'none';
          else section.setAttribute('aria-hidden', 'true');
        }, hide);

        const hidden = axText(await page.locator('body').ariaSnapshot());
        expect(hidden, `${hide} did not remove the notice, so this reads the DOM, not the reader's view`)
          .not.toContain(norm(newestVisible.description));
        // ...and the read itself still works, so "absent" means hidden rather
        // than broken.
        expect(hidden, `${hide} removed the whole page, so the absence above proves nothing`).toContain(
          norm(newestVisible.headline),
        );

        await page.evaluate(() => {
          const section = document.querySelector('section[aria-label="Corrections to this article"]');
          if (!section) return;
          section.removeAttribute('aria-hidden');
          (section as HTMLElement).style.display = '';
        });
      }

      // Reverting restores it, which is what makes the two readings causal
      // rather than a coincidence of timing.
      expect(axText(await page.locator('body').ariaSnapshot())).toContain(norm(newestVisible.description));
    } finally {
      await page.close();
    }
  }, 120_000);

  it('lists every logged correction on /corrections', async () => {
    if (!browser) return;
    const { page, status, ax } = await axTreeOf('/corrections', 8000);
    try {
      expect(status).toBe(200);
      covers('corrections');
      const missing = log.filter((entry) => !ax.includes(norm(entry.description)));
      expect(missing.map((e) => e.slug), 'these corrections are logged but do not render').toEqual([]);

      // The log page and the article must say the same thing. Two stores of
      // one sentence drift, and the log is the copy a reader is pointed at
      // from the policy page.
      const article = await getJson<{ corrections?: { description: string }[] }>(
        `${ARTICLES}/${newestVisible.slug}.json`,
      );
      const onArticle = (article.corrections ?? []).map((c) => c.description);
      expect(onArticle, 'the log and the article disagree about the correction text').toContain(
        newestVisible.description,
      );
    } finally {
      await page.close();
    }
  }, 120_000);

  it('keeps every corrected article in a status the renderer handles honestly', async () => {
    // `SHOWABLE_STATUSES` in news-api.ts admits both `published` and
    // `corrected`, while `isServable()` in news-types.ts requires `published`.
    // The two gates disagree, so an article marked `corrected` stays linked
    // from the front page and renders "It has not passed the checks we run
    // before publishing" — false about a piece that passed them, with the
    // correction notice itself never drawn. Measured rather than inferred:
    // intercepting the article JSON and changing that one word takes the
    // headline and the notice out of the accessibility tree, while an
    // otherwise identical `published` control renders both.
    //
    // `retracted` is NOT that hazard and must not be lumped in with it. Six of
    // the articles in this log are retracted, and ArticleView gives them a
    // bespoke view that says truthfully why the page is empty. That is the
    // correct handling of a different situation, and an assertion demanding
    // `published` everywhere would have called it a defect — this test made
    // exactly that mistake on its first run.
    //
    // So the invariant is the reader-facing one: whatever status a corrected
    // article carries, the renderer must have an honest branch for it. It
    // asserts the consequence rather than the gates' disagreement, because the
    // disagreement is real today and fixing it is a change to the newsroom
    // components rather than to a test.
    const HANDLED_HONESTLY = ['published', 'retracted'];

    // Control: the sweep found something to judge, so an empty list cannot pass.
    expect(statuses.length).toBeGreaterThan(0);

    const unhandled = statuses.filter((s) => !HANDLED_HONESTLY.includes(s.status ?? ''));
    expect(
      unhandled,
      'these render "it has not passed our checks", which is false of a corrected article',
    ).toEqual([]);
  }, 120_000);
});

describe('...and on every surface that merely LISTS the claim', () => {
  it('has corrected articles on those surfaces, so none of this passes vacuously', () => {
    expect(indexed.length, 'the index is empty').toBeGreaterThan(0);
    expect(
      correctedOnFeed.length,
      'no corrected article is listed anywhere, so every check below is true of nothing',
    ).toBeGreaterThan(0);
    expect(
      cleanOnFeed.length,
      'every listed article is corrected, so the negative controls cannot fire',
    ).toBeGreaterThan(0);
  });

  it('marks every corrected article on the front page, and no other', async () => {
    if (!browser) return;
    const { page, status } = await open('/');
    try {
      expect(status).toBe(200);

      // THE POSITIVE CONTROL, on this surface and read this way.
      //
      // The obvious control cannot fire: searching the page for "corrected" and
      // finding nothing is equally consistent with "none of these qualify" and
      // with "there is no marker at all". So the control is a badge that is
      // definitely present — the tier badge every one of our cards carries —
      // read out of the same containers by the same method. If this fails, an
      // absent marker below is a claim about the instrument, not about the site.
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
        if (block === null) continue; // not in view, which is not a defect
        checked += 1;
        if (!block.includes(BADGE)) unmarked.push(slug);
      }

      expect(checked, 'no corrected article was located on the page').toBeGreaterThan(0);
      expect(
        unmarked,
        'these carry a published correction and the front page does not say so',
      ).toEqual([]);

      // THE NEGATIVE CONTROL. Without it the sweep above is satisfied by a badge
      // painted onto every card.
      const wronglyMarked: string[] = [];
      for (const slug of cleanOnFeed) {
        const block = await blockFor(page, slug);
        if (block !== null && block.includes(BADGE)) wronglyMarked.push(slug);
      }
      expect(
        wronglyMarked,
        'these have no correction in the log and are marked as corrected anyway',
      ).toEqual([]);

      covers('frontPage');
    } finally {
      await page.close();
    }
  }, 180_000);

  it('marks corrected reviews on /weekly, in the archive as well as the lead', async () => {
    if (!browser) return;
    const { page, status } = await open('/weekly');
    try {
      expect(status).toBe(200);

      const wraps = indexed.filter((e) => e.format === 'weekly_wrap');
      const correctedSlugs = new Set(log.map((entry) => entry.slug));

      const wrong: string[] = [];
      let checked = 0;
      for (const wrap of wraps) {
        const block = await blockFor(page, wrap.slug);
        if (block === null) continue;
        checked += 1;
        const isCorrected = correctedSlugs.has(wrap.slug);
        if (isCorrected && !block.includes(BADGE)) wrong.push(wrap.slug);
        if (!isCorrected && block.includes(BADGE)) wrong.push(`${wrap.slug} (marked, not corrected)`);
      }

      if (checked === 0) {
        // No review is published, which is a legitimate state — the weekly runs
        // only when the week warrants it. Said out loud rather than passing
        // quietly, because a silent pass here is indistinguishable from a
        // selector that stopped matching.
        expect(wraps.filter((w) => correctedSlugs.has(w.slug))).toEqual([]);
      } else {
        expect(wrong, 'the weekly page disagrees with the corrections log about these').toEqual([]);
      }

      covers('weekly');
    } finally {
      await page.close();
    }
  }, 180_000);

  it('reads the reader\u2019s view of a listing, not its DOM', async () => {
    if (!browser) return;
    const { page } = await open('/');
    try {
      const slug = correctedOnFeed[0];
      expect(await blockFor(page, slug)).toContain(BADGE);

      // The instrument control, and the reason the sweeps mean anything.
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

        await page.evaluate((target) => {
          const link = document.querySelector(`a[href="/article/${target}"]`);
          const block = link?.closest('article, li');
          const badge = [...(block?.querySelectorAll('span') ?? [])].find(
            (el) => el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none',
          );
          if (!badge) return;
          badge.removeAttribute('aria-hidden');
          badge.style.display = '';
        }, slug);
      }

      // Reverting restores it, which makes the two readings causal rather than a
      // coincidence of timing.
      expect(await blockFor(page, slug)).toContain(BADGE);
    } finally {
      await page.close();
    }
  }, 180_000);
});

/**
 * The syndication feeds — the surfaces that leave the building.
 *
 * A false headline on our own page is ours to correct on the next load. A false
 * headline in `/rss.xml` is in somebody else's reader, and
 * `api/shared/newsroom.js` says so itself: such a reader "will never see the
 * page that corrects it."
 *
 * No browser, deliberately: a feed is not rendered by us, so the document IS
 * the artefact rather than a 51-byte shell.
 */
describe('...and in the feeds, which cannot be taken back', () => {
  const MARK = 'Corrected: ';
  const NEVER = 'zzzNEVERINAFEED';

  interface JsonFeedItem {
    url?: string;
    title?: string;
    _portabaltica?: { corrected?: boolean };
  }

  async function fetchText(path: string): Promise<{ status: number; body: string }> {
    // `.text()` rather than `.json()`, so a malformed body is visible here as a
    // string rather than as a parse error two frames away. Note that a shell
    // client will NOT do this for you: measured while writing this,
    // PowerShell's `Invoke-WebRequest` hands back `Content` as a BYTE ARRAY for
    // `application/feed+json` because that is not a recognised text type —
    // which reported an empty feed, with the controls reporting empty too, on a
    // feed carrying 43 items.
    const response = await fetch(`${BASE}${path}`);
    return { status: response.status, body: await response.text() };
  }

  function rssItems(xml: string): { slug: string; block: string }[] {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map((m) => {
        const slug = /\/article\/([a-z0-9-]+)</.exec(m[1])?.[1];
        return slug ? { slug, block: m[1] } : null;
      })
      .filter((v): v is { slug: string; block: string } => v !== null);
  }

  const slugOf = (item: JsonFeedItem) => String(item.url ?? '').replace(/^.*\/article\//, '');

  it('marks every corrected item in /rss.xml, and no other', async () => {
    const { status, body } = await fetchText('/rss.xml');
    expect(status).toBe(200);

    const items = rssItems(body);

    // CONTROLS, on this document and read this way. The first proves the parse
    // finds items and reads their content; the second proves it can still say
    // no. Without both, "nothing is marked" is equally consistent with a regex
    // that stopped matching.
    expect(items.length, 'the control failed: no items parsed out of the feed').toBeGreaterThan(0);
    expect(items.every((i) => /<title>/.test(i.block))).toBe(true);
    expect(items.filter((i) => i.block.includes(NEVER))).toEqual([]);

    const corrected = new Set(log.map((e) => e.slug));
    expect(
      items.filter((i) => corrected.has(i.slug)).length,
      'no corrected article is in the feed, so the sweep judged nothing',
    ).toBeGreaterThan(0);

    expect(
      items.filter((i) => corrected.has(i.slug) && !i.block.includes(MARK)).map((i) => i.slug),
      'these carry a published correction and /rss.xml does not say so',
    ).toEqual([]);
    expect(
      items.filter((i) => !corrected.has(i.slug) && i.block.includes(MARK)).map((i) => i.slug),
      'these are marked corrected and are not in the log',
    ).toEqual([]);

    covers('rss');
  }, 60_000);

  it('marks every corrected item in /feed.json, and no other', async () => {
    const { status, body } = await fetchText('/feed.json');
    expect(status).toBe(200);

    const items = (JSON.parse(body).items ?? []) as JsonFeedItem[];
    expect(items.length, 'the control failed: the feed parsed to no items').toBeGreaterThan(0);
    expect(items.every((i) => typeof i.title === 'string' && i.title.length > 0)).toBe(true);
    expect(items.filter((i) => String(i.title).includes(NEVER))).toEqual([]);

    const corrected = new Set(log.map((e) => e.slug));
    expect(items.filter((i) => corrected.has(slugOf(i))).length).toBeGreaterThan(0);

    expect(
      items.filter((i) => corrected.has(slugOf(i)) && !String(i.title).startsWith(MARK)).map(slugOf),
      'these carry a published correction and /feed.json does not say so',
    ).toEqual([]);
    expect(
      items.filter((i) => !corrected.has(slugOf(i)) && String(i.title).startsWith(MARK)).map(slugOf),
      'these are marked corrected and are not in the log',
    ).toEqual([]);

    // The structured half, so a machine consumer need not parse a prefix.
    expect(
      items.filter((i) => corrected.has(slugOf(i)) && i._portabaltica?.corrected !== true).map(slugOf),
      'marked in the title but not in the extension object',
    ).toEqual([]);

    covers('jsonFeed');
  }, 60_000);

  it('marks the same articles in both feeds', async () => {
    // Two feeds disagreeing about which headline has been withdrawn is a
    // contradiction with nothing to say which side is right, and it would be
    // silent. `tests/jsonFeed.test.ts` pins this against a stub; this pins it
    // against what is actually served.
    const [rss, json] = await Promise.all([fetchText('/rss.xml'), fetchText('/feed.json')]);

    const markedInRss = rssItems(rss.body)
      .filter((i) => i.block.includes(MARK))
      .map((i) => i.slug)
      .sort();
    const markedInJson = ((JSON.parse(json.body).items ?? []) as JsonFeedItem[])
      .filter((i) => String(i.title).startsWith(MARK))
      .map(slugOf)
      .sort();

    expect(markedInRss).toEqual(markedInJson);
    // The control: something was marked, so this is not two empty lists agreeing.
    expect(markedInRss.length).toBeGreaterThan(0);
  }, 60_000);

  it('agrees with /corrections about who, without claiming to agree about how many', () => {
    // The surfaces count different populations on purpose: the log lists
    // ENTRIES and the pages mark ARTICLES. Measured on 2026-09-01 that is 28
    // against 25, because three articles have been corrected more than once —
    // one of them because we corrected our own correction. Asserting the counts
    // match would assert something false; asserting the SETS agree is the
    // invariant that actually holds.
    expect(log.length).toBeGreaterThanOrEqual(new Set(log.map((e) => e.slug)).size);

    const logged = new Set(log.map((e) => e.slug));
    expect(correctedOnFeed.filter((slug) => !logged.has(slug))).toEqual([]);
  });
});

/**
 * The share card — the surface that travels furthest, because the reader never
 * visits us at all.
 *
 * `articleMeta.js` marks a RETRACTED article in `<title>` and `og:title` and,
 * until this, marked a corrected one nowhere a human sees. Its own comment
 * argued the case for the other half: "a card is exactly where a withdrawn
 * claim most needs one, because a share card carries no page around it to say
 * so."
 *
 * No browser: the served `<head>` is exactly what a crawler receives, so the
 * document is the artefact rather than a 51-byte shell.
 */
describe('...and in the share card, where the reader never arrives', () => {
  const MARK = 'Corrected: ';

  async function headOf(slug: string): Promise<{ status: number; html: string }> {
    const response = await fetch(`${BASE}/article/${slug}`);
    return { status: response.status, html: await response.text() };
  }

  const ogTitle = (html: string) =>
    /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? null;
  const docTitle = (html: string) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? null;

  it('marks a corrected article in og:title and in the document title', async () => {
    // Derived from the log, so it grows with it and always exercises a real
    // subject rather than a slug written down once.
    const slug = correctedOnFeed[0];
    const { status, html } = await headOf(slug);
    expect(status).toBe(200);

    // CONTROLS on this document, read this way: the tag exists at all, and the
    // probe can still say no.
    expect(ogTitle(html), 'the control failed: no og:title in the served head').not.toBeNull();
    expect(html.includes('zzzNEVERINAHEAD')).toBe(false);

    expect(ogTitle(html), 'a corrected article is shared with the withdrawn headline').toContain(
      MARK,
    );
    expect(docTitle(html)).toContain(MARK);

    covers('socialMeta');
  }, 60_000);

  it('leaves an uncorrected article unmarked', async () => {
    // The negative control, on the same renderer. Without it the assertion
    // above is satisfied by a prefix pasted onto every article.
    const { status, html } = await headOf(cleanOnFeed[0]);
    expect(status).toBe(200);
    expect(ogTitle(html), 'the control failed: no og:title in the served head').not.toBeNull();
    expect(ogTitle(html), 'this article has no correction and is marked anyway').not.toContain(MARK);
  }, 60_000);
});

describe('the population this file claims to walk', () => {
  it('exercised every surface that needs no browser', () => {
    // Asserted unconditionally, and that is the point. This equality used to
    // sit behind the same `if (!browser) return` as the guards it audits, so
    // outside CI it was inert for exactly the reason they were — a meta-guard
    // sharing its subject's failure mode. Found by the programme session
    // pointing PLAYWRIGHT_BROWSERS_PATH at a directory that did not exist:
    // 7 of 14 tests passed in 0ms, this one among them, and a planted
    // ['ZZZ_PLANT'] still passed.
    expect(
      [...covered].filter((s) => NO_BROWSER_NEEDED.includes(s)).sort(),
      'a surface that needs no browser was not exercised',
    ).toEqual([...NO_BROWSER_NEEDED].sort());
  });

  it('exercised every surface named at the top, and the list is not a wish', () => {
    // THE POINT OF THIS FILE.
    //
    // `#262` shipped a guard named `a published correction reaches a reader`
    // that walked two of these seven, and it was green through weeks in which
    // 18 of 43 front-page articles carried an unmarked correction. A name that
    // asserts a scope must walk that scope, and a list of surfaces sitting in a
    // comment is a second thing that can disagree with the tests.
    //
    // So this reads what the RUN recorded, not what the file says. A surface
    // added to `SURFACES` with no test fails here; a test deleted fails here;
    // and a test that silently stopped running — the `#156` shape — fails here
    // too, which no assertion inside that test could do for itself.
    //
    // Browser-gated, because four of the seven genuinely cannot run without
    // one. The assertion above is what keeps this file honest when they cannot.
    if (!browser) return;

    expect([...covered].sort(), 'a surface is named above and nothing exercised it').toEqual(
      (Object.keys(SURFACES) as Surface[]).sort(),
    );
  });
});
