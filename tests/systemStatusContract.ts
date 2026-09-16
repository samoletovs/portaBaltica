import { expect } from 'vitest';

export interface StatusCheck {
  name: string;
  status: string;
  required: boolean;
  freshness?: string;
}

export interface StatusReport {
  status: string;
  dataSources: {
    total: number;
    healthy: number;
    stale: number;
    requiredTotal: number;
    requiredHealthy: number;
    optionalTotal: number;
    optionalHealthy: number;
    checks: StatusCheck[];
  };
}

export function assertSystemStatus(d: StatusReport) {
  expect(d).toHaveProperty('status');
  expect(Array.isArray(d.dataSources?.checks)).toBe(true);
  expect(d.dataSources.checks.length).toBeGreaterThan(0);
  const checks = d.dataSources.checks;

  for (const c of checks) {
    expect(typeof c.name).toBe('string');
    expect(c.name.length).toBeGreaterThan(0);
    expect(typeof c.required).toBe('boolean');
    expect(['healthy', 'stale', 'unhealthy', 'pending']).toContain(c.status);
    expect(['fresh', 'stale', 'unknown']).toContain(c.freshness);
    expect(c.status === 'stale').toBe(c.freshness === 'stale');
    if (c.status === 'unhealthy' || c.status === 'pending') expect(c.freshness).toBe('unknown');
    if (c.required) expect(c.status).not.toBe('pending');
  }

  const required = checks.filter(c => c.required);
  const optional = checks.filter(c => !c.required);
  expect(required.length, 'a healthy verdict needs required sources to evaluate').toBeGreaterThan(0);
  expect(d.dataSources.total).toBe(checks.length);
  expect(d.dataSources.healthy).toBe(checks.filter(c => c.status === 'healthy').length);
  expect(d.dataSources.stale).toBe(checks.filter(c => c.status === 'stale').length);
  expect(d.dataSources.requiredTotal).toBe(required.length);
  expect(d.dataSources.requiredHealthy).toBe(required.filter(c => c.status === 'healthy').length);
  expect(d.dataSources.optionalTotal).toBe(optional.length);
  expect(d.dataSources.optionalHealthy).toBe(optional.filter(c => c.status === 'healthy').length);

  // Accept all legitimate outcomes, but not an arbitrary badge beside correct
  // counts. Optional checks cannot alter the required-only verdict.
  const down = required.filter(c => c.status === 'unhealthy').length;
  const stale = required.some(c => c.status === 'stale');
  const expected = down === 0 ? (stale ? 'stale' : 'healthy')
    : down > required.length / 2 ? 'unhealthy' : 'degraded';
  expect(d.status).toBe(expected);
}
