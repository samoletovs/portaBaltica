/**
 * The served article head and the hydrated one must be the same strings.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * `buildHead` in `api/shared/articleMeta.js` carries this comment:
 *
 *   "Mirrors ArticlePage's titles exactly, so the served head and the head
 *    after hydration are the same strings"
 *
 * Nothing checked it. `tests/articleMetaParity.test.ts` compares `isServable`,
 * `isValidSlug`, `publisherName`, `renderByline` and `newsArticleJsonLd`, and no
 * title. `tests/pageMetaParity.test.tsx` compares every route it knows and says
 * so explicitly — *"leaves /article/* to the function that owns it"* — asserting
 * `metaFor('/article/...')` is `null`. Both are right about their own subject
 * and neither covers this one, so two implementations of one rule sat in
 * different languages with the claim of agreement written only in a comment.
 *
 * Found by planting: removing the `Corrected: ` prefix from the CLIENT while
 * leaving the server alone broke **no named assertion anywhere in the suite**.
 * A divergence here is not cosmetic — a crawler and a reader would be told
 * different things about the same page, and the share card is the copy that
 * travels to people who never load the page at all.
 *
 * WHY IT RENDERS RATHER THAN READING THE SOURCE
 * ---------------------------------------------
 * The client's title is built inline in a `usePageMeta` call, so the only
 * honest way to ask what it produces is to produce it. Reading the source for a
 * matching template would be a second implementation of the thing under test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ArticlePage from '../src/components/news/ArticlePage';
import type { Article } from '../src/news-types';
import { tierAArticle } from './fixtures/articles';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const meta = require(resolve(ROOT, 'api/shared/articleMeta.js')) as {
  classify: (a: unknown) => string;
  renderShell: (shell: string, a: unknown, slug: string, kind: string) => string | null;
};

/**
 * The real shell, as `tests/articleMeta.test.ts` uses it.
 *
 * `renderShell` returns null for a shell it does not recognise — a guard worth
 * having, and one this file tripped on a hand-written stub before it was
 * pointed at what actually ships.
 */
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');

/** Yield the event loop once — no wall clock; see tests/suiteDeterminism.test.ts. */
async function turn(): Promise<void> {
  await act(async () => {
    await new Promise<void>((done) => {
      setImmediate(done);
    });
  });
}

async function settle(until: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (until()) return;
    await turn();
  }
  throw new Error(`did not settle after ${turns} turns of the event loop`);
}

function stubArticle(article: Article) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => article,
    } as unknown as Response),
  );
}

/** What the deployed Function puts in `<title>` for this article. */
function servedTitle(article: Article): string {
  const kind = meta.classify(article);
  const html = meta.renderShell(SHELL, kind === 'none' ? null : article, article.slug, kind);
  expect(html, 'the server renderer refused this article').not.toBeNull();
  const match = /<title>([\s\S]*?)<\/title>/.exec(html as string);
  expect(match, 'the served head carries no <title>').not.toBeNull();
  return (match as RegExpExecArray)[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** What the client puts in `document.title` once it has hydrated. */
async function hydratedTitle(article: Article): Promise<string> {
  stubArticle(article);
  const view = render(
    <MemoryRouter initialEntries={[`/article/${article.slug}`]}>
      <Routes>
        <Route path="/article/:slug" element={<ArticlePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle(() => document.title !== '' && document.title !== 'portaBaltica');
  const title = document.title;
  view.unmount();
  return title;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = '';
});

const published = (): Article => tierAArticle();

const corrected = (): Article =>
  tierAArticle({
    corrections: [
      {
        corrected_at: '2026-08-31T14:08:22Z',
        description: 'CORRECTED. It said the reading was a record; it was not.',
      },
    ],
  });

const retracted = (): Article =>
  tierAArticle({
    status: 'retracted',
    corrections: [{ corrected_at: '2026-08-27T08:08:13Z', description: 'RETRACTED. A caching fault…' }],
  });

describe('the served <title> and the hydrated one agree', () => {
  const CASES: [string, () => Article][] = [
    ['a plain published article', published],
    ['a corrected article', corrected],
    ['a retracted article', retracted],
  ];

  for (const [label, build] of CASES) {
    it(`for ${label}`, async () => {
      const article = build();
      const served = servedTitle(article);
      const hydrated = await hydratedTitle(article);
      expect(hydrated, `${label}: a crawler and a reader are told different things`).toBe(served);
    });
  }

  it('produced three different answers, so the comparison is not trivially true', async () => {
    // The control. Three identical strings would satisfy every assertion above
    // while proving that neither side distinguishes the states at all.
    const titles = [servedTitle(published()), servedTitle(corrected()), servedTitle(retracted())];
    expect(new Set(titles).size).toBe(3);
    expect(titles[1]).toContain('Corrected: ');
    expect(titles[2]).toContain('Retracted: ');
    expect(titles[0]).not.toContain(': ');
  });
});
