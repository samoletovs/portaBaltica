/**
 * `/api/sea-state`, and the six calls it replaced.
 *
 * The dashboard used to fetch marine and surface weather straight from
 * Open-Meteo in the browser: two requests per port, three ports, on every load
 * of `/data`. The ports are fixed coordinates, so every visitor fetched the
 * same six payloads independently, for data that is republished hourly — and
 * they were the only requests on the site that could not be cached server-side,
 * because they never reached our server.
 *
 * Two things therefore need holding down. That the coordinates on the server
 * are the coordinates the dashboard draws, because a silent divergence files
 * one port's weather under another port's name. And that the browser no longer
 * reaches Open-Meteo at all, which is a property of the Content-Security-Policy
 * rather than of anyone remembering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { PORTS as CLIENT_PORTS } from '../src/types';

const require = createRequire(import.meta.url);
const cache = require('../api/shared/cache.js');
const rateLimit = require('../api/shared/rateLimit.js');
const seaState = require('../api/sea-state/index.js');
const es = require('../api/shared/eurostat.js');

beforeEach(() => { cache.clear(); rateLimit.reset(); });

const call = async () => {
  const context: { res?: { status: number; headers: Record<string, string>; body: string } } = {};
  await seaState(context, { query: {}, headers: {} });
  return context.res!;
};

/** Replace the HTTP layer for the duration of one call. */
async function withUpstream<T>(impl: (url: string) => Promise<unknown>, run: () => Promise<T>) {
  const original = es.httpJson;
  es.httpJson = impl;
  try { return await run(); } finally { es.httpJson = original; }
}

const marinePayload = {
  current: {
    wave_height: 0.6, wave_direction: 210, wave_period: 4,
    sea_surface_temperature: 17.2, wind_wave_height: 0.3, swell_wave_height: 0.4,
  },
  hourly: { time: ['2026-08-27T12:00'], wave_height: [0.6], sea_surface_temperature: [17.2] },
};

const weatherPayload = {
  current: {
    temperature_2m: 19.4, wind_speed_10m: 12, wind_direction_10m: 200,
    cloud_cover: 40, precipitation: 0,
  },
};

const answerBoth = async (url: string) =>
  url.includes('marine') ? marinePayload : weatherPayload;

describe('the coordinates', () => {
  it('are the same three ports the dashboard draws', () => {
    // The Function App is deployed from `api/` alone and cannot read
    // `src/types.ts` at runtime, so the list is duplicated. A duplicate that
    // nothing compares is a divergence waiting to happen, and this one would
    // show up as a port's weather quietly filed under another port's name.
    const server = seaState.PORTS.map((p: { code: string; lat: number; lon: number }) =>
      ({ code: p.code, lat: p.lat, lon: p.lon }));
    const client = CLIENT_PORTS.map((p) => ({ code: p.code, lat: p.lat, lon: p.lon }));

    expect(server).toEqual(client);
  });
});

