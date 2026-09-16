import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { render, screen } from '@testing-library/react';
import type { PortMeasure } from '../src/types';
import { VesselTrafficPanel } from '../src/components/VesselTrafficPanel';

const require = createRequire(import.meta.url);
const es: { httpJson: (url: string) => Promise<unknown> } = require('../api/shared/eurostat.js');
const ports: {
  COUNTRIES: string[];
  PORTS: Record<string, { code: string }[]>;
  seriesUrls: (country: string) => { vessels: string };
} = require('../api/shared/ports.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const limiter: { reset: () => void } = require('../api/shared/rateLimit.js');
interface Response { status: number; body: string }
const handler: (context: { res?: Response }, request: { query: { country: string }; headers: object }) => Promise<void> =
  require('../api/port-data/index.js');

function vesselCube(readings: Record<string, number | null>) {
  const codes = Object.keys(readings);
  return {
    id: ['freq', 'tonnage', 'vessel', 'unit', 'rep_mar', 'time'],
    size: [1, 1, 1, 1, codes.length, 2],
    dimension: {
      freq: { category: { index: { Q: 0 } } },
      tonnage: { category: { index: { TOTAL: 0 } } },
      vessel: { category: { index: { TOTAL: 0 } } },
      unit: { category: { index: { NR: 0 } } },
      rep_mar: { category: {
        index: Object.fromEntries(codes.map((code, index) => [code, index])),
        label: { EE: 'Estonia', LV: 'Latvia' },
      } },
      time: { category: { index: { '2025-Q4': 0, '2026-Q1': 1 } } },
    },
    value: codes.flatMap(code => [readings[code], null]),
  };
}

function upstream(readings: Record<string, number | null>) {
  vi.spyOn(es, 'httpJson').mockImplementation(async address => {
    const url = new URL(address);
    if (!url.pathname.endsWith('/mar_tf_qm')) return {};
    const asked = url.searchParams.getAll('rep_mar');
    return vesselCube(Object.fromEntries(Object.entries(readings).filter(([code]) => asked.includes(code))));
  });
}

async function call(country: string) {
  const context: { res?: Response } = {};
  await handler(context, { query: { country }, headers: {} });
  if (!context.res) throw new Error('Port handler did not respond');
  return { status: context.res.status, body: JSON.parse(context.res.body) as { vessels: PortMeasure; assumptions: unknown[] } };
}

beforeEach(() => { cache.clear(); limiter.reset(); });
afterEach(() => { vi.restoreAllMocks(); cache.clear(); limiter.reset(); });

describe('a country-only vessel return reaches the existing labelled fallback', () => {
  it.each(ports.COUNTRIES)('%s requests only its named ports and national fallback', country => {
    expect(new URL(ports.seriesUrls(country).vessels).searchParams.getAll('rep_mar').sort())
      .toEqual([...ports.PORTS[country].map(port => port.code), country].sort());
  });

  it('renders the actual national reading rather than an empty or invented port breakdown', async () => {
    upstream({ EE: 7397, EE_0EE88C: 7397 });
    const response = await call('EE');
    expect(response.status).toBe(200);
    expect(response.body.assumptions).toEqual([]);
    expect(response.body.vessels).toMatchObject({
      unit: 'NR', countryOnly: true, latest: '2025-Q4',
      ports: [{ code: 'EE', name: 'Estonia', series: [{ period: '2025-Q4', value: 7397 }] }],
    });
    expect(response.body.vessels.ports).toHaveLength(1);
    render(<VesselTrafficPanel measure={response.body.vessels} />);
    expect(screen.getAllByText('7,397').length).toBeGreaterThan(0);
    expect(screen.getByText(/no port breakdown for this country/)).toBeTruthy();
    expect(screen.queryByText('Tallinn')).toBeNull();
  });

  it('keeps named ports and never double-counts their national aggregate', async () => {
    upstream({ LV: 1000, LV_0LVRIX: 568 });
    const response = await call('LV');
    expect(response.status).toBe(200);
    expect(response.body.vessels.countryOnly).toBe(false);
    expect(response.body.vessels.ports.map(port => port.code)).toEqual(['LV_0LVRIX']);
    expect(response.body.vessels.ports[0].series).toEqual([{ period: '2025-Q4', value: 568 }]);
  });

  it('does not turn an all-missing national series into available traffic', async () => {
    upstream({ EE: null });
    const response = await call('EE');
    expect(response.status).toBe(502);
    expect(response.body.vessels.ports).toEqual([]);
    expect(response.body.vessels.latest).toBeNull();
  });
});
