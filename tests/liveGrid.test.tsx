/**
 * The Estonian grid panel, and the two things about it that could mislead.
 *
 * This is the freshest data anywhere on portaBaltica — everything else is a
 * statistical release published quarters in arrears — which makes it the most
 * tempting thing on the site to overstate. Two claims have to be resisted:
 *
 *   1. **That it is Baltic.** Elering is the *Estonian* transmission operator
 *      and `/api/system/with-plan` is its own system. Consumption runs 670–870
 *      MW where the three states together draw three to four gigawatts, so the
 *      numbers give it away to anyone who looks — and nobody looks. This is the
 *      same trap as "Latvian sea passengers" turning out to mean Ventspils.
 *
 *   2. **That it is "now".** Metering lags by well over an hour: 83 minutes
 *      when this was written. Freshest and current are different claims.
 *
 * A third was avoided rather than fixed: `frequency` comes back as exactly 50
 * in every row of every sample, so it is a nominal constant and not telemetry.
 * A grid-frequency dial that never moves would be a fabricated liveness signal,
 * which is the same class of thing as an air-quality reading invented from a
 * failed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fetchLiveGrid = vi.fn();
vi.mock('../src/api', () => ({
  fetchLiveGrid: (...args: unknown[]) => fetchLiveGrid(...args),
}));

/**
 * Give `ResponsiveContainer` a size, so the chart actually draws here.
 *
 * jsdom reports every element as 0×0, so recharts renders **nothing** — and
 * every query against a chart then returns null, which reads as "the attribute
 * is missing" rather than "there is no chart". `AGENTS.md` records a session
 * nearly filing a false bug report on exactly that.
 *
 * It mattered the moment the chart's accessible name moved from the wrapping
 * div onto the chart element itself: the wrapper is plain DOM and always
 * present, the surface only exists once recharts has a box to draw in. Without
 * this the assertion below could not see the name it is about.
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const Sized = ({ children }: { children: React.ReactNode }) => (
    <actual.ResponsiveContainer width={600} height={300}>{children}</actual.ResponsiveContainer>
  );
  return { ...actual, ResponsiveContainer: Sized };
});

import { GridStatePanel } from '../src/components/GridStatePanel';

/** Elering's real payload shape: `data` is an object, not an array of one. */
function eleringPayload(real: unknown[], plan: unknown[]) {
  return { success: true, data: { real, plan } };
}

function row(minutesAgo: number, over: Record<string, unknown> = {}) {
  return Object.assign({
    timestamp: Math.floor((Date.now() - minutesAgo * 60000) / 1000),
    production: 514.78,
    consumption: 674.78,
    losses: null,
    frequency: 50,
    system_balance: -160.2,
    ac_balance: 490.59,
    production_renewable: 13.74,
    solar_energy_production: null,
  }, over);
}

async function callApi(payload: unknown, opts: { fail?: boolean } = {}) {
  const es = require('../api/shared/eurostat.js');
  const cache = require('../api/shared/cache.js');
  cache.clear();
  const original = es.httpJson;
  let requested: string | null = null;
  es.httpJson = (url: string) => {
    requested = url;
    return opts.fail
      ? Promise.reject(new Error('HTTP 503 from dashboard.elering.ee'))
      : Promise.resolve(payload);
  };
  try {
    delete require.cache[require.resolve('../api/live-grid/index.js')];
    const handler = require('../api/live-grid/index.js');
    const ctx: { res?: { body: string; status: number } } = {};
    await handler(ctx, { query: {}, headers: {} });
    return { status: ctx.res!.status, body: JSON.parse(ctx.res!.body), requested };
  } finally {
    es.httpJson = original;
  }
}

/** Hours of history the handler actually asked Elering for. */
function requestedSpanHours(url: string | null) {
  const q = new URLSearchParams(url!.split('?')[1]);
  return (Date.parse(q.get('end')!) - Date.parse(q.get('start')!)) / 3600000;
}

