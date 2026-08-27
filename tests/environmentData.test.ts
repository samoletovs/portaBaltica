/**
 * `/api/environment-data` used to invent readings.
 *
 * When the air-quality fetch failed, the catch returned
 * `{ pm25: 0, no2: 0, status: 'good', label: 'Good' }` — a clean-air reading
 * manufactured out of a request that never completed, rendered in the same
 * green, in the same shape, as a real one. `current.pm2_5 || 0` did the same
 * thing more quietly whenever a field was missing, and `current.temperature_2m
 * || 0` turned an absent temperature into 0°C, which in Latvia reads as an
 * ordinary winter day rather than as an error.
 *
 * This is the rule the repo already applies to registry counts, which are
 * omitted rather than shown as a fabricated zero. It just had not been applied
 * here.
 *
 * The endpoint was also measured at 22,031ms and 20,326ms cold against 1,105ms
 * warm, with the fan-out already fully parallel: its local `httpGet` armed only
 * a socket idle timer, which is the flaw `shared/eurostat.js` documents fixing
 * and which lets a stalled connection outlive its stated budget.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Weather and air quality are memoised now, and the store is process-global —
// so without this every test after the first would be served the first one's
// answer, which is the cache working exactly as intended and useless for
// isolating a case.
beforeEach(() => require('../api/shared/cache.js').clear());

/** Drive the handler with a stubbed HTTP layer. */
async function callEnvironment(responder: (url: string) => Promise<unknown>) {
  const es = require('../api/shared/eurostat.js');
  const original = es.httpJson;
  es.httpJson = (url: string) => responder(url);
  try {
    delete require.cache[require.resolve('../api/environment-data/index.js')];
    const handler = require('../api/environment-data/index.js');
    const ctx: { res?: { body: string; status: number } } = {};
    await handler(ctx, { query: { country: 'lv' }, headers: {} });
    return JSON.parse(ctx.res!.body);
  } finally {
    es.httpJson = original;
  }
}

const weatherOk = {
  current: { temperature_2m: 18.4, wind_speed_10m: 12, relative_humidity_2m: 61, weather_code: 0 },
};
const airOk = { current: { pm2_5: 7.3, nitrogen_dioxide: 11.2, european_aqi: 24 } };

function route(over: { air?: unknown; airThrows?: boolean; weatherThrows?: boolean } = {}) {
  return async (url: string) => {
    if (url.includes('air-quality')) {
      if (over.airThrows) throw new Error('Deadline 6000ms exceeded');
      return over.air ?? airOk;
    }
    if (url.includes('open-meteo.com/v1/forecast')) {
      if (over.weatherThrows) throw new Error('Deadline 6000ms exceeded');
      return weatherOk;
    }
    // Eurostat population.
    return { value: {}, id: [], dimension: {} };
  };
}

describe('air quality', () => {
  it('reports a real reading normally', async () => {
    const body = await callEnvironment(route());
    expect(body.airQuality).toMatchObject({
      pm25: 7.3, no2: 11.2, aqi: 24, status: 'good', label: 'Good', available: true,
    });
  });

  it('never reports "Good" for a reading it could not take', async () => {
    // The whole point. A failed request is not clean air.
    const body = await callEnvironment(route({ airThrows: true }));

    expect(body.airQuality.available).toBe(false);
    expect(body.airQuality.status).toBeNull();
    expect(body.airQuality.label).toBeNull();
    expect(body.airQuality.pm25).toBeNull();
    expect(body.airQuality.no2).toBeNull();
    expect(body.airQuality.unavailableReason).toMatch(/Deadline/);
  });

  it('does not turn a missing pollutant into a zero concentration', async () => {
    // `current.pm2_5 || 0` reported "0.0 µg/m³" — a perfect reading — for a
    // field the API had not sent.
    const body = await callEnvironment(route({ air: { current: { european_aqi: 30 } } }));

    expect(body.airQuality.pm25).toBeNull();
    expect(body.airQuality.no2).toBeNull();
    expect(body.airQuality.status, 'the AQI itself was present').toBe('good');
  });

  it('is unavailable when the AQI is absent, even though the call succeeded', async () => {
    const body = await callEnvironment(route({ air: { current: {} } }));
    expect(body.airQuality.available).toBe(false);
    expect(body.airQuality.status).toBeNull();
  });

  it('grades a real reading by its band', async () => {
    const cache = require('../api/shared/cache.js');
    const moderate = await callEnvironment(route({ air: { current: { european_aqi: 70 } } }));
    expect(moderate.airQuality.label).toBe('Moderate');

    // Two readings in one case, so the memo has to be cleared between them —
    // otherwise the second is served the first, which is the cache doing its
    // job and hiding what this test is here to check.
    cache.clear();
    const bad = await callEnvironment(route({ air: { current: { european_aqi: 140 } } }));
    expect(bad.airQuality.label).toBe('Unhealthy');
  });
});

describe('weather', () => {
  it('always sends a weather key, and says how many cities are missing', async () => {
    // A response that omitted `weather` entirely, or shipped a silently short
    // list, left the client unable to tell an outage from a small country.
    const body = await callEnvironment(route({ weatherThrows: true }));

    expect(Array.isArray(body.weather)).toBe(true);
    expect(body.weather).toHaveLength(0);
    expect(body.weatherCoverage.reporting).toBe(0);
    expect(body.weatherCoverage.missing).toBe(body.weatherCoverage.requested);
    expect(body.weatherCoverage.requested).toBeGreaterThan(0);
  });

  it('reports full coverage when every city answers', async () => {
    const body = await callEnvironment(route());
    expect(body.weatherCoverage.missing).toBe(0);
    expect(body.weatherCoverage.reporting).toBe(body.weatherCoverage.requested);
    expect(body.weather[0]).toMatchObject({ temperature: 18.4, description: 'Clear sky' });
  });

  it('does not turn a missing temperature into 0°C', async () => {
    const body = await callEnvironment(async (url: string) => {
      if (url.includes('air-quality')) return airOk;
      if (url.includes('open-meteo.com/v1/forecast')) return { current: {} };
      return { value: {}, id: [], dimension: {} };
    });

    expect(body.weather[0].temperature).toBeNull();
    expect(body.weather[0].windSpeed).toBeNull();
    expect(body.weather[0].description).toBeNull();
  });
});

describe('the HTTP client', () => {
  it('uses the shared deadline-bounded helper, not a socket idle timer', () => {
    // The 22-second cold path. `{ timeout: 10000 }` on a raw `https.get` only
    // fires when a connection goes quiet; a source that accepts and then
    // stalls holds the request open far past its stated budget.
    const source = require('node:fs').readFileSync(
      require('node:path').resolve('api/environment-data/index.js'), 'utf8');

    expect(source, 'must not hand-roll an HTTP client').not.toMatch(/https\.get\(|lib\.get\(/);
    expect(source, 'must use the shared client').toMatch(/es\.httpJson\(/);
    expect(source, 'every call needs a hard deadline').toMatch(/deadlineMs/);
  });
});
