/**
 * The air-quality band, checked against the scale it claims to implement.
 *
 * This component already has a chapter in DESIGN.md §3.8 for inventing a
 * clean-air reading when the fetch failed. It turns out that even when the
 * fetch *succeeded* the label still flattered the air: we fetch Open-Meteo's
 * `european_aqi`, which is the EEA/CAMS index in six bands at 20/40/60/80/100,
 * and banded it at **50 and 100** — the US EPA's breakpoints — into Good /
 * Moderate / Unhealthy. "Unhealthy" is an EPA word; the European scale has no
 * such band.
 *
 * Measured over 6696 hourly readings from Riga, Tallinn and Vilnius across 92
 * days: **76.1% named the air better than the European scale does, and 0.0%
 * named it worse.** 5050 readings the EEA rates *Fair* were called "Good".
 *
 * A scale that only ever errs towards reassurance is worse than one that errs
 * both ways, because nothing about it ever looks alarming enough to check.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const airQuality = require('../api/shared/airQuality.js');

/**
 * The European Air Quality Index as the EEA publishes it.
 *
 * A table rather than a chain of assertions, so the scale itself is the
 * specification and a band cannot be quietly renamed without editing the thing
 * that documents it.
 */
const EAQI = [
  { band: 1, name: 'Good', status: 'good', from: 0, to: 20 },
  { band: 2, name: 'Fair', status: 'fair', from: 20, to: 40 },
  { band: 3, name: 'Moderate', status: 'moderate', from: 40, to: 60 },
  { band: 4, name: 'Poor', status: 'poor', from: 60, to: 80 },
  { band: 5, name: 'Very poor', status: 'very-poor', from: 80, to: 100 },
  { band: 6, name: 'Extremely poor', status: 'extremely-poor', from: 100, to: 200 },
] as const;

describe('the index is banded the way the EEA bands it', () => {
  for (const b of EAQI) {
    it(`calls ${b.from}-${b.to} "${b.name}" (band ${b.band})`, () => {
      // Just inside the upper bound, and just above the lower one: the bounds
      // are where an off-by-one lives, and the boundary value belongs to the
      // band below it.
      expect(airQuality.classifyEuropeanAqi(b.to - 0.5)?.label).toBe(b.name);
      expect(airQuality.classifyEuropeanAqi(b.from + 0.5)?.label).toBe(b.name);
      expect(airQuality.classifyEuropeanAqi(b.to - 0.5)?.status).toBe(b.status);
      expect(airQuality.classifyEuropeanAqi(b.to - 0.5)?.rank).toBe(b.band);
    });
  }

  it('puts each boundary in the lower band, as the EEA does', () => {
    expect(airQuality.classifyEuropeanAqi(20)?.label).toBe('Good');
    expect(airQuality.classifyEuropeanAqi(40)?.label).toBe('Fair');
    expect(airQuality.classifyEuropeanAqi(60)?.label).toBe('Moderate');
    expect(airQuality.classifyEuropeanAqi(80)?.label).toBe('Poor');
    expect(airQuality.classifyEuropeanAqi(100)?.label).toBe('Very poor');
  });

  it('does not use an American band on a European index', () => {
    // The three specific readings that made this measurable. Each was called
    // "Good" by the old scale because each is below the EPA's 50.
    expect(airQuality.classifyEuropeanAqi(29)?.label).toBe('Fair');
    expect(airQuality.classifyEuropeanAqi(45)?.label).toBe('Moderate');
    expect(airQuality.classifyEuropeanAqi(70)?.label).toBe('Poor');

    const labels = airQuality.EAQI_BANDS.map((b: { label: string }) => b.label);
    expect(labels, '"Unhealthy" is an EPA word').not.toContain('Unhealthy');
    expect(airQuality.BAND_COUNT).toBe(6);
  });

  it('reads the whole measured Baltic range', () => {
    // Min and max actually observed across the three capitals: 10 and 57.
    for (const v of [10, 24, 29, 45, 53, 57]) {
      expect(airQuality.classifyEuropeanAqi(v), `no band for ${v}`).not.toBeNull();
    }
  });
});

