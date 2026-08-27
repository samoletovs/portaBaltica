/**
 * The one endpoint that could notify somebody's phone without limit.
 *
 * WHAT WAS WRONG
 * --------------
 * `api/track-login` was the only one of seventeen endpoints that never called
 * `rateLimit.check`, though `api/shared/rateLimit.js` says in as many words to
 * use it as the first thing in every public endpoint. It is anonymous,
 * POST-only, reachable from anywhere, and every request sent an outbound
 * Telegram message. Verified against production: `TELEGRAM_NOTIFY_URL` is
 * configured, and `POST /api/track-login` with an empty body answered
 * `200 {"ok":true}` with no credential of any kind.
 *
 * So an anonymous caller in a loop produced an unbounded stream of
 * notifications to a person's phone, and spent the Free tier's invocation
 * quota doing it.
 *
 * WHY THE LIMITER ALONE WOULD NOT HAVE FIXED IT
 * ---------------------------------------------
 * A per-IP limit bounds one caller to sixty a minute. A hundred callers still
 * make six thousand, and the limiter's state is per-instance, so scale-out
 * multiplies it again. What needs protecting is not this function's CPU — it
 * is a person's attention and Telegram's own rate limit, and neither is
 * per-IP. Hence the global budget, which is what most of this file tests.
 *
 * These tests drive `planNotification` rather than the response body, because
 * the body is a fixed two-key object that is identical whatever happens. What
 * varies — and what the endpoint is actually for — is what goes out and how
 * often.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const API = join(ROOT, 'api');
const HANDLER = join(API, 'track-login/index.js');

const rateLimit = require(join(API, 'shared/rateLimit.js'));

/** A notifier must be configured, or the module short-circuits everything. */
process.env.TELEGRAM_NOTIFY_URL = 'https://notify.example.com/api/notify?code=test';

interface Plan {
  send: boolean;
  reason?: string;
  message?: string;
  suppressed?: number;
}

interface TrackLogin {
  (context: unknown, req: unknown): Promise<void>;
  planNotification: (now: number, userInfo: string) => Plan;
  resetNotifyState: () => void;
  NOTIFY_INTERVAL_MS: number;
}

function load(): TrackLogin {
  delete require.cache[HANDLER];
  return require(HANDLER) as TrackLogin;
}

const trackLogin = load();
const INTERVAL = trackLogin.NOTIFY_INTERVAL_MS;

/** Every outbound request fails instantly, so nothing leaves this machine. */
const https = require('node:https') as { request: unknown };
const realRequest = https.request;
https.request = (() => {
  const request = new EventEmitter() as EventEmitter & {
    write: () => void;
    end: () => void;
    destroy: () => void;
  };
  request.write = () => {};
  request.end = () => {};
  request.destroy = () => {};
  process.nextTick(() => request.emit('error', new Error('outbound disabled in tests')));
  return request;
}) as unknown;

afterAll(() => {
  https.request = realRequest;
});

beforeEach(() => {
  trackLogin.resetNotifyState();
});

let ip = 0;
interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function post(headers: Record<string, string> = {}): Promise<Res> {
  const log = Object.assign(() => {}, {
    warn: () => {},
    error: () => {},
    info: () => {},
  });
  const context: { res?: Res; log: typeof log } = { log };
  await trackLogin(context, {
    method: 'POST',
    url: '/api/track-login',
    headers: { 'x-forwarded-for': `198.51.100.${++ip % 250}`, ...headers },
  });
  return context.res as Res;
}

describe('the limiter it never had', () => {
  it('refuses a caller who exceeds the per-IP limit', async () => {
    const address = '192.0.2.77';
    for (let i = 0; i < 200; i++) rateLimit.check({ headers: { 'x-forwarded-for': address } });

    const refused = await post({ 'x-forwarded-for': address });
    expect(refused.status).toBe(429);
  });

  it('is not the reason a fresh caller succeeds', async () => {
    // Guard against the limiter test passing because everything answers 429.
    const allowed = await post();
    expect(allowed.status).toBe(200);
    expect(JSON.parse(allowed.body)).toEqual({ ok: true });
  });
});

