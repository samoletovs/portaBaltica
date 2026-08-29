/**
 * The endpoint that serves a series as a file.
 *
 * WHAT IS TESTED HERE THAT `seriesExportParity` DOES NOT COVER
 * ------------------------------------------------------------
 * That suite proves the two writers agree about bytes. This one drives the real
 * handler, with the network stubbed at `https.get` — the same module
 * `api/shared/eurostat.js` requires — because the riskiest decisions live in the
 * handler and nowhere else:
 *
 *   - the cache key, and specifically that `format` and `years` are in it. A key
 *     that omitted `format` would serve a CSV body under the JSON content type
 *     to whoever asked second; one that omitted `years` would serve five years
 *     under a thirty-year heading. Both are correct figures answering a
 *     different question, and neither is malformed.
 *   - that an unknown indicator is a 400 that names the valid ids rather than
 *     echoing the invalid one;
 *   - that an upstream failure is a 502 and not a file of headers, because an
 *     empty spreadsheet reads as a country that reported nothing;
 *   - the security headers, which a managed function does not inherit from
 *     staticwebapp.config.json;
 *   - `Content-Disposition`, without which a browser renders CSV as a wall of
 *     text and the file has no name a week later.
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
const HANDLER = resolve(ROOT, 'api/data-export/index.js');

const https = require('node:https') as { get: unknown };
const realGet = https.get;

/**
 * A believable JSON-stat payload for three countries.
 *
 * Shaped from what `/api/baltic-compare` actually receives: a `dimension` with
 * `geo` and `time` categories, and a sparse `value` map keyed by flat index.
 */
function jsonStat(values: Record<string, number | null>) {
  const geos = ['LV', 'EE', 'LT'];
  const times = ['2025-Q1', '2025-Q2'];
  const value: Record<string, number> = {};
  geos.forEach((geo, g) => {
    times.forEach((time, t) => {
      const v = values[`${geo}:${time}`];
      if (typeof v === 'number') value[String(g * times.length + t)] = v;
    });
  });
  return {
    id: ['geo', 'time'],
    size: [geos.length, times.length],
    dimension: {
      geo: { category: { index: Object.fromEntries(geos.map((g, i) => [g, i])) } },
      time: { category: { index: Object.fromEntries(times.map((t, i) => [t, i])) } },
    },
    value,
  };
}

let upstream: { status: number; body: string } | 'error' = 'error';
let requests: string[] = [];

function stubNetwork() {
  https.get = ((url: string, _options: unknown, callback: (res: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void };
    request.destroy = () => {};
    requests.push(url);

    process.nextTick(() => {
      if (upstream === 'error') {
        request.emit('error', new Error('stubbed upstream failure'));
        return;
      }
      const response = Readable.from([upstream.body]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = upstream.status;
      response.headers = {};
      callback(response);
    });
    return request;
  }) as unknown;
}

/** A handler with every `api/` module reloaded, so the caches start empty. */
function freshHandler() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(API_DIR)) delete require.cache[key];
  }
  return require(HANDLER) as (context: unknown, req: unknown) => Promise<void>;
}

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

let ip = 0;
const log = Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} });

/** One request against a handler the caller owns, so its cache persists. */
async function invoke(
  handler: (context: unknown, req: unknown) => Promise<void>,
  query: Record<string, string>,
): Promise<Res> {
  const context: { res?: Res; log: typeof log } = { log };
  await handler(context, {
    headers: { 'x-forwarded-for': `10.8.0.${(++ip % 240) + 1}` },
    query,
    url: '/api/data-export',
  });
  return context.res as Res;
}

beforeEach(() => {
  stubNetwork();
  requests = [];
  upstream = {
    status: 200,
    body: JSON.stringify(jsonStat({
      'LV:2025-Q1': 0.2, 'LV:2025-Q2': -1.4,
      'EE:2025-Q1': 4.1, 'EE:2025-Q2': 0,
      'LT:2025-Q1': 2.2,
    })),
  };
});

afterAll(() => {
  https.get = realGet;
});

