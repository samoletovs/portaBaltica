/**
 * The two things `/api/system-status` says that are not about any one source:
 * whether a hung connection counts as an outage, and what one word describes
 * the whole site.
 *
 * Both were wrong in production at the same time. The Open-Meteo probe answered
 * in 17–63ms when it worked and in *exactly* 5000ms when it did not, roughly
 * one call in three, while the same endpoint answered in 119–222ms from a
 * laptop. A response landing precisely on the deadline is a socket that was
 * accepted and then said nothing, not a slow source — most likely the shared
 * Azure egress address meeting Open-Meteo's per-IP free-tier limit. The site
 * reported `degraded` every third call because of it.
 *
 * That matters beyond the flap itself: a status page that cries wolf teaches
 * readers to ignore it, and then the real outage goes unnoticed because nobody
 * trusts the amber light. It is the same argument the freshness contract makes,
 * applied to timeouts.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const es = require('../api/shared/eurostat.js');
const freshness = require('../api/shared/freshness.js');
const status = require('../api/system-status/index.js');

describe('withRetry', () => {
  it('retries a connection that hung, and succeeds on the second attempt', async () => {
    // The production failure: one attempt dies on the deadline, a fresh
    // connection answers immediately.
    let attempts = 0;
    const result = await es.withRetry(() => {
      attempts++;
      if (attempts === 1) {
        const err: Error & { transient?: boolean } = new Error('Deadline 3000ms exceeded');
        err.transient = true;
        return Promise.reject(err);
      }
      return Promise.resolve('ok');
    }, 1);

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry an answer, however unwelcome', async () => {
    // A 404 or a malformed body is a reply. Asking again spends another second
    // to be told the same thing, and on a status page that is a second of the
    // reader's time for nothing.
    let attempts = 0;
    await expect(es.withRetry(() => {
      attempts++;
      return Promise.reject(new Error('HTTP 404 from https://example.invalid'));
    }, 1)).rejects.toThrow(/404/);

    expect(attempts).toBe(1);
  });

  it('gives up after the allowance and reports the real error', async () => {
    let attempts = 0;
    await expect(es.withRetry(() => {
      attempts++;
      const err: Error & { transient?: boolean } = new Error('Timeout: https://example.invalid');
      err.transient = true;
      return Promise.reject(err);
    }, 1)).rejects.toThrow(/Timeout/);

    expect(attempts).toBe(2);
  });

  it('does not retry at all when no allowance is given', async () => {
    // The default, so no existing caller changes behaviour.
    let attempts = 0;
    await expect(es.withRetry(() => {
      attempts++;
      const err: Error & { transient?: boolean } = new Error('Timeout');
      err.transient = true;
      return Promise.reject(err);
    }, 0)).rejects.toThrow();

    expect(attempts).toBe(1);
  });
});

describe('overallStatus', () => {
  const check = (over: Record<string, unknown>) =>
    Object.assign({ name: 'x', status: 'healthy', required: true }, over);

  it('is healthy when every required source is current', () => {
    expect(status.overallStatus([check({}), check({}), check({ required: false })]))
      .toBe('healthy');
  });

  it('is stale, not degraded, when everything answers but something is frozen', () => {
    // The distinction the endpoint exists to draw. A frozen source is not a
    // broken one, and telling a reader "degraded" for a table that is merely
    // behind is the same overstatement the maritime probe used to make.
    expect(status.overallStatus([check({}), check({ status: 'stale' })])).toBe('stale');
  });

  it('is degraded when a source is actually down but most are up', () => {
    expect(status.overallStatus([check({}), check({}), check({ status: 'unhealthy' })]))
      .toBe('degraded');
  });

  it('lets a real outage outrank staleness', () => {
    // Down is worse news than late, so a mix reports the worse of the two.
    expect(status.overallStatus([check({ status: 'stale' }), check({ status: 'unhealthy' }), check({})]))
      .toBe('degraded');
  });

  it('is unhealthy when most required sources are down', () => {
    expect(status.overallStatus([
      check({ status: 'unhealthy' }), check({ status: 'unhealthy' }), check({}),
    ])).toBe('unhealthy');
  });

  it('ignores optional sources, which is why Riga Open Data does not red-light the site', () => {
    // Every entity set on that host returns HTTP 500 upstream and nothing on
    // the dashboard reads it. It is probed as a signal, not a dependency.
    expect(status.overallStatus([check({}), check({ required: false, status: 'unhealthy' })]))
      .toBe('healthy');
  });
});

describe('newsroomObservation', () => {
  /**
   * The real report shape, from PR #82. The one on 25 Aug is the case the
   * whole contract exists for: every tier A article rejected, one syndicated
   * wire card published, so `counts.published` was 1 and truthful and told
   * nobody that the newsroom had had its worst day.
   */
  const report = {
    version: 1,
    finished_at: '2026-08-26T14:05:12Z',
    trigger: 'timer',
    schedule: '0 0 5,11,17 * * *',
    stale_after_hours: 26,
    counts: { signals_detected: 7, articles_generated: 5, published: 3, rejected: 2, errors: 0 },
    original_articles: { generated: 5, publishable: 3, attempts_total: 9, attempts_max: 3 },
    liveness: { last_original_at: '2026-08-26T14:04:00Z', runs_without_originals: 0 },
  };

  it('reads the timestamp and the production counts', () => {
    const observation = status.newsroomObservation(report);
    expect(observation).toMatchObject({
      at: '2026-08-26T14:05:12Z',
      generated: 5,
      publishable: 3,
      attemptsTotal: 9,
      published: 3,
      trigger: 'timer',
    });
  });

  it('prefers the threshold the report declares over ours', () => {
    // The newsroom moved from one run a day to three the moment PR #82 merged.
    // A bound copied into our registry would have silently become wrong, so
    // `stale_after_hours` wins.
    expect(status.newsroomObservation(report).maxLag).toBe(26);

    const check = { cadence: 'H', maxLag: 3 };
    const recent = { at: '2026-08-26T09:00:00Z', maxLag: 26 };
    expect(freshness.judge(check, recent, new Date('2026-08-26T20:00:00Z')).state).toBe('fresh');
    expect(freshness.judge(check, { at: recent.at }, new Date('2026-08-26T20:00:00Z')).state)
      .toBe('stale');
  });

  it('calls a run that wrote articles and shipped none of them stale', () => {
    // 25 Aug. `counts.published` is 1 because a syndicated card went out, and
    // reading that alone would have reported a healthy newsroom.
    const badDay = Object.assign({}, report, {
      counts: { published: 1, rejected: 5, errors: 0 },
      original_articles: { generated: 5, publishable: 0, attempts_total: 15, attempts_max: 3 },
    });

    const observation = status.newsroomObservation(badDay);
    expect(observation.stale).toBe(true);
    expect(observation.staleReason).toMatch(/published none/);
    expect(observation.published, 'the syndicated card is still reported').toBe(1);

    // And it reaches the verdict even though the timestamp is current.
    const verdict = freshness.judge(
      { cadence: 'H', maxLag: 26 }, observation, new Date('2026-08-26T14:10:00Z'));
    expect(verdict.state).toBe('stale');
  });

  it('leaves a genuinely quiet day alone', () => {
    // Nothing newsworthy is not a failure. Only "wrote some, shipped none" is.
    const quiet = Object.assign({}, report, {
      counts: { published: 0, rejected: 0, errors: 0 },
      original_articles: { generated: 0, publishable: 0, attempts_total: 0, attempts_max: 3 },
    });

    const observation = status.newsroomObservation(quiet);
    expect(observation.stale).toBeUndefined();
    expect(freshness.judge({ cadence: 'H', maxLag: 26 }, observation,
      new Date('2026-08-26T14:10:00Z')).state).toBe('fresh');
  });

  it('keeps a zero distinguishable from a missing count', () => {
    expect(status.newsroomObservation(report).errors).toBe(0);
    expect(status.newsroomObservation({ finished_at: report.finished_at }))
      .toMatchObject({ generated: null, publishable: null, published: null });
  });

  it('never throws on a half-built report', () => {
    // A report whose fields are null must degrade to "cannot tell" rather than
    // take the status page down with it.
    expect(() => status.newsroomObservation({
      finished_at: report.finished_at,
      counts: null, original_articles: null, liveness: null,
    })).not.toThrow();

    expect(status.newsroomObservation({ published: 3 })).toBeNull();
    expect(status.newsroomObservation(null)).toBeNull();
  });

  it('accepts the older field names, so a report written mid-deploy still reads', () => {
    expect(status.newsroomObservation({ finishedAt: '2026-08-26T14:05:12Z' })?.at)
      .toBe('2026-08-26T14:05:12Z');
  });
});