describe('the global notification budget', () => {
  // The part a per-IP limit cannot do.

  it('sends the first visit', () => {
    const plan = trackLogin.planNotification(1_000_000, 'anonymous');
    expect(plan.send).toBe(true);
    expect(plan.message).toContain('portaBaltica visit');
  });

  it('sends one message however many visitors arrive at once', () => {
    const now = 1_000_000;
    const sent = [];
    // A hundred DIFFERENT visitors inside the interval. A per-IP limiter
    // would let every one of these through.
    for (let i = 0; i < 100; i++) {
      const plan = trackLogin.planNotification(now + i * 10, 'anonymous');
      if (plan.send) sent.push(plan);
    }
    expect(sent.length).toBe(1);
  });

  it('sends again once the interval has passed', () => {
    trackLogin.planNotification(1_000_000, 'anonymous');
    const tooSoon = trackLogin.planNotification(1_000_000 + INTERVAL - 1, 'anonymous');
    const later = trackLogin.planNotification(1_000_000 + INTERVAL + 1, 'anonymous');

    expect(tooSoon.send).toBe(false);
    expect(later.send).toBe(true);
  });

  it('counts what it suppressed rather than discarding it', () => {
    // The count is the only real information this beacon carries, so losing it
    // would make the endpoint pointless rather than merely quiet.
    const start = 1_000_000;
    trackLogin.planNotification(start, 'anonymous');
    for (let i = 1; i <= 12; i++) trackLogin.planNotification(start + i * 1000, 'anonymous');

    const next = trackLogin.planNotification(start + INTERVAL + 1, 'anonymous');
    expect(next.send).toBe(true);
    expect(next.message).toContain('And 12 more in the last');
  });

  it('does not mention suppressed visits when there were none', () => {
    trackLogin.planNotification(1_000_000, 'anonymous');
    const next = trackLogin.planNotification(1_000_000 + INTERVAL + 1, 'anonymous');
    expect(next.send).toBe(true);
    expect(next.message).not.toContain('And ');
  });

  it('resets the count after reporting it', () => {
    const start = 1_000_000;
    trackLogin.planNotification(start, 'anonymous');
    trackLogin.planNotification(start + 1000, 'anonymous');
    trackLogin.planNotification(start + INTERVAL + 1, 'anonymous');

    const third = trackLogin.planNotification(start + 2 * INTERVAL + 2, 'anonymous');
    expect(third.message).not.toContain('And ');
  });

  it('bounds a sustained flood to the interval, not to the request count', () => {
    // Ten thousand requests over an hour. Without the budget this is ten
    // thousand messages; with it, it is what the interval allows.
    let now = 1_000_000;
    let sent = 0;
    const hour = 60 * 60 * 1000;
    const step = hour / 10_000;
    for (let i = 0; i < 10_000; i++) {
      if (trackLogin.planNotification(now, 'anonymous').send) sent += 1;
      now += step;
    }
    expect(sent).toBeLessThanOrEqual(Math.ceil(hour / INTERVAL) + 1);
    // And it must not be zero, or the endpoint has simply been switched off.
    expect(sent).toBeGreaterThan(0);
  });
});

describe('the response', () => {
  it('declares itself as JSON', async () => {
    // It used to set no Content-Type at all, so the host chose
    // `text/plain; charset=utf-8` for a JSON body — measured in production.
    // That was the one response on this site where a missing `nosniff` met a
    // content type browsers actually sniff.
    const res = await post();
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('carries the security headers every function response carries', async () => {
    const res = await post();
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('does not tell the caller whether a notification went out', async () => {
    // The body is deliberately identical whether we notified, coalesced, or
    // have no notifier configured. A caller learning which would be a way to
    // probe the budget's state.
    const first = await post();
    const second = await post();
    expect(first.body).toBe(second.body);
    expect(first.status).toBe(second.status);
  });
});

describe('the identity it reports', () => {
  it('is anonymous, because nobody can log in', () => {
    // staticwebapp.config.json answers 404 for /.auth/login/github, /aad and
    // /twitter, and /.auth/me returns {"clientPrincipal": null} — verified
    // against production. So the header below is never sent by the platform
    // and this endpoint has never once reported a user.
    const plan = trackLogin.planNotification(1_000_000, 'anonymous');
    expect(plan.message).toContain('User: anonymous');
  });

  it('would report a real user if a provider were ever enabled', async () => {
    // The parsing is dead today but becomes correct the day auth is turned on,
    // so it is kept and exercised rather than deleted.
    trackLogin.resetNotifyState();
    const principal = Buffer.from(
      JSON.stringify({ userDetails: 'someone@example.com' }),
      'utf-8'
    ).toString('base64');

    const res = await post({ 'x-ms-client-principal': principal });
    expect(res.status).toBe(200);

    // Drive the planner directly to see what it would have said.
    trackLogin.resetNotifyState();
    const plan = trackLogin.planNotification(1_000_000, 'someone@example.com');
    expect(plan.message).toContain('User: someone@example.com');
  });
});

describe('every public endpoint has a limiter', () => {
  it('including this one, which was the only exception', async () => {
    // The registry check that used to record track-login as a known gap. It is
    // now an assertion that there are none.
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const missing = readdirSync(API, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
      .filter((entry) => existsSync(join(API, entry.name, 'index.js')))
      .filter((entry) => !readFileSync(join(API, entry.name, 'index.js'), 'utf-8').includes('rateLimit.check'))
      .map((entry) => entry.name);

    expect(missing, `endpoints with no rate limit: ${missing.join(', ')}`).toEqual([]);
  });
});
