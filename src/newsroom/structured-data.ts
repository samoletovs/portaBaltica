// ─── Structured data ───
//
// Google's guidance rewards original reporting that can show its working. The
// provenance record we already keep for editorial reasons happens to be
// exactly what `isBasedOn` and `citation` are for, so the machine-readable
// version costs nothing beyond mapping it across.
//
// Only tier A gets a NewsArticle. Tier B is somebody else's press release
// reproduced verbatim and tier C is a link out — claiming either as our own
// original reporting in structured data would be a lie told to a crawler,
// which is the same lie, only harder to notice.

import type { Article } from '../news-types';
import { renderByline } from './correspondents';
import { ACCOUNTABLE_EDITOR } from './editorial';

export const SITE_URL = 'https://portabaltica.naurolabs.com';
export const SITE_NAME = 'portaBaltica';

export function articleUrl(slug: string): string {
  return `${SITE_URL}/article/${slug}`;
}

export function newsArticleJsonLd(article: Article): Record<string, unknown> | null {
  if (article.tier !== 'A' || !article.persona) return null;

  const byline = renderByline(article.persona);
  const lastCorrection = article.corrections?.[article.corrections.length - 1];

  const citations = article.provenance.sources
    .filter((source) => Boolean(source.url))
    .map((source) => ({
      '@type': 'Dataset',
      name: source.dataset ?? source.source_id,
      url: source.url,
      ...(source.dataset_version ? { version: source.dataset_version } : {}),
    }));

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl(article.slug) },
    headline: article.headline,
    ...(article.dek ? { description: article.dek } : {}),
    articleSection: article.section,
    inLanguage: 'en',
    datePublished: article.published_at ?? article.created_at,
    dateModified: lastCorrection?.corrected_at ?? article.published_at ?? article.created_at,
    // Deliberately an Organization, never a Person. The author is a disclosed
    // software system; schema.org has no AI author type and a Person entry
    // would imply a human staff journalist.
    author: {
      '@type': 'Organization',
      name: byline,
      url: `${SITE_URL}/correspondents/${article.persona.id}`,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    editor: { '@type': 'Person', name: article.provenance.accountable_editor ?? ACCOUNTABLE_EDITOR },
    creativeWorkStatus: article.status === 'corrected' ? 'Corrected' : 'Published',
    ...(citations.length > 0 ? { isBasedOn: citations, citation: citations } : {}),
    ...(article.corrections?.length
      ? {
          correction: article.corrections.map((correction) => ({
            '@type': 'CorrectionComment',
            text: correction.description,
            datePublished: correction.corrected_at,
          })),
        }
      : {}),
  };
}
