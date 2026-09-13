import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

const SITE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const ARTICLES = 'https://stportabalticabpmff5so.blob.core.windows.net/articles';
const BASE = ARTICLES + '/evidence/v1';
const ARTICLE_SLUG = 'latvia-s-unemployment-rate-rises-to-7-3-in-july-154f54';

interface SnapshotManifest {
  snapshot_id: string;
  status: string;
  provenance: { sha256: string; retrieved_at: string };
  artifacts: Record<string, { sha256: string }>;
}

async function response(url: string): Promise<Response> {
  const result = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  expect(result.status, url).toBe(200);
  return result;
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('deployed evidence preserves and serves the source behind real reporting', () => {
  let snapshotId: string;
  let manifest: SnapshotManifest;

  beforeAll(async () => {
    const index = await (await response(BASE + '/index.json')).json();
    expect(index.version).toBe(1);
    expect(index.series_id).toBe('baltic-unemployment-v1');
    expect(index.latest_snapshot_id).toMatch(/^[a-f0-9]{32}$/);
    expect(index.months.length).toBeGreaterThan(0);
    snapshotId = index.latest_snapshot_id;
    manifest = await (await response(`${BASE}/snapshots/${snapshotId}/manifest.json`)).json();
  });

  it('serves the catalogue and snapshot deep-link metadata before JavaScript executes', async () => {
    const catalogue = await (await response(SITE + '/evidence')).text();
    const snapshot = await (await response(`${SITE}/evidence/${snapshotId}`)).text();
    expect(catalogue).toContain('<title>Evidence archive | portaBaltica</title>');
    expect(snapshot).toContain('<title>Frozen evidence | portaBaltica</title>');
    expect(snapshot).toContain(`https://portabaltica.naurolabs.com/evidence/${snapshotId}`);
  });

  it('downloads raw bytes and CSV matching the frozen manifest hashes', async () => {
    expect(manifest.snapshot_id).toBe(snapshotId);
    expect(manifest.status).toBe('complete');
    const raw = new Uint8Array(await (await response(`${BASE}/snapshots/${snapshotId}/source.json`)).arrayBuffer());
    const csv = new Uint8Array(await (await response(`${BASE}/snapshots/${snapshotId}/observations.csv`)).arrayBuffer());
    expect(hash(raw)).toBe(manifest.provenance.sha256);
    expect(hash(csv)).toBe(manifest.artifacts['observations.csv'].sha256);
    expect(new TextDecoder().decode(csv)).toContain('observed_at');
    expect(new TextDecoder().decode(csv)).toContain(manifest.provenance.retrieved_at);
  });

  it('binds an existing article to its exact source timestamp and URL, not the nearest vintage', async () => {
    const article = await (await response(`${ARTICLES}/${ARTICLE_SLUG}.json`)).json();
    const source = article.provenance.sources.find(
      (item: { source_id: string; dataset: string }) => item.source_id === 'eurostat' && item.dataset === 'une_rt_m',
    );
    expect(source).toBeDefined();
    const key = hash(new TextEncoder().encode(
      [source.source_id, source.dataset, source.retrieved_at, source.url].join('\n'),
    ));
    const binding = await (await response(`${BASE}/bindings/${key}.json`)).json();
    expect(binding).toMatchObject({
      version: 1, source_id: source.source_id, dataset: source.dataset,
      observed_at: source.retrieved_at, request_url: source.url,
    });
    expect(binding.snapshot_id).toMatch(/^[a-f0-9]{32}$/);
    const bound = await (await response(`${BASE}/snapshots/${binding.snapshot_id}/manifest.json`)).json();
    expect(bound.snapshot_id).toBe(binding.snapshot_id);
    expect(bound.status).toBe('complete');
    expect(bound.provenance.retrieved_at).toBe(source.retrieved_at);
    expect(bound.provenance.request_url).toBe(source.url);
    expect(bound.provenance.sha256).toBe(binding.raw_sha256);
    const boundBase = `${BASE}/snapshots/${binding.snapshot_id}`;
    const raw = new Uint8Array(await (await response(`${boundBase}/source.json`)).arrayBuffer());
    expect(hash(raw)).toBe(binding.raw_sha256);
    for (const filename of ['observations.csv', 'normalized.json', 'dictionary.json']) {
      const bytes = new Uint8Array(await (await response(`${boundBase}/${filename}`)).arrayBuffer());
      expect(hash(bytes), filename).toBe(bound.artifacts[filename].sha256);
    }
  });

  it('reports recent successful source capture through the existing status endpoint', async () => {
    const health = await (await response(SITE + '/api/system-status')).json();
    const checks = health.dataSources.checks;
    expect(Array.isArray(checks)).toBe(true);
    const evidence = checks.find((item: { name: string }) => item.name === 'Evidence archive');
    expect(evidence).toMatchObject({ status: 'healthy', freshness: 'fresh', required: true });
  });
});