describe('/api/live-grid', () => {
  it('reads Elering\u2019s object-shaped payload, not an array of one', async () => {
    // `data` is `{ real, plan }`. A shell that auto-wraps a single object into
    // a collection made it look like an array, and indexing it as one returns
    // nothing at all while still answering HTTP 200.
    const { status, body } = await callApi(eleringPayload([row(90), row(75)], []));
    expect(status).toBe(200);
    expect(body.actual).toHaveLength(2);
    expect(body.latest).not.toBeNull();
  });

  it('says it is Estonia, in the payload and not only in the UI', async () => {
    const { body } = await callApi(eleringPayload([row(90)], []));
    expect(body.area).toBe('EE');
    expect(body.areaLabel).toBe('Estonia');
    expect(body.operator).toMatch(/Estonian/);
  });

  it('dates the newest metered reading, and ships no age beside it', async () => {
    const { body } = await callApi(eleringPayload([row(83)], []));

    // The instant is the contract. A consumer subtracts from it when it
    // renders; the response cannot, because the body outlives the moment it
    // was built — measured frozen at 72 minutes for nine minutes of serving.
    const behind = (Date.now() - Date.parse(body.meteredTo)) / 60000;
    expect(behind).toBeGreaterThanOrEqual(82);
    expect(behind).toBeLessThanOrEqual(85);

    expect(body.minutesBehind, 'a frozen age must not come back').toBeUndefined();
  });

  it('derives the balance rather than trusting an undocumented field', async () => {
    // `system_balance` agrees with production minus consumption on every
    // sampled row, so deriving it makes the sign convention ours and stated.
    // `ac_balance` is *not* net import — it read 429–653 MW while the country
    // was short by 160–280 — so it is not served at all.
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, consumption: 700, system_balance: 999 })], []));

    expect(body.latest.balance).toBe(-200);
    expect(JSON.stringify(body)).not.toContain('ac_balance');
  });

  it('drops frequency, which is a nominal constant and not a measurement', async () => {
    const { body } = await callApi(eleringPayload([row(60)], []));
    expect(JSON.stringify(body)).not.toContain('frequency');
  });

  it('keeps the forecast ahead of the metered edge, so the two never overlap', async () => {
    const { body } = await callApi(eleringPayload(
      [row(90), row(75)],
      [row(75, { production: 600 }), row(-30, { production: 664 })],
    ));

    expect(body.forecast).toHaveLength(1);
    expect(body.forecast[0].kind).toBe('forecast');
    expect(body.forecast[0].time > body.meteredTo).toBe(true);
  });

  it('computes renewable share against generation, not demand', async () => {
    // Solar is stated rather than left at the fixture's null, so this test
    // keeps measuring its own subject — the denominator — now that an absent
    // solar reading makes the share unknown.
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, production_renewable: 125, solar_energy_production: 0 })], []));
    expect(body.latest.renewableShare).toBe(25);
  });

  it('folds solar into the renewable share, because production_renewable excludes it', async () => {
    // Measured against 668 live readings: solar exceeds production_renewable in
    // 331 of them, and a component cannot exceed its total. Dividing the
    // solar-excluding numerator by the solar-including denominator understated
    // the share by a mean of 28.4 percentage points.
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, production_renewable: 125, solar_energy_production: 125 })], []));
    expect(body.latest.renewableShare).toBe(50);
  });

  it('reports solar, and does not turn an absent reading into a zero', async () => {
    const { body: known } = await callApi(eleringPayload(
      [row(60, { solar_energy_production: 42.5 })], []));
    expect(known.latest.solar).toBe(42.5);

    const { body: absent } = await callApi(eleringPayload(
      [row(60, { solar_energy_production: null })], []));
    expect(absent.latest.solar).toBeNull();
  });

  it('says the share is unknown when solar is missing, rather than understating it', async () => {
    // The gaps are not night — they fall in a contiguous stretch across hours
    // with sun — so an absent solar reading cannot be read as no solar.
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, production_renewable: 125, solar_energy_production: null })], []));
    expect(body.latest.renewableShare).toBeNull();
    // Specifically not the solar-excluding figure, which is the number that shipped.
    expect(body.latest.renewableShare).not.toBe(25);
  });

  it('refuses a share above 100 rather than clamping it to a certainty', async () => {
    // One row in 624 had renewable + solar exceeding production, where solar
    // rose while production fell between two neighbours that both agree — a
    // single-interval metering artefact, not a reading to publish.
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, production_renewable: 300, solar_energy_production: 300 })], []));
    expect(body.latest.renewableShare).toBeNull();
  });

  it('reports the renewable share with its own age, because solar is a slower clock', async () => {
    // Solar is filed a day at a time, so the newest interval almost never has
    // it. Measured over 763 readings: 44 nulls in one unbroken run at the
    // newest end, nothing missing beyond 12.3 hours old.
    const { body } = await callApi(eleringPayload([
      row(200, { production: 500, production_renewable: 125, solar_energy_production: 125 }),
      row(60, { production: 600, production_renewable: 60, solar_energy_production: null }),
    ], []));

    // `latest` is the newest metered interval, and its share is honestly unknown.
    expect(body.latest.renewableShare).toBeNull();

    // The share we can stand behind is the older one, and it carries its own
    // instant. The two-clocks property is asserted on the instants rather than
    // on ages, which is the point: an age would have been frozen at build time.
    expect(body.renewableLatest.share).toBe(50);
    expect(body.renewableLatest.time).toBe(body.actual[0].time);
    expect(Date.parse(body.renewableLatest.time))
      .toBeLessThan(Date.parse(body.meteredTo));
  });

  it('reports an absent renewable share as absent, not as a missing key', async () => {
    const { body } = await callApi(eleringPayload(
      [row(60, { solar_energy_production: null })], []));
    expect(body.renewableLatest.share).toBeNull();
    expect(body.renewableLatest.time).toBeNull();
  });

  it('asks for more history than it plots, so solar is reachable behind its lag', async () => {
    // Measured: solar is filed a day at a time, so the newest reading is up to
    // ~24h old. A request no longer than the plotted window finds none — which
    // is how this endpoint came to state in its own docstring that the field is
    // empty on actuals. The request must clear a full day, not merely the 12.3h
    // lag observed on one afternoon.
    const { requested } = await callApi(eleringPayload([row(60)], []));
    expect(requestedSpanHours(requested)).toBeGreaterThanOrEqual(24);

    // And the request must genuinely exceed what is plotted: a 20h-old row is
    // inside the request and outside the chart.
    const wide = await callApi(eleringPayload([row(20 * 60), row(60)], []));
    expect(requestedSpanHours(wide.requested)).toBeGreaterThan(20);
    expect(wide.body.actual).toHaveLength(1);
  });

  it('reaches solar behind its lag without plotting the extra history', async () => {
    // The whole reason the request is longer than the window: at midday the
    // newest solar reading is ~12h old, so a 12h request finds none and the
    // field looks dead. Serving that history would triple the chart's x-range.
    const { body } = await callApi(eleringPayload([
      row(20 * 60, { production: 500, production_renewable: 125, solar_energy_production: 125 }),
      row(60, { production: 600, production_renewable: 60, solar_energy_production: null }),
    ], []));

    // Plotted series holds only the recent window.
    expect(body.actual).toHaveLength(1);
    expect(body.actual[0].solar).toBeNull();

    // The share is still found, from history that was fetched but not plotted.
    expect(body.renewableLatest.share).toBe(50);
    expect((Date.now() - Date.parse(body.renewableLatest.time)) / 60000)
      .toBeGreaterThan(19 * 60);
  });

  it('answers 502 when Elering is down, rather than an empty-looking success', async () => {
    // Elering sits behind a Cloudflare tier that returns bursts of 503; the
    // whole host was down for a stretch while this was built.
    const { status, body } = await callApi(null, { fail: true });
    expect(status).toBe(502);
    expect(body.error).toMatch(/503/);
  });
});

