/**
 * A corrected article is dated to the day it changed, not the day it appeared.
 *
 * WHAT `#349` LEFT, AND WHY IT COULD NOT HAVE DONE OTHERWISE
 * ---------------------------------------------------------
 * `#349` marked /rss.xml and /feed.json with a title prefix, and it was right
 * that a prefix is the marker: no reader displays a namespaced element, and the
 * title is what a list view shows. `tests/correctionsReachReaders.live.test.ts`
 * guards that.
 *
 * It answered "was this corrected" with a `Set` of slugs, which is exactly what
 * a prefix needs and structurally cannot answer "WHEN". Two surfaces need the
 * date, and both were therefore out of its reach:
 *
 *   - `date_modified`, JSON Feed 1.1's own field for "this entry changed after
 *     you fetched it". The prefix marks every item served from here on and can
 *     never reach an item a reader already holds — `feedTitle` says so about
 *     itself. This is the only field in either format that can, and RSS 2.0 has
 *     no equivalent.
 *   - `<lastmod>` in /sitemap.xml, which `#349` did not touch at all. It means
 *     "the date of last modification of the file", and 18 of the 43 syndicated
 *     articles were reporting their original publication date.
 *
 * Measured against production at 2026-09-01T14:30Z, after `#349` deployed:
 *
 *     rss items                         43   marked "Corrected: "   18
 *     json items                        43   marked                 18
 *     json items carrying date_modified  0   <- of the 18 corrected
 *
 * So the prefix shipped and the date did not, which is the gap this closes.
 *
 * WHAT THIS FILE DOES NOT RE-ASSERT
 * ---------------------------------
 * The prefix, the fatal-log decision, and that the two feeds mark the same
 * slugs. All three are `#349`'s and all three are already guarded in
 * `tests/jsonFeed.test.ts`. A second copy would be a second thing to keep in
 * step, and this repository has a section on what two copies do.
 *
 * Every claim below was proven by planting a fault and watching a NAMED
 * assertion fail; the plants are recorded in the pull request.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');
const JSONFEED_PATH = resolve(ROOT, 'api/news-jsonfeed/index.js');
const SITEMAP_PATH = resolve(ROOT, 'api/news-sitemap/index.js');
const NEWSROOM_PATH = resolve(ROOT, 'api/shared/newsroom.js');

const https = require('node:https') as { get: unknown };
const realGet = https.get;

const BLOBS = 'https://stportabalticabpmff5so.blob.core.windows.net/articles';
const INDEX_URL = `${BLOBS}/index.json`;
const CORRECTIONS_URL = `${BLOBS}/corrections.json`;

type Route = { status: number; body: string } | 'error' | 'missing';

let indexRoute: Route = 'missing';
let correctionsRoute: Route = 'missing';

/**
 * One stub for both blobs, routed by URL.
 *
 * `https.get` and not `https.request`: `api/shared/newsroom.js` uses `get`, and
 * `vitest.config.ts` records two files that stubbed the wrong one of that pair
 * and reached the real internet believing they had not.
 */
function stubNetwork() {
  https.get = ((url: string, _options: unknown, callback: (res: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void };
    request.destroy = () => {};

    process.nextTick(() => {
      const selected =
        url === INDEX_URL ? indexRoute : url === CORRECTIONS_URL ? correctionsRoute : 'error';
      if (selected === 'error') {
        request.emit('error', new Error('stubbed network failure for ' + url));
        return;
      }
      const route = selected === 'missing' ? { status: 404, body: '' } : selected;
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
 * `responseCache`, `cache` and `rateLimit` hold process-level state and these
 * endpoints key on nothing — `keyOn: []` — so without this the second test would
 * be served the first test's answer and pass for the wrong reason.
 */
function fresh<T>(path: string): T {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(API_DIR)) delete require.cache[key];
  }
  return require(path) as T;
}

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

let ip = 0;
const log = Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} });

