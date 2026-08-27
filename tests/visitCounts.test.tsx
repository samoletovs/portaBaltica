import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { SystemStatus } from '../src/types';

/**
 * What the status panel says about traffic.
 *
 * The number itself comes from Azure Monitor and is tested in
 * `visitStats.test.ts`; what is tested here is the wording and the failure
 * behaviour, because both are ways this feature can mislead while working
 * perfectly.
 *
 * The wording, because `SiteHits` counts HTTP requests and a single-page app
 * serves a dozen or more per arrival. Rendering it as "visits" would inflate
 * the audience by the asset-per-page ratio and nobody would ever notice,
 * because the figure would still move in the right direction on the right days.
 *
 * The failure behaviour, because the counts come from a blob this app neither
 * writes nor controls. When that read fails the panel must show nothing at all.
 * A zero would be a claim that nobody came.
 */

vi.mock('../src/api', () => ({
  fetchSystemStatus: vi.fn(),
}));

const { fetchSystemStatus } = await import('../src/api');
const { SystemStatusFooter } = await import('../src/components/SystemStatusFooter');

const BASE: SystemStatus = {
  status: 'healthy',
  version: '0.4.0',
  phase: 'Phase 3 — Deep Latvia',
  dataSources: { healthy: 12, total: 12, checks: [] },
  apis: { total: 13, endpoints: [] },
  selfSustaining: {
    monthlyInfrastructureCost: '~€5-18',
    revenue: '€0 (pre-monetization)',
    status: 'Phase 3',
  },
  respondedIn: '565ms',
  fetchedAt: '2026-08-27T14:39:34Z',
};

const TRAFFIC = {
  unit: 'requests',
  metric: 'SiteHits',
  today: 2328,
  last7Days: 4736,
  last30Days: 12944,
  dailyAverage30d: 431.5,
  timezone: 'Europe/Riga',
  generatedAt: '2026-08-27T14:39:34Z',
  ageMs: 12 * 60 * 1000,
};

/** Render the footer and open the details, where the counts live. */
async function openDetails(status: SystemStatus) {
  vi.mocked(fetchSystemStatus).mockResolvedValue(status);
  render(<SystemStatusFooter />);
  await waitFor(() => expect(screen.getByText(/System healthy/)).toBeTruthy());
  fireEvent.click(screen.getByLabelText('Toggle system status details'));
}

afterEach(() => vi.clearAllMocks());

describe('the traffic block', () => {
  it('shows today, the week and the month', async () => {
    await openDetails({ ...BASE, traffic: TRAFFIC });

    expect(screen.getByText('2,328')).toBeTruthy();
    expect(screen.getByText('4,736')).toBeTruthy();
    expect(screen.getByText('12,944')).toBeTruthy();
  });

  it('calls them requests, and never visits', async () => {
    await openDetails({ ...BASE, traffic: TRAFFIC });

    expect(screen.getByText('Site requests')).toBeTruthy();
    expect(screen.getByText(/HTTP requests, not unique visitors/)).toBeTruthy();
    // The word must not appear anywhere in the rendered panel, including in a
    // heading or a tooltip somebody adds later.
    expect(document.body.textContent).not.toMatch(/visits/i);
  });

  it('says how old the reading is, so it does not look live', async () => {
    await openDetails({ ...BASE, traffic: TRAFFIC });
    expect(screen.getByText(/updated 12m ago/)).toBeTruthy();
  });

  it('shows nothing at all when the counts could not be read', async () => {
    // The endpoint omits the key when the blob read fails. The panel must not
    // fill the gap with zeros.
    await openDetails({ ...BASE, traffic: null });

    expect(screen.queryByText('Site requests')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0\b requests/);
  });

  it('shows nothing when the payload carries the key with the wrong types', async () => {
    // A truncated or half-written blob parses fine and would otherwise print
    // "NaN" beside a healthy status line.
    const broken = { ...TRAFFIC, today: 'lots' } as unknown as SystemStatus['traffic'];
    await openDetails({ ...BASE, traffic: broken });

    expect(screen.queryByText('Site requests')).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('still renders the rest of the panel when traffic is missing', async () => {
    // The counts are decoration on a health panel. Losing them must not cost
    // the reader the thing they actually came for.
    await openDetails({ ...BASE, traffic: null });

    expect(screen.getByText('Data Sources')).toBeTruthy();
    expect(screen.getByText('Moonshot Status')).toBeTruthy();
  });
});
