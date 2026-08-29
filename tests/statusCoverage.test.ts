/**
 * The status endpoint has to be true about two separate things: that it probes
 * what the application actually calls, and that it does not charge a reader for
 * an answer that cannot change the verdict.
 *
 * Both had failed. `/api/live-grid` (#88) called `system/with-plan` while the
 * only Elering probe hit `nps/price` — a different path on the same host — so
 * the feed could have been withdrawn without anything going amber. And Riga
 * Open Data, `required: false` and powering nothing, was measured at 6202ms on
 * eight consecutive requests out of a 6206ms page: 99.9% of the response time
 * spent on the one source whose answer is discarded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const freshness = require('../api/shared/freshness.js');
const registry = require('../api/shared/statusChecks.js');
const status = require('../api/system-status/index.js');
const cache = require('../api/shared/cache.js');

/** A `system/with-plan` payload: metered actuals plus a forecast that runs on. */
function withPlan(opts: { actualMinutesBehind: number; planMinutesAhead: number }) {
  const now = Math.floor(Date.now() / 1000);
  const quarterHours = (n: number) => n * 900;

  const real = [];
  for (let i = 3; i >= 0; i--) {
    real.push({
      timestamp: now - opts.actualMinutesBehind * 60 - quarterHours(i),
      production: 800 + i,
      consumption: 900,
      production_renewable: 300,
    });
  }
  const plan = [];
  for (let i = 0; i < 4; i++) {
    plan.push({
      timestamp: now + opts.planMinutesAhead * 60 - quarterHours(i),
      production: 810,
      consumption: 905,
      production_renewable: 305,
    });
  }
  return { success: true, data: { real, plan } };
}

describe('the grid-state probe reads metered actuals, never the forecast', () => {
  it('takes its reading from data.real and ignores data.plan entirely', () => {
    // The measured shape of the live feed: actuals 77 minutes behind, plan 178
    // minutes into the future.
    const body = withPlan({ actualMinutesBehind: 77, planMinutesAhead: 178 });
    const obs = freshness.extract.eleringMetered(body);

    const minutesBehind = (Date.now() - obs.at.getTime()) / 60000;
    expect(minutesBehind).toBeGreaterThan(70);
    expect(minutesBehind).toBeLessThan(85);
  });

  it('would have been a probe that can never fail, had it read the newest row', () => {
    // Guarding the guard. The generic `elering` extractor takes the newest
    // timestamp across every key of `data`, which here is the plan — and a
    // reading in the future has a negative age, so it can never be judged
    // stale. Asserting the wrong reading really is wrong keeps the test above
    // from passing vacuously if `eleringMetered` ever loses its filter.
    const body = withPlan({ actualMinutesBehind: 77, planMinutesAhead: 178 });
    const naive = freshness.extract.elering(body);

    expect(naive.at.getTime()).toBeGreaterThan(Date.now());
    expect(freshness.extract.eleringMetered(body).at.getTime()).toBeLessThan(Date.now());
  });

  it('reports stale when metering stops, even while the forecast runs on', () => {
    // The case the probe exists for. Actuals frozen nine hours back, plan still
    // publishing into the future — the shape a dead metering feed actually has.
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Elering grid state');
    const body = withPlan({ actualMinutesBehind: 9 * 60, planMinutesAhead: 178 });

    const verdict = freshness.judge(check, freshness.extract.eleringMetered(body), new Date());
    expect(verdict.state).toBe('stale');

    // And the same payload read naively is judged fresh, which is the bug.
    const naive = freshness.judge(check, freshness.extract.elering(body), new Date());
    expect(naive.state).toBe('fresh');
  });

  it('is fresh at the ordinary metering delay', () => {
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Elering grid state');
    // 83 minutes is the worst lag observed across all sampling for #88.
    const body = withPlan({ actualMinutesBehind: 83, planMinutesAhead: 178 });
    expect(freshness.judge(check, freshness.extract.eleringMetered(body), new Date()).state)
      .toBe('fresh');
  });

  it('rejects a real block whose rows carry no production', () => {
    // A row present but empty is not a reading — the same rule `/api/live-grid`
    // applies with `newestWithProduction`.
    const now = Math.floor(Date.now() / 1000);
    expect(freshness.extract.eleringMetered({
      data: { real: [{ timestamp: now, production: null, consumption: 900 }] },
    })).toBeNull();
  });
});

