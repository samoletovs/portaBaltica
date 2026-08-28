/**
 * /feed.json — JSON Feed 1.1.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * Two things, and the second matters more than the first.
 *
 * 1. Conformance. A feed is consumed by software that will not tell us it is
 *    broken; it will simply show nothing, or show `Invalid Date`, in somebody
 *    else's reader. So the spec's required fields are asserted here rather than
 *    trusted to review.
 *
 * 2. That there is still ONE answer to "which articles are ours". That rule has
 *    history in this repo: tier C is somebody else's journalism and syndicating
 *    their snippet would be reuse we have no right to, and a withdrawn article
 *    must stop circulating the moment we take it back — a feed reader does not
 *    come back to see the correction. Adding a second feed is exactly the move
 *    that produces a second copy of that rule, and a copy can quietly stop
 *    agreeing. So the two feeds are driven against the same stubbed index and
 *    required to carry the same slugs, rather than each being checked against
 *    the test author's idea of the right answer.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');
const JSONFEED_PATH = resolve(ROOT, 'api/news-jsonfeed/index.js');
const RSS_PATH = resolve(ROOT, 'api/news-rss/index.js');

const https = require('node:https') as { get: unknown };
const realGet = https.get;

const INDEX_URL =
  'https://stportabalticabpmff5so.blob.core.windows.net/articles/index.json';

/** What the network should answer for the index, or `'error'` / `'missing'`. */
let indexRoute: { status: number; body: string } | 'error' | 'missing' = 'missing';

function stubNetwork() {
  https.get = ((url: string, _options: unknown, callback: (res: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void };
    request.destroy = () => {};

    process.nextTick(() => {
      if (url !== INDEX_URL || indexRoute === 'error') {
        request.emit('error', new Error('stubbed network failure for ' + url));
        return;
      }
      const route = indexRoute === 'missing' ? { status: 404, body: '' } : indexRoute;
      const response = Readable.from([route.body]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = route.status;
      response.headers = {};
      callback(response);
    });
    return request;
  }) as unknown;
}

/**
 * A handler with every `api/` module reloaded.
 *
 * `responseCache`, `cache` and `rateLimit` all hold process-level state, and
 * this feed's key is constant — `keyOn: []` — so without this the second test
 * in the file would be served the first test's answer and pass for the wrong
 * reason.
 */
function freshHandler(path: string) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(API_DIR)) delete require.cache[key];
  }
  return require(path) as (context: unknown, req: unknown) => Promise<void>;
}

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

let ip = 0;

/** Callable with methods, which is the shape the Functions host passes. */
const log = Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} });

async function invoke(path: string): Promise<Res> {
  const handler = freshHandler(path);
  const context: { res?: Res; log: typeof log } = { log };
  await handler(context, {
    headers: { 'x-forwarded-for': `10.1.0.${(++ip % 250) + 1}` },
    query: {},
    url: path.includes('jsonfeed') ? '/api/news-jsonfeed' : '/api/news-rss',
  });
  return context.res as Res;
}

function serveIndex(articles: unknown[]) {
  indexRoute = {
    status: 200,
    body: JSON.stringify({ generated_at: '2026-08-27T17:12:59Z', count: articles.length, articles }),
  };
}

const OURS = {
  id: '01A',
  slug: 'latvian-wage-growth-outpaced-inflation',
  tier: 'A',
  section: 'economy',
  headline: 'Latvian wage growth outpaced inflation for a third straight quarter',
  dek: 'Hourly labour cost rose faster than consumer prices again.',
  persona: { id: 'nida', name: 'Nida', byline: 'Nida · AI correspondent, Economy & Labour' },
  published_at: '2026-08-24T06:15:00Z',
  status: 'published',
};

const OFFICIAL = {
  id: '01B',
  slug: 'elering-desynchronisation-notice',
  tier: 'B',
  section: 'energy',
  headline: 'Elering publishes desynchronisation test results',
  dek: 'The operator’s own statement, reproduced in full.',
  syndicated: { attribution: 'Elering', original_url: 'https://elering.ee/x' },
  published_at: '2026-08-25T09:00:00Z',
  status: 'published',
};

const THEIRS = {
  id: '01C',
  slug: 'err-estonia-grid-story',
  tier: 'C',
  section: 'energy',
  headline: 'Estonia’s grid operator reports record desynchronisation test',
  syndicated: {
    attribution: 'ERR News',
    original_url: 'https://news.err.ee/example-story',
    snippet: 'Elering said the test ran without incident.',
  },
  published_at: '2026-08-25T05:45:00Z',
  status: 'published',
};

const WITHDRAWN = { ...OURS, id: '01D', slug: 'withdrawn-piece', status: 'retracted' };

interface FeedItem {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  summary?: unknown;
  content_text?: unknown;
  content_html?: unknown;
  date_published?: unknown;
  authors?: { name?: unknown }[];
  tags?: unknown;
  _portabaltica?: { tier?: unknown; format?: unknown };
}

