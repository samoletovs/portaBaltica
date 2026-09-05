/**
 * The count beside the badge must count what the badge counts.
 *
 * `/api/system-status` makes its verdict from **required sources only** —
 * `AGENTS.md`: "an optional probe cannot change the verdict by construction".
 * The footer rendered `healthy/total`, the *combined* figure, so the badge and
 * the number beside it answered different questions in the same visual grammar.
 *
 * This is not a latent inconsistency waiting for an outage. Measured against
 * production over five minutes on 2026-08-30, eight distinct readings past the
 * 60-second cache TTL:
 *
 *     09:15:54  healthy  11/12  req 8/8   Riga Open Data: unhealthy
 *     09:16:54  healthy  11/12  req 8/8   Riga Open Data: pending
 *     09:17:10  healthy  12/12  req 8/8
 *     09:18:18  healthy  11/12  req 8/8   Riga Open Data: unhealthy
 *     ...
 *     five of eight  =  63% showed "11/12" beside a green "System healthy"
 *
 * Every one was Riga Open Data, whose own `powers` field reads "Nothing —
 * retained as an availability signal only".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const fetchSystemStatus = vi.fn();
vi.mock('../src/api', () => ({
  fetchSystemStatus: (...args: unknown[]) => fetchSystemStatus(...args),
}));

import { SystemStatusFooter } from '../src/components/SystemStatusFooter';

/** One probe, as the endpoint reports it. */
function check(name: string, status: string, required: boolean, powers?: string) {
  return { name, status, latency: 100, required, powers };
}

/**
 * A payload with the real production shape.
 *
 * `overall` is passed independently of the counts on purpose: the whole defect
 * is that the two can disagree, so a fixture that derived one from the other
 * could not express the case under test.
 */
function payload(overall: string, checks: ReturnType<typeof check>[]) {
  const healthy = checks.filter((c) => c.status === 'healthy').length;
  const req = checks.filter((c) => c.required);
  const opt = checks.filter((c) => !c.required);
  return {
    status: overall,
    version: 'v1',
    phase: '3',
    dataSources: {
      healthy,
      total: checks.length,
      requiredHealthy: req.filter((c) => c.status === 'healthy').length,
      requiredTotal: req.length,
      optionalHealthy: opt.filter((c) => c.status === 'healthy').length,
      optionalTotal: opt.length,
      checks,
    },
    apis: { total: 14, endpoints: [] },
    selfSustaining: { monthlyInfrastructureCost: '', revenue: '', status: '' },
  };
}

/** The production line-up, reduced to the two that matter. */
const REQUIRED_OK = [
  check('Eurostat', 'healthy', true, 'All Baltic comparison charts'),
  check('ECB Exchange Rates', 'healthy', true, 'Currency ticker'),
];
const RIGA_DOWN = check('Riga Open Data', 'unhealthy', false, 'Nothing — retained as an availability signal only');
const RIGA_OK = check('Riga Open Data', 'healthy', false, 'Nothing — retained as an availability signal only');
const ELERING_DOWN = check('Elering grid state', 'unhealthy', false, 'Live grid state panel');

/** Two drains: `await Promise.resolve()` does not flush a React state update. */
async function renderFooter() {
  render(<SystemStatusFooter />);
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => { fetchSystemStatus.mockReset(); });
afterEach(() => { cleanup(); });

describe('the headline count agrees with the badge', () => {
  it('reports the required sources, not the combined figure', async () => {
    // The measured production case: an optional source down, everything the
    // reader depends on up. Before this change the line read "2/3".
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_DOWN]));
    await renderFooter();

    expect(screen.getByText(/System healthy/)).toBeTruthy();
    expect(document.body.textContent).toContain('2/2 data sources');
    expect(
      document.body.textContent,
      'the combined count contradicts a required-only badge',
    ).not.toContain('2/3 data sources');
  });

  it('says an optional source is unavailable rather than hiding it', async () => {
    // Suppressing it entirely would be the other failure: the footer's job is
    // to report, and a source that is down should be visible somewhere.
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_DOWN]));
    await renderFooter();

    expect(document.body.textContent).toContain('1 optional source unavailable');
  });

  it('says nothing about optional sources when they are all up', async () => {
    // The negative half. A message that is always present carries no
    // information, and would make the assertion above pass for the wrong
    // reason.
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_OK]));
    await renderFooter();

    expect(document.body.textContent).toContain('2/2 data sources');
    expect(document.body.textContent).not.toContain('optional source');
  });

  it('pluralises, because "1 optional sources" reads as a bug', async () => {
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_DOWN, ELERING_DOWN]));
    await renderFooter();

    expect(document.body.textContent).toContain('2 optional sources unavailable');
  });
});

