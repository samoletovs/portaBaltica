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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fetchLiveGrid = vi.fn();
vi.mock('../src/api', () => ({
  fetchLiveGrid: (...args: unknown[]) => fetchLiveGrid(...args),
}));

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
  es.httpJson = () => opts.fail
    ? Promise.reject(new Error('HTTP 503 from dashboard.elering.ee'))
    : Promise.resolve(payload);
  try {
    delete require.cache[require.resolve('../api/live-grid/index.js')];
    const handler = require('../api/live-grid/index.js');
    const ctx: { res?: { body: string; status: number } } = {};
    await handler(ctx, { query: {}, headers: {} });
    return { status: ctx.res!.status, body: JSON.parse(ctx.res!.body) };
  } finally {
    es.httpJson = original;
  }
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

  it('reports how far behind the metering is', async () => {
    const { body } = await callApi(eleringPayload([row(83)], []));
    expect(body.minutesBehind).toBeGreaterThanOrEqual(82);
    expect(body.minutesBehind).toBeLessThanOrEqual(85);
    expect(body.meteredTo).toBeTruthy();
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
    const { body } = await callApi(eleringPayload(
      [row(60, { production: 500, production_renewable: 125 })], []));
    expect(body.latest.renewableShare).toBe(25);
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
  beforeEach(() => fetchLiveGrid.mockReset());

  const payload = {
    area: 'EE', areaLabel: 'Estonia',
    operator: 'Elering (Estonian transmission system operator)',
    unit: 'MW',
    latest: {
      time: '2026-08-26T13:45:00.000Z', kind: 'actual',
      production: 514.78, consumption: 674.78, renewable: 13.74,
      balance: -160, renewableShare: 2.7,
    },
    meteredTo: '2026-08-26T13:45:00.000Z',
    minutesBehind: 83,
    actual: [
      { time: '2026-08-26T13:30:00.000Z', kind: 'actual', production: 525.93, consumption: 705.17, renewable: 15.34, balance: -179.24, renewableShare: 2.9 },
      { time: '2026-08-26T13:45:00.000Z', kind: 'actual', production: 514.78, consumption: 674.78, renewable: 13.74, balance: -160, renewableShare: 2.7 },
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

  it('describes the whole panel to a screen reader', async () => {
    await renderWith(payload);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/net import of 160 megawatts/);
    expect(label).toMatch(/2.7 per cent/);
  });

  it('says so plainly when the grid data will not load', async () => {
    await renderWith(null);
    expect(screen.getByText(/Estonian grid data unavailable/)).toBeTruthy();
  });
});