describe('absence is not a clean-air reading', () => {
  it('returns null rather than the best band', () => {
    // The original defect: a failed fetch returned `status: 'good'`. And in
    // `ai-insights`, `european_aqi || 0` turned a missing field into 0, which
    // lands in the cleanest band there is.
    for (const absent of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY, '24', {}, []]) {
      expect(airQuality.classifyEuropeanAqi(absent as never),
        `${String(absent)} was given a band`).toBeNull();
    }
  });

  it('refuses a negative index, which the scale has no room for', () => {
    expect(airQuality.classifyEuropeanAqi(-1)).toBeNull();
  });
});

describe('both endpoints read the same scale', () => {
  const insights = readFileSync(resolve('api/ai-insights/index.js'), 'utf8');
  const environment = readFileSync(resolve('api/environment-data/index.js'), 'utf8');

  it('neither carries its own copy of the thresholds', () => {
    // They each had one, with the same wrong numbers, so fixing one would have
    // left the other quietly disagreeing.
    for (const [name, src] of [['ai-insights', insights], ['environment-data', environment]]) {
      expect(src, `${name} still bands the AQI itself`).not.toMatch(/aqi\s*>\s*(50|100)/);
      expect(src, `${name} does not use the shared classifier`)
        .toMatch(/classifyEuropeanAqi/);
    }
  });

  it('does not fabricate an index of zero from a missing field', () => {
    // Textual, as a second line of defence — the behavioural version lives in
    // "the insight card never invents an index" below, which is what actually
    // binds. This only catches the specific idiom.
    expect(insights, 'european_aqi || 0 bands as the cleanest air there is')
      .not.toMatch(/european_aqi\s*\|\|\s*0/);
    expect(insights).not.toMatch(/pm2_5\s*\|\|\s*0/);
  });

  it('compares PM2.5 against the WHO guideline it prints, not against the index', () => {
    // The old line asserted "Well below WHO guidelines" from the AQI band while
    // printing a PM2.5 figure beside it. Sampled over 6696 paired readings,
    // PM2.5 exceeded the WHO 24-hour guideline eight times — and on all eight
    // the line still read "Well below WHO guidelines", printing 16.9 µg/m³ and
    // calling it well below 15.
    expect(insights).not.toMatch(/Well below WHO guidelines/);
    expect(insights, 'the guideline must be a named figure').toMatch(/WHO_PM25_24H\s*=\s*15/);
    expect(insights, 'and compared against the printed value')
      .toMatch(/pm25\s*>\s*WHO_PM25_24H/);
  });
});

describe('the insight card never invents an index', () => {
  /** Drive the real handler with a stubbed upstream, as the fan-out test does. */
  async function insightsWith(airCurrent: Record<string, unknown>) {
    const { EventEmitter } = await import('node:events');
    const https = (await import('node:https')).default;

    const fakeResponse = (body: string) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
      res.statusCode = 200;
      res.resume = () => {};
      setTimeout(() => { res.emit('data', body); res.emit('end'); }, 0);
      return res;
    };

    const spy = vi.spyOn(https, 'get').mockImplementation(((url: string, _o: unknown, cb: (r: unknown) => void) => {
      const ts = Math.floor(Date.now() / 1000);
      const body = url.includes('elering')
        ? JSON.stringify({ data: { lv: [{ timestamp: ts, price: 42 }], ee: [{ timestamp: ts, price: 42 }] } })
        : url.includes('ecb.europa.eu') ? "<Cube currency='USD' rate='1.0850'/>"
          : url.includes('air-quality') ? JSON.stringify({ current: airCurrent })
            : JSON.stringify({ current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 1 } });
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      setTimeout(() => cb(fakeResponse(body)), 0);
      return req;
    }) as never);

    try {
      const mod = await import('../api/ai-insights/index.js');
      const handler = (mod as { default?: unknown }).default ?? mod;
      const context: { res?: { body: string } } = {};
      await (handler as (c: unknown, r: unknown) => Promise<void>)(context, { query: { country: 'lv' } });
      const parsed = JSON.parse(context.res!.body) as { insights: { headline: string; description: string }[] };
      return parsed.insights.filter((i) => /air quality/i.test(i.headline));
    } finally { spy.mockRestore(); }
  }

  it('says nothing at all when the index is missing', async () => {
    // `european_aqi || 0` turned an absent field into 0, which is the cleanest
    // band there is — so a missing reading was announced as perfect air. The
    // card must simply not appear.
    const cards = await insightsWith({ pm2_5: 4.2 });
    expect(cards).toHaveLength(0);
  });

  it('names the European band, not the American one', async () => {
    const cards = await insightsWith({ european_aqi: 45, pm2_5: 9 });
    expect(cards).toHaveLength(1);
    // 45 is EEA "Moderate". The old scale called it "Good", because 45 < 50.
    expect(cards[0].headline).toMatch(/Moderate/);
    expect(cards[0].headline).not.toMatch(/Good/);
  });

  it('does not call a PM2.5 above the WHO guideline "well below" it', async () => {
    // Measured: on all eight occasions PM2.5 exceeded 15 µg/m³ in the sample,
    // the old line still read "Well below WHO guidelines" — printing the
    // contradicting number in the same sentence.
    const cards = await insightsWith({ european_aqi: 45, pm2_5: 16.9 });
    expect(cards).toHaveLength(1);
    expect(cards[0].description).toMatch(/above the WHO 24-hour guideline/);
    expect(cards[0].description).not.toMatch(/[Ww]ell below/);
  });

  it('reports PM2.5 as unavailable rather than as zero', async () => {
    const cards = await insightsWith({ european_aqi: 30 });
    expect(cards).toHaveLength(1);
    expect(cards[0].description).toMatch(/PM2\.5 unavailable/);
    expect(cards[0].description).not.toMatch(/0\.0 /);
  });
});

