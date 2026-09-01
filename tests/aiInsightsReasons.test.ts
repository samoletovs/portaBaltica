/**
 * Three paths that answer HTTP 200 and still lose an insight — and the closed
 * vocabulary that keeps our request URLs out of the response.
 *
 * WHY THIS EXISTS BESIDE `aiInsightsUnavailable.test.ts`
 * -----------------------------------------------------
 * `#329` published `unavailable` and covered the four `catch` clauses. It did
 * not cover the three `if` guards, because those never throw:
 *
 *   L334  if (band) {
 *   L364  }                                        <- no else
 *   L365  } catch (e) { unavailable.push(...); }   <- never reached
 *
 * A source that answers HTTP 200 and parses cleanly but carries no reading
 * falls out of the `if` and hits nothing. `if (usdMatch)` and
 * `if (prices.length > 0)` are the same shape. So four of seven paths were
 * covered and three still dropped in silence — and the air-quality one is not
 * hypothetical: it is one of the two insights production was measured losing.
 *
 * WHY THE REASON EARNS ITS PLACE
 * ------------------------------
 * "Reached, and empty" and "could not reach" are different messages. The first
 * says the source published nothing; the second says look at the channel. A
 * reader told only that air quality is unavailable goes hunting an outage that
 * may never have happened.
 *
 * ON THE LEAK, STATED HONESTLY
 * ----------------------------
 * There is no leak on master. `#329`'s four pushes are fixed literals and
 * `e.message` appears zero times in the file. This vocabulary is a guard
 * against *introducing* one, because attaching reasons is precisely the change
 * that tempts a `lost(source, e.message)` — and `jsonGet` rejects with the full
 * request URL, so that one line would publish our query strings and the
 * capital-city coordinates in a public body.
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
const insightsMod = require('../api/ai-insights/index.js') as {
  REASONS: Record<string, string>;
  reasonOf: (e: unknown) => string;
  httpReason: (n: number) => string;
};
const handler = require('../api/ai-insights/index.js') as
  (c: Ctx, r: unknown) => Promise<void>;
const { REASONS, reasonOf, httpReason } = insightsMod;

type Ctx = { res?: { status: number; body: string } };
type Envelope = {
  insights: { headline: string }[];
  unavailable: { source: string; reason: string }[];
};

function fakeResponse(body: string, statusCode = 200) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
  res.statusCode = statusCode;
  res.resume = () => {};
  setTimeout(() => { res.emit('data', body); res.emit('end'); }, 0);
  return res;
}

function eleringBody(rows: { timestamp: number; price: number }[]) {
  return JSON.stringify({ data: { lv: rows, ee: rows, lt: rows } });
}

const NOW = () => Math.floor(Date.now() / 1000);
const HEALTHY: Record<string, () => string> = {
  elering: () => eleringBody([{ timestamp: NOW(), price: 42 }]),
  ecb: () => "<Cube currency='USD' rate='1.0850'/>",
  air: () => JSON.stringify({ current: { european_aqi: 20, pm2_5: 4.2 } }),
  weather: () => JSON.stringify({ current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 1 } }),
};

function which(url: string): 'elering' | 'ecb' | 'air' | 'weather' {
  if (url.includes('elering')) return 'elering';
  if (url.includes('ecb.europa.eu')) return 'ecb';
  if (url.includes('air-quality')) return 'air';
  return 'weather';
}

type Override = { body: string } | { status: number } | { fail: 'timeout' | 'socket' };

/**
 * Run the real handler with every upstream healthy except those overridden.
 *
 * Each case states only what it changes: a fixture that restates the healthy
 * world drifts from it.
 */