async function invoke(path: string): Promise<Res> {
  const handler = fresh<(c: unknown, r: unknown) => Promise<void>>(path);
  const context: { res?: Res; log: typeof log } = { log };
  await handler(context, {
    headers: { 'x-forwarded-for': `10.4.0.${(++ip % 250) + 1}` },
    query: {},
    url: '/api/test',
  });
  return context.res as Res;
}

const jsonfeed = () => invoke(JSONFEED_PATH);
const sitemap = () => invoke(SITEMAP_PATH);

function serveIndex(articles: unknown[]) {
  indexRoute = {
    status: 200,
    body: JSON.stringify({ generated_at: '2026-09-01T06:00:00Z', count: articles.length, articles }),
  };
}

function serveCorrections(entries: unknown[]) {
  correctionsRoute = { status: 200, body: JSON.stringify(entries) };
}

// ─── fixtures ──────────────────────────────────────────────────────────────

/** Corrected in production, and its headline IS the claim we withdrew. */
const CORRECTED = {
  id: '01A',
  slug: 'lithuania-s-renewable-energy-share-hits-record-38-5-in-bb595c',
  tier: 'A',
  section: 'energy',
  headline: "Lithuania's renewable energy share hits record 38.5% in 2025",
  dek: 'The share rose again on the year.',
  persona: { id: 'nida', name: 'Nida', byline: 'Nida · AI correspondent, Economy & Labour' },
  published_at: '2026-08-28T06:15:00Z',
  status: 'corrected',
};

/** Never corrected. The negative case in every assertion below. */
const CLEAN = {
  id: '02A',
  slug: 'latvian-wage-growth-outpaced-inflation',
  tier: 'A',
  section: 'economy',
  headline: 'Latvian wage growth outpaced inflation for a third straight quarter',
  dek: 'Hourly labour cost rose faster than consumer prices again.',
  persona: { id: 'nida', name: 'Nida', byline: 'Nida · AI correspondent, Economy & Labour' },
  published_at: '2026-08-24T06:15:00Z',
  status: 'published',
};

function entry(slug: string, correctedAt: string | undefined) {
  const row: Record<string, unknown> = {
    slug,
    headline: 'whatever the headline was at the time',
    description: 'The superlative was not supported by the series and has been withdrawn.',
  };
  if (correctedAt !== undefined) row.corrected_at = correctedAt;
  return row;
}

beforeEach(() => {
  indexRoute = 'missing';
  correctionsRoute = 'missing';
  stubNetwork();
});

afterAll(() => {
  https.get = realGet;
});

// ─── the parser keeps the latest date, and stays usable as a membership test ─

describe('parseCorrections', () => {
  interface Newsroom {
    parseCorrections: (raw: unknown, url: string) => Map<string, string>;
    feedTitle: (article: unknown, corrected: Map<string, string>) => string;
  }
  const shared = () => fresh<Newsroom>(NEWSROOM_PATH);

  it('keeps the most recent correction for an article corrected twice', () => {
    // The log is append-only and NOT sorted. Measured on 2026-09-01: 28 entries
    // over 25 slugs, so three articles carry more than one, and taking whichever
    // came first dates them to a correction we have since superseded.
    const map = shared().parseCorrections(
      [
        entry('a', '2026-08-29T09:00:00Z'),
        entry('a', '2026-08-31T05:52:25Z'),
        entry('a', '2026-08-30T12:00:00Z'),
      ],
      CORRECTIONS_URL,
    );

    expect(map.get('a'), 'not the most recent correction').toBe('2026-08-31T05:52:25Z');
  });

  it('still answers membership, which is all the title prefix needs', () => {
    // Widening the set to a map had to leave `feedTitle` alone. `.has()` behaves
    // identically on both, and this is what says so rather than the comment.
    const map = shared().parseCorrections([entry('a', '2026-08-31T05:52:25Z')], CORRECTIONS_URL);

    expect(map.has('a'), 'a corrected slug is no longer a member').toBe(true);
    expect(map.has('b'), 'an uncorrected slug is a member').toBe(false);
  });

  it('marks an article whose log entry has no timestamp at all', () => {
    // The mark matters more than the date. An empty string is falsy, so a
    // `!known` test here would have dropped the article from the map entirely
    // and served its withdrawn headline unmarked — a worse failure than the
    // missing date it was reacting to.
    const map = shared().parseCorrections([entry('a', undefined)], CORRECTIONS_URL);

    expect(map.has('a'), 'an entry with no timestamp lost its mark').toBe(true);
  });

  it('prefers a real timestamp over a missing one, whichever came first', () => {
    const first = shared().parseCorrections(
      [entry('a', undefined), entry('a', '2026-08-31T05:52:25Z')],
      CORRECTIONS_URL,
    );
    const second = shared().parseCorrections(
      [entry('a', '2026-08-31T05:52:25Z'), entry('a', undefined)],
      CORRECTIONS_URL,
    );

    expect(first.get('a'), 'a later real timestamp did not win').toBe('2026-08-31T05:52:25Z');
    expect(second.get('a'), 'an empty timestamp displaced a real one').toBe('2026-08-31T05:52:25Z');
  });

  it('is empty, not fatal, when the log has never existed', () => {
    // A 404 is an answer: the log does not exist until the first correction is
    // ever issued. `#349`'s distinction, re-asserted here only because the
    // return type changed underneath it.
    expect(shared().parseCorrections(null, CORRECTIONS_URL).size).toBe(0);
  });
});

