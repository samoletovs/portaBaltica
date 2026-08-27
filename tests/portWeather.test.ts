/**
 * Two live-data defects that were reported and neither diagnosed, plus the
 * coercion underneath one of them.
 *
 * **The sea state and the air temperature came from different endpoints and
 * were joined with `Promise.all`.** `fetchAllWeather` uses `allSettled`
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
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAllWeather, fetchMarineWeather, fetchPortWeather } from '../src/api';
import { PORTS, classifySeaState } from '../src/types';

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

/** Routes by URL, so the two endpoints can fail independently. */
function route(opts: { marineOk?: boolean; landOk?: boolean }) {
  return vi.fn(async (url: string) => {
    const marine = String(url).includes('marine');
    const ok = marine ? opts.marineOk !== false : opts.landOk !== false;
    if (!ok) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => (marine ? MARINE : LAND) } as unknown as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllWeather', () => {
  it('keeps every port when the land forecast fails and the marine call does not', async () => {
    vi.stubGlobal('fetch', route({ landOk: false }));

    const got = await fetchAllWeather();

    // The defect returned 0. The sea state arrived for all three and was thrown
    // away because a different service, answering a different question, was
    // down.
    expect(got, 'a land-forecast outage must not cost the sea state').toHaveLength(PORTS.length);
    for (const entry of got) {
      expect(entry.marine.current.waveHeight).toBe(0.6);
      expect(entry.weather, 'the absent forecast is null, not a zeroed one').toBeNull();
    }
  });

  it('still drops a port whose sea state is missing, because that card has nothing to say', async () => {
    vi.stubGlobal('fetch', route({ marineOk: false }));

    // Asymmetric on purpose: the marine reading is the subject of the card and
    // the land forecast is context beside it. "Resilient" does not mean
    // rendering a port card with no port conditions in it.
    expect(await fetchAllWeather()).toHaveLength(0);
  });

  it('returns both when both answer', async () => {
    vi.stubGlobal('fetch', route({}));

    const got = await fetchAllWeather();
    expect(got).toHaveLength(PORTS.length);
    expect(got[0].weather?.temperature).toBe(19.4);
  });
});

describe('an absent reading is absent, not zero', () => {
  it('does not report a missing wave height as a calm sea', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ current: {}, hourly: {} }),
    } as unknown as Response)));

    const marine = await fetchMarineWeather(PORTS[0]);

    expect(marine.current.waveHeight, 'a field Open-Meteo omitted is null').toBeNull();
    // The whole point: this is what the card asks, and 0 would answer "calm".
    expect(
      classifySeaState(marine.current.waveHeight),
      'an unreceived reading must classify as unknown, not as the calmest band'
    ).toBeNull();
    expect(classifySeaState(0), 'zero is a real sea state, which is why it cannot stand in for absence').toBe('calm');
  });

  it('does not report a missing air temperature as zero degrees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ current: {} }),
    } as unknown as Response)));

    const weather = await fetchPortWeather(PORTS[0]);

    // 0 °C is an ordinary Latvian winter reading. It cannot mean "we do not
    // know" as well as meaning itself.
    expect(weather.temperature).toBeNull();
    expect(weather.windSpeed).toBeNull();
    expect(weather.cloudCover).toBeNull();
  });

  it('passes a real zero through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ current: { temperature_2m: 0, wind_speed_10m: 0 } }),
    } as unknown as Response)));

    const weather = await fetchPortWeather(PORTS[0]);

    // Guarding the guard: a fix that turned every zero into null would trade
    // one wrong answer for another.
    expect(weather.temperature).toBe(0);
    expect(weather.windSpeed).toBe(0);
  });
});
