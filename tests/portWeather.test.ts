/**
 * Two live-data defects that were reported and neither diagnosed, plus the
 * coercion underneath one of them.
 *
 * **The sea state and the air temperature came from different endpoints and
 * were joined with `Promise.all`.** `fetchAllWeather` used `allSettled`
 * *between* ports, which reads as resilient, but the pair inside one port was
 * all-or-nothing across two independent Open-Meteo services. Measured: the
 * forecast endpoint 500s, the marine endpoint answers perfectly, and the call
 * returns **zero ports** — every card lost, including the wave heights that
 * arrived.
 *
 * `PortCard` was already written for this. It reads `weather?.temperature`
 * through `fixed()`, which renders an em dash, and its comment explains why.
 * The component handled the case the fetch layer made impossible.
 *
 * **And the coercion is the sharper fault.** `wave_height ?? 0` made
 * `classifySeaState`'s "unknown" branch unreachable through the only path that
 * calls it: a payload missing the field arrived as `0`, and 0 m is not absence,
 * it is the calmest band on the WMO scale. A reading we never received rendered
 * as "Calm" in the colour that means the sea is fine — the same shape as #131,
 * in a file #131 did not reach.
 *
 * WHERE THIS LOGIC NOW LIVES
 * --------------------------
 * Both fixes still hold, but the fetch they were made in has moved. The browser
 * used to call Open-Meteo directly — two requests per port, three ports, on
 * every load of `/data`, for fixed coordinates, from every visitor
 * independently — and it now reads `/api/sea-state`, which answers all three
 * from one cached response.
 *
 * So these cases now drive the endpoint that performs the rules and check that
 * the dashboard still receives the shape they produce. Rewritten rather than
 * deleted: the assertions are about behaviour the site must keep, and behaviour
 * does not stop mattering because the code that implements it moved. The
 * asymmetry's own cases sit beside its implementation in
 * `tests/seaStateEndpoint.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fetchAllWeather } from '../src/api';
import { PORTS, classifySeaState } from '../src/types';

const require = createRequire(import.meta.url);
const seaState = require('../api/sea-state/index.js');
const cache = require('../api/shared/cache.js');
const rateLimit = require('../api/shared/rateLimit.js');
const es = require('../api/shared/eurostat.js');

const MARINE = {
  current: {
    wave_height: 0.6, wave_direction: 240, wave_period: 4,
    sea_surface_temperature: 17.2, wind_wave_height: 0.4, swell_wave_height: 0.3,
  },
  hourly: { time: ['2026-08-27T00:00'], wave_height: [0.6], sea_surface_temperature: [17.2] },
};

const LAND = {
  current: {
    temperature_2m: 19.4, wind_speed_10m: 12, wind_direction_10m: 200,
    cloud_cover: 40, precipitation: 0,
  },
};

/** Run the real endpoint against a routed upstream and return its parsed body. */
async function seaStateBody(upstream: (url: string) => Promise<unknown>) {
  const original = es.httpJson;
  es.httpJson = upstream;
  try {
    const context: { res?: { status: number; body: string } } = {};
    await seaState(context, { query: {}, headers: {} });
    return { status: context.res!.status, body: JSON.parse(context.res!.body) };
  } finally {
    es.httpJson = original;
  }
}

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchAllWeather', () => {
  it('hands the dashboard a port whose land forecast failed, rather than nothing', async () => {
    // The defect returned 0 ports. The sea state arrived for all three and was
    // thrown away because a different service, answering a different question,
    // was down.
    const { body } = await seaStateBody(async (url) => {
      if (!String(url).includes('marine')) throw new Error('HTTP 500 from forecast');
      return MARINE;
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => body,
    } as unknown as Response)));

    const got = await fetchAllWeather();

    expect(got, 'a land-forecast outage must not cost the sea state').toHaveLength(PORTS.length);
    for (const entry of got) {
      expect(entry.marine.current.waveHeight).toBe(0.6);
      expect(entry.weather, 'the absent forecast is null, not a zeroed one').toBeNull();
    }
  });

  it('reads one endpoint rather than two per port', async () => {
    // Six cross-origin calls per dashboard load became one. The ports are fixed
    // coordinates, so every visitor was fetching the same six payloads.
    const requested: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return {
        ok: true, status: 200,
        json: async () => ({ ports: [], unavailable: [], source: 'Open-Meteo', fetchedAt: '' }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchAllWeather();

    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/sea-state');
  });

  it('returns both readings when both services answer', async () => {
    const { body } = await seaStateBody(async (url) =>
      String(url).includes('marine') ? MARINE : LAND);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => body,
    } as unknown as Response)));

    const got = await fetchAllWeather();
    expect(got).toHaveLength(PORTS.length);
    expect(got[0].weather?.temperature).toBe(19.4);
  });
});

describe('an absent reading is absent, not zero', () => {
  it('does not report a missing wave height as a calm sea', async () => {
    const { body } = await seaStateBody(async (url) =>
      String(url).includes('marine') ? { current: {}, hourly: {} } : LAND);

    const waveHeight = body.ports[0].marine.current.waveHeight;

    expect(waveHeight, 'a field Open-Meteo omitted is null').toBeNull();
    // The whole point: this is what the card asks, and 0 would answer "calm".
    expect(
      classifySeaState(waveHeight),
      'an unreceived reading must classify as unknown, not as the calmest band'
    ).toBeNull();
    expect(
      classifySeaState(0),
      'zero is a real sea state, which is why it cannot stand in for absence'
    ).toBe('calm');
  });

  it('does not report a missing air temperature as zero degrees', async () => {
    const { body } = await seaStateBody(async (url) =>
      String(url).includes('marine') ? MARINE : { current: {} });

    // 0 °C is an ordinary Latvian winter reading. It cannot mean "we do not
    // know" as well as meaning itself.
    const weather = body.ports[0].weather;
    expect(weather.temperature).toBeNull();
    expect(weather.windSpeed).toBeNull();
    expect(weather.cloudCover).toBeNull();
  });

  it('passes a real zero through untouched', async () => {
    const { body } = await seaStateBody(async (url) =>
      String(url).includes('marine')
        ? MARINE
        : { current: { temperature_2m: 0, wind_speed_10m: 0 } });

    // Guarding the guard: a fix that turned every zero into null would trade
    // one wrong answer for another.
    const weather = body.ports[0].weather;
    expect(weather.temperature).toBe(0);
    expect(weather.windSpeed).toBe(0);
  });
});
