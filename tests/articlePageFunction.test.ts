/**
 * The function that actually answers /article/*.
 *
 * WHY THIS EXISTS SEPARATELY FROM articleMeta.test.ts
 * ---------------------------------------------------
 * That suite tests pure string helpers, and it re-implements the servable gate
 * in its own `render()` helper to do so. Which means it would keep passing if
 * the handler forgot to apply that gate — the rule would be tested in the test
 * rather than in the code. The riskiest decisions in this feature all live in
 * the handler and nowhere else:
 *
 *   - the status code, and specifically that a retracted article and a slug
 *     that never existed are indistinguishable;
 *   - that an upstream failure does NOT become a 404, because a transient blob
 *     error must never tell a crawler a live article is gone;
 *   - the security headers, which a managed function does not inherit from
 *     staticwebapp.config.json and which would otherwise silently vanish from
 *     the one route that renders model-written prose;
 *   - that the body still boots the app in every one of those cases.
 *
 * So this drives the real module, with the network stubbed at `https.get` —
 * the same module object `api/shared/newsroom.js` and the handler both require.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const HANDLER_PATH = resolve(ROOT, 'api/article-page/index.js');

const https = require('node:https') as { get: unknown };
const realGet = https.get;

/** A believable build output: the real shell plus a hashed asset tag. */
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf-8').replace(
  '<script type="module" src="/src/main.tsx"></script>',
  '<script type="module" crossorigin src="/assets/index-CUmohATZ.js"></script>'
);

const ARTICLE = {
  id: '01M115W57T56VK9HZ69EY80WAV',
  slug: 'latvia-s-ports-set-record-6d06ee',
  tier: 'A',
  status: 'published',
  section: 'maritime',
  headline: "Latvia's ports set record with 1,175 thousand tonnes in Q4 2025",
  dek: 'A shift in logistics through Latvian ports.',
  persona: { id: 'kolka', name: 'Gintaras Vaitkus', beat: 'Maritime & Trade', byline: 'x' },
  provenance: {
    sources: [],
    validator: { passed: true, checked_at: '2026-08-27T08:30:00Z', checks: [] },
  },
  created_at: '2026-08-27T08:30:00Z',
  published_at: '2026-08-27T08:37:03Z',
};

const RETRACTED = {
  ...ARTICLE,
  slug: 'lithuania-s-bankruptcy-declarations-364200',
  status: 'retracted',
  headline: "Lithuania's business bankruptcy declarations spike to 130.9 index points in Q2 2026",
};

type Route = { status: number; body: string } | 'error';

/** url → what the network should do. */
let routes: Record<string, Route> = {};

function stubNetwork() {
  https.get = ((url: string, _options: unknown, callback: (res: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void };
    request.destroy = () => {};

    const route = routes[url];
    process.nextTick(() => {
      if (!route || route === 'error') {
        request.emit('error', new Error('stubbed network failure for ' + url));
        return;
      }
      const response = Readable.from([route.body]) as Readable & { statusCode: number };
      response.statusCode = route.status;
      callback(response);
    });
    return request;
  }) as unknown;
}

/** A fresh handler, so the in-process shell and article caches start empty. */
function loadHandler() {
  delete require.cache[HANDLER_PATH];
  return require(HANDLER_PATH) as (context: unknown, req: unknown) => Promise<void>;
}

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

let ip = 0;

async function call(slug: string): Promise<Res> {
  const handler = loadHandler();
  const context: { res?: Res; log: Record<string, unknown> } = {
    log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
  };
  await handler(context, {
    // A distinct IP per call, so the shared per-IP rate limiter in
    // api/shared/rateLimit.js does not start answering 429 mid-suite.
    headers: {
      'x-ms-original-url': `https://portabaltica.naurolabs.com/article/${slug}`,
      'x-forwarded-for': `10.0.0.${++ip % 250}`,
    },
    url: '/api/article-page',
  });
  return context.res as Res;
}

