/**
 * Every response this app emits carries the security headers.
 *
 * WHY THIS IS NOT A SOURCE SCAN
 * -----------------------------
 * The tempting version of this test greps each function's `index.js` for
 * `withSecurity` and asserts it appears. That is a word list pretending to be
 * a rule — the failure mode AGENTS.md records four separate instances of — and
 * it would pass for a function that imports the wrapper and forgets to apply
 * it, or applies it to three response paths out of five.
 *
 * The property is about responses, so this tests responses: it loads all
 * seventeen real handlers and invokes them, and asserts on what comes back out
 * of `context.res`. A handler that stops being wrapped fails here no matter how
 * its source happens to read.
 *
 * WHAT IT COVERS
 * --------------
 * Two paths per function, both reachable with no network at all:
 *
 *   - the RATE LIMIT path, taken before any handler does its own work. Every
 *     function checks it first, so it is the one response every function is
 *     guaranteed to be able to produce.
 *   - the FAILURE path, with `https.get` stubbed to error, which drives each
 *     function into its own catch block. That is the response nobody looks at
 *     and therefore the one most likely to be missed by a per-call-site edit.
 *
 * The success path is covered by `tests/functionSecurityHeaders.live.test.ts`
 * against the deployed site, because reproducing fourteen different upstreams
 * faithfully enough to reach fourteen success branches would be a fixture
 * exercise that proves less than one real request does.
 *
 * MEASURED BASELINE, production, 2026-08-27, before this change:
 *
 *   /article/<slug>  CSP=YES  XFO=YES  nosniff=YES     (function, wrapped by #115)
 *   /  /data  /favicon.svg    all YES                  (static content)
 *   /rss.xml  /sitemap.xml  /api/* ×14   ALL BARE      (functions)
 *
 * Sixteen of seventeen function routes served with no CSP, no X-Frame-Options,
 * no nosniff, no Referrer-Policy and no Permissions-Policy, while
 * `staticwebapp.config.json` carried a block called `globalHeaders` listing all
 * five.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const API = join(ROOT, 'api');

const { SECURITY_HEADERS } = require(join(API, 'shared/securityHeaders.js'));
const rateLimit = require(join(API, 'shared/rateLimit.js'));

/** Every deployed function: a directory under api/ holding an index.js. */
function functionNames(): string[] {
  return readdirSync(API, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
    .filter((entry) => existsSync(join(API, entry.name, 'index.js')))
    .map((entry) => entry.name);
}

const NAMES = functionNames();

interface Res {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function makeContext(): { res?: Res; log: Record<string, unknown> } {
  const log = Object.assign(() => {}, {
    warn: () => {},
    error: () => {},
    info: () => {},
    verbose: () => {},
  });
  return { log } as { res?: Res; log: Record<string, unknown> };
}

let ip = 0;
function request(overrides: Record<string, unknown> = {}) {
  return {
    headers: { 'x-forwarded-for': `172.16.${Math.floor(++ip / 250) % 250}.${ip % 250}` },
    query: {},
    method: 'GET',
    url: '/api/x',
    ...overrides,
  };
}

const https = require('node:https') as { get: unknown; request: unknown };
const http = require('node:http') as { get: unknown; request: unknown };
const realHttpsGet = https.get;
const realHttpsRequest = https.request;
const realHttpGet = http.get;
const realHttpRequest = http.request;
const realFetch = globalThis.fetch;

/**
 * Every outbound call fails immediately, so each handler takes its own catch.
 *
 * `request` is patched as well as `get`, and that omission is the whole reason
 * this file used to be flaky. Two handlers reach CSP PxWeb through
 * `https.request` — `api/economy-data/index.js:149` and
 * `api/historical-data/index.js:15` — so the two tests named after those
 * handlers made real calls to `data.stat.gov.lv` while this function claimed
 * the network was off. PxWeb answers in 1–12s and a test gets 5000ms, so
 * whether CI was green depended on the weather at a statistics office.
 *
 * `tests/noNetwork.ts` now refuses the connection underneath this as well. Both
 * exist on purpose: the guard makes the failure impossible for every file, and
 * this makes this file's own stated claim true rather than accidentally rescued
 * by something two directories away.
 */
function breakTheNetwork() {
  const failing = () => {
    const request = new EventEmitter() as EventEmitter & {
      destroy: () => void;
      end: () => void;
      write: () => void;
    };
    request.destroy = () => {};
    request.end = () => {};
    // A `request` caller writes a body before ending; a `get` caller does not.
    // Without this the POST path throws where it should error.
    request.write = () => {};
    process.nextTick(() => request.emit('error', new Error('network disabled for this test')));
    return request;
  };
  https.get = failing as unknown;
  https.request = failing as unknown;
  http.get = failing as unknown;
  http.request = failing as unknown;
  globalThis.fetch = (() =>
    Promise.reject(new Error('network disabled for this test'))) as typeof fetch;
}

beforeAll(() => breakTheNetwork());

afterAll(() => {
  https.get = realHttpsGet;
  https.request = realHttpsRequest;
  http.get = realHttpGet;
  http.request = realHttpRequest;
  globalThis.fetch = realFetch;
});

function assertSecured(res: Res | undefined, label: string) {
  expect(res, `${label} produced no response at all`).toBeDefined();
  const headers = (res as Res).headers ?? {};
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers[name], `${label} is missing ${name}`).toBe(value);
  }
}

