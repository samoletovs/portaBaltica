/**
 * The `country` parameter, read one way across the whole API.
 *
 * **The API disagreed with itself about case.** `/api/port-data` upper-cased
 * the parameter and keyed maps of `LV|EE|LT`; `/api/economy-data`,
 * `/api/ai-insights` and `/api/environment-data` did not normalise at all and
 * keyed maps of `lv|ee|lt`. The same value was therefore correct on one
 * endpoint and wrong on three.
 *
 * What made it costly was the fallback rather than the mismatch. Every lookup
 * ended `|| 'lv'` or `|| CITIES_BY_COUNTRY.lv`, so an unrecognised country did
 * not fail — **it returned Latvia**:
 *
 *   var zone = zoneMap[country] || 'lv';   // zoneMap['EE'] is undefined
 *
 * `?country=EE` therefore served Latvia's electricity market under an Estonian
 * heading, and Riga's weather, air quality and population with it. Every figure
 * real, every figure the wrong country's — the class that has cost this project
 * the most, and one no numeric check can see.
 *
 * It is also invisible to exactly the readers who would notice, because Latvian
 * readers see correct data.
 *
 * The equality assertions below are the ones that matter: comparing two
 * countries' payloads is the only cheap thing that catches a silent default.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const countries = require('../api/shared/country.js');

describe('the country parameter is read one way', () => {
  it('accepts either case', () => {
    for (const raw of ['lv', 'LV', 'Lv', ' lv ', 'EE', 'ee', 'LT', 'lt']) {
      const code = countries.normaliseCountry(raw);
      expect(code, `${raw} was rejected`).not.toBeNull();
      expect(code, `${raw} did not normalise to lower case`).toBe(raw.trim().toLowerCase());
    }
  });

  it('defaults only when nothing was asked for', () => {
    // A bare `/api/economy-data` is a legitimate request for the default view.
    for (const nothing of [undefined, null, '']) {
      expect(countries.normaliseCountry(nothing)).toBe('lv');
    }
  });

  it('refuses an unknown country rather than returning Latvia', () => {
    // The whole defect in one assertion. `|| 'lv'` answered every one of these
    // with Latvia's data under the caller's heading.
    for (const unknown of ['XX', 'FI', 'ru', 'lv1', '../lv', 0, {}, []]) {
      expect(
        countries.normaliseCountry(unknown as never),
        `${String(unknown)} was silently accepted`,
      ).toBeNull();
    }
  });

  it('offers a 400 that names what it expected', () => {
    const res = countries.badCountry('XX');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/lv, ee, lt/);
    expect(JSON.parse(res.body).error).toMatch(/case-insensitive/);
  });
});

describe('every country-aware endpoint reads it through the same function', () => {
  const sources: [string, string][] = [
    ['economy-data', 'api/economy-data/index.js'],
    ['ai-insights', 'api/ai-insights/index.js'],
    ['environment-data', 'api/environment-data/index.js'],
    ['port-data', 'api/port-data/index.js'],
  ];

  for (const [name, path] of sources) {
    it(`${name} normalises rather than keying on the raw parameter`, () => {
      const src = require('node:fs').readFileSync(path, 'utf8');
      expect(src, `${name} still reads the raw query value`).toMatch(/normaliseCountry/);
      // The specific idiom that produced the fault: a map lookup that falls
      // back to a country instead of failing. Allowed in a comment, since the
      // files document what they used to do.
      const code = src.split('\n').filter((l: string) => !l.trim().startsWith('*')
        && !l.trim().startsWith('//')).join('\n');
      expect(code, `${name} still defaults a missed lookup to Latvia`)
        .not.toMatch(/\|\|\s*'lv'/);
      expect(code, `${name} still defaults a missed lookup to Latvia`)
        .not.toMatch(/\|\|\s*\w+\.lv\b/);
    });
  }

  it('no endpoint keys an upstream payload on an unnormalised value', () => {
    const src = require('node:fs').readFileSync('api/economy-data/index.js', 'utf8');
    // Elering's zone keys are lower case — measured: ['ee','fi','lv','lt'] —
    // so `data.data['LV']` was undefined and `|| []` swallowed it, and the
    // endpoint returned an empty price series for every upper-case request.
    expect(src).toMatch(/data\.data\[zone\]/);
    expect(src, 'the zone must be normalised before it keys the payload')
      .toMatch(/const zone = country\.normaliseCountry/);
  });
});

describe('two countries never return the same payload', () => {
  /**
   * The assertion that actually catches a silent default.
   *
   * A test that only checks "EE returns something" passes while EE is being
   * served Latvia. Comparing two countries is cheap and is the only thing that
   * distinguishes "answered" from "answered correctly".
   *
   * Driven through the real handler with a stubbed upstream, because the fault
   * was in how the handler picked a coordinate, not in the fetch.
   */
  async function citiesFor(query: Record<string, string>) {
    const events = await import('node:events');
    const https = (await import('node:https')).default;
    const { vi } = await import('vitest');

    // `EventEmitter` arrives here as a value from a dynamic import, so it is
    // not usable as a type name — hence the loose shapes below rather than
    // `as EventEmitter & { … }`, which typechecks nowhere and which `npm test`
    // now catches because it runs `tsc` before vitest.
    const spy = vi.spyOn(https, 'get').mockImplementation(((
      _url: string, _o: unknown, cb: (r: unknown) => void,
    ) => {
      const req = new events.EventEmitter() as unknown as { destroy: () => void };
      req.destroy = () => {};
      setTimeout(() => {
        // Built inside the callback, not before it: emitting `data` before the
        // consumer has attached its listeners drops the body on the floor and
        // the request hangs to its deadline. That cost one 5012ms test run.
        const res = new events.EventEmitter();
        const typed = res as unknown as { statusCode: number; resume: () => void };
        typed.statusCode = 200;
        typed.resume = () => {};
        cb(res);
        res.emit('data', JSON.stringify({
          current: { temperature_2m: 4, wind_speed_10m: 3, weather_code: 1, pm2_5: 5, european_aqi: 22 },
        }));
        res.emit('end');
      }, 0);
      return req;
    }) as never);

    try {
      const handler = require('../api/environment-data/index.js');
      const ctx: { res?: { body: string; status: number } } = {};
      await handler(ctx, { headers: {}, query });
      return JSON.parse(ctx.res!.body);
    } finally { spy.mockRestore(); }
  }

  it('gives Estonia Tallinn and Latvia Riga, whichever case is asked for', async () => {
    const ee = await citiesFor({ country: 'EE' });
    const lv = await citiesFor({ country: 'LV' });

    const eeCities = (ee.weather ?? []).map((c: { city: string }) => c.city);
    const lvCities = (lv.weather ?? []).map((c: { city: string }) => c.city);

    expect(eeCities.length, 'Estonia reported no cities').toBeGreaterThan(0);
    expect(eeCities, 'upper-case EE was served Latvia').not.toEqual(lvCities);
    expect(eeCities).toContain('Tallinn');
    expect(lvCities).toContain('Riga');
  });

  it('rejects an unknown country instead of answering with Latvia', async () => {
    const handler = require('../api/environment-data/index.js');
    const ctx: { res?: { body: string; status: number } } = {};
    await handler(ctx, { headers: {}, query: { country: 'XX' } });
    expect(ctx.res!.status).toBe(400);
    expect(JSON.parse(ctx.res!.body).error).toMatch(/Unknown country/);
  });
});