describe('GridStatePanel', () => {
  /**
   * The panel derives both ages from `Date.now()` at render, so the clock is
   * part of the subject and has to be held still. Frozen at the fixture's own
   * `fetchedAt`, which is what makes the expected strings exact rather than
   * "roughly 83": the API used to send those ages, so the numbers the fixture
   * carried were computed for precisely this instant.
   */
  const NOW = new Date('2026-08-26T15:08:00.000Z');

  beforeEach(() => {
    fetchLiveGrid.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => { vi.useRealTimers(); });

  const payload = {
    area: 'EE', areaLabel: 'Estonia',
    operator: 'Elering (Estonian transmission system operator)',
    unit: 'MW',
    latest: {
      time: '2026-08-26T13:45:00.000Z', kind: 'actual',
      production: 514.78, consumption: 674.78, renewable: 13.74,
      // Null, as production almost always is. This fixture used to set `2.7`
      // here, which is why nothing caught the panel reading the wrong field for
      // as long as it did: measured against production, `latest.renewableShare`
      // is non-null for **1 interval in 45**, and the API measured 44 nulls in
      // one unbroken run across 763 readings over eight days. Solar is filed a
      // day at a time, so this is the normal state and not an outage.
      //
      // A fixture that is fresher than production cannot fail the way
      // production does.
      balance: -160, renewableShare: null,
    },
    meteredTo: '2026-08-26T13:45:00.000Z',
    // No `minutesBehind` on either clock, because the payload no longer carries
    // one. The panel subtracts these instants from `Date.now()` when it renders,
    // which is the only place the answer is true.
    renewableLatest: { share: 2.7, time: '2026-08-26T01:45:00.000Z' },
    actual: [
      { time: '2026-08-26T13:30:00.000Z', kind: 'actual', production: 525.93, consumption: 705.17, renewable: 15.34, balance: -179.24, renewableShare: null },
      { time: '2026-08-26T13:45:00.000Z', kind: 'actual', production: 514.78, consumption: 674.78, renewable: 13.74, balance: -160, renewableShare: null },
    ],
    forecast: [
      { time: '2026-08-26T14:00:00.000Z', kind: 'forecast', production: 664, consumption: 857.9, renewable: 84.5, balance: -193.9, renewableShare: 12.7 },
    ],
    source: 'Elering system data (with-plan)',
    fetchedAt: '2026-08-26T15:08:00.000Z',
  };

  async function renderWith(data: unknown) {
    fetchLiveGrid.mockResolvedValue(data);
    render(<GridStatePanel />);
    await screen.findByText(/Estonian grid|Estonian grid data unavailable/);
  }

  it('names Estonia in the heading, never "Baltic"', async () => {
    await renderWith(payload);
    expect(screen.getByText('Estonian grid')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Estonia only, not the Baltics/);
  });

  it('says nothing about retrieval when the response is current', async () => {
    // The banner is for a failure, so an ordinary render must not carry it.
    await renderWith(payload);
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).not.toMatch(/Elering last reached/);
  });

  it('says when the server last reached Elering, once that is too long ago', async () => {
    // `withCache` serves a body for thirty minutes after upstream fails, and
    // the panel showed the same calm figures throughout — a reader could not
    // tell a working feed from a dead one. `fetchedAt` is stamped when the
    // handler runs, so it stays at the last success while the body is reused.
    vi.setSystemTime(new Date('2026-08-26T15:33:00.000Z'));   // 25 min later
    await renderWith(payload);

    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text, 'the outage is not stated').toMatch(/Elering last reached 15:08 UTC/);
    expect(text).toMatch(/25 min behind/);

    // The control: the metered clock moves with the wall clock too, so this
    // cannot pass on a panel that simply printed a second copy of one figure.
    expect(text, 'the metered age did not move with the clock').toMatch(/1\.8 h behind/);
  });

  it('dates the reading and says how stale it is', async () => {
    // "Freshest thing on the site" and "current" are different claims.
    await renderWith(payload);
    expect(screen.getByText(/metered to 13:45 UTC/)).toBeTruthy();
    expect(screen.getByText(/83 min behind/)).toBeTruthy();
  });

  it('calls a negative balance an import, and shows it unsigned', async () => {
    await renderWith(payload);
    expect(screen.getByText('Net import')).toBeTruthy();
    expect(screen.getByText('160')).toBeTruthy();
  });

  it('calls a positive balance an export', async () => {
    await renderWith({
      ...payload,
      latest: { ...payload.latest, balance: 90, production: 764.78 },
    });
    expect(screen.getByText('Net export')).toBeTruthy();
  });

  it('shows no frequency dial, because the source reports a constant', async () => {
    await renderWith(payload);
    expect(document.body.textContent).not.toMatch(/Hz|[Ff]requency/);
  });

  it('describes the chart, and leaves the panel figures as text', async () => {
    await renderWith(payload);

    // Queried by *outcome* rather than by role, which is what the comment below
    // has always claimed and what the query did not do. It used to be
    // `getByRole('img')`, pinning the description to a wrapping div; the name
    // now sits on the chart surface itself, where focus lands, so a role-bound
    // query broke on a change that improved the thing it was guarding.
    //
    // The control comes first: if the chart did not render, every `aria-label`
    // query returns nothing and the assertions below would pass vacuously on an
    // empty string.
    const labelled = [...document.querySelectorAll('[aria-label]')]
      .map((n) => n.getAttribute('aria-label') ?? '');
    expect(labelled.length, 'no labelled element at all — the chart did not draw').toBeGreaterThan(0);

    const label = labelled.find((l) => /generation against demand/i.test(l)) ?? '';
    expect(label, 'the chart carries no description').not.toBe('');

    // This used to assert the chart's `aria-label` recited the net flow and
    // the renewable share. It was renamed and rewritten rather than deleted,
    // because the old form pinned a defect: **renewable share is not plotted
    // here at all.** The chart's three `dataKey`s are `generated`, `metered`
    // and `planned`, so the label was making a claim about a quantity the
    // graphic does not contain — and reciting three figures that are already
    // adjacent text, which makes a screen reader read them twice.
    //
    // So the assertion moved from the technique to the outcome. What matters
    // is that the information is reachable, not which element carries it.
    expect(label, 'the label should describe what is plotted').toMatch(/generation against demand/i);
    expect(label, 'and where measurement stops').toMatch(/Measured to .*forecast/i);

    // Two of the three series run past `meteredTo` into the operator's
    // forecast, and `describeComparison` otherwise reports each series' own
    // *last* observation — so "Demand, forecast" was announced at the end of
    // the forecast horizon rather than at the boundary. Same fault that told
    // a screen reader Finland was at EUR 1.83 while the panel showed 27.45.
    //
    // Passing `asAt` pins every series to the metered boundary. Asserted as a
    // relation rather than against fixture values: all three clauses must
    // name the same period, and it must be the one the panel calls measured.
    const at = [...label.matchAll(/\bat (\d{2}:\d{2})\b/g)].map((m) => m[1]);
    const measuredTo = label.match(/Measured to (\d{2}:\d{2})/)?.[1];

    expect(at.length, 'each plotted series should be reported at a named period').toBe(3);
    expect(new Set(at).size, 'all three series must be read at one period, not each at its own end').toBe(1);
    expect(at[0], 'and that period is where measurement stops, not where the forecast ends')
      .toBe(measuredTo);
    expect(label, 'a series that runs past the boundary must say so')
      .toMatch(/continues to \d{2}:\d{2}/i);
    expect(label, 'renewable share is not plotted, so the chart must not claim it')
      .not.toMatch(/per cent|renewable/i);

    // The companion assertion, and the one that makes the removal safe: the
    // figures are still in the accessible content of the panel, as text.
    // Without this, the check above passes just as well on a panel that
    // dropped them altogether.
    expect(document.body.textContent, 'net flow is still readable').toMatch(/Net import/);
    expect(document.body.textContent, 'renewable share is still readable').toMatch(/2\.7/);
  });

  it('reads the renewable share from the field that carries one', async () => {
    // The seam this closes. `/api/live-grid` computes two renewable figures:
    // `latest.renewableShare`, the share AT `meteredTo`, and `renewableLatest`,
    // the newest interval that actually has one. The panel read the first.
    //
    // Solar is filed a day at a time, so the first is null almost always —
    // measured against production 2026-08-30, **1 of 45 intervals**, one
    // unbroken trailing run, zero interior holes; the API measured 44 nulls in
    // 763 readings across eight days. So a reader saw an em-dash under
    // "Renewable" while a real 53.9% sat one field away, unread by anything in
    // `src/`.
    //
    // The producer had anticipated exactly this and written down why the two
    // must not be conflated. The consumer read the other one.
    await renderWith(payload);

    expect(document.body.textContent, 'the share the API can stand behind is not shown')
      .toMatch(/2\.7/);
  });

  it('dates the renewable share, because it is on a slower clock', async () => {
    // And the reason the fix is not simply "read the other field". That figure
    // was 715 minutes old beside three stats 55 minutes old. Printing it under
    // the header's "metered to 13:45" would be a 12-hour-old number wearing an
    // 83-minute-old timestamp — the fault the API separated the fields to avoid.
    await renderWith(payload);

    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');

    expect(text, 'the share is shown without its own age').toMatch(/13\.4 h behind/);

    // The control. The metered clock must still be stated too, or this passes
    // on a panel that simply relabelled the one timestamp it had.
    expect(text, 'the metered clock is gone').toMatch(/83 min behind/);
  });

  it('says which kind of emptiness, when there is no share at all', async () => {
    // A bare em-dash is two states wearing one symbol — "no reading" and "no
    // renewables generated" — and on a grid panel a reader could believe the
    // second. Both `absent` and `null` mean nothing to show, and both must say
    // so rather than render a dash alone.
    // Each case is rendered in its own `it`-scoped cleanup, because
    // `renderWith` mounts into the document body and three mounts leave three
    // panels for `findByText` to match. The failure that taught me this was a
    // "found multiple elements" from the harness, not from the component.
    for (const missing of [undefined, null, { share: null, time: null, minutesBehind: null }]) {
      cleanup();
      await renderWith({ ...payload, renewableLatest: missing });

      const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
      expect(text, `renewableLatest=${JSON.stringify(missing)} rendered a bare dash`)
        .toMatch(/not yet filed/);

      // The control, in the same render: the panel is otherwise intact, so a
      // pass here cannot come from a panel that failed to draw at all.
      expect(text, 'the panel did not render').toMatch(/Estonian grid/);
    }
  });

  it('says so plainly when the grid data will not load', async () => {
    await renderWith(null);
    expect(screen.getByText(/Estonian grid data unavailable/)).toBeTruthy();
  });
});