// ─── date_modified: the one field RSS has no element for ───────────────────

describe('/feed.json dates a corrected item', () => {
  const items = async () =>
    (JSON.parse((await jsonfeed()).body) as { items: Record<string, unknown>[] }).items;
  const find = async (slug: string) =>
    (await items()).find((i) => String(i.id).endsWith(slug));

  beforeEach(() => {
    serveIndex([CORRECTED, CLEAN]);
    serveCorrections([entry(CORRECTED.slug, '2026-08-31T05:52:25Z')]);
  });

  it('emits date_modified for a corrected item', async () => {
    const marked = await find(CORRECTED.slug);

    // The spec's own "this entry changed" field. The readers honouring it
    // re-read the entry, which is the only way to reach a subscriber already
    // holding the withdrawn headline.
    expect(marked!.date_modified, 'the correction date is missing').toBe('2026-08-31T05:52:25.000Z');
  });

  it('emits none at all for an uncorrected item', async () => {
    const clean = await find(CLEAN.slug);

    // Absent, not equal to `date_published`. A reader honouring the field would
    // otherwise be told every item had changed, every time — the same lesson the
    // handler states about `corrected: false`.
    expect(clean, 'the clean item is missing, so this proves nothing').toBeDefined();
    expect('date_modified' in clean!, 'an uncorrected item claims it was modified').toBe(false);
  });

  it('takes the latest when an article was corrected more than once', async () => {
    serveCorrections([
      entry(CORRECTED.slug, '2026-08-29T09:00:00Z'),
      entry(CORRECTED.slug, '2026-08-31T05:52:25Z'),
      entry(CORRECTED.slug, '2026-08-30T12:00:00Z'),
    ]);

    const marked = await find(CORRECTED.slug);

    expect(marked!.date_modified, 'not the most recent correction').toBe('2026-08-31T05:52:25.000Z');
  });

  it('drops an unparseable correction date rather than emitting Invalid Date', async () => {
    serveCorrections([entry(CORRECTED.slug, 'the third of never')]);

    const marked = await find(CORRECTED.slug);

    // `rfc3339` already makes this choice for `date_published`, and the reason
    // carries: a well-formed feed carrying a malformed field renders as garbage
    // in every reader, where an absent one is a state they all handle.
    expect('date_modified' in marked!, 'Invalid Date reached the feed').toBe(false);
  });

  it('still marks the title when the date is unusable', async () => {
    serveCorrections([entry(CORRECTED.slug, 'the third of never')]);

    const marked = await find(CORRECTED.slug);

    // The two are independent on purpose. A bad timestamp must cost the date and
    // not the notice, because the notice is the part a reader acts on.
    expect(String(marked!.title).startsWith('Corrected: '), 'a bad date cost the mark').toBe(true);
  });

  it('dates nothing when the log names an article we do not syndicate', async () => {
    serveCorrections([entry('an-article-that-is-not-in-the-index', '2026-08-31T05:52:25Z')]);

    const dated = (await items()).filter((i) => 'date_modified' in i);

    // Measured in production: 7 of the 25 corrected slugs are not in the feed,
    // so this has to intersect rather than count.
    expect(dated.length, 'a correction for an absent article dated a present one').toBe(0);
  });
});