async function run(overrides: Partial<Record<string, Override>> = {}) {
  // Cleared before every case. Without it the second case is answered from the
  // fifteen-minute memo and its assertion holds whatever the handler does — a
  // test that has stopped measuring rather than one that has broken.
  cache.clear();

  const attempts: string[] = [];
  vi.spyOn(https, 'get').mockImplementation(((url: string, _o: unknown, cb: (r: unknown) => void) => {
    attempts.push(url);
    const req = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void };
    req.destroy = (e?: Error) => { if (e) req.emit('error', e); };

    const o = overrides[which(url)];
    if (o && 'fail' in o) {
      if (o.fail === 'timeout') setTimeout(() => req.emit('timeout'), 1);
      // A real Node socket failure carries `code`; a bare Error does not, and
      // `reasonOf` reads the property rather than the message.
      else setTimeout(() => req.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), 1);
      return req;
    }
    const status = o && 'status' in o ? o.status : 200;
    const body = o && 'body' in o ? o.body : HEALTHY[which(url)]();
    setTimeout(() => cb(fakeResponse(body, status)), 1);
    return req;
  }) as never);

  const context: Ctx = {};
  await handler(context, { query: { country: 'lv' } });
  return {
    status: context.res!.status,
    body: JSON.parse(context.res!.body) as Envelope,
    attempts,
  };
}

/** How many times one upstream was actually dialled. */
const dialled = (attempts: string[], w: string) => attempts.filter((u) => which(u) === w).length;

const sources = (e: Envelope) => e.unavailable.map((u) => u.source);
const reasonFor = (e: Envelope, s: string) => e.unavailable.find((u) => u.source === s)?.reason;

afterEach(() => vi.restoreAllMocks());

describe('a source that answered and carried no reading is declared, not dropped', () => {
  it('names air quality when the payload has no index', async () => {
    // `classifyEuropeanAqi` returns null and `if (band)` has no else. Nothing
    // throws, so #329's catch never runs.
    const { status, body } = await run({ air: { body: JSON.stringify({ current: {} }) } });

    expect(status).toBe(200);
    expect(body.insights.some((i) => i.headline.includes('air quality'))).toBe(false);
    expect(sources(body)).toContain('air quality');
    expect(reasonFor(body, 'air quality')).toBe(REASONS.NO_READING);
  });

  it('names electricity prices when Elering has nothing for today', async () => {
    const { body } = await run({ elering: { body: eleringBody([]) } });

    expect(body.insights.some((i) => i.headline.includes('Electricity'))).toBe(false);
    expect(sources(body)).toContain('electricity prices');
    expect(reasonFor(body, 'electricity prices')).toBe(REASONS.NO_READING);
  });

  it('names exchange rates when the ECB file has no USD line', async () => {
    const { body } = await run({ ecb: { body: "<Cube currency='SEK' rate='11.0'/>" } });

    expect(body.insights.some((i) => i.headline.includes('EUR/USD'))).toBe(false);
    expect(sources(body)).toContain('exchange rates');
    expect(reasonFor(body, 'exchange rates')).toBe(REASONS.NO_READING);
  });

  it('declares nothing when all four answer normally', async () => {
    // The positive control, and the load-bearing one: every assertion above is
    // "the list contains X", so a handler that declared all four sources
    // unconditionally would satisfy all of them.
    const { body } = await run();
    expect(body.insights).toHaveLength(4);
    expect(body.unavailable).toEqual([]);
  });
});

