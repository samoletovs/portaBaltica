/**
 * The monitor must not go quiet when the site goes down.
 *
 * @vitest-environment node
 *
 * Run in the node environment rather than the project-wide jsdom default. The
 * subject is a Node script that talks to an HTTP endpoint and touches no DOM,
 * so a jsdom instance per run is ~20s of setup bought for nothing — and this
 * suite is meant to be cheap enough that nobody is tempted to skip it.
 *
 * This suite exists to pin one property above all others: **absence resolves
 * to an alert.** `AGENTS.md` devotes a section to the fact that every guard
 * found broken in this repository reduced to the opposite — a check handed
 * nothing and answering yes — and a health monitor is the worst possible place
 * to repeat it, because its silence is the all-clear. A monitor that says
 * nothing when the endpoint is unreachable, when the payload is malformed, or
 * when zero probes ran is indistinguishable from one reporting perfect health.
 *
 * So the table below deliberately pairs the two directions. Several rows assert
 * silence, and each is only meaningful because rows built by *the same builder*
 * assert an alert: an assertion that nothing happened needs a companion proving
 * that something could have. Without that pairing, a fixture builder that
 * quietly produced nonsense would make every "silent" row pass for the wrong
 * reason, which is the same fault one level up.
 *
 * Fixtures mirror the shape measured against the live endpoint on
 * 2026-08-28T10:30Z rather than an imagined one — including the two probes that
 * legitimately report `freshness: 'unknown'`.
 */

import { describe, expect, it } from 'vitest';
import {
  describeShape,
  evaluate,
  renderText,
  run,
  type StatusCheck,
  type StatusPayload,
  type Verdict,
} from '../scripts/source-alert.mjs';

/* -------------------------------------------------------------------------- */
/* Fixtures, built from the measured live shape                               */
/* -------------------------------------------------------------------------- */

/** One probe, healthy and fresh, with every field the real endpoint emits. */
function check(overrides: Partial<StatusCheck> & { name: string; required: boolean }): StatusCheck {
  return {
    status: 'healthy',
    freshness: 'fresh',
    latency: 112,
    powers: 'All Baltic comparison charts',
    dataPeriod: '2026-06',
    ageInCadenceUnits: 2,
    maxLag: 3,
    cadence: 'M',
    ...overrides,
  };
}

/**
 * A payload around a given set of checks, with counters that agree with them.
 *
 * The counters are computed from the checks rather than hardcoded, so a fixture
 * cannot accidentally trip the summary-versus-detail consistency rule while
 * testing something else.
 */
function payloadWith(checks: StatusCheck[], overrides: Partial<StatusPayload> = {}): StatusPayload {
  const required = checks.filter((c) => c.required === true);
  const optional = checks.filter((c) => c.required === false);
  const healthy = checks.filter((c) => c.status === 'healthy');
  const bad = required.filter((c) => c.status === 'stale' || c.status === 'unhealthy');
  const down = required.filter((c) => c.status === 'unhealthy');

  // Mirrors `overallStatus` in api/system-status/index.js: required only.
  let overall = 'healthy';
  if (down.length > 0) {
    overall = down.length > Math.floor(required.length / 2) ? 'unhealthy' : 'degraded';
  } else if (bad.length > 0) {
    overall = 'stale';
  }

  return {
    status: overall,
    version: '1.0.0',
    phase: 'Phase 3',
    uptime: '99.9%',
    dataSources: {
      healthy: healthy.length,
      stale: checks.filter((c) => c.status === 'stale').length,
      total: checks.length,
      requiredHealthy: required.filter((c) => c.status === 'healthy').length,
      requiredTotal: required.length,
      optionalHealthy: optional.filter((c) => c.status === 'healthy').length,
      optionalTotal: optional.length,
      checks,
    },
    apis: { total: 13, endpoints: ['/api/system-status'] },
    traffic: { unit: 'requests', today: 181 },
    respondedIn: '385ms',
    fetchedAt: '2026-08-28T10:30:35.410Z',
    ...overrides,
  };
}