// ─── the sitemap, which #349 did not reach ─────────────────────────────────

describe('/sitemap.xml dates a corrected article to its correction', () => {
  const lastmodFor = async (slug: string) => {
    const body = (await sitemap()).body;
    const found = body.match(
      new RegExp(`<loc>[^<]*/article/${slug}</loc>\\s*<lastmod>([^<]*)</lastmod>`),
    );
    return found ? found[1] : null;
  };

  it('uses the correction date, not the publication date', async () => {
    serveIndex([CORRECTED]);
    serveCorrections([entry(CORRECTED.slug, '2026-08-31T05:52:25Z')]);

    // Published 2026-08-28, corrected 2026-08-31. Before this, a crawler was
    // told the file had not changed since the 28th.
    expect(await lastmodFor(CORRECTED.slug), 'dated to publication, not to the correction').toBe(
      '2026-08-31',
    );
  });

  it('leaves an uncorrected article dated to its publication', async () => {
    serveIndex([CLEAN]);
    serveCorrections([]);

    expect(await lastmodFor(CLEAN.slug), 'a clean article was redated').toBe('2026-08-24');
  });

  it('falls back to publication when the correction carries no timestamp', async () => {
    serveIndex([CORRECTED]);
    serveCorrections([entry(CORRECTED.slug, undefined)]);

    // An empty `<lastmod>` is a malformed sitemap entry; the publication date is
    // wrong by a few days but well-formed and honest about the file existing.
    expect(await lastmodFor(CORRECTED.slug), 'emitted a blank or missing lastmod').toBe(
      '2026-08-28',
    );
  });

  it('refuses to serve at all when the corrections log cannot be read', async () => {
    serveIndex([CORRECTED]);
    correctionsRoute = 'error';

    const res = await sitemap();

    // The same choice the two feeds make. A sitemap quietly falling back to
    // publication dates would tell a crawler nothing had changed — which is the
    // one claim a correction makes false.
    expect(res.status, 'an unreadable log produced confident wrong dates').toBe(500);
  });

  it('serves normally when the log has never existed', async () => {
    serveIndex([CLEAN]);
    correctionsRoute = 'missing'; // 404

    const res = await sitemap();

    expect(res.status, 'a 404 log was treated as a failure').toBe(200);
    expect(await lastmodFor(CLEAN.slug), 'the article lost its date').toBe('2026-08-24');
  });
});

// ─── controls ──────────────────────────────────────────────────────────────

describe('the harness is not blind', () => {
  beforeEach(() => {
    serveIndex([CORRECTED, CLEAN]);
    serveCorrections([]);
  });

  it('produces items at all', async () => {
    const feed = JSON.parse((await jsonfeed()).body) as { items: unknown[] };

    // Every `toBe(false)` and `toEqual([])` above passes trivially on an empty
    // feed, and an empty feed is what a broken stub produces.
    expect(feed.items.length, 'the stub served no items').toBe(2);
  });

  it('lists the articles in the sitemap at all', async () => {
    const body = (await sitemap()).body;

    expect((body.match(/\/article\//g) ?? []).length, 'the sitemap listed no articles').toBe(2);
  });

  it('reports date_modified as absent when nothing is corrected', async () => {
    const feed = JSON.parse((await jsonfeed()).body) as { items: Record<string, unknown>[] };

    // The negative control. Without it, "the corrected item has a date" passing
    // would be consistent with a feed that dates everything.
    expect(feed.items.filter((i) => 'date_modified' in i).length, 'an empty log dated an item').toBe(0);
  });
});