describe('the newsroom probe against a missing report', () => {
  /** Drive the real probe with a stubbed HTTP layer. */
  async function probeNewsroom(responder: () => Promise<unknown>) {
    const original = es.httpJson;
    es.httpJson = responder;
    try {
      const check = { type: 'newsroom-run', url: 'https://example.invalid/runs/latest.json' };
      return await status.probe(check);
    } finally {
      es.httpJson = original;
    }
  }

  it('calls a 404 stale, not an outage', async () => {
    // A 404 means no run has yet written a report. That is a true statement
    // about the wire — it is not advancing — but it is not the site being
    // broken, and reporting it as an outage is the crying-wolf this endpoint
    // exists to stop. It also self-corrects the moment the first report lands,
    // rather than waiting for someone to flip a flag.
    const observation = await probeNewsroom(() =>
      Promise.reject(new Error('HTTP 404 from https://example.invalid/runs/latest.json')));

    expect(observation).toMatchObject({ stale: true });
    expect(observation.staleReason).toMatch(/No run report/);
  });

  it('still treats a real fault as a fault', async () => {
    // A 500, a refused connection or unparseable JSON says something is
    // actually wrong, and must not be softened into "not advancing".
    await expect(probeNewsroom(() =>
      Promise.reject(new Error('HTTP 500 from https://example.invalid/runs/latest.json'))))
      .rejects.toThrow(/500/);
  });

  it('rejects a report with no completion time', async () => {
    await expect(probeNewsroom(() => Promise.resolve({ counts: { published: 3 } })))
      .rejects.toThrow(/no completion time/);
  });
});