describe('an empty answer does not read as a quiet one', () => {
  it('does not report a network reason for a source that answered', async () => {
    // The distinction the reason exists for. If a no-reading path collapsed
    // into the catch it would surface as `unreachable` or `unknown`, and a
    // reader would go looking for an outage that never happened.
    const { body } = await run({ air: { body: JSON.stringify({ current: {} }) } });
    expect(reasonFor(body, 'air quality')).not.toBe(REASONS.UNREACHABLE);
    expect(reasonFor(body, 'air quality')).not.toBe(REASONS.UNKNOWN);
  });

  it('does report a network reason for a source that did not answer', async () => {
    // The companion. Without it, "always say no-reading" passes the case above
    // and the distinction is a constant rather than a measurement.
    const { body } = await run({ air: { fail: 'socket' } });
    expect(reasonFor(body, 'air quality')).toBe(REASONS.UNREACHABLE);
  });

  it('distinguishes a timeout, a refusal and a malformed body', async () => {
    const timedOut = await run({ weather: { fail: 'timeout' } });
    expect(reasonFor(timedOut.body, 'weather')).toBe(REASONS.TIMEOUT);

    // 429 rather than a generic failure: the channel this endpoint reaches
    // Open-Meteo over is rate-limited, and "we were turned away" is a different
    // thing to know than "we could not connect".
    const refused = await run({ air: { status: 429 } });
    expect(reasonFor(refused.body, 'air quality')).toBe(httpReason(429));

    // Asserted against ELERING, which keeps `jsonGet` and therefore tags its own
    // parse failure. Open-Meteo goes through `es.httpJson` since #333, and that
    // throws a plain Error on an unparseable body — see the case below.
    const garbled = await run({ elering: { body: 'not json at all' } });
    expect(reasonFor(garbled.body, 'electricity prices')).toBe(REASONS.MALFORMED);
  });

  it('calls an unparseable Open-Meteo body unknown, and does not guess malformed', async () => {
    // A known gap, pinned so it is a decision rather than an accident.
    //
    // #333 routes Open-Meteo through `es.httpJson`, which throws
    // `Error('JSON parse failed for ' + url)` — no status, no code, no
    // transient. Closing the gap would mean parsing at our end (a second
    // transport for one reason code) or matching that message text (the lexical
    // proxy `reasonOf` exists to avoid). `unknown` is honest; a guessed
    // `malformed` would be a claim nobody established.
    const { body } = await run({ air: { body: 'not json at all' } });

    expect(reasonFor(body, 'air quality')).toBe(REASONS.UNKNOWN);
    // And it must still be REPORTED — an unclassifiable failure is not a licence
    // to drop the source silently, which is the whole subject of this file.
    expect(sources(body)).toContain('air quality');
    // The URL must not ride along in the reason, whatever the classification.
    expect(JSON.stringify(body.unavailable)).not.toMatch(/https?:\/\//);
  });
});

describe('Open-Meteo gets a fresh connection rather than a longer wait', () => {
  /**
   * These guard `#333`'s merged behaviour; they do not propose it.
   *
   * `#333` routed both Open-Meteo calls through `es.httpJson` with `sea-state`'s
   * 6000ms deadline and one retry, because `jsonGet`'s `{ timeout: 15000 }`
   * arms a socket idle timer only — the wrong shape for a host that accepts the
   * connection and then goes quiet. It ships two tests of its own in
   * `aiInsightsUnavailable.test.ts`: that a first-attempt failure is recovered,
   * and that Elering is not retried.
   *
   * What follows is deliberately NOT a second copy of those. Each case here
   * asserts something they do not:
   *
   *   exactly 2 attempts      theirs asserts > 1, which passes for 5 retries
   *   air quality retried     theirs counts weather attempts only
   *   1 attempt when healthy   the negative control; "always retry" passes theirs
   *   404 vs 429              the sharpest: only a transient answer is retried
   *   the ECB not retried     theirs covers Elering only
   *
   * Two enumerations of one fact always drift, so where they already assert
   * something it is not restated.
   */
  it('retries a hung weather call once, and gives up after that', async () => {
    const { body, attempts } = await run({ weather: { fail: 'timeout' } });

    expect(dialled(attempts, 'weather'), 'one attempt plus one retry').toBe(2);
    expect(reasonFor(body, 'weather')).toBe(REASONS.TIMEOUT);
  });

  it('retries a reset air-quality connection once', async () => {
    const { attempts } = await run({ air: { fail: 'socket' } });
    expect(dialled(attempts, 'air')).toBe(2);
  });

  it('does not dial twice when the first attempt succeeds', async () => {
    // The negative control. Without it, "always retry" satisfies both cases
    // above while doubling the load on a channel that is throttled for being
    // asked too often.
    const { attempts } = await run();
    expect(dialled(attempts, 'weather')).toBe(1);
    expect(dialled(attempts, 'air')).toBe(1);
  });

  it('does not retry an answer about the request itself', async () => {
    // A 404 is an answer; asking again spends another deadline to hear it
    // repeated. `eurostat.js` retries only what it marks transient — 429 and
    // 5xx — and this pins that this endpoint inherits that judgement rather
    // than retrying everything.
    const notFound = await run({ air: { status: 404 } });
    expect(dialled(notFound.attempts, 'air'), 'a 404 is not worth a second go').toBe(1);
    expect(reasonFor(notFound.body, 'air quality')).toBe(httpReason(404));

    const throttled = await run({ air: { status: 429 } });
    expect(dialled(throttled.attempts, 'air'), 'a 429 is the retryable one').toBe(2);
  });

  it('leaves the ECB on its existing transport', async () => {
    // `#333` asserts this for Elering; the ECB is uncovered there. Neither is
    // failing — across 34 generations sampled on 2026-08-31 and 17 more on
    // 2026-09-01, every degradation was Open-Meteo — so inventing deadlines for
    // them is how a reliable source gets made less reliable.
    const { attempts } = await run({ ecb: { fail: 'socket' } });
    expect(dialled(attempts, 'ecb')).toBe(1);
  });
});

describe('the reason vocabulary is closed', () => {
  it('defaults an unclassified error to unknown rather than to a cause', () => {
    // Absence must not resolve to a confident claim. `unreachable` would be a
    // statement about a network nobody examined.
    expect(reasonOf(new Error('nobody tagged this'))).toBe(REASONS.UNKNOWN);
    expect(reasonOf(undefined)).toBe(REASONS.UNKNOWN);
    expect(reasonOf({ reason: '' })).toBe(REASONS.UNKNOWN);
  });

  it('passes a tag through when there is one', () => {
    // The companion half: the assertion above passes for a `reasonOf` that
    // returns `unknown` unconditionally, which would erase every reason.
    expect(reasonOf(Object.assign(new Error('x'), { reason: REASONS.TIMEOUT }))).toBe(REASONS.TIMEOUT);
  });

  it('never publishes an upstream error message, which carries our request URL', async () => {
    const { body } = await run({
      air: { fail: 'timeout' }, weather: { status: 503 }, ecb: { fail: 'socket' },
    });
    const serialised = JSON.stringify(body.unavailable);

    expect(serialised).not.toMatch(/https?:\/\//);
    expect(serialised).not.toMatch(/latitude|longitude|open-meteo|europa\.eu/);

    const allowed = new Set(Object.values(REASONS));
    for (const u of body.unavailable) {
      expect(
        allowed.has(u.reason) || /^http-\d{3}$/.test(u.reason),
        `"${u.reason}" is outside the closed vocabulary`,
      ).toBe(true);
    }
  });

  it('proves the URL would have been caught, had it been published', async () => {
    // The negative control for the assertion above. Without it, those regexes
    // pass on any payload — including one whose `unavailable` is empty — and the
    // leak guard would be a check that cannot fail.
    //
    // This is the exact message `jsonGet` rejects with on a timeout, so it is
    // what `lost(source, e.message)` would put on the wire.
    const wouldHaveLeaked = JSON.stringify([{
      source: 'weather',
      reason: 'Timeout: https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11',
    }]);

    expect(wouldHaveLeaked).toMatch(/https?:\/\//);
    expect(wouldHaveLeaked).toMatch(/latitude|longitude|open-meteo|europa\.eu/);
  });
});

describe('no insight at all is a failure, not an empty answer', () => {
  it('returns 502 with every source named when all four are lost', async () => {
    const { status, body } = await run({
      elering: { fail: 'socket' }, ecb: { fail: 'socket' },
      air: { fail: 'socket' }, weather: { fail: 'socket' },
    });

    // 502 rather than a cacheable 200 carrying an empty list. `responseCache`
    // will not remember a non-200, so `cache.memo` serves the last good answer
    // inside its hour of grace instead of an empty strip for fifteen minutes.
    expect(status).toBe(502);
    expect(body.insights).toEqual([]);
    expect(body.unavailable).toHaveLength(4);
    expect(sources(body).sort())
      .toEqual(['air quality', 'electricity prices', 'exchange rates', 'weather']);
  });

  it('does not reach for a 502 while any source still answers', async () => {
    // The companion. Without it, "return 502 always" passes the case above —
    // and it would take the banner down on every partial degradation, which is
    // the common case rather than the rare one.
    const { status, body } = await run({
      ecb: { fail: 'socket' }, air: { fail: 'socket' }, weather: { fail: 'socket' },
    });
    expect(status).toBe(200);
    expect(body.insights.length).toBeGreaterThan(0);
  });
});
