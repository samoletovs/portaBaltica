/**
 * A partial weather payload must yield no insight, never a fabricated one.
 *
 * WHY THIS IS A SEPARATE SUITE FROM `aiInsightsUnavailable.test.ts`
 * ----------------------------------------------------------------
 * They are opposite failures of the same block, and neither subsumes the other:
 *
 *   #329 fixed   a failed fetch    -> the insight VANISHED      under-reporting
 *   this fixes   a partial payload -> the insight is FABRICATED over-reporting
 *
 * `#329` made a missing insight honest. It did nothing about an insight that
 * says something false, because the fetch succeeded and nothing threw.
 *
 * THE DEFECT
 * ----------
 * `var temp = wxCurrent.temperature_2m || 0` shipped until this change, beside
 * `var wind = wxCurrent.wind_speed_10m || 0`. Zero is not an implausible value
 * for either reading in Riga — it is the freezing point and a still day — and
 * both downstream branches waved it through: `temp < -10 || temp > 35` is false
 * at 0 so the level was `routine`, and `temp < 0` is false at 0 so the advice
 * was "Conditions within seasonal range." The rendered card was
 *
 *   Riga: 0°C, overcast — Wind 0 km/h. Conditions within seasonal range.
 *
 * a real, still, overcast winter day, published, with nothing anywhere saying a
 * field had been absent.
 *
 * It is the third time this substitution has been found against this same
 * upstream, after a fabricated calm sea and a fabricated clean-air reading. The
 * air-quality block 46 lines above already guards against it and carries three
 * sentences explaining why — which is exactly what kept this one hidden, per
 * AGENTS.md's "the correct sibling that conceals the broken one": a reader who
 * went to check whether this file understood the `|| 0` trap found the fixed
 * version and stopped.
 *
 * ON REACHABILITY
 * ---------------
 * Open-Meteo was **not** observed producing this payload: 6 of 6 live replies
 * carried a finite `temperature_2m`, and asking for an unknown variable returns
 * HTTP 400, which `jsonGet` rejects before the substitution is reached. The
 * defect is not that the upstream does this. It is that `wxData.current || {}`
 * on the preceding line already concedes `current` may be absent — so if it
 * cannot be, that guard is dead code, and if it can be, `|| 0` invents a
 * reading. The two lines contradicted each other with no appeal to the upstream,
 * and `jsonGet` accepts any 2xx that parses without checking the shape.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// `require` rather than `await import`, following #329 and countryParam.test.ts:
// these are untyped CommonJS, and a dynamic import of them fails `npm test`'s
// typecheck with TS7016. It also means the handler and the cache resolve to one
// module registry, so a single `clear()` is enough.
const cache = require('../api/shared/cache.js') as { clear: () => void };
const handler = require('../api/ai-insights/index.js') as
  (c: Ctx, r: unknown) => Promise<void>;

type Ctx = { res?: { status: number; body: string } };
type Payload = {
  insights: { headline: string; description: string; level: string }[];
  unavailable: { source: string; reason: string }[];
};

function fakeResponse(body: string) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
  res.statusCode = 200;
  res.resume = () => {};
  setTimeout(() => { res.emit('data', body); res.emit('end'); }, 0);
  return res;
}

function eleringBody() {
  const ts = Math.floor(Date.now() / 1000);
  const rows = [{ timestamp: ts, price: 42 }];
  return JSON.stringify({ data: { lv: rows, ee: rows, lt: rows } });
}

/**
 * Run the real handler with every upstream healthy except the weather one,
 * which serves `weatherBody`.
 *
 * Only weather varies. A fixture that restates the healthy world drifts from
 * it, and the point of each case below is one payload shape.
 */
async function runWithWeather(weatherBody: string): Promise<Payload> {
  // Cleared before every case. Without it the second case is answered from the
  // fifteen-minute memo and its assertion holds whatever the handler does — a
  // test that has stopped measuring rather than one that has broken.
  //
  // One `clear()` is enough here because the handler and the cache are both
  // loaded with `require`, so they resolve to a single module registry.
  // `tests/aiInsightsFanout.test.ts` clears through two handles for the reason
  // it records: it loads the endpoint with `await import` while the endpoint
  // requires the cache as CommonJS, and those need not be the same object.
  cache.clear();

  vi.spyOn(https, 'get').mockImplementation(((url: string, _o: unknown, cb: (r: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    const body = url.includes('elering') ? eleringBody()
      : url.includes('ecb.europa.eu') ? "<Cube currency='USD' rate='1.0850'/>"
        : url.includes('air-quality') ? JSON.stringify({ current: { european_aqi: 20, pm2_5: 4.2 } })
          : weatherBody;
    setTimeout(() => cb(fakeResponse(body)), 1);
    return req;
  }) as never);

  const context: Ctx = {};
  await handler(context, { query: { country: 'lv' } });
  return JSON.parse(context.res!.body) as Payload;
}

/** The weather card, if the handler produced one. */
const card = (p: Payload) => p.insights.find((i) => i.headline.startsWith('Riga:'));

const COMPLETE = JSON.stringify({
  current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 1 },
});

