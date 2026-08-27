// ─── Newsroom types ───
//
// TypeScript mirror of newsroom/schemas/article.schema.json.
// Keep the two in sync — the schema is authoritative and validates at write
// time in the pipeline; these types govern the reader at render time.

import type { DashboardSection } from './types';

/** A = original data journalism, B = verbatim press release, C = link-out card. */
export type ArticleTier = 'A' | 'B' | 'C';

export type ArticleStatus =
  | 'draft'
  | 'pending_approval'
  | 'published'
  | 'rejected'
  | 'corrected'
  | 'retracted';

export type PersonaId = 'nida' | 'akmensrags' | 'kolka' | 'ristna' | 'irbene' | 'saulkrasti';

export type Country = 'LV' | 'EE' | 'LT' | 'Baltic' | 'EU';

/** Names of the validator gates. Mirrors the enum in the JSON schema. */
export type ValidatorCheckName =
  | 'figures_traceable'
  | 'no_invented_numbers'
  | 'snippet_verbatim'
  | 'no_rewrite_of_restricted_source'
  | 'byline_discloses_ai'
  | 'no_lived_experience_claims'
  | 'attribution_present'
  | 'comparison_basis_stated'
  | 'no_repeated_findings';

export interface ValidatorCheck {
  name: ValidatorCheckName;
  passed: boolean;
  detail?: string;
}

export interface ValidatorVerdict {
  passed: boolean;
  checked_at: string;
  checks: ValidatorCheck[];
}

export interface ProvenanceSource {
  source_id: string;
  dataset?: string;
  dataset_version?: string;
  retrieved_at: string;
  url?: string;
}

export interface ResearchSource {
  source_id: string;
  source_name: string;
  role: 'official_statement' | 'prior_coverage';
  title: string;
  url: string;
  retrieved_at: string;
  published?: string;
  /**
   * How much of this source's own page was read. Present only for official
   * statements the registry permits fetching; the text itself is never copied
   * here, because it belongs to the publisher and the article links to it.
   */
  document_chars?: string;
  /** The search provider that surfaced this link, if we went looking for it. */
  discovered_by?: string;
}

export interface ResearchProvenance {
  method: 'registered_feeds';
  candidates_considered: number;
  /** Official statements whose full text was retrieved and read. */
  documents_fetched?: number;
  consulted: ResearchSource[];
}

/** One verified figure the article borrowed from another series. */
export interface ContextFact {
  field: string;
  kind: 'peer' | 'companion' | 'placement' | 'trajectory';
  period: string;
  source_id: string;
  metric?: string;
  geography?: string;
  dataset?: string;
}

/**
 * The other series the newsroom already held that bear on this finding. Every
 * figure here passed the same traceability check as the detector's own.
 */
export interface ContextProvenance {
  method: 'collected_series';
  series_considered: number;
  facts: ContextFact[];
  /** Statements computed from the series by code rather than by a model. */
  observations?: string[];
}

/** A candidate explanation, and the verified fields that license it. */
export interface AnalysisMechanism {
  claim: string;
  grounded_in: string[];
  /** `established`: the figures show it. `consistent`: they merely allow it. */
  confidence: 'established' | 'consistent';
}

/**
 * The specialist desk's brief. Mechanisms that named no verified field were
 * deleted in code before the writer saw them; `mechanisms_discarded` counts
 * those, and is published rather than hidden.
 */
export interface AnalysisProvenance {
  prompt_version: string;
  expert: string;
  discipline: string;
  angle?: string;
  significance?: string;
  mechanisms?: AnalysisMechanism[];
  what_to_watch?: string;
  caveats?: string[];
  mechanisms_discarded?: number;
}

export type EditorDecision = 'approve' | 'revise' | 'reject' | 'escalate';

export interface EditorProvenance {
  prompt_version: string;
  decision: EditorDecision;
  reason: string;
  editor: string;
  decided_at: string;
  model?: string;
  notified_accountable_editor?: boolean;
  revisions?: number;
  notes?: string[];
}

/**
 * The article's "passport": what it was built from, by what, when, and who is
 * accountable. Rendered on the page — not merely stored.
 */
export interface Provenance {
  sources: ProvenanceSource[];
  signal_id?: string;
  /** Null for tiers B and C, which involve no generation at all. */
  model?: string | null;
  prompt_version?: string;
  research?: ResearchProvenance;
  context?: ContextProvenance;
  analysis?: AnalysisProvenance;
  generated_at: string;
  approved_by?: string;
  approved_at?: string;
  accountable_editor?: string;
  editor?: EditorProvenance;
  validator: ValidatorVerdict;
}

/** A numeric value in the prose, bound to the signal field it came from. */
export interface Figure {
  value: number;
  unit?: string;
  signal_field: string;
  rendered_as?: string;
}

export type BlockType = 'paragraph' | 'chart' | 'table' | 'quote' | 'list' | 'callout';

export interface ArticleBlock {
  type: BlockType;
  text?: string;
  /** Indicator id resolving to a live tile on /data. */
  chart_ref?: string;
  figures?: Figure[];
}

export interface Persona {
  id: PersonaId;
  name: string;
  beat: string;
  /** Rendered byline. Always contains "AI correspondent". */
  byline: string;
}

/** Tier B and C payload. We did not write these. */
export interface Syndicated {
  source_id: string;
  original_url: string;
  attribution: string;
  /** Tier C: verbatim from the outlet's own RSS <description>. Never rewritten. */
  snippet?: string;
  /** Tier B only, where the licence permits verbatim reproduction. */
  full_text?: string;
  snippet_is_verbatim: true;
}

export interface Correction {
  corrected_at: string;
  description: string;
  previous_value?: string;
}

export interface Article {
  id: string;
  slug: string;
  tier: ArticleTier;
  status: ArticleStatus;
  section: DashboardSection;
  headline: string;
  dek?: string;
  body?: ArticleBlock[];
  /** Present on tier A only — nobody bylines work we did not write. */
  persona?: Persona;
  /** Present on tiers B and C only. */
  syndicated?: Syndicated;
  provenance: Provenance;
  corrections?: Correction[];
  created_at: string;
  published_at?: string;
  countries?: Country[];
  tags?: string[];
}

/** Lightweight shape for feed listings, avoiding shipping full bodies to the index. */
export interface ArticleSummary {
  id: string;
  slug: string;
  tier: ArticleTier;
  section: DashboardSection;
  headline: string;
  dek?: string;
  persona?: Pick<Persona, 'id' | 'name' | 'byline'>;
  syndicated?: Pick<Syndicated, 'attribution' | 'original_url' | 'snippet'>;
  published_at?: string;
  countries?: Country[];
  /**
   * The article's own state.
   *
   * Optional because entries written before the field existed do not carry it,
   * and those are shown rather than hidden — the index has always held only
   * servable articles, so absence means "written before we recorded this", not
   * "withheld".
   */
  status?: ArticleStatus;
}

export interface ArticleIndex {
  generated_at: string;
  count: number;
  articles: ArticleSummary[];
}

/**
 * The render-time gate.
 *
 * Mirrors the pipeline's fail-closed rule: anything without a passing
 * validator verdict is not servable, no matter how it reached the client.
 * Call this before rendering any article, including in tests.
 */
export function isServable(article: Pick<Article, 'status' | 'provenance'>): boolean {
  return article.status === 'published' && article.provenance?.validator?.passed === true;
}