describe('the file it serves', () => {
  it('is CSV by default, named, and offered as a download', async () => {
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/^text\/csv/);
    expect(res.headers['Content-Disposition']).toMatch(
      /^attachment; filename="portabaltica-gdp-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it('carries the provenance a spreadsheet outliving the page needs', async () => {
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.body).toContain('# Source: Eurostat (namq_10_gdp)');
    expect(res.body).toContain('# Dataset: namq_10_gdp');
    expect(res.body).toMatch(/# Retrieved from source: \d{4}-\d{2}-\d{2}T/);
    expect(res.body).toMatch(/# Exported: \d{4}-\d{2}-\d{2}T/);
    expect(res.body).toContain('# Licence: ');
    expect(res.body).toContain('# Attribution: portaBaltica');
  });

  it('names the three countries as columns, in order', async () => {
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.body).toContain('period,Latvia,Estonia,Lithuania');
  });

  it('writes a period a country did not publish as an empty cell', async () => {
    // Lithuania has no 2025-Q2 in the fixture. A zero there would be a reading
    // the source never made — the defect this whole export path is careful about.
    const res = await invoke(freshHandler(), { indicator: 'gdp' });
    const row = res.body.split('\r\n').find((line) => line.startsWith('2025-Q2,'));

    expect(row).toBe('2025-Q2,-1.4,0,');
  });

  it('serves JSON when asked, with null preserved rather than dropped', async () => {
    // Lithuania has no 2025-Q2 reading in the fixture. JSON has a way of saying
    // "no reading" that CSV does not, so the period is carried with a `null`
    // rather than omitted — omitting it would make a gap indistinguishable from
    // a series that simply ends earlier.
    const res = await invoke(freshHandler(), { indicator: 'gdp', format: 'json' });

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/^application\/json/);
    const payload = JSON.parse(res.body) as {
      series: { label: string; observations: { period: string; value: number | null }[] }[];
    };
    const lithuania = payload.series.find((s) => s.label === 'Lithuania')!;
    expect(lithuania.observations.find((o) => o.period === '2025-Q2')?.value).toBeNull();
    expect(lithuania.observations.find((o) => o.period === '2025-Q1')?.value).toBe(2.2);
    expect(payload.series.map((s) => s.label)).toEqual(['Latvia', 'Estonia', 'Lithuania']);
  });
});

describe('the cache key names every parameter the handler reads', () => {
  /**
   * The failure this repo has already published five wrong articles from: a key
   * that ignores a parameter serves one question's answer under another's
   * heading, and nothing about the response looks wrong.
   */
  it('does not serve the CSV body to a request for JSON', async () => {
    const handler = freshHandler();
    const csv = await invoke(handler, { indicator: 'gdp', format: 'csv' });
    const json = await invoke(handler, { indicator: 'gdp', format: 'json' });

    expect(csv.headers['Content-Type']).toMatch(/^text\/csv/);
    expect(json.headers['Content-Type']).toMatch(/^application\/json/);
    expect(json.body).not.toBe(csv.body);
    expect(() => JSON.parse(json.body)).not.toThrow();
  });

  it('does not serve one indicator under another indicator’s name', async () => {
    const handler = freshHandler();
    const gdp = await invoke(handler, { indicator: 'gdp' });
    const unemployment = await invoke(handler, { indicator: 'unemployment' });

    expect(gdp.body).toContain('Eurostat (namq_10_gdp)');
    expect(unemployment.body).toContain('Eurostat (une_rt_m)');
    expect(unemployment.body).not.toContain('namq_10_gdp');
  });

  it('asks upstream for the number of years it was given', async () => {
    // `years` reaches `es.buildUrl` as a `sinceTimePeriod`, so a key that
    // ignored it would serve five years of history under a thirty-year request
    // — correct figures, wrong question, nothing malformed.
    const handler = freshHandler();
    await invoke(handler, { indicator: 'gdp', years: '5' });
    const first = requests.length;
    await invoke(handler, { indicator: 'gdp', years: '30' });

    expect(requests.length, 'a second distinct request must reach upstream')
      .toBeGreaterThan(first);
    expect(requests[requests.length - 1]).not.toBe(requests[0]);
  });

  it('serves the same request from cache rather than asking twice', async () => {
    // The control for the assertion above: if every request reached upstream,
    // "a different request reached upstream" would prove nothing.
    const handler = freshHandler();
    await invoke(handler, { indicator: 'gdp', years: '5' });
    const after = requests.length;
    await invoke(handler, { indicator: 'gdp', years: '5' });

    expect(requests.length).toBe(after);
  });

  it('declares those parameters and no others', () => {
    const source = readFileSync(HANDLER, 'utf-8');
    const keyOn = source.match(/keyOn:\s*\[([^\]]*)\]/)?.[1] ?? '';

    expect(keyOn).toContain("'indicator'");
    expect(keyOn).toContain("'years'");
    expect(keyOn).toContain("'format'");
  });
});

