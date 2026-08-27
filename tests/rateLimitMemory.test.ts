/**
 * The rate limiter's own memory, which used to be the thing it could not bound.
 *
 * `pruneOldHits` trimmed the timestamps *inside* an entry and the entry itself
 * was never removed, so every address that ever called kept a permanent slot.
 * Measured directly against that version: 50,000 distinct addresses produced
 * 50,000 retained entries and none were released.
 *
 * That is the wrong shape of bug for a site expecting more visitors, because it
 * grows with exactly the thing we are trying to support. And it is reachable on
 * purpose rather than only by popularity: `getClientIp` reads the first value
 * of `X-Forwarded-For`, and while the platform sets that header, nothing stops
 * a caller sending their own. The forged-address evasion was always possible;
 * the unbounded allocation is what turned it from a nuisance into a way to
 * exhaust the worker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rateLimit = require('../api/shared/rateLimit.js');

const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });

beforeEach(() => rateLimit.reset());

describe('the limiter', () => {
  it('lets an ordinary caller through', () => {
    expect(rateLimit.check(from('198.51.100.1'))).toBeNull();
  });

  it('cuts off a caller past the limit and says when to come back', () => {
    const limit = rateLimit.getStats().limitPerMin;
    let blocked = null;
    for (let i = 0; i < limit + 1; i++) blocked = rateLimit.check(from('198.51.100.2'));

    expect(blocked).not.toBeNull();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('keeps callers apart', () => {
    const limit = rateLimit.getStats().limitPerMin;
    for (let i = 0; i < limit + 1; i++) rateLimit.check(from('198.51.100.3'));

    expect(rateLimit.check(from('198.51.100.4')), 'one abuser must not block everyone')
      .toBeNull();
  });
});

describe('what it remembers', () => {
  it('does not keep a slot for every address that has ever called', () => {
    // The assertion that fails against the previous implementation, where this
    // returned 50000.
    for (let i = 0; i < 50_000; i++) {
      rateLimit.check(from('10.' + ((i >> 16) & 255) + '.' + ((i >> 8) & 255) + '.' + (i & 255)));
    }

    const tracked = rateLimit.getStats().trackedIps;
    expect(tracked).toBeLessThanOrEqual(rateLimit.MAX_TRACKED_IPS);
  });

  it('stays bounded under a flood of forged addresses', () => {
    // What a caller rotating `X-Forwarded-For` per request actually does to us.
    for (let i = 0; i < rateLimit.MAX_TRACKED_IPS * 3; i++) {
      rateLimit.check(from('203.0.113.' + (i % 256) + '.' + i));
    }
    expect(rateLimit.getStats().trackedIps).toBeLessThanOrEqual(rateLimit.MAX_TRACKED_IPS);
  });

  it('stays fast while it stays bounded', () => {
    // How the bulk eviction was found. The first version of the cap sorted the
    // whole map on every request once the ceiling was reached, and 50,000
    // requests took 33 seconds — a guard against heavy traffic that fell over
    // under heavy traffic, which is worse than the leak it replaced. A leak
    // costs memory; that cost latency on every single request.
    const started = Date.now();
    for (let i = 0; i < 50_000; i++) {
      rateLimit.check(from('172.16.' + ((i >> 8) & 255) + '.' + (i & 255) + '.' + i));
    }
    const elapsed = Date.now() - started;

    expect(rateLimit.getStats().trackedIps).toBeLessThanOrEqual(rateLimit.MAX_TRACKED_IPS);
    // Generous against the ~33s the per-call sort took, and still far below it.
    expect(elapsed, `50k checks took ${elapsed}ms`).toBeLessThan(5_000);
  });

  it('still limits a real caller while the map is at its ceiling', () => {
    // Eviction must not become an escape hatch for the address actually
    // hammering us: it is the busiest, so it is never the quietest.
    const limit = rateLimit.getStats().limitPerMin;
    const attacker = from('192.0.2.77');

    for (let i = 0; i < limit; i++) rateLimit.check(attacker);
    for (let i = 0; i < rateLimit.MAX_TRACKED_IPS; i++) {
      rateLimit.check(from('198.18.' + ((i >> 8) & 255) + '.' + (i & 255)));
    }

    expect(rateLimit.check(attacker), 'the busiest caller must not be forgotten first')
      .not.toBeNull();
  });

  it('does not extend a caller\u2019s own window by continuing to hammer it', () => {
    // Recording a hit on a rejection would let a caller hold their window open
    // indefinitely, so a blocked client could never become unblocked.
    const limit = rateLimit.getStats().limitPerMin;
    const ip = from('192.0.2.99');
    for (let i = 0; i < limit; i++) rateLimit.check(ip);

    const first = rateLimit.check(ip);
    for (let i = 0; i < 100; i++) rateLimit.check(ip);
    const later = rateLimit.check(ip);

    expect(Number(later.headers['Retry-After']))
      .toBeLessThanOrEqual(Number(first.headers['Retry-After']));
  });
});