interface Feed {
  version?: unknown;
  title?: unknown;
  home_page_url?: unknown;
  feed_url?: unknown;
  language?: unknown;
  authors?: unknown;
  items?: FeedItem[];
}

/** Slugs, in order, from whichever feed document is handed in. */
function slugsFromJson(body: string): string[] {
  return ((JSON.parse(body) as Feed).items ?? []).map((item) =>
    String(item.url).replace(/^.*\/article\//, ''),
  );
}

function slugsFromRss(body: string): string[] {
  return [...body.matchAll(/<link>[^<]*\/article\/([^<]+)<\/link>/g)].map((m) => m[1]);
}

beforeEach(() => {
  stubNetwork();
  indexRoute = 'missing';
  serveIndex([OURS, OFFICIAL, THEIRS]);
});

afterAll(() => {
  https.get = realGet;
});

describe('JSON Feed 1.1 conformance', () => {
  it('declares the version the spec requires, verbatim', async () => {
    const res = await invoke(JSONFEED_PATH);
    const feed = JSON.parse(res.body) as Feed;

    // Not "1.1", not a version/1 URL. Readers switch on this exact string.
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
  });

  it('carries the required top-level fields', async () => {
    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    expect(typeof feed.title).toBe('string');
    expect(feed.title).toBeTruthy();
    expect(Array.isArray(feed.items)).toBe(true);
    // Recommended, and the pair that lets a reader resubscribe after a move.
    expect(feed.home_page_url).toBe('https://portabaltica.naurolabs.com');
    expect(feed.feed_url).toBe('https://portabaltica.naurolabs.com/feed.json');
    expect(feed.language).toBe('en');
  });

  it('gives every item an id and something to display', async () => {
    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    expect(feed.items!.length).toBeGreaterThan(0);
    for (const item of feed.items!) {
      expect(typeof item.id, `id on ${String(item.url)}`).toBe('string');
      expect(String(item.id)).toBeTruthy();
      // The spec requires at least one of content_html / content_text. An item
      // with neither renders as a blank row in most readers.
      const hasContent =
        typeof item.content_text === 'string' || typeof item.content_html === 'string';
      expect(hasContent, `content on ${String(item.url)}`).toBe(true);
      expect(String(item.content_text ?? item.content_html)).toBeTruthy();
    }
  });

  it('dates every item in RFC 3339', async () => {
    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    for (const item of feed.items!) {
      expect(item.date_published).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
      );
      expect(Number.isNaN(new Date(String(item.date_published)).getTime())).toBe(false);
    }
  });

  it('serves the media type the spec names', async () => {
    const res = await invoke(JSONFEED_PATH);

    expect(res.headers['Content-Type']).toMatch(/^application\/feed\+json/);
  });

  it('omits a date it cannot parse rather than emitting "Invalid Date"', async () => {
    // Absent must stay absent. `new Date('soon').toISOString()` throws and
    // interpolating the Date object yields the literal string "Invalid Date",
    // which is a well-formed feed carrying a field every reader renders as
    // garbage. A missing date is a state readers already handle.
    serveIndex([{ ...OURS, published_at: 'soon' }]);

    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    expect(feed.items).toHaveLength(1);
    expect(feed.items![0]).not.toHaveProperty('date_published');
    expect(JSON.stringify(feed)).not.toContain('Invalid Date');
  });
});

describe('the two feeds answer the same question', () => {
  it('carries exactly the slugs /rss.xml carries, from one index', async () => {
    serveIndex([OURS, OFFICIAL, THEIRS, WITHDRAWN]);

    const json = slugsFromJson((await invoke(JSONFEED_PATH)).body);
    const rss = slugsFromRss((await invoke(RSS_PATH)).body);

    // The comparison is only worth anything if both feeds actually produced
    // something. Two empty lists are equal and prove nothing — the shape of
    // guard this repo keeps finding inert.
    expect(json.length, 'the JSON feed produced no items to compare').toBeGreaterThan(0);
    expect(json).toEqual(rss);
    expect(json).toEqual([OURS.slug, OFFICIAL.slug]);
  });

  it('never syndicates a tier C link-out', async () => {
    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    const body = JSON.stringify(feed);
    expect(body).not.toContain(THEIRS.slug);
    expect(body).not.toContain('news.err.ee');
  });

  it('drops a withdrawn article even when the index still lists it', async () => {
    serveIndex([OURS, WITHDRAWN]);

    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;

    expect(slugsFromJson(JSON.stringify(feed))).toEqual([OURS.slug]);
  });

  it('credits the same article to the same author in both feeds', async () => {
    serveIndex([OURS, OFFICIAL]);

    const feed = JSON.parse((await invoke(JSONFEED_PATH)).body) as Feed;
    const rss = (await invoke(RSS_PATH)).body;
    // The same name, in each document's own encoding: RSS must escape `&` and
    // JSON must not. Comparing the raw strings would fail on the ampersand in
    // "Economy & Labour" while both feeds were entirely correct.
    const { escapeXml } = require(resolve(ROOT, 'api/shared/newsroom.js')) as {
      escapeXml: (value: unknown) => string;
    };

    expect(feed.items!.length).toBeGreaterThan(0);
    for (const item of feed.items!) {
      const author = String(item.authors![0].name);
      expect(rss, `${String(item.url)} is credited differently in RSS`).toContain(
        `<dc:creator>${escapeXml(author)}</dc:creator>`,
      );
    }
  });
});

