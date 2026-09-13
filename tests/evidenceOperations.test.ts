import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { evidenceObservation } = require('../api/shared/evidenceHealth.js');
const registry = require('../api/shared/statusChecks.js');
const freshness = require('../api/shared/freshness.js');
const status = require('../api/system-status/index.js');
const es = require('../api/shared/eurostat.js');
const pageMeta = require('../api/shared/pageMeta.js');

const now = new Date('2026-09-13T14:00:00Z');
const check = registry.CHECKS.find((item: { type: string }) => item.type === 'evidence-archive');
const snapshotId = 'a'.repeat(32);

function index() {
  return {
    version: 1,
    series_id: 'baltic-unemployment-v1',
    latest_snapshot_id: snapshotId,
    last_success_at: '2026-09-13T13:00:00Z',
    stale_after_hours: 26,
    last_attempt: {
      attempted_at: '2026-09-13T12:59:58Z',
      finished_at: '2026-09-13T13:00:01Z',
      status: 'unchanged',
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('evidence health measures source capture, not changing monthly values', () => {
  it('is wired as a required check of the published archive index', async () => {
    expect(check.required).toBe(true);
    expect(check.url).toMatch(/\/articles\/evidence\/v1\/index\.json$/);
    const fetch = vi.spyOn(es, 'httpJson').mockResolvedValue(index());
    const observation = await status.probe(check);
    expect(fetch).toHaveBeenCalledWith(check.url, expect.objectContaining({ deadlineMs: 3000 }));
    expect(freshness.judge(check, observation, now).state).toBe('fresh');
  });

  it('allows a freshly fetched but numerically unchanged dataset', () => {
    expect(freshness.judge(check, evidenceObservation(index(), now), now).state).toBe('fresh');
  });

  it('cannot turn an old capture fresh by replaying its cache', () => {
    const body = index();
    body.last_attempt.status = 'reused';
    body.last_success_at = '2026-09-10T13:00:00Z';
    expect(freshness.judge(check, evidenceObservation(body, now), now).state).toBe('stale');
  });

  it('does not let metadata disable the daily capture deadline', () => {
    const body = index();
    body.stale_after_hours = 10000;
    body.last_success_at = '2026-09-10T13:00:00Z';
    expect(freshness.judge(check, evidenceObservation(body, now), now).state).toBe('stale');
  });

  it('surfaces a failed capture even when an earlier snapshot exists', () => {
    const body = index();
    body.last_attempt.status = 'failed';
    expect(() => evidenceObservation(body, now)).toThrow(/last evidence capture failed/i);
  });

  it.each([null, {}, { ...index(), last_attempt: null }, { ...index(), latest_snapshot_id: '../raw-feeds' }])(
    'refuses an incomplete index instead of returning a healthy observation',
    (body) => { expect(() => evidenceObservation(body, now)).toThrow(); },
  );

  it.each(['not-a-date', '2099-01-01T00:00:00Z'])('refuses invalid or future retrieval time %s', (time) => {
    expect(() => evidenceObservation({ ...index(), last_success_at: time }, now)).toThrow(/retrieval time/);
  });

  it('propagates an unreadable index as failure', async () => {
    vi.spyOn(es, 'httpJson').mockRejectedValue(new Error('HTTP 404 from the archive'));
    await expect(status.probe(check)).rejects.toThrow(/404/);
  });
});

describe('evidence page metadata and routing', () => {
  it('serves a useful canonical catalogue head without client JavaScript', () => {
    expect(pageMeta.metaFor('/evidence')).toMatchObject({
      title: 'Evidence archive | portaBaltica',
      canonical: 'https://portabaltica.naurolabs.com/evidence',
      index: true,
    });
  });

  it('only recognizes well-formed frozen snapshot paths', () => {
    expect(pageMeta.metaFor('/evidence/' + snapshotId)).toMatchObject({
      title: 'Frozen evidence | portaBaltica', index: false,
    });
    expect(pageMeta.metaFor('/evidence/<script>')).toBeNull();
  });

  it('routes catalogue and snapshot deep links through the metadata shell', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'staticwebapp.config.json'), 'utf8'));
    for (const route of ['/evidence', '/evidence/*']) {
      expect(config.routes).toContainEqual({ route, rewrite: '/api/page-shell' });
    }
  });
});