describe('the tile draws all six bands', () => {
  const tile = readFileSync(resolve('src/components/EnvironmentTile.tsx'), 'utf8');

  it('has a visual for every status the API can send', () => {
    for (const b of EAQI) {
      expect(tile, `no band styling for "${b.status}"`).toMatch(
        new RegExp(`'${b.status}':\\s*\\{`),
      );
    }
  });

  it('sizes the ordinal meter from the band table rather than a literal', () => {
    // It drew three segments and said "Band n of 3" while the scale had six, so
    // the meter understated the range as surely as the label understated the
    // reading.
    expect(tile).not.toMatch(/\[1, 2, 3\]\.map/);
    expect(tile).toMatch(/length:\s*AQI_BAND_COUNT/);
    expect(tile).toMatch(/of \{AQI_BAND_COUNT\}/);
  });

  it('never lets colour and glyph claim different granularity', () => {
    // The sea-state defect, guarded here before it can happen: six bands and
    // four tokens means some must share, but colour and glyph must group the
    // *same* bands rather than merely the same number of them.
    const rows = [...tile.matchAll(
      /'([\w-]+)':\s*\{\s*token:\s*'([^']+)',\s*glyph:\s*'([^']+)',\s*rank:\s*(\d+)/g,
    )];
    expect(rows.length, 'could not parse the band table').toBe(6);

    const group = (i: number) => {
      const m = new Map<string, string[]>();
      for (const r of rows) m.set(r[i], [...(m.get(r[i]) ?? []), r[1]]);
      return [...m.values()].map((g) => g.slice().sort().join('+')).sort();
    };
    expect(group(2), 'colour and glyph group different bands').toEqual(group(3));
  });

  it('rises monotonically, so no band outranks a worse one', () => {
    const rows = [...tile.matchAll(
      /token:\s*'--data-([\w-]+)',\s*glyph:\s*'[^']+',\s*rank:\s*(\d+)/g,
    )];
    expect(rows.length, 'could not parse the band table').toBe(6);
    const order = ['positive', 'neutral', 'warning', 'negative'];
    const severity = rows
      .sort((a, b) => Number(a[2]) - Number(b[2]))
      .map((r) => order.indexOf(r[1]));
    for (const s of severity) expect(s, 'unknown token in the ramp').toBeGreaterThanOrEqual(0);
    for (let i = 1; i < severity.length; i++) {
      expect(severity[i], 'severity ramp doubles back').toBeGreaterThanOrEqual(severity[i - 1]);
    }
  });
});