describe('when it cannot answer', () => {
  it('refuses an unknown indicator without echoing it', async () => {
    const res = await invoke(freshHandler(), { indicator: '<script>alert(1)</script>' });

    expect(res.status).toBe(400);
    expect(res.body).not.toContain('<script>');
    expect(res.body).toContain('Unknown indicator');
  });

  it('refuses a format it does not serve', async () => {
    const res = await invoke(freshHandler(), { indicator: 'gdp', format: 'xlsx' });

    expect(res.status).toBe(400);
    expect(res.body).toContain('Unknown format');
  });

  it('answers 502 rather than a file of headers when upstream fails', async () => {
    // A CSV with a header row and no data reads, in a spreadsheet, as three
    // countries that published nothing. A 502 says what actually happened.
    upstream = 'error';
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.status).toBe(502);
    expect(res.headers['Content-Type']).toMatch(/^application\/json/);
  });

  it('answers 502 when upstream returns no observations at all', async () => {
    // `parseJsonStat` returns every requested country with a null-filled series
    // whatever the payload holds — measured — so "no data" arrives as three
    // full-length columns of nothing rather than as an empty array. A guard
    // written against `series.length === 0` could never fire; this fixture is
    // what actually reaches the handler.
    upstream = { status: 200, body: JSON.stringify(jsonStat({})) };
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.status).toBe(502);
    expect(res.body).toContain('no observations');
  });

  it('still serves a file when only one country has a reading', async () => {
    // The control for the assertion above. A guard on "every observation is
    // null" must not also refuse a sparse but real series — which is most of
    // the maritime and Estonian cubes on this site.
    upstream = { status: 200, body: JSON.stringify(jsonStat({ 'LV:2025-Q1': 1 })) };
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.status).toBe(200);
    expect(res.body).toContain('2025-Q1,1,,');
  });

  it('does not cache a failure, so a blip is not a fixed outage', async () => {
    const handler = freshHandler();
    upstream = 'error';
    expect((await invoke(handler, { indicator: 'gdp' })).status).toBe(502);

    upstream = { status: 200, body: JSON.stringify(jsonStat({ 'LV:2025-Q1': 1 })) };
    expect((await invoke(handler, { indicator: 'gdp' })).status).toBe(200);
  });
});

describe('the response carries what a managed function does not inherit', () => {
  it('has the security headers', async () => {
    // `globalHeaders` in staticwebapp.config.json does not reach a function
    // response — measured against production, sixteen of seventeen routes bare.
    const res = await invoke(freshHandler(), { indicator: 'gdp' });

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });
});