describe('the function inventory', () => {
  it('found every deployed function', () => {
    // If this drops to a handful, the suite below is asserting about almost
    // nothing while still passing. The floor moved 17 → 16 when `track-login`
    // was removed; it is a floor against silent collapse, not a target.
    expect(NAMES.length).toBeGreaterThanOrEqual(16);
    expect(NAMES).toContain('news-rss');
    expect(NAMES).toContain('news-sitemap');
    expect(NAMES).toContain('system-status');
    expect(NAMES).toContain('article-page');
  });

  it('exports a callable handler from each', () => {
    for (const name of NAMES) {
      const handler = require(join(API, name, 'index.js'));
      expect(typeof handler, `${name} does not export a function`).toBe('function');
    }
  });
});

describe('the pre-handler refusal', () => {
  /**
   * The rate limiter answers before a handler does any work of its own, so it
   * is the one response every function is guaranteed to produce with no
   * network at all.
   *
   * `track-login` used to be excluded here, because it was the only endpoint
   * that never called `rateLimit.check` despite `api/shared/rateLimit.js`
   * saying in as many words to use it as the first thing in every public
   * endpoint. It was anonymous, POST-only, and sent an outbound Telegram
   * notification per request, so an unlimited caller got unlimited messages to
   * somebody's phone.
   *
   * #139 closed that gap by giving it a limiter and a global notification
   * budget. This change then removed the endpoint altogether, because the
   * notification could not answer the question it was built to ask: every one
   * it ever sent said "anonymous", and the post-deploy smoke suite was POSTing
   * it on every push, so the beacon was partly ringing itself. A rate-limited
   * doorbell on a public street is safer than an unlimited one; no doorbell is
   * better still.
   *
   * Both changes deleted the exemption list, which is the part that matters
   * here: a list of endpoints allowed to have no limiter is only honest while
   * one of them does. The rule is universal now, with no list left to grow.
   */
  it('covers every function, with no exceptions', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(16);
    expect(NAMES).not.toContain('track-login');
  });

  for (const name of NAMES) {
    it(`${name} is secured when it refuses`, async () => {
      const handler = require(join(API, name, 'index.js'));
      const address = `10.99.${NAMES.indexOf(name)}.1`;

      // Fill this IP's window, so the next call is certain to be refused.
      for (let i = 0; i < 200; i++) rateLimit.check({ headers: { 'x-forwarded-for': address } });

      const context = makeContext();
      await handler(context, request({ headers: { 'x-forwarded-for': address } }));

      expect(context.res?.status, `${name} did not rate limit`).toBe(429);
      assertSecured(context.res, `${name} 429`);
    });
  }
});