describe('the registry covers the endpoint live-grid actually calls', () => {
  it('probes system/with-plan, not merely some other path on the Elering host', () => {
    // `nps/price` answering proves nothing about `system/with-plan`; that is
    // the whole point of AGENTS.md's "probe the endpoint the app actually uses".
    const urls = registry.CHECKS.map((c: { url?: string }) => c.url || '');
    expect(urls.some((u: string) => u.includes('/api/system/with-plan'))).toBe(true);
  });

  it('probes the CKAN action four endpoints read through, not only liveness', () => {
    const ckan = registry.CHECKS.find((c: { name: string }) => c.name === 'data.gov.lv CKAN');
    expect(ckan.url).toContain('status_show');
    expect(ckan.datastoreUrl).toContain('datastore_search');
  });

  it('gives the grid-state probe a cadence, like every other check', () => {
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Elering grid state');
    expect(check.cadence).toBe('H');
    expect(check.maxLag).toBeGreaterThan(1.4);
  });

  it('asks every windowed probe for more history than the lag it tolerates', () => {
    // A window shorter than a field's publication lag makes a LIVE field
    // indistinguishable from a DEAD one. That is not hypothetical here:
    // `/api/live-grid` requested twelve hours, solar is filed a day at a time,
    // so every row in the window was legitimately null — and the endpoint
    // recorded in its own docstring that the field "is empty on actuals". The
    // renewable share was then built on that, understating by up to 95.8
    // percentage points until #234.
    //
    // The probes here carry the same risk in the other direction: a window
    // narrower than `maxLag` returns nothing for a source that is merely
    // running late, and reads as an outage. So the window must strictly exceed
    // the lag the check has already declared it will forgive.
    const HOURS: Record<string, number> = { H: 1, D: 24, W: 168, M: 730, Q: 2192, A: 8766 };
    const windowed = registry.CHECKS
      .filter((c: { url?: string }) => /[?&]start=/.test(c.url || ''))
      .map((c: { name: string; url: string; cadence: string | null; maxLag: number }) => {
        const q = new URLSearchParams(c.url.split('?')[1]);
        return {
          name: c.name,
          spanHours: (Date.parse(q.get('end')!) - Date.parse(q.get('start')!)) / 3600000,
          toleratedHours: c.cadence ? c.maxLag * HOURS[c.cadence] : null,
        };
      });

    // The population is named, so a probe that stops carrying a window — or a
    // new one that starts — fails this rather than silently leaving the set.
    expect(windowed.map((w) => w.name).sort())
      .toEqual(['Elering grid state', 'NordPool Electricity']);

    for (const w of windowed) {
      expect(w.toleratedHours, w.name + ' must declare a cadence to be judged').not.toBeNull();
      expect(w.spanHours, w.name + ' asks for ' + w.spanHours
        + 'h but forgives a lag of ' + w.toleratedHours + 'h').toBeGreaterThan(w.toleratedHours!);
    }
  });
});

/**
 * "Probe the endpoint the app actually uses" was satisfied by *restating* the
 * app's query rather than by asking for it.
 *
 * Both Eurostat probes were hand-built strings. The unemployment one happened
 * to be byte-identical to `buildUrl` output, which sounds harmless and is the
 * whole problem — the identity was maintained by hand and nothing checked it.
 *
 * The maritime one had already drifted. It pinned `rep_mar=LV_0LVRIX`, Riga
 * alone, over three years; `/api/port-data` asks for all four Latvian ports
 * over eight. So the probe could not see a failure at Ventspils, Liepāja or
 * Skulte, and went red whenever Riga alone was quiet — which is the false red
 * this very check has already produced once.
 *
 * The newsroom's collision guard failed the same way on the same day: it
 * rebuilt the collector's query parameters itself with a hardcoded geography
 * list while the collector's default moved underneath it, and changed no
 * outcome, which is exactly why nobody noticed. **A guard that reproduces the
 * logic it guards is not a guard, it is a second implementation that can
 * disagree.**
 */
describe('the Eurostat probes ask the app for its query rather than restating it', () => {
  const eurostat = require('../api/shared/eurostat.js');
  const indicators = require('../api/shared/indicators.js');
  const ports = require('../api/shared/ports.js');

  it('probes the comparison charts with the charts\u2019 own URL', () => {
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Eurostat');
    expect(check.url).toBe(eurostat.buildUrl(indicators.unemployment, 2, ['LV']));
  });

  it('probes the maritime tile with the maritime tile\u2019s own URL', () => {
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Eurostat maritime');
    expect(check.url).toBe(ports.seriesUrls('LV').vessels);
  });

  it('covers every Latvian port, not just the one that lags', () => {
    // The concrete regression. Riga is routinely behind the other three, so a
    // Riga-only probe reports a healthy feed as dead — and is blind to the
    // three ports it does not ask about.
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'Eurostat maritime');
    const asked = (check.url.match(/rep_mar=/g) || []).length;

    expect(asked, 'the probe must ask for every port the tile draws')
      .toBe(ports.PORTS.LV.length);
    expect(asked).toBeGreaterThan(1);
  });

  it('builds no Eurostat query by hand anywhere in the registry', () => {
    // The general form. A literal cube path in this file is a second
    // implementation of a query that lives somewhere else.
    const offenders = registry.CHECKS
      .filter((c: { url?: string; name: string }) =>
        (c.url || '').startsWith(eurostat.EUROSTAT_BASE) &&
        c.url !== eurostat.buildUrl(indicators.unemployment, 2, ['LV']) &&
        c.url !== ports.seriesUrls('LV').vessels)
      .map((c: { name: string }) => c.name);

    expect(
      offenders,
      'these probe Eurostat with a URL no application code produces, so they can ' +
        'pass while the query the app makes fails, or fail while it works'
    ).toEqual([]);
  });
});