describe('it does not spend the reader’s rate limit twice', () => {
  /**
   * Measured before this was written: `rateLimit.check` RECORDS A HIT on every
   * call, and `withCache` calls it. So invoking `/api/baltic-compare`'s exported
   * handler to reuse its cached response — the obvious implementation — would
   * charge one reader two of their sixty requests a minute, on the endpoint
   * most likely to be scripted.
   *
   * WHY THIS COUNTS REQUESTS INSTEAD OF READING THE SOURCE
   * ------------------------------------------------------
   * It used to assert that the handler's text did not `require` a sibling
   * endpoint. That is a lexical proxy for "does not invoke one", and the two
   * came apart the moment there was a good reason to import one: this handler
   * now reads `GEOS`, `REFERENCE_GEO`, `buildReference` and
   * `referenceIsComparable` from `baltic-compare`, which exports them
   * deliberately. `require` does not call the handler and records no hit, so
   * the endpoint's behaviour was right and the guard was wrong — it went red on
   * a correct change and would have pushed the next author into copying four
   * functions to keep a test quiet.
   *
   * So this exhausts the reader's budget and counts. One request must cost one
   * unit. No phrasing can beat it, because it is not reading any words.
   */
  it('spends exactly one request per request, measured against the real limit', async () => {
    interface Limiter {
      reset: () => void;
      getStats: () => { limitPerMin: number };
    }
    // Required AFTER `freshHandler` clears the module cache, so this is the
    // same instance the handler will consult rather than a second copy with a
    // map of its own — which would report zero hits however often it was hit.
    const handler = freshHandler();
    const limiter = require(resolve(ROOT, 'api/shared/rateLimit.js')) as Limiter;
    limiter.reset();

    const limit = limiter.getStats().limitPerMin;
    const caller = { headers: { 'x-forwarded-for': '198.51.100.7' }, query: { indicator: 'gdp' } };

    let served = 0;
    for (let i = 0; i < limit + 5; i += 1) {
      const context: { res?: Res; log: typeof log } = { log };
      await handler(context, caller);
      if (context.res!.status === 429) break;
      served += 1;
    }

    expect(served, `one reader got ${served} files out of a ${limit}/min budget`).toBe(limit);
    limiter.reset();
  });

  it('records no hit merely for being imported', () => {
    // The other half, and the reason importing a sibling is safe: loading a
    // module must not consult the limiter. If it did, a cold start would spend
    // the budget of whichever address happened to arrive first.
    const limiter = require(resolve(ROOT, 'api/shared/rateLimit.js')) as {
      reset: () => void;
      getStats: () => { trackedIps: number };
    };
    limiter.reset();
    expect(limiter.getStats().trackedIps).toBe(0);

    freshHandler();

    expect(limiter.getStats().trackedIps, 'importing charged somebody').toBe(0);
  });

  it('uses the shared builders rather than re-deriving the query', () => {
    const source = readFileSync(HANDLER, 'utf-8');

    expect(source, 'it uses the shared builders instead').toContain("require('../shared/eurostat.js')");
    expect(source).toContain("require('../shared/indicators.js')");
  });

  it('asks upstream for a URL the shared builder produced', async () => {
    // Not a restated query string. AGENTS.md: ask the application for the URL.
    await invoke(freshHandler(), { indicator: 'gdp' });

    expect(requests[0]).toContain('namq_10_gdp');
    expect(requests[0]).toContain('geo=LV');
    expect(requests[0]).toContain('geo=EE');
    expect(requests[0]).toContain('geo=LT');
  });
});

describe('the route that makes it reachable', () => {
  interface SwaConfig { routes?: { route: string; rewrite?: string }[] }
  const config = (): SwaConfig =>
    JSON.parse(readFileSync(resolve(ROOT, 'public/staticwebapp.config.json'), 'utf-8')) as SwaConfig;

  it('is served under /api, which is already routed', () => {
    const all = config().routes!.map((r) => r.route);

    expect(all).toContain('/api/*');
    expect(all.indexOf('/api/*')).toBeLessThan(all.indexOf('/*'));
  });

  it('is not swallowed by the page-shell rules added for crawlers', () => {
    // Those rewrite whole families to an HTML shell. If `/api/*` fell behind
    // them, every endpoint on the site would answer with a web page.
    const all = config().routes!.map((r) => r.route);

    expect(all.indexOf('/api/*')).toBeLessThan(all.indexOf('/'));
    expect(all.indexOf('/api/*')).toBeLessThan(all.indexOf('/data'));
  });
});