/** The healthy baseline: eight required, four optional, two unknown-freshness. */
function healthyPayload(): StatusPayload {
  return payloadWith([
    check({ name: 'Eurostat', required: true }),
    check({ name: 'Eurostat maritime', required: true, cadence: 'Q', ageInCadenceUnits: 2.7, maxLag: 4 }),
    check({ name: 'ECB Exchange Rates', required: true, cadence: 'D', ageInCadenceUnits: 0.4, maxLag: 4 }),
    check({ name: 'NordPool Electricity', required: true, cadence: 'H', ageInCadenceUnits: -11.3, maxLag: 6 }),
    // Reports `unknown` legitimately: CKAN cannot say when it last changed.
    check({ name: 'data.gov.lv CKAN', required: true, freshness: 'unknown' }),
    check({ name: 'VID business registers', required: true, cadence: 'D' }),
    check({ name: 'CSP PxWeb', required: true, cadence: 'Q' }),
    check({ name: 'Newsroom pipeline', required: true, cadence: 'H' }),
    check({ name: 'Elering grid state', required: false, cadence: 'H' }),
    check({ name: 'Open-Meteo Weather', required: false, cadence: 'H' }),
    check({ name: 'Open-Meteo Air Quality', required: false, cadence: 'H' }),
    check({ name: 'Riga Open Data', required: false, freshness: 'unknown' }),
  ]);
}

/** Replace one named check in the healthy baseline. */
function withCheck(name: string, overrides: Partial<StatusCheck>): StatusPayload {
  const base = healthyPayload();
  const sources = base.dataSources as { checks: StatusCheck[] };
  return payloadWith(
    sources.checks.map((c) => (c.name === name ? { ...c, ...overrides } : c)),
  );
}

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

interface Row {
  what: string;
  payload: unknown;
  alert: boolean;
  /** Substrings the report must contain, so an alert actually names the fault. */
  mentions?: string[];
  /** Substrings the report must NOT contain. */
  silentAbout?: string[];
}

const rows: Row[] = [
  {
    what: 'every source healthy and fresh',
    payload: healthyPayload(),
    alert: false,
  },
  {
    what: 'a required source is stale',
    payload: withCheck('Eurostat', { status: 'stale', freshness: 'stale', ageInCadenceUnits: 9, maxLag: 3 }),
    alert: true,
    mentions: ['Eurostat', 'stale'],
  },
  {
    what: 'a required source is unhealthy',
    payload: withCheck('CSP PxWeb', { status: 'unhealthy', freshness: 'unknown' }),
    alert: true,
    mentions: ['CSP PxWeb', 'unhealthy'],
  },
  {
    what: 'an optional source is stale',
    payload: withCheck('Open-Meteo Air Quality', { status: 'stale', freshness: 'stale' }),
    alert: false,
    // It may be mentioned as a note, but must not read as a problem.
    silentAbout: ['Problems:'],
  },
  {
    what: 'an optional source is unhealthy',
    payload: withCheck('Riga Open Data', { status: 'unhealthy' }),
    alert: false,
    silentAbout: ['Problems:'],
  },
  {
    what: 'a required source reports unknown freshness',
    payload: withCheck('data.gov.lv CKAN', { freshness: 'unknown' }),
    alert: false,
  },
  {
    what: 'the checks array is empty',
    payload: payloadWith([]),
    alert: true,
    mentions: ['empty', 'nothing was actually probed'],
  },
  {
    what: 'dataSources is missing entirely',
    payload: { status: 'healthy', version: '1.0.0', apis: { total: 13 } },
    alert: true,
    mentions: ['dataSources'],
  },
  {
    what: 'dataSources.checks is not an array',
    payload: { status: 'healthy', dataSources: { checks: { Eurostat: 'healthy' } } },
    alert: true,
    mentions: ['checks'],
  },
  {
    what: 'a check carries no `required` flag',
    payload: (() => {
      const base = healthyPayload();
      const sources = base.dataSources as { checks: StatusCheck[] };
      const stripped = sources.checks.map((c) => {
        if (c.name !== 'Eurostat') return c;
        const copy: StatusCheck = { ...c };
        delete copy.required;
        return copy;
      });
      // Counters left describing the original population on purpose: this is
      // what a real endpoint regression would look like.
      return { ...base, dataSources: { ...sources, checks: stripped } };
    })(),
    alert: true,
    mentions: ['required'],
  },
  {
    what: 'a check reports a status word the vocabulary does not contain',
    payload: withCheck('Eurostat', { status: 'degraded' }),
    alert: true,
    mentions: ['degraded'],
  },
  {
    what: 'a check reports a freshness word the vocabulary does not contain',
    payload: withCheck('Eurostat', { freshness: 'probably fine' }),
    alert: true,
    mentions: ['freshness'],
  },
  {
    what: 'the top-level status word is not one the endpoint emits',
    payload: { ...healthyPayload(), status: 'ok' },
    alert: true,
    mentions: ['status'],
  },
  {
    what: 'the summary and the detail disagree about how many are required',
    payload: (() => {
      const base = healthyPayload();
      const sources = base.dataSources as Record<string, unknown>;
      return { ...base, dataSources: { ...sources, requiredTotal: 11 } };
    })(),
    alert: true,
    mentions: ['requiredTotal', 'disagree'],
  },
  {
    what: 'the top-level status is degraded while every check looks fine',
    payload: { ...healthyPayload(), status: 'degraded' },
    alert: true,
    mentions: ['degraded'],
  },
  {
    what: 'the body is not an object at all',
    payload: 'Service Unavailable',
    alert: true,
    mentions: ['not a JSON object'],
  },
  {
    what: 'the body is null',
    payload: null,
    alert: true,
    mentions: ['not a JSON object'],
  },
];

