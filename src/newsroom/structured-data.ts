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
import { publisherName } from './editorial';

export const SITE_URL = 'https://portabaltica.naurolabs.com';
export const SITE_NAME = 'portaBaltica';

// ─── Machine-readable AI disclosure ───
//
// EU AI Act Article 50 has applied since 2 August 2026. Text on a matter of
// public interest that is AI-generated must be disclosed as such, and from
// 2 December 2026 the disclosure must also be machine-readable — a deadline
// that lands on systems already on the market before August, which is us.
//
// The byline already carries the human-readable half ("AI correspondent"), and
// persona_rules.py enforces it. This is the other half. schema.org has no
// settled AI-authorship property, so this uses the IPTC digital source type
// vocabulary, which is the term C2PA embeds in Content Credentials and is
// therefore the one a verifier is most likely to recognise.
//
// trainedAlgorithmicMedia is the correct code and the honest one: the prose is
// composed by a model. It is NOT compositeWithTrainedAlgorithmicMedia, which
// would claim a human-written article with AI elements, and every figure in the
// piece being pipeline-verified does not change who wrote the sentences.
export const AI_DISCLOSURE =
  'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

/** Third-party material we reproduce or link to. We did not generate it. */
export const HUMAN_DISCLOSURE =
  'https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture';

export function articleUrl(slug: string): string {
  return `${SITE_URL}/article/${slug}`;
}

/**
 * The disclosure code for a given tier.
 *
 * Tier B and C are somebody else's words, reproduced verbatim or linked. Marking
 * them as algorithmically generated would be as wrong as failing to mark tier A,
 * and in the more damaging direction: it would attribute a synthetic origin to a
 * human journalist's work.
 */
export function disclosureFor(tier: Article['tier']): string {
  return tier === 'A' ? AI_DISCLOSURE : HUMAN_DISCLOSURE;
}

export function newsArticleJsonLd(article: Article): Record<string, unknown> | null {
  if (article.tier !== 'A' || !article.persona) return null;

  const byline = renderByline(article.persona);
  const lastCorrection = article.corrections?.[article.corrections.length - 1];

  const dataCitations = article.provenance.sources
    .filter((source) => Boolean(source.url))
    .map((source) => ({
      '@type': 'Dataset',
      name: source.dataset ?? source.source_id,
      url: source.url,
      ...(source.dataset_version ? { version: source.dataset_version } : {}),
    }));
  const researchCitations =
    article.provenance.research?.consulted.map((source) => ({
      '@type': 'CreativeWork',
      name: source.title,
      url: source.url,
      publisher: { '@type': 'Organization', name: source.source_name },
    })) ?? [];
  // One entry per distinct source, not one per series read. `sources` carries
  // an entry for every series the signal touched, and a structural_divergence
  // signal reads three series out of ONE cube -- measured on production
  // 2026-08-28, 3 of the newest 10 tier A articles published three identical
  // Dataset entries. A human reads the provenance panel and sees one source;
  // an answer engine parses this and counts three. Deduped on the identifying
  // triple rather than the URL alone, because two readings at different
  // vintages are genuinely two citations. Mirrored in api/shared/articleMeta.js
  // and asserted equal by tests/articleMetaParity.test.ts.
  const seen = new Set<string>();
  const citations = [...dataCitations, ...researchCitations].filter((entry) => {
    const key = JSON.stringify([
      entry['@type'],
      entry.name,
      entry.url,
      'version' in entry ? entry.version : undefined,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl(article.slug) },
    headline: article.headline,
    ...(article.dek ? { description: article.dek } : {}),
    articleSection: article.section,
    inLanguage: 'en',
    // EU AI Act Article 50: the machine-readable half of the disclosure the
    // byline already makes in words.
    digitalSourceType: disclosureFor(article.tier),
    datePublished: article.published_at ?? article.created_at,
    dateModified: lastCorrection?.corrected_at ?? article.published_at ?? article.created_at,
    // Deliberately an Organization, never a Person. The author is a disclosed
    // software system; schema.org has no AI author type and a Person entry
    // would imply a human staff journalist.
    author: {
      '@type': 'Organization',
      name: byline,
      url: `${SITE_URL}/newsroom/${article.persona.id}`,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    editor: { '@type': 'Person', name: publisherName(article.provenance.accountable_editor) },
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
