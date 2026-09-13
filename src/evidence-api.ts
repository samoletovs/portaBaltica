import type { ProvenanceSource } from './news-types';
import type { EvidenceFile, EvidenceIndex, EvidenceManifest, EvidencePack } from './evidence-types';
import { categorizeEvidenceComparison } from './evidence-comparison';
import {
  EvidenceError, isEvidenceMonth, isEvidenceSourceUrl, isEvidenceTimestamp, isSnapshotId, parseEvidenceBinding,
  parseEvidenceComparison, parseEvidenceIndex, parseEvidenceManifest, parseEvidenceMonth, parseEvidenceNormalized,
} from './evidence-validation';

const BASE = `${(import.meta.env.VITE_ARTICLES_BASE_URL ?? '/articles').replace(/\/$/, '')}/evidence/v1`;
const MAX_BYTES = 8 * 1024 * 1024;
const FILES: readonly string[] = ['source.json', 'normalized.json', 'observations.csv', 'dictionary.json', 'comparison.json', 'manifest.json'];

export function evidenceFileUrl(id: string, file: EvidenceFile | 'manifest.json'): string {
  if (!isSnapshotId(id) || !FILES.includes(file)) throw new EvidenceError('integrity', 'Invalid evidence file address.');
  return `${BASE}/snapshots/${id}/${file}`;
}

