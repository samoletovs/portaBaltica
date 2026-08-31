/**
 * Does `/api/ai-insights` say when a source was unavailable?
 *
 * The defect, measured in production on 2026-08-31. `country=lv` and
 * `country=ee` returned two insights while `lt` returned four, because
 * Open-Meteo was unreachable from our egress for Riga and Tallinn:
 *
 *     age=842  insights=2  Riga=0
 *     age=465  insights=4  Riga=2
 *     age=863  insights=2  Riga=0
 *
 * `ttlMs` is 900000, and every `Age` above 800 carried the short list — so a
 * blip lasting seconds was served for the full fifteen minutes.
 *
 * The caching made it last; **the silence made it invisible**. Four bare
 * `catch` clauses dropped an insight with no published field and no `console`
 * call, so a skipped insight and an insight that does not exist were the same
 * artefact. This was the only endpoint in `api/` that could degrade with no
 * signal at all — four siblings already publish an `unavailable` field, and
 * `sea-state` serves `unavailable: []` today.
 *
 * These are written to fail against the silent version, and do: three of the
 * four go red when the field and the pushes are removed. The fourth asserts
 * that degrading has not become failing, which was already true and must stay
 * true.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const cache = require('../api/shared/cache.js') as { clear: () => void };
const handler = require('../api/ai-insights/index.js') as (
  context: { res?: { status: number; body: string } },
  req: { query: Record<string, string> },
) => Promise<void>;

type Envelope = { insights: { headline: string }[]; unavailable: string[] };

function bodyFor(url: string): string {
  if (url.includes('elering')) {
    const ts = Math.floor(Date.now() / 1000);
    return JSON.stringify({
      data: { lv: [{ timestamp: ts, price: 42 }], ee: [{ timestamp: ts, price: 42 }] },
    });
  }
  if (url.includes('ecb.europa.eu')) return "<Cube currency='USD' rate='1.0850'/>";
  if (url.includes('air-quality')) {
    return JSON.stringify({ current: { european_aqi: 20, pm2_5: 4.2 } });
  }
  return JSON.stringify({ current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 1 } });
}

/**
 * Answer every upstream except the ones matching `refuse`, which error.
 *
 * The cache is cleared first. Without it a second call is answered from the
 * fifteen-minute memo and the assertion holds whatever the handler does — a
 * test that has stopped measuring rather than one that has broken.
 */
function stubHttps(refuse: RegExp | null): void {
  cache.clear();
  vi.spyOn(https, 'get').mockImplementation(((
    url: string,
    _o: unknown,
    cb: (r: unknown) => void,
  ) => {
    const req = new EventEmitter();
    const typedReq = req as unknown as { destroy: () => void };
    typedReq.destroy = () => {};

    if (refuse && refuse.test(url)) {
      setTimeout(() => req.emit('error', new Error('simulated upstream failure')), 0);
      return req;
    }

    setTimeout(() => {
      // Built inside the callback, not before it: emitting `data` before the
      // consumer has attached its listeners drops the body on the floor and the
      // request hangs to its deadline.
      const res = new EventEmitter();
      const typed = res as unknown as { statusCode: number; resume: () => void };
      typed.statusCode = 200;
      typed.resume = () => {};
      cb(res);
      res.emit('data', bodyFor(url));
      res.emit('end');
    }, 0);

    return req;
  }) as unknown as typeof https.get);
}

async function insightsFor(refuse: RegExp | null): Promise<Envelope> {
  stubHttps(refuse);
  const context: { res?: { status: number; body: string } } = {};
  await handler(context, { query: { country: 'lv' } });
  return JSON.parse(context.res!.body) as Envelope;
}

describe('ai-insights says what was unavailable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('carries the field even when nothing failed', async () => {
    const body = await insightsFor(null);

    // Always present, so an absent key can never be read as "nothing failed".
    expect(Array.isArray(body.unavailable)).toBe(true);
    expect(body.unavailable).toEqual([]);

    // The control that the harness can produce a full response at all: without
    // it, an empty `unavailable` beside an empty `insights` would look like
    // success while measuring nothing.
    expect(body.insights.length).toBeGreaterThan(0);
  });

  it('names the weather sources when Open-Meteo refuses', async () => {
    const full = await insightsFor(null);
    vi.restoreAllMocks();
    const degraded = await insightsFor(/open-meteo/i);

    // The defect this reproduces: a shorter list, and nothing else.
    expect(degraded.insights.length).toBeLessThan(full.insights.length);

    // And what makes it legible now.
    expect(degraded.unavailable).toContain('weather');
    expect(degraded.unavailable).toContain('air quality');
  });

  it('names the electricity source when Elering refuses', async () => {
    const degraded = await insightsFor(/elering/i);

    expect(degraded.unavailable).toContain('electricity prices');
    // The negative half on the same object: an unrelated source must not be
    // blamed, or the field is a vague alarm rather than a diagnosis.
    expect(degraded.unavailable).not.toContain('weather');
  });

  it('is still a 200 with usable insights when one source is down', async () => {
    stubHttps(/elering/i);
    const context: { res?: { status: number; body: string } } = {};
    await handler(context, { query: { country: 'lv' } });

    // Degrading must not become failing. A source being quiet is not an error
    // about the request, and a 500 here would take the whole banner down.
    expect(context.res!.status).toBe(200);
    const body = JSON.parse(context.res!.body) as Envelope;
    expect(body.insights.length).toBeGreaterThan(0);
  });
});