describe('a required failure and an optional one are distinguishable', () => {
  it('marks stale required data as a warning rather than an unreachable system', async () => {
    fetchSystemStatus.mockResolvedValue(payload('stale', [
      check('Eurostat', 'stale', true, 'Baltic comparisons'),
      check('ECB Exchange Rates', 'healthy', true, 'Currency ticker'),
    ]));
    await renderFooter();
    const label = screen.getByText('System stale');
    expect(label.classList.contains('dash-warning')).toBe(true);
    expect(label.classList.contains('dash-negative')).toBe(false);
  });

  it('a required source down moves both the badge and the count', async () => {
    // The other side of the plant. If this rendered the same way as the
    // optional case, the fix would have made every failure look harmless —
    // which is worse than the defect it replaces.
    const checks = [
      check('Eurostat', 'unhealthy', true, 'All Baltic comparison charts'),
      check('ECB Exchange Rates', 'healthy', true, 'Currency ticker'),
      RIGA_OK,
    ];
    fetchSystemStatus.mockResolvedValue(payload('degraded', checks));
    await renderFooter();

    expect(screen.getByText(/System degraded/)).toBeTruthy();
    expect(document.body.textContent).toContain('1/2 data sources');
    expect(document.body.textContent).not.toContain('optional source');
  });

  it('renders differently in the two cases', async () => {
    // Asserted as an inequality rather than by describing each rendering,
    // because that is the property the reader actually needs: the two states
    // must not look alike.
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_DOWN]));
    await renderFooter();
    const optionalCase = document.body.textContent;

    cleanup();

    fetchSystemStatus.mockResolvedValue(payload('degraded', [
      check('Eurostat', 'unhealthy', true, 'All Baltic comparison charts'),
      check('ECB Exchange Rates', 'healthy', true, 'Currency ticker'),
      RIGA_OK,
    ]));
    await renderFooter();

    expect(document.body.textContent).not.toBe(optionalCase);
  });
});

describe('powers explains an amber dot', () => {
  it('names what an unhealthy source powers', async () => {
    // The field was served for every check and rendered nowhere — the sweep in
    // `#259` classified it `test-only`. It is the sentence that tells a reader
    // whether the amber dot concerns them.
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_DOWN]));
    render(<SystemStatusFooter />);
    await act(async () => {});
    await act(async () => {});

    screen.getByLabelText('Toggle system status details').click();
    await act(async () => {});

    expect(document.body.textContent).toContain('Nothing — retained as an availability signal only');
  });

  it('does not explain a healthy source', async () => {
    // Twelve explanations at all times is a list nobody reads, and a healthy
    // source raises no question that needs answering.
    fetchSystemStatus.mockResolvedValue(payload('healthy', [...REQUIRED_OK, RIGA_OK]));
    render(<SystemStatusFooter />);
    await act(async () => {});
    await act(async () => {});

    screen.getByLabelText('Toggle system status details').click();
    await act(async () => {});

    expect(document.body.textContent).toContain('Riga Open Data');
    expect(document.body.textContent).not.toContain('availability signal only');
  });
});

describe('absence does not invent a count', () => {
  it('falls back to the combined figure when the server sends no split', async () => {
    // `AGENTS.md`: absence must not resolve to success. An older server, or a
    // stale cached response, has no `requiredHealthy` — and rendering `0/0`
    // would report a site with no data sources at all.
    const p = payload('healthy', [...REQUIRED_OK, RIGA_DOWN]);
    delete (p.dataSources as Record<string, unknown>).requiredHealthy;
    delete (p.dataSources as Record<string, unknown>).requiredTotal;
    delete (p.dataSources as Record<string, unknown>).optionalHealthy;
    delete (p.dataSources as Record<string, unknown>).optionalTotal;
    fetchSystemStatus.mockResolvedValue(p);
    await renderFooter();

    expect(document.body.textContent).toContain('2/3 data sources');
    expect(document.body.textContent).not.toContain('0/0');
    expect(document.body.textContent).not.toContain('optional source');
  });

  it('does not render at all when the counts are the wrong type', async () => {
    // The existing guard, kept under test: this footer sits outside App's error
    // boundaries, so one bad read removes the whole page rather than one tile.
    fetchSystemStatus.mockResolvedValue({ status: 'healthy', dataSources: { healthy: null, total: 'x' } });
    const { container } = render(<SystemStatusFooter />);
    await act(async () => {});
    await act(async () => {});

    expect(container.textContent).toBe('');
  });
});