describe('the byline', () => {
  const newsroom = require(resolve(ROOT, 'api/shared/newsroom.js')) as {
    bylineFor: (article: unknown) => string;
  };

  it('discloses AI on our own work', () => {
    expect(newsroom.bylineFor(OURS)).toContain('AI correspondent');
  });

  it('rebuilds the disclosure when the byline field is missing', () => {
    // A feed reader shows the author and never shows our masthead, so falling
    // back to a bare name would strip the disclosure on the one surface where
    // nothing else carries it.
    const noByline = { ...OURS, persona: { id: 'nida', name: 'Nida' } };

    expect(newsroom.bylineFor(noByline)).toContain('AI correspondent');
  });

  it('credits a verbatim release to its publisher, not to us', () => {
    // `ArticleView` says this on the page — "No portaBaltica byline: we did not
    // write this" — and /rss.xml said `portaBaltica` anyway. The page was right.
    expect(newsroom.bylineFor(OFFICIAL)).toBe('Elering');
    expect(newsroom.bylineFor(OFFICIAL)).not.toContain('portaBaltica');
  });

  it('falls back to the publication only when there is nothing else to say', () => {
    expect(newsroom.bylineFor({ tier: 'A', slug: 'x' })).toBe('portaBaltica');
    expect(newsroom.bylineFor(null)).toBe('portaBaltica');
  });
});

describe('failure modes', () => {
  it('500s on a missing index rather than serving a valid empty feed', async () => {
    // The 2026-08-24 fault: a 404 became [], which became a green empty feed
    // while three articles were live, and nothing anywhere was red.
    indexRoute = 'missing';

    const res = await invoke(JSONFEED_PATH);

    expect(res.status).toBe(500);
  });

  it('serves an empty feed, and a 200, on a genuinely quiet day', async () => {
    // The newsroom publishes only when the data warrants it. Nothing to report
    // is a legitimate state and must not look like an outage.
    serveIndex([]);

    const res = await invoke(JSONFEED_PATH);

    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as Feed).items).toEqual([]);
  });

  it('carries the security headers a managed function does not inherit', async () => {
    // `globalHeaders` in staticwebapp.config.json does not reach a function
    // response — measured against production, sixteen of seventeen routes bare.
    const res = await invoke(JSONFEED_PATH);

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });
});

describe('the route that makes /feed.json resolve', () => {
  interface SwaConfig {
    routes?: { route: string; rewrite?: string }[];
    navigationFallback?: { exclude?: string[] };
  }

  const config = (): SwaConfig =>
    JSON.parse(readFileSync(resolve(ROOT, 'public/staticwebapp.config.json'), 'utf-8')) as SwaConfig;

  it('sends /feed.json to the function', () => {
    const rule = config().routes!.find((r) => r.route === '/feed.json');

    expect(rule).toBeDefined();
    expect(rule!.rewrite).toBe('/api/news-jsonfeed');
  });

  it('keeps that rule ahead of the catch-all', () => {
    // SWA takes the first matching route. Behind `/*` the rewrite never runs,
    // and `navigationFallback` excludes `*.json`, so the reader gets a 404 for
    // a URL we advertise in the document head.
    const all = config().routes!.map((r) => r.route);

    expect(all.indexOf('/feed.json')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('/feed.json')).toBeLessThan(all.indexOf('/*'));
  });

  it('is advertised in the head, where a feed reader looks', () => {
    // Autodiscovery is read without running JavaScript, so it has to be in the
    // served bytes rather than set by `usePageMeta` after the app boots.
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');

    expect(html).toMatch(
      /<link rel="alternate" type="application\/feed\+json"[^>]*href="\/feed\.json"/,
    );
    expect(html, 'the existing RSS alternate must survive').toMatch(
      /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/rss\.xml"/,
    );
  });

  it('lists /follow and /weekly in the sitemap', async () => {
    const res = await invoke(resolve(ROOT, 'api/news-sitemap/index.js'));

    expect(res.body).toContain('<loc>https://portabaltica.naurolabs.com/follow</loc>');
    expect(res.body).toContain('<loc>https://portabaltica.naurolabs.com/weekly</loc>');
  });
});
