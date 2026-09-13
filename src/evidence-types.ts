export const EVIDENCE_SERIES = 'baltic-unemployment-v1';
export const EVIDENCE_SELECTION = { freq: 'M', s_adj: 'SA', age: 'TOTAL', sex: 'T', unit: 'PC_ACT' } as const;
export const EVIDENCE_COUNTRIES = { EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania' } as const;
export type EvidenceCountry = keyof typeof EVIDENCE_COUNTRIES;
export type EvidenceFile = 'source.json' | 'normalized.json' | 'observations.csv' | 'dictionary.json' | 'comparison.json';

export interface EvidenceSummary {
  snapshot_id: string;
  observed_at: string;
  source_updated_at: string | null;
  row_count: number;
  missing_count: number;
  flagged_count: number;
}

export interface EvidenceIndex {
  version: 1;
  series_id: typeof EVIDENCE_SERIES;
  title: string;
  dataset: 'une_rt_m';
  selection: typeof EVIDENCE_SELECTION;
  start_period: '2020-01';
  stale_after_hours: number;
  last_attempt: {
    attempted_at: string;
    finished_at: string;
    status: 'captured' | 'unchanged' | 'reused' | 'failed';
    error?: string;
  } | null;
  last_success_at: string | null;
  latest_snapshot_id: string | null;
  months: string[];
  recent: EvidenceSummary[];
}

export interface EvidenceMonth {
  version: 1;
  month: string;
  snapshots: EvidenceSummary[];
}

export interface EvidenceArtifact {
  sha256: string;
}

export interface EvidenceManifest {
  format_version: 1;
  series_id: typeof EVIDENCE_SERIES;
  snapshot_id: string;
  status: 'complete';
  created_at: string;
  provenance: {
    request_url: string;
    retrieved_at: string;
    sha256: string;
    http_status: 200;
  };
  artifacts: Record<'normalized.json' | 'observations.csv' | 'dictionary.json', EvidenceArtifact>
    & Partial<Record<'raw' | 'source.json' | 'comparison.json', EvidenceArtifact>>;
  row_count: number;
  missing_count: number;
  flagged_count: number;
  attribution: string;
  modifications: string;
  disclaimer: string;
  previous_snapshot_id?: string;
}

export interface EvidenceRow {
  geo: EvidenceCountry;
  period: string;
  value: number | null;
  status: string;
  missing: boolean;
}

export interface EvidenceNormalized {
  format_version: 1;
  series_id: typeof EVIDENCE_SERIES;
  dataset: 'une_rt_m';
  selection: typeof EVIDENCE_SELECTION;
  start_period: '2020-01';
  source_updated_at: string | null;
  rows: EvidenceRow[];
}

export const EVIDENCE_CHANGE_LABELS = {
  value_revision: 'Revised reading',
  status_change: 'Flag change',
  filled_missing: 'Missing value filled',
  became_missing: 'Reading became missing',
  new_period: 'New observation period',
  removed_period: 'Period no longer returned',
  coverage_added: 'Added historical coverage',
  coverage_removed: 'Reduced request coverage',
} as const;
export type EvidenceChangeKind = keyof typeof EVIDENCE_CHANGE_LABELS;
export interface EvidenceChange {
  geo: EvidenceCountry;
  period: string;
  kind: EvidenceChangeKind;
  before: EvidenceRow | null;
  after: EvidenceRow | null;
}

export interface EvidenceComparison {
  before: string;
  after: string;
  unchanged: boolean;
  metadata_changed: boolean;
  value_revisions: number;
  changes: EvidenceChange[];
}

export interface EvidencePack {
  manifest: EvidenceManifest;
  data: EvidenceNormalized;
  comparison: EvidenceComparison | null;
}

export interface EvidenceBinding {
  version: 1;
  source_id: 'eurostat';
  dataset: 'une_rt_m';
  observed_at: string;
  request_url: string;
  snapshot_id: string;
  raw_sha256: string;
}
