import type { Article } from '../news-types';

/**
 * The one country an embedded chart may speak for, if there is one.
 *
 * A chart under a story is an invitation to check the claim, so it must plot
 * the series the claim was made from. Single-country articles have exactly one
 * candidate. Baltic-wide ones do not: the generator tags them
 * `["Baltic", "LV", "EE", "LT"]`, and picking the first entry would chart
 * Latvia under a three-country comparison — a chart that looks like evidence
 * and is not. Those defer to the dashboard's country switcher instead, which
 * the reader controls and which says on its face which country it is showing.
 *
 * Returning `undefined` is the safe direction: it costs the reader a click,
 * whereas a confidently wrong series costs them the ability to tell that the
 * chart and the sentence above it disagree.
 */
export function soleCountry(article: Article): 'LV' | 'EE' | 'LT' | undefined {
  const baltic = (article.countries ?? []).filter(
    (c): c is 'LV' | 'EE' | 'LT' => c === 'LV' || c === 'EE' || c === 'LT',
  );
  return baltic.length === 1 ? baltic[0] : undefined;
}
