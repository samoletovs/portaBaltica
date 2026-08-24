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
    'retracted',
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
