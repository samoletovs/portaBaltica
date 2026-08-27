/**
 * Every route on the deployed site carries the security headers.
 *
 * WHY A LIVE TEST AS WELL
 * -----------------------
 * `tests/functionSecurityHeaders.test.ts` invokes the handlers directly and
 * proves the wrapper is applied. It cannot prove the platform delivers what the
 * handler set, and the whole finding here is that the platform does not deliver
 * what `staticwebapp.config.json` sets — `globalHeaders` reaches static content
 * and nothing else. A claim about headers on the wire has to be measured on the
 * wire.
 *
 * It also covers the success paths, which the unit suite deliberately does not:
 * reproducing fourteen different upstreams faithfully enough to reach fourteen
 * success branches would be a fixture exercise proving less than one real
 * request does.
 *
 * BASELINE, measured 2026-08-27 before this change:
 *
 *   route                     code  CSP  XFO  nosniff  Referrer  Permissions
 *   /                          200   Y    Y      Y        Y          Y
 *   /data                      200   Y    Y      Y        Y          Y
 *   /favicon.svg               200   Y    Y      Y        Y          Y
 *   /article/<slug>            200   Y    Y      Y        Y          Y   (#115)
 *   /rss.xml                   200   -    -      -        -          -
 *   /sitemap.xml               200   -    -      -        -          -
 *   /api/system-status         200   -    -      -        -          -
 *   /api/power-prices          200   -    -      -        -          -
 *   /api/port-data             200   -    -      -        -          -
 *   /api/environment-data      200   -    -      -        -          -
 *   /api/economy-data          200   -    -      -        -          -
 *   /api/property-data         200   -    -      -        -          -
 *   /api/live-grid             200   -    -      -        -          -
 *   /api/ai-insights           200   -    -      -        -          -
 *   /api/eu-funds              200   -    -      -        -          -
 *   /api/business-search       200   -    -      -        -          -
 *   /api/address-search        200   -    -      -        -          -
 *   /api/baltic-compare        400   -    -      -        -          -
 *   /api/historical-data       400   -    -      -        -          -
 *
 * Sixteen of seventeen function routes bare, including both error responses.
 *
 * Run after a release: `npm run test:live`.
 */

import { describe, it, expect } from 'vitest';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** Read from api/shared/securityHeaders.js so the two cannot describe different sets. */
const REQUIRED: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** Every route the site answers on, function-backed unless noted. */
const FUNCTION_ROUTES = [
  '/rss.xml',
  '/sitemap.xml',
  '/api/system-status',
  '/api/power-prices',
  '/api/port-data?country=LV',
  '/api/environment-data',
  '/api/economy-data',
  '/api/property-data',
  '/api/live-grid',
  '/api/ai-insights',
  '/api/eu-funds',
  '/api/business-search?q=test',
  '/api/address-search?q=riga',
];

/** Function routes whose responses are errors. The path nobody looks at. */
const ERROR_ROUTES = [
  '/api/baltic-compare?indicator=definitely-not-an-indicator',
  '/api/historical-data?indicator=definitely-not-an-indicator',
];

const STATIC_ROUTES = ['/', '/data', '/favicon.svg'];

async function head(path: string): Promise<{ status: number; headers: Headers }> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  // Drain, so the connection is released rather than left hanging.
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status, headers: response.headers };
}

function assertSecured(headers: Headers, label: string) {
  for (const [name, value] of Object.entries(REQUIRED)) {
    expect(headers.get(name), `${label} is missing ${name}`).toBe(value);
  }
  const csp = headers.get('content-security-policy');
  expect(csp, `${label} has no Content-Security-Policy`).toBeTruthy();
  expect(csp, `${label} CSP is not ours`).toContain("default-src 'self'");
  expect(csp, `${label} CSP does not forbid framing`).toContain("frame-ancestors 'none'");
}

describe('function-backed routes', () => {
  for (const route of FUNCTION_ROUTES) {
    it(`${route} is secured`, async () => {
      const { status, headers } = await head(route);
      expect(status, `${route} did not answer`).toBeLessThan(500);
      assertSecured(headers, route);
    });
  }
});

describe('function error responses', () => {
  // These were bare too, and an error body is the one most likely to carry
  // something a browser should not be guessing the type of.
  for (const route of ERROR_ROUTES) {
    it(`${route.split('?')[0]} is secured when it refuses`, async () => {
      const { status, headers } = await head(route);
      expect(status).toBe(400);
      assertSecured(headers, route);
    });
  }
});

describe('static routes are unchanged', () => {
  // The platform still applies globalHeaders here. If these ever go bare, the
  // change broke the thing it was modelled on.
  for (const route of STATIC_ROUTES) {
    it(`${route} still carries what globalHeaders promises`, async () => {
      const { status, headers } = await head(route);
      expect(status).toBe(200);
      assertSecured(headers, route);
    });
  }
});

describe('the endpoint that was genuinely sniffable', () => {
  it('is gone from the deployed site', async () => {
    // Measured 2026-08-27: POST /api/track-login returned
    //   Content-Type: text/plain; charset=utf-8
    //   {"ok":true}
    // with no X-Content-Type-Options. text/plain is the type browsers sniff.
    // The body was a fixed two-key object so it was not exploitable, but this
    // was the one response on the site where the missing header met a content
    // type it actually governs.
    //
    // The endpoint has since been removed, because its real job was to send a
    // Telegram notification on every page load — and this very test was one of
    // the things ringing it, on every deploy, from a GitHub runner. A live
    // smoke test that triggers a notification is a test with a side effect on
    // the people watching the channel.
    //
    // Asserting it stays gone is the useful thing now: a 404 here is the
    // success condition, and a 200 would mean the endpoint came back.
    const response = await fetch(`${BASE}/api/track-login`, { method: 'POST' });
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status, 'track-login answered; it was removed deliberately').toBe(404);
  });
});

describe('the whole surface', () => {
  it('leaves no route serving bare', async () => {
    // The summary the baseline table above is a snapshot of. One assertion
    // that fails loudly with the full list, rather than a green run with one
    // quiet gap.
    const bare: string[] = [];
    for (const route of [...FUNCTION_ROUTES, ...ERROR_ROUTES, ...STATIC_ROUTES]) {
      const { headers } = await head(route);
      if (!headers.get('x-content-type-options')) bare.push(route);
    }
    expect(bare, `these routes serve without nosniff: ${bare.join(', ')}`).toEqual([]);
  });
});