afterEach(() => vi.restoreAllMocks());

describe('an absent temperature produces no card', () => {
  // Every shape that reaches the substitution: `current` missing entirely, a
  // `current` with nothing in it, an explicit null, and the field simply not
  // sent. `undefined || 0` and `null || 0` are both 0, so all four rendered
  // "0°C" before this change.
  const PARTIAL: [string, string][] = [
    ['no current key at all', JSON.stringify({ latitude: 56.95, longitude: 24.11 })],
    ['an empty current', JSON.stringify({ current: {} })],
    ['an explicit null', JSON.stringify({ current: { temperature_2m: null, wind_speed_10m: null } })],
    ['wind and code but no temperature', JSON.stringify({ current: { wind_speed_10m: 12, weather_code: 3 } })],
  ];

  for (const [label, body] of PARTIAL) {
    it(`emits no weather insight for ${label}`, async () => {
      const p = await runWithWeather(body);
      expect(card(p), 'a card was fabricated from a payload with no temperature').toBeUndefined();
    });

    it(`never prints a fabricated 0 for ${label}`, async () => {
      // Asserted on the rendered text as well as on the card's absence. The
      // absence check alone passes for a handler that emits the card under a
      // headline this helper does not recognise, and the whole defect is that
      // the fabricated card looked exactly like a real one.
      const p = await runWithWeather(body);
      const rendered = p.insights.map((i) => i.headline + ' ' + i.description).join(' | ');
      expect(rendered).not.toMatch(/0\s*°C/);
      expect(rendered).not.toMatch(/Wind 0 km\/h/);
    });

    it(`says the weather source was unavailable for ${label}`, async () => {
      // Fixing a fabrication must not quietly convert it into the silent vanish
      // #329 just removed. Reuses that field and its existing string rather
      // than adding a second vocabulary for the same fact.
      const p = await runWithWeather(body);
      expect(p.unavailable.map((u) => u.source)).toContain('weather');
    });
  }
});

describe('the positive control: a complete payload still produces a real card', () => {
  it('reports the temperature it was given', async () => {
    // Load-bearing. Every assertion above is of the form "no card" or "no
    // zero", and a handler that emitted no weather insight ever would pass all
    // of them. This is the case that stops it.
    const p = await runWithWeather(COMPLETE);
    const c = card(p);

    expect(c, 'a complete payload must still produce an insight').toBeDefined();
    expect(c!.headline).toBe('Riga: 17°C, mainly clear');
    expect(c!.description).toContain('Wind 12 km/h');
    expect(p.unavailable.map((u) => u.source), 'nothing was lost').not.toContain('weather');
  });

  it('still reports a genuine 0°C, which is a reading rather than an absence', async () => {
    // The sharp edge of this fix, and the reason `num()` tests the type rather
    // than truthiness. Zero is a real Riga temperature; suppressing it would
    // trade a fabricated reading for a discarded one, which is the same class
    // of error pointing the other way.
    const p = await runWithWeather(JSON.stringify({
      current: { temperature_2m: 0, wind_speed_10m: 0, weather_code: 3 },
    }));
    const c = card(p);

    expect(c, 'a measured zero is an observation and must survive').toBeDefined();
    expect(c!.headline).toBe('Riga: 0°C, overcast');
    expect(c!.description).toContain('Wind 0 km/h');
    expect(p.unavailable.map((u) => u.source)).not.toContain('weather');
  });
});

describe('a missing wind does not discard a temperature we hold', () => {
  it('keeps the card and states that the wind is unavailable', async () => {
    // The over-correction control. Dropping the whole card whenever any field
    // is absent would satisfy every assertion in the first block and lose a
    // temperature that arrived perfectly well. The air-quality block 46 lines
    // above makes the same split: it prints "PM2.5 unavailable." and still
    // reports its band.
    const p = await runWithWeather(JSON.stringify({
      current: { temperature_2m: 17, weather_code: 1 },
    }));
    const c = card(p);

    expect(c, 'the temperature was present and is worth reporting').toBeDefined();
    expect(c!.headline).toBe('Riga: 17°C, mainly clear');
    expect(c!.description).toContain('Wind unavailable');
    expect(c!.description).not.toMatch(/Wind 0 km\/h/);
    expect(p.unavailable.map((u) => u.source), 'the source answered; only one field of it was empty')
      .not.toContain('weather');
  });

  it('still raises severity on a high wind', async () => {
    // Pins that the wind term is wired at all. Deliberately not asserted the
    // other way round: `wind !== null && wind > 80` and the bare `wind > 80` it
    // replaces are behaviourally identical, because `null > 80` is already
    // false — so a case with an absent wind returns `routine` under both
    // spellings and could not fail whichever is shipped.
    const p = await runWithWeather(JSON.stringify({
      current: { temperature_2m: 8, wind_speed_10m: 92, weather_code: 3 },
    }));
    expect(card(p)!.level).toBe('significant');
  });
});