async function bytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (response.status === 404) throw new EvidenceError('not-found', 'This evidence record is not available.');
    if (!response.ok) throw new EvidenceError('network', 'The evidence archive could not be reached.');
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_BYTES) throw new EvidenceError('integrity', 'The evidence file exceeds its supported size.');
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new EvidenceError('integrity', 'The evidence file exceeds its supported size.');
    return body;
  } catch (error) {
    if (error instanceof EvidenceError || signal?.aborted) throw error;
    throw new EvidenceError('network', 'The evidence archive could not be reached. Please try again.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
function json(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new EvidenceError('integrity', 'The evidence file is not valid JSON.');
  }
}
export async function evidenceSha256(body: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new EvidenceError('integrity', 'This browser cannot verify SHA-256. Use a current browser over HTTPS.');
  const hash = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export function evidenceFileHash(manifest: EvidenceManifest, file: EvidenceFile): string {
  const hash = file === 'source.json' ? manifest.provenance.sha256 : manifest.artifacts[file]?.sha256;
  if (!hash) throw new EvidenceError('integrity', 'This file has no recorded checksum.');
  return hash;
}
async function checkedBytes(manifest: EvidenceManifest, file: EvidenceFile, signal?: AbortSignal): Promise<ArrayBuffer> {
  const body = await bytes(evidenceFileUrl(manifest.snapshot_id, file), signal);
  if (await evidenceSha256(body) !== evidenceFileHash(manifest, file)) {
    throw new EvidenceError('integrity', `${file} does not match its recorded SHA-256. The file has been withheld.`);
  }
  return body;
}
export async function fetchEvidenceDownload(manifest: EvidenceManifest, file: EvidenceFile, signal?: AbortSignal): Promise<ArrayBuffer> {
  return checkedBytes(manifest, file, signal);
}
export async function fetchEvidenceIndex(signal?: AbortSignal): Promise<EvidenceIndex> {
  return parseEvidenceIndex(json(await bytes(`${BASE}/index.json`, signal)));
}
export async function fetchEvidenceMonth(month: string, signal?: AbortSignal) {
  if (!isEvidenceMonth(month)) throw new EvidenceError('integrity', 'Invalid archive month.');
  return parseEvidenceMonth(json(await bytes(`${BASE}/months/${month}.json`, signal)), month);
}
export async function fetchEvidenceManifest(id: string, signal?: AbortSignal): Promise<EvidenceManifest> {
  return parseEvidenceManifest(json(await bytes(evidenceFileUrl(id, 'manifest.json'), signal)), id);
}
export async function fetchEvidencePack(id: string, signal?: AbortSignal): Promise<EvidencePack> {
  const manifest = await fetchEvidenceManifest(id, signal);
  const data = parseEvidenceNormalized(json(await checkedBytes(manifest, 'normalized.json', signal)), manifest);
  let comparison = null;
  if (manifest.artifacts['comparison.json'] && manifest.previous_snapshot_id) {
    const delta = parseEvidenceComparison(json(await checkedBytes(manifest, 'comparison.json', signal)), manifest);
    const previousManifest = await fetchEvidenceManifest(manifest.previous_snapshot_id, signal);
    if (Date.parse(previousManifest.provenance.retrieved_at) > Date.parse(manifest.provenance.retrieved_at)) {
      throw new EvidenceError('integrity', 'The comparison reverses the capture chronology.');
    }
    const before = parseEvidenceNormalized(json(await checkedBytes(previousManifest, 'normalized.json', signal)), previousManifest);
    comparison = categorizeEvidenceComparison({ comparison: delta, before, after: data });
  }
  return { manifest, data, comparison };
}
export async function verifyEvidenceDownloads(manifest: EvidenceManifest, signal?: AbortSignal): Promise<void> {
  await Promise.all((['source.json', 'observations.csv', 'dictionary.json'] as const)
    .map(file => checkedBytes(manifest, file, signal)));
}

export function isEligibleEvidenceSource(source: ProvenanceSource): boolean {
  return source.source_id === 'eurostat' && source.dataset === 'une_rt_m'
    && isEvidenceTimestamp(source.retrieved_at) && isEvidenceSourceUrl(source.url);
}
export async function evidenceBindingKey(source: ProvenanceSource): Promise<string | null> {
  if (!isEligibleEvidenceSource(source)) return null;
  return evidenceSha256(new TextEncoder().encode(
    [source.source_id, source.dataset, source.retrieved_at, source.url].join('\n'),
  ).buffer);
}
export async function resolveEvidenceSource(source: ProvenanceSource, signal?: AbortSignal): Promise<string | null> {
  if (!isEligibleEvidenceSource(source)) return null;
  let id = source.evidence_snapshot_id;
  let expectedHash: string | undefined;
  if (id !== undefined && !isSnapshotId(id)) throw new EvidenceError('integrity', 'The source has an invalid evidence identifier.');
  if (id === undefined) {
    const key = await evidenceBindingKey(source);
    if (!key) return null;
    let value: unknown;
    try {
      value = json(await bytes(`${BASE}/bindings/${key}.json`, signal));
    } catch (error) {
      if (error instanceof EvidenceError && error.kind === 'not-found') return null;
      throw error;
    }
    const binding = parseEvidenceBinding(value);
    if (binding.source_id !== source.source_id || binding.dataset !== source.dataset
      || binding.observed_at !== source.retrieved_at || binding.request_url !== source.url) {
      throw new EvidenceError('integrity', 'The frozen record does not match this article source.');
    }
    id = binding.snapshot_id;
    expectedHash = binding.raw_sha256;
  }
  const manifest = await fetchEvidenceManifest(id, signal);
  if (manifest.provenance.retrieved_at !== source.retrieved_at || manifest.provenance.request_url !== source.url
    || (expectedHash !== undefined && manifest.provenance.sha256 !== expectedHash)) {
    throw new EvidenceError('integrity', 'The frozen record does not match this article source.');
  }
  return id;
}

export function evidenceHealth(index: EvidenceIndex, now = Date.now()): { label: string; detail: string; warning: boolean } {
  if (index.last_attempt?.status === 'failed') {
    return { label: 'Last capture failed', detail: 'Earlier captures remain available. A failed attempt is not unchanged data.', warning: true };
  }
  if (!index.last_attempt || !index.last_success_at || !index.latest_snapshot_id) {
    return { label: 'No confirmed capture', detail: 'The archive has not reported a completed successful capture.', warning: true };
  }
  const latest = index.recent.find(item => item.snapshot_id === index.latest_snapshot_id);
  const moments = [index.last_attempt.attempted_at, index.last_attempt.finished_at, index.last_success_at, latest?.observed_at];
  const staleHours = Math.min(index.stale_after_hours, 26);
  const invalid = !Number.isFinite(staleHours) || staleHours <= 0
    || moments.some(value => !isEvidenceTimestamp(value) || Date.parse(value) > now)
    || Date.parse(index.last_attempt.finished_at) < Date.parse(index.last_attempt.attempted_at)
    || Date.parse(index.last_success_at) > Date.parse(index.last_attempt.finished_at);
  if (invalid) return { label: 'Archive timing invalid', detail: 'The archive reported malformed, future or inconsistent timing. Its freshness cannot be confirmed.', warning: true };
  const overdue = [index.last_attempt.finished_at, index.last_success_at]
    .some(value => now - Date.parse(value) > staleHours * 3_600_000);
  if (overdue) return { label: 'Capture overdue', detail: 'Retrieval or monitoring is older than the expected archive interval. These are historical records, not a fresh feed.', warning: true };
  return {
    label: index.last_attempt.status === 'reused' ? 'Cached capture reused' : index.last_attempt.status === 'unchanged' ? 'Source checked, unchanged' : 'Capture up to date',
    detail: 'Archive timing describes retrieval, not how recent the measured observation is.',
    warning: false,
  };
}