describe('the response', () => {
  it('answers all three ports from one request', async () => {
    let upstreamCalls = 0;
    const res = await withUpstream(async (url) => {
      upstreamCalls++;
      return answerBoth(url);
    }, call);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ports).toHaveLength(3);
    expect(upstreamCalls, 'two calls per port, made once for everyone').toBe(6);
  });

  it('costs nothing upstream for the second reader', async () => {
    // The whole point. Six upstream calls per TTL rather than six per visitor:
    // twenty-four an hour whether one person is reading or ten thousand.
    let upstreamCalls = 0;
    await withUpstream(async (url) => { upstreamCalls++; return answerBoth(url); }, async () => {
      await call();
      await call();
      await call();
    });

    expect(upstreamCalls).toBe(6);
  });

  it('reports a missing reading as null, never as a calm sea', async () => {
    // Zero is an ordinary wave height, air temperature and wind speed on the
    // Baltic, so a zero standing in for "no answer" is indistinguishable from
    // an observation. This dashboard has shipped that exact substitution twice.
    const res = await withUpstream(async (url) =>
      url.includes('marine') ? { current: {}, hourly: {} } : weatherPayload, call);

    const body = JSON.parse(res.body);
    expect(body.ports[0].marine.current.waveHeight).toBeNull();
    expect(body.ports[0].marine.current.waveHeight).not.toBe(0);
  });

  it('keeps the other ports when one fails, and names the one it lost', async () => {
    const res = await withUpstream(async (url) => {
      if (url.includes('latitude=56.52')) throw new Error('Deadline exceeded');
      return answerBoth(url);
    }, call);

    const body = JSON.parse(res.body);
    expect(body.ports).toHaveLength(2);
    // Named rather than dropped, so a client can tell "Liepāja is missing" from
    // "Liepāja is calm".
    expect(body.unavailable).toEqual(['LVLPX']);
  });

  it('keeps a port whose land forecast failed but whose sea state arrived', async () => {
    // The asymmetry #143 established on the browser side, which moving the
    // fetch to the server would otherwise have undone. Under `Promise.all` a
    // single 500 from the forecast API rejected the pair and dropped the whole
    // port — so a run where the marine API answered perfectly returned no ports
    // at all, losing every card including the wave heights that had arrived.
    //
    // The sea state is the point of the card; the air temperature is context.
    const res = await withUpstream(async (url) => {
      if (!url.includes('marine')) throw new Error('HTTP 500 from forecast');
      return marinePayload;
    }, call);

    const body = JSON.parse(res.body);
    expect(body.ports, 'a land outage must not cost the sea state').toHaveLength(3);
    expect(body.unavailable).toEqual([]);
    expect(body.ports[0].marine.current.waveHeight).toBe(0.6);
    // Absent, and shaped as absent — `PortCard` reads it through `fixed()`.
    expect(body.ports[0].weather).toBeNull();
  });

  it('drops only the port whose sea state is missing', async () => {
    // The other half of the asymmetry: a marine failure leaves the card with
    // nothing to say, so that port goes — and only that port.
    const res = await withUpstream(async (url) => {
      if (url.includes('marine') && url.includes('latitude=57.4')) {
        throw new Error('Deadline exceeded');
      }
      return answerBoth(url);
    }, call);

    const body = JSON.parse(res.body);
    expect(body.ports).toHaveLength(2);
    expect(body.unavailable).toEqual(['LVVNT']);
  });

  it('fails rather than reporting an empty, becalmed coastline', async () => {
    const res = await withUpstream(async () => { throw new Error('Deadline exceeded'); }, call);
    expect(res.status).toBe(502);
  });
});

describe('the browser no longer talks to Open-Meteo', () => {
  const root = resolve(__dirname, '..');

  it('has no direct upstream fetch left anywhere in src/', async () => {
    // Structural rather than a search for the two hostnames that happen to be
    // in my head: any absolute URL passed to `fetch` is a call that bypasses
    // the proxy and therefore the cache, whoever it is to.
    const { globSync } = await import('node:fs');
    const files = [
      ...globSync('src/**/*.ts', { cwd: root }),
      ...globSync('src/**/*.tsx', { cwd: root }),
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf-8');
      // `fetch('https://...')` or fetch(`https://...`) — a same-origin `/api/...`
      // path is exactly what this is checking has not been bypassed.
      if (/fetch\(\s*[`'"]https?:\/\//.test(source)) offenders.push(file);
    }

    expect(offenders, `these fetch upstream directly: ${offenders.join(', ')}`).toEqual([]);
  });

  it('does not permit a connection to any upstream data host', () => {
    // The policy is what enforces this, not anyone remembering. A direct call
    // added later fails in development rather than quietly reintroducing an
    // uncacheable request on every page load.
    const config = JSON.parse(
      readFileSync(resolve(root, 'public/staticwebapp.config.json'), 'utf-8'));
    const csp: string = config.globalHeaders['Content-Security-Policy'];
    const connectSrc = /connect-src ([^;]+)/.exec(csp)![1];

    for (const host of [
      'open-meteo.com', 'ec.europa.eu', 'data.gov.lv', 'data.stat.gov.lv',
      'elering.ee', 'ecb.europa.eu', 'opendata.riga.lv',
    ]) {
      expect(connectSrc, `${host} is proxied and must not be reachable from the page`)
        .not.toContain(host);
    }

    // What the page legitimately still opens: itself, and the articles blob.
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('blob.core.windows.net');
  });
});
