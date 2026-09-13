import {
  EVIDENCE_CHANGE_LABELS, EVIDENCE_COUNTRIES, EVIDENCE_SELECTION, EVIDENCE_SERIES,
  type EvidenceBinding, type EvidenceComparison, type EvidenceIndex, type EvidenceManifest,
  type EvidenceMonth, type EvidenceNormalized, type EvidenceRow, type EvidenceSummary,
} from './evidence-types';

export class EvidenceError extends Error {
  readonly kind: 'not-found' | 'network' | 'integrity';
  constructor(kind: 'not-found' | 'network' | 'integrity', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'EvidenceError';
  }
}

export function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}
export function isEvidenceMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 2000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function timestamp(value: unknown): value is string {
  return text(value, 64) && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function optionalTimestamp(value: unknown): boolean {
  return value === null || timestamp(value);
}
function sourceTimestamp(value: unknown): boolean {
  return value === null || (text(value, 64) && Number.isFinite(Date.parse(value)));
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function counts(value: Record<string, unknown>): boolean {
  return count(value.row_count) && count(value.missing_count) && count(value.flagged_count)
    && value.missing_count <= value.row_count && value.flagged_count <= value.row_count;
}
function contract(value: Record<string, unknown>): boolean {
  return value.series_id === EVIDENCE_SERIES && value.dataset === 'une_rt_m'
    && value.start_period === '2020-01' && record(value.selection)
    && Object.keys(value.selection).length === Object.keys(EVIDENCE_SELECTION).length
    && Object.entries(EVIDENCE_SELECTION).every(([key, expected]) => record(value.selection) && value.selection[key] === expected);
}
function assert(valid: boolean, subject: string): asserts valid {
  if (!valid) throw new EvidenceError('integrity', `The ${subject} did not pass its format and identity checks.`);
}

/** Only the registered public source may become a navigable source URL. Never normalize binding input. */
export function isEvidenceSourceUrl(value: unknown): value is string {
  if (!text(value, 8192) || /[\r\n\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://ec.europa.eu' && !url.username && !url.password && !url.hash
      && url.pathname === '/eurostat/api/dissemination/statistics/1.0/data/une_rt_m'
      && Object.entries(EVIDENCE_SELECTION).every(([key, expected]) => {
        const values = url.searchParams.getAll(key);
        return key === 'freq' && values.length === 0 || values.length === 1 && values[0] === expected;
      })
      && Object.keys(EVIDENCE_COUNTRIES).every(geo => url.searchParams.getAll('geo').includes(geo));
  } catch {
    return false;
  }
}

function isSummary(value: unknown): value is EvidenceSummary {
  return record(value) && isSnapshotId(value.snapshot_id) && timestamp(value.observed_at)
    && sourceTimestamp(value.source_updated_at) && counts(value);
}
function summaries(value: unknown): value is EvidenceSummary[] {
  return Array.isArray(value) && value.length <= 20_000 && value.every(isSummary)
    && new Set(value.map(item => item.snapshot_id)).size === value.length;
}
function isIndex(value: unknown): value is EvidenceIndex {
  if (!record(value) || value.version !== 1 || !contract(value) || !text(value.title)) return false;
  const attempt = value.last_attempt;
  if (attempt !== null && (!record(attempt) || !timestamp(attempt.attempted_at) || !timestamp(attempt.finished_at)
    || Date.parse(attempt.finished_at) < Date.parse(attempt.attempted_at)
    || !['captured', 'unchanged', 'reused', 'failed'].includes(String(attempt.status))
    || (attempt.error !== undefined && !text(attempt.error, 1000)))) return false;
  if (typeof value.stale_after_hours !== 'number' || !Number.isFinite(value.stale_after_hours)
    || value.stale_after_hours <= 0 || !optionalTimestamp(value.last_success_at)) return false;
  if (value.latest_snapshot_id !== null && !isSnapshotId(value.latest_snapshot_id)) return false;
  return Array.isArray(value.months) && value.months.every(isEvidenceMonth)
    && new Set(value.months).size === value.months.length && summaries(value.recent)
    && value.recent.every(item => Array.isArray(value.months) && value.months.includes(item.observed_at.slice(0, 7)))
    && (value.latest_snapshot_id === null || value.recent.some(item => item.snapshot_id === value.latest_snapshot_id));
}
export function parseEvidenceIndex(value: unknown): EvidenceIndex {
  assert(isIndex(value), 'archive catalogue');
  return value;
}
function isMonth(value: unknown, expected: string): value is EvidenceMonth {
  return record(value) && value.version === 1 && value.month === expected && summaries(value.snapshots)
    && value.snapshots.every(item => item.observed_at.slice(0, 7) === expected);
}
export function parseEvidenceMonth(value: unknown, expected: string): EvidenceMonth {
  assert(isEvidenceMonth(expected) && isMonth(value, expected), 'monthly archive');
  return value;
}
function isManifest(value: unknown, id: string): value is EvidenceManifest {
  if (!record(value) || value.format_version !== 1 || value.series_id !== EVIDENCE_SERIES
    || value.snapshot_id !== id || value.status !== 'complete' || !timestamp(value.created_at) || !counts(value)) return false;
  const provenance = value.provenance;
  if (!record(provenance) || !isEvidenceSourceUrl(provenance.request_url) || !timestamp(provenance.retrieved_at)
    || !isSha256(provenance.sha256) || provenance.http_status !== 200 || !record(value.artifacts)) return false;
  for (const filename of ['normalized.json', 'observations.csv', 'dictionary.json']) {
    const entry = value.artifacts[filename];
    if (!record(entry) || !isSha256(entry.sha256)) return false;
  }
  for (const filename of ['raw', 'source.json', 'comparison.json']) {
    const entry = value.artifacts[filename];
    if (entry !== undefined && (!record(entry) || !isSha256(entry.sha256))) return false;
    if (record(entry) && filename !== 'comparison.json' && entry.sha256 !== provenance.sha256) return false;
  }
  if (value.previous_snapshot_id !== undefined && (!isSnapshotId(value.previous_snapshot_id) || value.previous_snapshot_id === id)) return false;
  return (value.artifacts['comparison.json'] === undefined || isSnapshotId(value.previous_snapshot_id))
    && text(value.attribution) && text(value.modifications) && text(value.disclaimer);
}
export function parseEvidenceManifest(value: unknown, id: string): EvidenceManifest {
  assert(isSnapshotId(id) && isManifest(value, id), 'snapshot manifest');
  return value;
}
function isRow(value: unknown): value is EvidenceRow {
  return record(value) && typeof value.geo === 'string' && Object.hasOwn(EVIDENCE_COUNTRIES, value.geo)
    && isEvidenceMonth(value.period) && value.period >= '2020-01'
    && (value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value)))
    && value.missing === (value.value === null)
    && typeof value.status === 'string' && value.status.length <= 100 && /^[A-Za-z0-9 :;,_-]*$/.test(value.status);
}
function isNormalized(value: unknown): value is EvidenceNormalized {
  return record(value) && value.format_version === 1 && contract(value) && sourceTimestamp(value.source_updated_at)
    && Array.isArray(value.rows) && value.rows.length > 0 && value.rows.length <= 20_000 && value.rows.every(isRow)
    && new Set(value.rows.map(row => `${row.geo}/${row.period}`)).size === value.rows.length;
}
export function parseEvidenceNormalized(value: unknown, manifest: EvidenceManifest): EvidenceNormalized {
  assert(isNormalized(value), 'normalized observations');
  assert(value.rows.length === manifest.row_count
    && value.rows.filter(row => row.missing).length === manifest.missing_count
    && value.rows.filter(row => row.status !== '').length === manifest.flagged_count
    && Object.keys(EVIDENCE_COUNTRIES).every(geo => value.rows.some(row => row.geo === geo)), 'observation coverage');
  return value;
}
function isComparison(value: unknown, manifest: EvidenceManifest): value is EvidenceComparison {
  if (!record(value) || value.before !== manifest.previous_snapshot_id || value.after !== manifest.snapshot_id
    || typeof value.unchanged !== 'boolean' || typeof value.metadata_changed !== 'boolean' || !count(value.value_revisions)
    || !Array.isArray(value.changes) || value.changes.length > 40_000) return false;
  const valid = value.changes.every(change => {
    if (!record(change) || typeof change.kind !== 'string' || !Object.hasOwn(EVIDENCE_CHANGE_LABELS, change.kind)
      || (change.before !== null && !isRow(change.before)) || (change.after !== null && !isRow(change.after))
      || (change.before === null && change.after === null)) return false;
    if (![change.before, change.after].every(row => row === null || (isRow(row) && row.geo === change.geo && row.period === change.period))) return false;
    if (change.kind === 'new_period' || change.kind === 'coverage_added') return change.before === null && isRow(change.after);
    if (change.kind === 'removed_period' || change.kind === 'coverage_removed') return isRow(change.before) && change.after === null;
    if (!isRow(change.before) || !isRow(change.after)) return false;
    if (change.kind === 'filled_missing') return change.before.missing && !change.after.missing;
    if (change.kind === 'became_missing') return !change.before.missing && change.after.missing;
    if (change.kind === 'value_revision') return !change.before.missing && !change.after.missing && change.before.value !== change.after.value;
    return change.before.value === change.after.value && change.before.status !== change.after.status;
  });
  return valid && value.value_revisions === value.changes.filter(change => record(change) && change.kind === 'value_revision').length
    && value.unchanged === (value.changes.length === 0 && !value.metadata_changed)
    && new Set(value.changes.map(change => record(change) ? `${change.geo}/${change.period}` : '')).size === value.changes.length;
}
export function parseEvidenceComparison(value: unknown, manifest: EvidenceManifest): EvidenceComparison {
  assert(isComparison(value, manifest), 'revision comparison');
  return value;
}
function isBinding(value: unknown): value is EvidenceBinding {
  return record(value) && value.version === 1 && value.source_id === 'eurostat' && value.dataset === 'une_rt_m'
    && timestamp(value.observed_at) && isEvidenceSourceUrl(value.request_url)
    && isSnapshotId(value.snapshot_id) && isSha256(value.raw_sha256);
}
export function parseEvidenceBinding(value: unknown): EvidenceBinding {
  assert(isBinding(value), 'article evidence binding');
  return value;
}