describe('evaluate', () => {
  for (const row of rows) {
    it(`${row.alert ? 'alerts' : 'stays silent'} when ${row.what}`, () => {
      const verdict = evaluate(row.payload);
      const text = renderText(verdict);

      expect(verdict.alert, `${row.what}\n${text}`).toBe(row.alert);

      // An alert with no stated problem is an alarm nobody can act on, and a
      // silent verdict carrying problems would be a contradiction.
      expect(verdict.problems.length > 0).toBe(row.alert);

      for (const needle of row.mentions ?? []) {
        expect(text, `report should name "${needle}"\n${text}`).toContain(needle);
      }
      for (const needle of row.silentAbout ?? []) {
        expect(text, `report should not contain "${needle}"\n${text}`).not.toContain(needle);
      }
    });
  }

  it('covers both outcomes, so the silent rows mean something', () => {
    // The companion assertion. Every "stays silent" row above is only evidence
    // if the same builder is capable of producing an alert -- otherwise they
    // would all pass against a fixture builder that emits unreadable nonsense.
    expect(rows.some((r) => r.alert)).toBe(true);
    expect(rows.some((r) => !r.alert)).toBe(true);
    expect(evaluate(healthyPayload()).alert).toBe(false);
    expect(evaluate(withCheck('Eurostat', { status: 'unhealthy' })).alert).toBe(true);
  });

  it('names every failing required source, not just the first', () => {
    const base = healthyPayload();
    const sources = base.dataSources as { checks: StatusCheck[] };
    const broken = payloadWith(
      sources.checks.map((c) =>
        c.name === 'Eurostat' || c.name === 'CSP PxWeb'
          ? { ...c, status: 'unhealthy', freshness: 'unknown' }
          : c,
      ),
    );

    const verdict = evaluate(broken);
    expect(verdict.alert).toBe(true);
    expect(verdict.problems).toHaveLength(2);
    expect(renderText(verdict)).toContain('Eurostat');
    expect(renderText(verdict)).toContain('CSP PxWeb');
  });

  it('carries the lag detail so the message says how far behind it is', () => {
    const verdict = evaluate(
      withCheck('Eurostat maritime', {
        status: 'stale',
        freshness: 'stale',
        dataPeriod: '2025-Q1',
        ageInCadenceUnits: 6.7,
        maxLag: 4,
        cadence: 'Q',
      }),
    );
    const text = renderText(verdict);
    expect(text).toContain('2025-Q1');
    expect(text).toContain('6.7Q');
    expect(text).toContain('budget of 4');
  });

  it('alerts when freshness says stale but status still claims healthy', () => {
    // These cannot disagree today -- the endpoint derives one from the other --
    // so this fires only on a genuine internal contradiction. Reading `status`
    // alone would let a freshness regression through silently.
    const verdict = evaluate(withCheck('Eurostat', { status: 'healthy', freshness: 'stale' }));
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('disagreeing');
  });
});

/* -------------------------------------------------------------------------- */
/* The network boundary                                                       */
/* -------------------------------------------------------------------------- */