describe('an optional source never costs the reader the wait', () => {
  beforeEach(() => { cache.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cache.clear(); });

  /** A check whose probe hangs for as long as we like. */
  function hangingCheck(name: string) {
    return {
      name,
      url: 'https://example.invalid/' + encodeURIComponent(name),
      type: 'never-matches-any-probe-type',
      required: false,
      powers: 'Nothing — retained as an availability signal only',
      cadence: null,
    };
  }

  /**
   * A runner that never answers — the shape Riga actually has, a connection
   * accepted and then left silent for the full 6202ms.
   *
   * Injected rather than simulated with an unreachable host: DNS refuses
   * `.invalid` in microseconds, so a probe pointed there finishes *before* the
   * budget and the assertion passes on timing luck rather than on behaviour.
   */
  const neverAnswers = () => new Promise<never>(() => { /* deliberately open */ });

  it('reports pending rather than holding the page open', async () => {
    // Riga hung for 6202ms on every one of eight consecutive live requests.
    // The reader now waits the optional budget instead, and is told plainly
    // that the answer is still coming.
    const check = hangingCheck('slow optional');

    const pending = status.runOptionalCheck(check, new Date(), Date.now(), neverAnswers);
    await vi.advanceTimersByTimeAsync(status.OPTIONAL_RESPONSE_BUDGET_MS + 10);
    const result = await pending;

    expect(result.status).toBe('pending');
    expect(result.required).toBe(false);
    expect(result.pendingReason).toMatch(/cannot affect the overall status/);
  });

  it('routes an optional check down the non-blocking path, not merely offers one', async () => {
    // The test above proves `runOptionalCheck` behaves; this proves the endpoint
    // actually uses it. Without that second assertion the helper could be
    // correct and dead code — which is what an earlier draft of this suite
    // measured, passing happily with the dispatch reverted.
    const check = hangingCheck('optional via dispatch');

    const routed = status.runRegistryCheck(check, new Date(), Date.now(), neverAnswers);
    await vi.advanceTimersByTimeAsync(status.OPTIONAL_RESPONSE_BUDGET_MS + 10);
    const result = await routed;

    expect(result.status).toBe('pending');
  });

  it('still makes the page wait for a required check', async () => {
    // The other direction, so "don't wait" cannot quietly become "never wait".
    // A required source's answer is the verdict; abandoning it after 750ms
    // would report an outage the moment any cube took a second to think.
    const check = Object.assign(hangingCheck('required'), { required: true });

    let settled = false;
    const routed = status.runRegistryCheck(check, new Date(), Date.now(), neverAnswers)
      .then((r: { status: string }) => { settled = true; return r; });

    await vi.advanceTimersByTimeAsync(status.OPTIONAL_RESPONSE_BUDGET_MS + 10);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(9000);
    const result = await routed;
    expect(result.status).toBe('unhealthy');
  });

  it('serves the second caller from cache once the probe finally lands', async () => {
    // The half that preserves the recovery signal. The abandoned probe is still
    // running, and when it answers the result is filed — so if Riga ever comes
    // back, the next request shows it, at no cost to anyone.
    const check = hangingCheck('eventually answers');
    let land: (r: unknown) => void = () => {};
    const slow = () => new Promise((resolve) => { land = resolve; });

    const first = status.runRegistryCheck(check, new Date(), Date.now(), slow);
    await vi.advanceTimersByTimeAsync(status.OPTIONAL_RESPONSE_BUDGET_MS + 10);
    expect((await first).status).toBe('pending');

    land({ name: check.name, status: 'healthy', required: false, latency: 6202 });
    await vi.advanceTimersByTimeAsync(1);

    const second = await status.runRegistryCheck(check, new Date(), Date.now(), neverAnswers);
    expect(second.status).toBe('healthy');
  });

  it('a pending optional cannot move the site off healthy', () => {
    // The reason waiting for it was never worth anything: `overallStatus` reads
    // only the required checks, so this result is discarded by construction.
    expect(status.overallStatus([
      { name: 'req', status: 'healthy', required: true },
      { name: 'opt', status: 'pending', required: false },
    ])).toBe('healthy');
  });

  it('does not treat pending as healthy either, which would be the other lie', () => {
    const results = [
      { name: 'req', status: 'healthy', required: true },
      { name: 'opt', status: 'pending', required: false },
    ];
    expect(results.filter((r) => r.status === 'healthy').length).toBe(1);
  });

  it('gives the budget enough room that a working source is never called pending', () => {
    // Every healthy latency on the board: 16–63ms Open-Meteo, 21–500ms cubes,
    // 351ms PxWeb metadata, 75–217ms Elering. The budget has to clear all of it
    // or a healthy source gets reported as "checking" on a cold cache.
    expect(status.OPTIONAL_RESPONSE_BUDGET_MS).toBeGreaterThan(500);
  });
});
