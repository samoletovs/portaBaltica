import type { Article, ArticleSummary, ValidatorVerdict } from '../../src/news-types';

/**
 * Fixtures for the newsroom tests.
 *
 * Everything is local. No network, no Azure, no blob — the frontend's whole
 * contract is "read finished static JSON", so a plain object is a faithful
 * stand-in for what it will actually be handed.
 */

export const PASSING_VERDICT: ValidatorVerdict = {
  passed: true,
  checked_at: '2026-08-24T06:10:00Z',
  checks: [
    { name: 'figures_traceable', passed: true },
    { name: 'no_invented_numbers', passed: true },
    { name: 'byline_discloses_ai', passed: true },
    { name: 'no_lived_experience_claims', passed: true },
    { name: 'comparison_basis_stated', passed: true },
  ],
};

export const FAILING_VERDICT: ValidatorVerdict = {
  passed: false,
  checked_at: '2026-08-24T06:10:00Z',
  checks: [
    { name: 'figures_traceable', passed: true },
    {
      name: 'no_invented_numbers',
      passed: false,
      detail: '"3.1%" appears in the body but not in figures',
    },
  ],
};

export const SECRET_PROSE =
  'SHOULD-NEVER-RENDER: an unverified claim that inflation collapsed overnight.';

export function tierAArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '01JBALTICA0000000000000001',
    slug: 'latvian-wage-growth-outpaces-inflation',
    tier: 'A',
    status: 'published',
    section: 'economy',
    headline: 'Latvian wage growth outpaced inflation for a third straight quarter',
    dek: 'Hourly labour cost rose faster than consumer prices again, the longest such run since 2019.',
    body: [
      {
        type: 'paragraph',
        text: 'Hourly labour cost in Latvia rose 8.4% year on year in the second quarter, against consumer price growth of 2.1% over the same period.',
        figures: [
          { value: 8.4, unit: '%', signal_field: 'lc_lci_lev.yoy', rendered_as: '8.4%' },
          { value: 2.1, unit: '%', signal_field: 'prc_hicp_manr.yoy', rendered_as: '2.1%' },
        ],
      },
      { type: 'chart', chart_ref: 'salary', text: 'Hourly labour cost, Latvia, ten-year series.' },
    ],
    persona: {
      id: 'nida',
      name: 'Nida',
      beat: 'Economy & Labour',
      byline: 'Nida · AI correspondent, Economy & Labour',
    },
    provenance: {
      sources: [
        {
          source_id: 'eurostat',
          dataset: 'lc_lci_lev',
          dataset_version: '2026-08',
          retrieved_at: '2026-08-24T05:00:00Z',
          url: 'https://ec.europa.eu/eurostat/databrowser/view/lc_lci_lev',
        },
      ],
      signal_id: 'sig-lv-wages-2026q2',
      model: 'gpt-4o-mini@2024-07-18',
      prompt_version: 'v3',
      generated_at: '2026-08-24T06:00:00Z',
      accountable_editor: 'Sam Samoletovs',
      validator: PASSING_VERDICT,
    },
    created_at: '2026-08-24T06:00:00Z',
    published_at: '2026-08-24T06:15:00Z',
    countries: ['LV'],
    ...overrides,
  };
}

/**
 * A tier C item carrying material it must never display: body prose and a dek
 * that read as though we had written them. The renderer has to ignore both.
 */
export function tierCArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '01JBALTICA0000000000000003',
    slug: 'err-estonia-grid-story',
    tier: 'C',
    status: 'published',
    section: 'energy',
    headline: 'Estonia’s grid operator reports record desynchronisation test',
    dek: SECRET_PROSE,
    body: [{ type: 'paragraph', text: SECRET_PROSE }],
    syndicated: {
      source_id: 'err_en',
      original_url: 'https://news.err.ee/example-story',
      attribution: 'ERR News',
      snippet:
        'Elering said the test ran without incident and that frequency stayed within the permitted band throughout.',
      snippet_is_verbatim: true,
    },
    provenance: {
      sources: [
        { source_id: 'err_en', retrieved_at: '2026-08-24T05:30:00Z', url: 'https://news.err.ee/rss' },
      ],
      model: null,
      generated_at: '2026-08-24T05:31:00Z',
      approved_by: 'Sam Samoletovs',
      approved_at: '2026-08-24T05:45:00Z',
      accountable_editor: 'Sam Samoletovs',
      validator: PASSING_VERDICT,
    },
    created_at: '2026-08-24T05:31:00Z',
    published_at: '2026-08-24T05:45:00Z',
    ...overrides,
  };
}

export function tierASummary(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  const article = tierAArticle();
  return {
    id: article.id,
    slug: article.slug,
    tier: 'A',
    section: article.section,
    headline: article.headline,
    dek: article.dek,
    persona: { id: 'nida', name: 'Nida', byline: 'Nida · AI correspondent, Economy & Labour' },
    published_at: article.published_at,
    ...overrides,
  };
}

export function tierCSummary(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  const article = tierCArticle();
  return {
    id: article.id,
    slug: article.slug,
    tier: 'C',
    section: article.section,
    headline: article.headline,
    dek: SECRET_PROSE,
    syndicated: {
      attribution: 'ERR News',
      original_url: 'https://news.err.ee/example-story',
      snippet: article.syndicated!.snippet,
    },
    published_at: article.published_at,
    ...overrides,
  };
}
