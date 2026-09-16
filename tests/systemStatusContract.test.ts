import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { assertSystemStatus, type StatusCheck, type StatusReport } from './systemStatusContract';

const require = createRequire(import.meta.url);
const status: {
  (context: { res?: { status: number; body: string } }, req: { query: object; headers: object }): Promise<void>;
  overallStatus: (checks: StatusCheck[]) => string;
} = require('../api/system-status/index.js');
const registry: { CHECKS: { type: string; required: boolean }[] } = require('../api/shared/statusChecks.js');
const es: { httpJson: (url: string, options?: unknown) => Promise<unknown> } = require('../api/shared/eurostat.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const limiter: { reset: () => void } = require('../api/shared/rateLimit.js');
const originalChecks = registry.CHECKS;

afterEach(() => {
  registry.CHECKS = originalChecks;
  vi.restoreAllMocks();
  vi.useRealTimers();
  cache.clear();
  limiter.reset();
});

function report(states: string[], optional: string[] = []): StatusReport {
  const checks = [...states, ...optional].map((state, index) => ({
    name: `Source ${index}`,
    status: state,
    required: index < states.length,
    freshness: state === 'stale' ? 'stale' : state === 'healthy' ? 'fresh' : 'unknown',
  }));
  return {
    status: status.overallStatus(checks),
    dataSources: {
      total: checks.length,
      healthy: checks.filter(c => c.status === 'healthy').length,
      stale: checks.filter(c => c.status === 'stale').length,
      requiredTotal: states.length,
      requiredHealthy: states.filter(s => s === 'healthy').length,
      optionalTotal: optional.length,
      optionalHealthy: optional.filter(s => s === 'healthy').length,
      checks,
    },
  };
}

describe('the live status contract accepts the producer, not only a healthy day', () => {
  it.each([
    { states: ['healthy', 'healthy'], expected: 'healthy' },
    { states: ['healthy', 'stale'], expected: 'stale' },
    { states: ['stale', 'stale'], expected: 'stale' },
    { states: ['healthy', 'unhealthy'], expected: 'degraded' },
    { states: ['stale', 'unhealthy'], expected: 'degraded' },
    { states: ['unhealthy', 'unhealthy'], expected: 'unhealthy' },
  ])('accepts $expected from $states', ({ states, expected }) => {
    const body = report(states);
    expect(body.status).toBe(expected);
    expect(() => assertSystemStatus(body)).not.toThrow();
  });

  it.each(['stale', 'unhealthy', 'pending'])('accepts an optional %s without changing required health', state => {
    const body = report(['healthy'], [state]);
    expect(body.status).toBe('healthy');
    expect(() => assertSystemStatus(body)).not.toThrow();
  });

  it('rejects a wrong tally', () => {
    const body = report(['healthy']);
    body.dataSources.healthy = 0;
    expect(() => assertSystemStatus(body)).toThrow();
  });

  it.each(['healthy', 'degraded', 'unhealthy', 'unknown'])('does not accept a stale payload labelled %s', label => {
    const body = report(['healthy', 'stale']);
    body.status = label;
    expect(() => assertSystemStatus(body)).toThrow();
  });

  it.each(['healthy', 'stale', 'degraded'])('does not disguise a majority outage as %s', label => {
    const body = report(['unhealthy', 'unhealthy', 'healthy']);
    body.status = label;
    expect(() => assertSystemStatus(body)).toThrow();
  });

  it.each(['requiredTotal', 'requiredHealthy', 'optionalTotal', 'optionalHealthy', 'stale'] as const)(
    'still rejects an inconsistent %s count',
    field => {
      const body = report(['healthy', 'stale'], ['pending']);
      body.dataSources[field]++;
      expect(() => assertSystemStatus(body)).toThrow();
    },
  );

  it.each([
    { states: [], optional: ['healthy'] },
    { states: ['pending'], optional: [] },
    { states: ['unrecognized'], optional: [] },
  ])('rejects missing or undecidable required health: $states', ({ states, optional }) => {
    expect(() => assertSystemStatus(report(states, optional))).toThrow();
  });

  it('rejects stale checks disguised as fresh', () => {
    const body = report(['stale']);
    body.dataSources.checks[0].freshness = 'fresh';
    expect(() => assertSystemStatus(body)).toThrow();
  });

  it.each([
    { ageHours: 1, attempt: 'unchanged', expected: 'healthy' },
    { ageHours: 27, attempt: 'reused', expected: 'stale' },
    { ageHours: 1, attempt: 'failed', expected: 'unhealthy' },
  ])('accepts the actual archive-to-status handler result: $expected', async ({ ageHours, attempt, expected }) => {
    const now = new Date('2026-09-14T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    cache.clear();
    limiter.reset();
    const check = originalChecks.find(c => c.type === 'evidence-archive');
    expect(check).toBeDefined();
    if (!check) throw new Error('Evidence archive check missing');
    registry.CHECKS = [check];
    vi.spyOn(es, 'httpJson').mockImplementation(async (url: string) => {
      if (!url.includes('/evidence/v1/')) throw new Error('No traffic fixture');
      return {
        version: 1,
        series_id: 'baltic-unemployment-v1',
        latest_snapshot_id: 'a'.repeat(32),
        stale_after_hours: 26,
        last_success_at: new Date(now.getTime() - ageHours * 3600000).toISOString(),
        last_attempt: { status: attempt, attempted_at: '2026-09-14T11:59:00Z', finished_at: now.toISOString() },
      };
    });
    const context: { res?: { status: number; body: string } } = {};
    await status(context, { query: {}, headers: {} });
    expect(context.res?.status).toBe(200);
    if (!context.res) throw new Error('Status handler did not respond');
    const body: StatusReport = JSON.parse(context.res.body);
    expect(body.status).toBe(expected);
    expect(body.dataSources.checks[0].status).toBe(expected);
    expect(() => assertSystemStatus(body)).not.toThrow();
    vi.clearAllTimers();
  });
});
