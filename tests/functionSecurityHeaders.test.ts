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

const https = require('node:https') as { get: unknown };
const http = require('node:http') as { get: unknown };
const realHttpsGet = https.get;
const realHttpGet = http.get;
const realFetch = globalThis.fetch;

/** Every outbound call fails immediately, so each handler takes its own catch. */
function breakTheNetwork() {
  const failing = () => {
    const request = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
    request.destroy = () => {};
    request.end = () => {};
    process.nextTick(() => request.emit('error', new Error('network disabled for this test')));
    return request;
  };
  https.get = failing as unknown;
  http.get = failing as unknown;
  globalThis.fetch = (() =>
    Promise.reject(new Error('network disabled for this test'))) as typeof fetch;
}

beforeAll(() => breakTheNetwork());

afterAll(() => {
  https.get = realHttpsGet;
  http.get = realHttpGet;
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
    // nothing while still passing.
    expect(NAMES.length).toBeGreaterThanOrEqual(17);
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
   * is the one response nearly every function is guaranteed to produce with no
   * network at all.
   *
   * `track-login` is the exception, and that is a finding rather than a
   * tolerance: it never calls `rateLimit.check`, though `api/shared/rateLimit.js`
   * says in as many words to "use this as the first thing in every public
   * endpoint". It is anonymous, it is POST-only, and it sends an outbound
   * Telegram notification on every request — so an unlimited caller gets
   * unlimited notifications and burns the Free tier's invocation quota doing
   * it. Fixing that is a behaviour change and belongs with whoever owns that
   * endpoint; recording it here stops it being forgotten, and the count below
   * fails if any *other* function quietly loses its limiter.
   */
  const RATE_LIMITED = NAMES.filter((name) => name !== 'track-login');

  it('is exactly one function short of universal', () => {
    expect(NAMES).toContain('track-login');
    expect(RATE_LIMITED.length).toBe(NAMES.length - 1);
  });

  for (const name of RATE_LIMITED) {
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

  it('reach the one response that production genuinely served sniffable', async () => {
    /**
     * `track-login` sets no `Content-Type` on either of its responses — the
     * only `'Content-Type'` in that file is on the outbound Telegram request —
     * so the host picks one. Measured against production on 2026-08-27, a POST
     * came back:
     *
     *     HTTP/1.1 200 OK
     *     Content-Type: text/plain; charset=utf-8
     *     {"ok":true}
     *
     * with no `X-Content-Type-Options`. `text/plain` is the type browsers
     * sniff, so that is the one response on this site where the missing header
     * met a content type it actually governs. The body is a fixed two-key
     * object, so this was not exploitable — which is the honest way to put it,
     * and not a reason to keep serving it that way.
     */
    const handler = require(join(API, 'track-login', 'index.js'));
    const context = makeContext();
    await handler(context, request({ method: 'POST' }));

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
