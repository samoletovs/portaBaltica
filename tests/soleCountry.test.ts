/**
 * Which country an embedded chart is allowed to speak for.
 *
 * The chart under an article carries an implicit promise — "this is the series
 * the story was written from". Honouring that promise for a single-country
 * story is easy. The trap is the Baltic-wide story, which the generator tags
 * `["Baltic", "LV", "EE", "LT"]`: taking the first Baltic entry there charts
 * Latvia under a three-country comparison, producing something that looks like
 * evidence for a claim it does not support.
 *
 * That is a worse outcome than showing no chart at all, so the rule is
 * deliberately conservative: chart a country only when the article names
 * exactly one.
 */

import { describe, it, expect } from 'vitest';
import { soleCountry } from '../src/newsroom/article-country';
import type { Article } from '../src/news-types';

function article(countries: string[] | undefined): Article {
  return { countries } as unknown as Article;
}

describe('soleCountry', () => {
  it('returns the country of a single-country article', () => {
    expect(soleCountry(article(['EE']))).toBe('EE');
  });

  it('refuses to pick one country from a Baltic-wide article', () => {
    // The exact shape `_countries_for` emits for a Baltic signal.
    expect(soleCountry(article(['Baltic', 'LV', 'EE', 'LT']))).toBeUndefined();
  });

  it('refuses to pick one country from a two-country comparison', () => {
    expect(soleCountry(article(['LV', 'EE']))).toBeUndefined();
  });

  it('ignores non-country tags when counting', () => {
    expect(soleCountry(article(['EU', 'LT']))).toBe('LT');
  });

  it('returns nothing when the article names no country', () => {
    expect(soleCountry(article([]))).toBeUndefined();
    expect(soleCountry(article(undefined))).toBeUndefined();
  });
});
