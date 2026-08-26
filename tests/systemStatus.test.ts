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
  it('reads the completion time and what the run produced', () => {
    const observation = status.newsroomObservation({
      completedAt: '2026-08-26T14:03:00Z', published: 3, rejected: 1, trigger: 'timer',
    });
    expect(observation).toEqual({
      at: '2026-08-26T14:03:00Z', published: 3, rejected: 1, trigger: 'timer',
    });
  });

  it('keeps a zero-article run distinguishable from a missing count', () => {
    // A run that published nothing is not necessarily broken — some days have
    // no news — but it must not be reported as "no data about publishing".
    // Thirty consecutive zero-article runs is the failure being watched for.
    expect(status.newsroomObservation({ completedAt: '2026-08-26T14:03:00Z', published: 0, rejected: 9 }))
      .toMatchObject({ published: 0, rejected: 9 });
    expect(status.newsroomObservation({ completedAt: '2026-08-26T14:03:00Z' }))
      .toMatchObject({ published: null, rejected: null });
  });

  it('returns null for a report with no completion time, which is itself the finding', () => {
    expect(status.newsroomObservation({ published: 3 })).toBeNull();
    expect(status.newsroomObservation(null)).toBeNull();
  });

  it('accepts the alternative names a run report might use', () => {
    expect(status.newsroomObservation({ finishedAt: '2026-08-26T14:03:00Z' })?.at)
      .toBe('2026-08-26T14:03:00Z');
    expect(status.newsroomObservation({ timestamp: '2026-08-26T14:03:00Z' })?.at)
      .toBe('2026-08-26T14:03:00Z');
  });
});
