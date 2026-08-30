/**
 * Can a reader actually see a correction?
 *
 * WHY THIS IS A LIVE BROWSER CHECK AND NOT A UNIT TEST
 * ---------------------------------------------------
 * On 2026-08-30 this newsroom published its first correction. Everything about
 * it was verified except the only thing that matters. The article JSON carried
 * `corrections[0]`, `corrections.json` held a matching entry, and
 * `ArticleView.tsx` guards on `corrections.length` and renders `.description`.
 * All three are green whether or not a single pixel reaches a reader.
 *
 * The page is a single-page app: its served `<body>` is 51 bytes. **Fetching
 * the URL and finding the text is not the same as a reader seeing it**, and a
 * correction that exists in blob storage but does not render is
 * indistinguishable, from our side, from one that does. Both produce a green
 * JSON check, and the second is worse than publishing nothing — because we
 * have told ourselves we corrected it.
 *
 * WHY THE ACCESSIBILITY TREE RATHER THAN THE DOM
 * ----------------------------------------------
 * `display: none` and `aria-hidden` both leave the text in the DOM and remove
 * it from every reader, sighted or not. So a DOM query cannot answer the
 * question being asked. `ariaSnapshot()` serialises the tree the browser
 * itself computes, which is the closest thing to "what a reader gets" that a
 * test can hold — and the last test here proves it behaves that way on this
 * page rather than assuming it.
 *
 * WHY IT FOLLOWS THE LOG INSTEAD OF NAMING AN ARTICLE
 * --------------------------------------------------
 * Naming the food-inflation slug would pass forever for one article and say
 * nothing about the next correction, which is the one that will be broken.
 * Every subject here is derived from `corrections.json`, so the check grows
 * with the log and always exercises the newest entry — the least-proven one.
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

describe('a published correction reaches a reader', () => {
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
