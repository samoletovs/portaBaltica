import { describe, it, expect } from 'vitest';
import type { ArticleStatus } from '../src/news-types';
import { isServable } from '../src/news-types';
import { FAILING_VERDICT, PASSING_VERDICT, tierAArticle } from './fixtures/articles';

/**
 * The fail-closed gate, tested as a requirement rather than as an
 * implementation. Every case below describes an article that must not reach a
 * reader; if `isServable` is loosened, weakened or deleted, these fail.
 */
describe('isServable', () => {
  it('accepts a published article with a passing verdict', () => {
    expect(isServable(tierAArticle())).toBe(true);
  });

  it('refuses a published article whose validator did not pass', () => {
    const article = tierAArticle();
    article.provenance.validator = FAILING_VERDICT;

    expect(isServable(article)).toBe(false);
  });

  const nonPublished: ArticleStatus[] = [
    'draft',
    'pending_approval',
    'rejected',
  ];

  it.each(nonPublished)('refuses status "%s" even with a passing verdict', (status) => {
    expect(isServable({ status, provenance: tierAArticle().provenance })).toBe(false);
  });

  it('refuses an article with no validator verdict at all', () => {
    const article = tierAArticle();
    // Exactly the shape a partially written or hand-edited blob would have.
    delete (article.provenance as { validator?: unknown }).validator;

    expect(isServable(article)).toBe(false);
  });

  it('refuses an article with no provenance record at all', () => {
    expect(
      isServable({ status: 'published' } as unknown as Parameters<typeof isServable>[0]),
    ).toBe(false);
  });

  it('refuses a verdict whose passed flag is truthy but not true', () => {
    // A JSON blob can carry "true" as a string. Only a real boolean passes.
    const article = tierAArticle();
    article.provenance.validator = {
      ...PASSING_VERDICT,
      passed: 'true' as unknown as boolean,
    };

    expect(isServable(article)).toBe(false);
  });
});

/**
 * ─── Unreconciled with the published corrections policy ───
 *
 * `isServable()` came from the data contract (PR #7). The corrections policy
 * (PR #8) was written afterwards and the two were never reconciled. They now
 * disagree, in public, about what happens to an article after we correct it:
 *
 *   newsroom/policy/corrections.md
 *     Correction → "Correction notice on the article, entry in the log,
 *                   article marked `corrected`."
 *     Retraction → "Article marked `retracted` ... The page stays up, showing
 *                   why. We do not delete the evidence."
 *
 * Because the gate is `status === 'published'`, marking an article `corrected`
 * makes it disappear — the exact opposite of the promise — and a `retracted`
 * article shows a generic refusal rather than its reason.
 *
 * The tests below pin the CURRENT behaviour so it cannot drift silently, and
 * the `todo` entries record the behaviour the policy requires. They are not
 * assertions of correctness. Changing `isServable()` affects the pipeline and
 * safety workstreams, so it needs their agreement rather than a unilateral fix
 * from the frontend.
 *
 * Recorded as executable todos rather than a comment on purpose: the policy
 * this contradicts is the same document that says "a lesson recorded only as
 * prose is advice, and advice does not execute."
 */
describe('isServable — disputed statuses', () => {
  it('currently refuses "corrected", which contradicts the corrections policy', () => {
    expect(isServable({ status: 'corrected', provenance: tierAArticle().provenance })).toBe(false);
  });

  it('currently refuses "retracted", which contradicts the corrections policy', () => {
    expect(isServable({ status: 'retracted', provenance: tierAArticle().provenance })).toBe(false);
  });

  it.todo('serves a "corrected" article, with its correction notice shown on the page');
  it.todo('serves a "retracted" article as a tombstone stating why it was retracted');
  it.todo('excludes a "retracted" article from RSS and the sitemap');
});