const SHELL_URL = 'https://portabaltica.naurolabs.com/index.html';
const blob = (slug: string) =>
  `https://stportabalticabpmff5so.blob.core.windows.net/articles/${slug}.json`;

/** What a crawler ends up with: the attribute value after entity decoding. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The inverse, for asserting on raw bytes. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

beforeEach(() => {
  stubNetwork();
  routes = {
    [SHELL_URL]: { status: 200, body: SHELL },
    [blob(ARTICLE.slug)]: { status: 200, body: JSON.stringify(ARTICLE) },
    [blob(RETRACTED.slug)]: { status: 200, body: JSON.stringify(RETRACTED) },
    [blob('gone-forever-abc123')]: { status: 404, body: '' },
  };
});

afterAll(() => {
  https.get = realGet;
});

describe('a published article', () => {
  it('is 200, with its own headline in the bytes', async () => {
    const res = await call(ARTICLE.slug);
    expect(res.status).toBe(200);
    expect(res.body).toContain('og:title');
    expect(res.body).toContain(
      'content="Latvia&#39;s ports set record with 1,175 thousand tonnes in Q4 2025"'
    );
    expect(res.body).toContain('<meta name="robots" content="index, follow" />');
    expect(res.body).toContain('application/ld+json');
  });

  it('still boots the app, with the asset tags of the live build', async () => {
    const res = await call(ARTICLE.slug);
    expect(res.body).toContain('<div id="root"></div>');
    expect(res.body).toContain('/assets/index-CUmohATZ.js');
  });

  it('is served as HTML, cached no longer than the static shell it replaces', async () => {
    const res = await call(ARTICLE.slug);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    // The shell names content-hashed assets, so HTML cached across a deploy
    // boots to a blank page. This must not be laxer than the static route.
    expect(res.headers['Cache-Control']).toBe('public, must-revalidate, max-age=30');
  });

  it('carries the security headers a managed function does not inherit', async () => {
    const res = await call(ARTICLE.slug);
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(res.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});

describe('a retracted article', () => {
  it('is 200 and stays up, because the corrections policy says it does', async () => {
    // publish.py keeps the blob at its reader-facing address, and #113 made
    // the page render the withdrawal notice. A 404 here would contradict both.
    const res = await call(RETRACTED.slug);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root"></div>');
  });

  it('is marked in the title and kept out of search', async () => {
    const res = await call(RETRACTED.slug);
    const ogTitle = /<meta property="og:title" content="([^"]*)"/.exec(res.body);
    expect(ogTitle).not.toBeNull();
    expect(decodeEntities((ogTitle as RegExpExecArray)[1])).toBe(
      `Retracted: ${RETRACTED.headline}`
    );
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
    // Never presented as journalism we stand behind.
    expect(res.body).not.toContain('application/ld+json');
    expect(res.body).toContain('<meta property="og:type" content="website" />');
  });

  it('never carries the headline unmarked', async () => {
    const res = await call(RETRACTED.slug);
    expect(res.body).not.toContain(`content="${escapeAttr(RETRACTED.headline)}"`);
  });
});

describe('an article we will not serve', () => {
  it('answers 404 for a slug that never existed', async () => {
    const res = await call('gone-forever-abc123');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('answers 404 without a network call for a slug the client rejects', async () => {
    // Eight live slugs carry diacritics and fail src/news-api.ts's pattern, so
    // the client renders "Article not found" for them. Answering 200 with rich
    // metadata would advertise a page no reader can read.
    routes = { [SHELL_URL]: { status: 200, body: SHELL } };
    const res = await call('reason-for-cia-chief-s-trip-via-rīga-8a530118');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('is byte-identical for a failed verdict and a slug that never existed', async () => {
    // The comparison holds the slug fixed and varies only what storage says,
    // because that is the question a leak would answer. A retracted article is
    // deliberately NOT hidden this way — see the status note in the handler:
    // unpublished work is unreachable at this address by construction, and a
    // retraction is something we announce ourselves in the corrections log.
    const slug = 'some-article-that-failed-abc123';
    const failed = {
      ...ARTICLE,
      slug,
      provenance: { sources: [], validator: { passed: false, checked_at: '', checks: [] } },
    };

    routes[blob(slug)] = { status: 200, body: JSON.stringify(failed) };
    const refused = await call(slug);

    routes[blob(slug)] = { status: 404, body: '' };
    const absent = await call(slug);

    expect(refused.status).toBe(404);
    expect(refused.body).toBe(absent.body);
    expect(refused.headers).toEqual(absent.headers);
  });

  it('still returns a body that boots the app', async () => {
    // A 404 with the working app is the goal. A 404 with an error page would
    // be a regression: the client's own not-found screen is good.
    const res = await call('gone-forever-abc123');
    expect(res.body).toContain('<div id="root"></div>');
    expect(res.body).toContain('/assets/index-CUmohATZ.js');
  });
});

describe('when the upstream fails rather than answers', () => {
  it('does not tell a crawler the article is gone', async () => {
    // A transient blob error is not evidence of anything. 404 is cached and
    // acted on; noindex is reversible on the next crawl.
    routes = { [SHELL_URL]: { status: 200, body: SHELL } };
    routes[blob(ARTICLE.slug)] = 'error';

    const res = await call(ARTICLE.slug);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(res.body).not.toContain('1,175 thousand tonnes');
    expect(res.body).toContain('<div id="root"></div>');
  });

  it('refuses to dress up a body that is not the app shell', async () => {
    routes[SHELL_URL] = { status: 200, body: '<html><body>gateway error</body></html>' };
    const res = await call(ARTICLE.slug);
    // No shell was ever cached on this fresh instance, so there is nothing to
    // serve. 503 is the truthful answer and the one crawlers retry.
    expect(res.status).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Retry-After']).toBe('5');
    expect(res.body).toContain('noindex');
  });

  it('answers 503 rather than a blank page when the origin is unreachable', async () => {
    routes[SHELL_URL] = 'error';
    const res = await call(ARTICLE.slug);
    expect(res.status).toBe(503);
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });
});

describe('when the request does not say which article it is', () => {
  it('degrades to exactly what the route did before this function existed', async () => {
    // SWA passes the reader's original URL in x-ms-original-url, and once
    // shipped a period where that header carried the *rewritten* URL instead.
    // If that ever regresses, every /article/* request arrives with nothing to
    // look up — so this must not 404 the newsroom or de-index it.
    const handler = loadHandler();
    const context: { res?: Res; log: Record<string, unknown> } = {
      log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
    };
    await handler(context, {
      headers: { 'x-forwarded-for': '198.51.100.7' },
      url: '/api/article-page',
    });
    const res = context.res as Res;

    expect(res.status).toBe(200);
    expect(res.body).toBe(SHELL);
    // Indexable and unmodified: sharing is broken again, which is the bug we
    // started with, rather than the whole section disappearing.
    expect(res.body).toContain('<meta name="robots" content="index, follow" />');
    expect(res.body).toContain('<div id="root"></div>');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });
});

describe('rate limiting', () => {
  it('applies the same per-IP limit as every other public endpoint', async () => {
    const handler = loadHandler();
    const limit = 60;
    let last: Res | undefined;
    for (let i = 0; i <= limit; i++) {
      const context: { res?: Res; log: Record<string, unknown> } = {
        log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
      };
      await handler(context, {
        headers: {
          'x-ms-original-url': `https://portabaltica.naurolabs.com/article/${ARTICLE.slug}`,
          'x-forwarded-for': '203.0.113.99',
        },
        url: '/api/article-page',
      });
      last = context.res as Res;
    }
    expect(last?.status).toBe(429);
  });
});
