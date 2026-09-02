import type { Article } from '../news-types';

/**
 * Whose page is this?
 *
 * The client answers this after hydration and `api/shared/articleMeta.js`
 * answers it in the served bytes, because social crawlers never run the first
 * one. There is no shared build step between `src/` and `api/`, so this is a
 * mirror — and `tests/articleMetaParity.test.ts` holds the two together,
 * because the client runs *last* and would silently win any disagreement.
 *
 * WHY IT EXISTS
 * -------------
 * Every syndicated page used to declare **itself** the canonical version of
 * somebody else's article. Measured live on 2026-09-02, before the fix:
 *
 *   tier B  a European Commission press release   canonical=ours, in sitemap
 *   tier C  an LSM report                         canonical=ours, not in sitemap
 *
 * `structured-data.ts` already refuses to emit `NewsArticle` JSON-LD for
 * anything but tier A, on the grounds that a syndicated item is not our
 * journalism. The canonical had no equivalent gate, so the same page said both
 * things at once.
 */

/** The site's own origin, used when nothing else is known. */
export const SITE_ORIGIN = 'https://portabaltica.naurolabs.com';

/**
 * The foreign original this piece reproduces, or `null` when the piece is ours.
 *
 * Keyed on the `syndicated` block rather than on the tier letter. Measured
 * against the live index: tier A carries one 0/45 times, tier B 4/4 and tier C
 * 50/50 — so the two agree today, and the block stays right for a tier nobody
 * has invented yet. `tests/syndicatedCanonical.test.ts` pins the tier mapping
 * as an equality regardless, so a new tier is still noticed rather than
 * silently absorbed.
 *
 * The scheme test is load-bearing: `rel=canonical` resolves against the
 * document, so a relative or `javascript:` value in stored data would become a
 * claim about one of our own URLs, or worse.
 */
export function syndicatedOriginalUrl(article: Article | null | undefined): string | null {
  const url = article?.syndicated?.original_url;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * The canonical URL for a piece, resolved against `origin`.
 *
 * `origin` is a parameter rather than `window.location.origin` so this is
 * callable from a test and from the parity suite, and so a preview deployment
 * keeps claiming *itself* rather than production for our own articles.
 */
export function canonicalForArticle(
  article: Article | null | undefined,
  slug: string | undefined,
  origin: string = SITE_ORIGIN,
): string {
  const original = syndicatedOriginalUrl(article);
  if (original) return original;
  return slug ? `${origin}/article/${slug}` : origin;
}