/** A `fetch` that behaves however a test needs it to. */
function fakeFetch(behaviour: () => unknown): typeof fetch {
  return (async () => behaviour()) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: '',
    text: async () => JSON.stringify(body),
  };
}

describe('run, at the network boundary', () => {
  it('stays silent on a healthy live-shaped response', async () => {
    const verdict = await run({ fetchImpl: fakeFetch(() => jsonResponse(healthyPayload())) });
    expect(verdict.alert).toBe(false);
  });

  it('alerts when fetch throws', async () => {
    const verdict = await run({
      fetchImpl: fakeFetch(() => {
        throw new Error('getaddrinfo ENOTFOUND portabaltica.naurolabs.com');
      }),
    });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('ENOTFOUND');
  });

  it('alerts when the fetch rejects asynchronously', async () => {
    const verdict = await run({
      fetchImpl: (() => Promise.reject(new Error('socket hang up'))) as unknown as typeof fetch,
    });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('socket hang up');
  });

  it('alerts on a non-2xx response rather than reading the error page', async () => {
    const verdict = await run({
      fetchImpl: fakeFetch(() => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'upstream is down',
      })),
    });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('503');
  });

  it('alerts when the body is not JSON', async () => {
    const verdict = await run({
      fetchImpl: fakeFetch(() => ({
        ok: true,
        status: 200,
        statusText: '',
        text: async () => '<html>Azure is having a moment</html>',
      })),
    });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('not JSON');
  });

  it('alerts rather than hanging when the endpoint never answers', async () => {
    const verdict = await run({
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })) as unknown as typeof fetch,
    });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('timed out');
  });

  it('alerts when a 200 carries an empty checks array', async () => {
    // The whole-system version of the emptiness rule: the site answers, the
    // JSON parses, every counter is internally consistent -- and nothing ran.
    const verdict = await run({ fetchImpl: fakeFetch(() => jsonResponse(payloadWith([]))) });
    expect(verdict.alert).toBe(true);
    expect(renderText(verdict)).toContain('nothing was actually probed');
  });
});

/* -------------------------------------------------------------------------- */
/* The shape report                                                           */
/* -------------------------------------------------------------------------- */

describe('describeShape', () => {
  it('reports the keys the script actually reads', () => {
    const shape = describeShape(healthyPayload());
    expect(shape).toContain('dataSources:');
    expect(shape).toContain('checks:');
    expect(shape).toContain('required: boolean');
    // The field three sessions have misread as an object.
    expect(shape).toContain('freshness: string');
  });

  it('distinguishes an empty array from a populated one', () => {
    // This is the instrument-check itself: a probe that reports "absent" must
    // be able to show it could have seen something. An empty array and an
    // array of the wrong thing are indistinguishable from a length alone.
    expect(describeShape([])).toBe('array (empty)');
    expect(describeShape([{ name: 'Eurostat' }])).toContain('1 item');
    expect(describeShape([{ name: 'a' }, { name: 'b' }])).toContain('2 items');
  });

  it('prints types rather than values, so a report can be pasted anywhere', () => {
    const shape = describeShape({ token: 'super-secret', count: 3 });
    expect(shape).toContain('token: string');
    expect(shape).not.toContain('super-secret');
  });
});

/* -------------------------------------------------------------------------- */
/* The rendered message                                                       */
/* -------------------------------------------------------------------------- */

describe('renderText', () => {
  it('leads with ALERT or OK so the first line is the answer', () => {
    expect(renderText(evaluate(healthyPayload())).split('\n')[0]).toContain('OK');
    expect(
      renderText(evaluate(withCheck('Eurostat', { status: 'unhealthy' }))).split('\n')[0],
    ).toContain('ALERT');
  });

  it('quotes the counters so a reader can judge the blast radius', () => {
    const text = renderText(evaluate(withCheck('Eurostat', { status: 'unhealthy' })));
    expect(text).toMatch(/required \d+\/\d+/);
    expect(text).toMatch(/optional \d+\/\d+/);
  });

  it('says when it looked and where', () => {
    const verdict: Verdict = evaluate(healthyPayload(), { source: 'https://example.test/status' });
    const text = renderText(verdict);
    expect(text).toContain('https://example.test/status');
    expect(text).toContain(verdict.checkedAt);
  });
});