describe('the failure response', () => {
  // The path nobody looks at, and the one a per-call-site edit misses.
  for (const name of NAMES) {
    it(`${name} is secured when its upstream is unreachable`, async () => {
      const handler = require(join(API, name, 'index.js'));
      const context = makeContext();

      await handler(context, request({ query: { country: 'LV', indicator: 'gdp', q: 'riga' } }));

      assertSecured(context.res, `${name} with no network`);
    });
  }
});

describe('the headers themselves', () => {
  it('include the one that actually carries weight for a JSON response', () => {
    // No endpoint reflects raw input today — `business-search` and
    // `address-search` strip `<script>alert(1)</script>` to
    // `scriptalert1script`, verified against production. This is defence in
    // depth, and `nosniff` is the part of it that matters: these endpoints
    // relay text this project does not author.
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('reaches a response that sets no Content-Type of its own', async () => {
    /**
     * This is the case that was genuinely served sniffable in production.
     * `track-login` set no `Content-Type` on either of its responses, so the
     * host picked one. Measured against production on 2026-08-27, a POST came
     * back:
     *
     *     HTTP/1.1 200 OK
     *     Content-Type: text/plain; charset=utf-8
     *     {"ok":true}
     *
     * with no `X-Content-Type-Options`. `text/plain` is the type browsers
     * sniff, so that was the one response on this site where the missing header
     * met a content type it actually governs. The body was a fixed two-key
     * object, so it was not exploitable — the honest way to put it, and not a
     * reason to have kept serving it that way.
     *
     * That endpoint is gone. The test is kept and rewritten to assert the
     * *property* rather than the example: any handler that omits a
     * `Content-Type` still comes back with `nosniff`. Pointing it at whichever
     * endpoint happens to omit one today would make it lapse silently the day
     * that endpoint changed, which is the failure this file exists to prevent.
     */
    const { withSecurity } = require(join(API, 'shared/securityHeaders.js'));
    const bare = withSecurity(async (context: { res: Res }) => {
      context.res = { status: 200, body: JSON.stringify({ ok: true }) };
    });

    const context = makeContext();
    await bare(context, request({ method: 'POST' }));

    expect(context.res?.headers?.['X-Content-Type-Options']).toBe('nosniff');
  });

  it('cannot be weakened by a handler that sets its own', () => {
    const { withSecurity } = require(join(API, 'shared/securityHeaders.js'));
    const hostile = withSecurity(async (context: { res: Res }) => {
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      };
    });

    const context = makeContext();
    return hostile(context, request()).then(() => {
      assertSecured(context.res, 'a handler setting its own headers');
      // And the handler's own headers survive alongside them.
      expect(context.res?.headers?.['Cache-Control']).toBe('no-store');
      expect(context.res?.headers?.['Content-Type']).toBe('application/json');
    });
  });

  it('are applied even when the handler throws after responding', async () => {
    const { withSecurity } = require(join(API, 'shared/securityHeaders.js'));
    const thrower = withSecurity(async (context: { res: Res }) => {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' } };
      throw new Error('boom');
    });

    const context = makeContext();
    // The throw is deliberately not swallowed: an unhandled fault should stay
    // a 500 from the platform rather than becoming a silent 200.
    await expect(thrower(context, request())).rejects.toThrow('boom');
    assertSecured(context.res, 'a handler that threw after responding');
  });

  it('do not invent a response where the handler produced none', () => {
    const { withSecurity } = require(join(API, 'shared/securityHeaders.js'));
    const silent = withSecurity(async () => {});
    const context = makeContext();
    return silent(context, request()).then(() => {
      expect(context.res).toBeUndefined();
    });
  });
});
