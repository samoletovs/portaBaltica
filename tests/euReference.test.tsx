/**
 * The European denominator.
 *
 * The dashboard could answer "who is ahead" and not "is 6.8% good or bad",
 * because the only baseline on offer was two small neighbours. `EU27_2020`
 * rides on the same cube in the same request — one more `geo=` on a call we
 * already make — so this is new data from an existing API rather than a new
 * upstream, a new failure mode and a new thing to trust.
 *
 * **It is a reference, not a fourth country**, and that distinction is
 * structural rather than cosmetic. It is returned outside `countries`, because
 * everything that iterates that record — the ranked comparison, the indicator
 * cards, the chart's own colour assignment — treats its keys as Baltic states.
 * A fourth entry would have put the European Union into a ranking of Latvia,
 * Estonia and Lithuania.
 *
 * Measured against live Eurostat: 53 of the 65 indicators carry it with data.
 * The 12 that do not are not a fault — ten are `bop_c6_q`, where an EU
 * aggregate balance of payments against itself means little because intra-EU
 * flows cancel, and `minimum_wage` has no EU figure because not every member
 * state has one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';
import { BalticCompareChart } from '../src/components/BalticCompareChart';
import type { BalticCompareData } from '../src/api';

const require = createRequire(import.meta.url);

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

describe('the reference is built from observations, not from a label', () => {
  const handler = require('../api/baltic-compare/index.js');
  const buildReference = handler.buildReference;

  it('is null when the cube lists EU27 but populates none of it', () => {
    // `rail_go_quartal` does exactly this. A check for the code's *presence*
    // would have drawn an empty benchmark — the same mistake as a probe that
    // goes green because the cube answered.
    expect(buildReference({ series: [
      { period: '2025-Q4', value: null },
      { period: '2026-Q1', value: null },
    ] })).toBeNull();
  });

  it('is null when the cube has no EU27 at all', () => {
    expect(buildReference(undefined)).toBeNull();
    expect(buildReference(null)).toBeNull();
    expect(buildReference({})).toBeNull();
  });

  it('refuses a non-finite value rather than reporting it as the average', () => {
    expect(buildReference({ series: [{ period: '2026-Q1', value: Number.NaN }] })).toBeNull();
    expect(buildReference({ series: [{ period: '2026-Q1', value: '6.0' }] })).toBeNull();
  });

  it('takes its latest from the newest observation that exists', () => {
    // Trailing nulls are ordinary — the EU aggregate is often published a
    // period behind its members — and the benchmark must date itself to the
    // reading it actually has.
    const ref = buildReference({ series: [
      { period: '2026-Q1', value: 6.2 },
      { period: '2026-Q2', value: 6.0 },
      { period: '2026-Q3', value: null },
    ] });
    expect(ref.latest).toBe(6.0);
    expect(ref.latestPeriod).toBe('2026-Q2');
    expect(ref.label).toBe('EU27');
    // Spelled out somewhere, because "EU27" is ambiguous between the pre- and
    // post-Brexit composition.
    expect(ref.fullLabel).toMatch(/from 2020/);
  });
});

describe('the chart draws the benchmark, and withholds it', () => {
  beforeEach(() => fetchBalticCompare.mockReset());

  function payload(reference: BalticCompareData['reference']): BalticCompareData {
    const series = (a: number, b: number) => [
      { period: '2026-Q1', value: a },
      { period: '2026-Q2', value: b },
    ];
    return {
      indicator: 'unemployment', title: 'Unemployment', unit: '%',
      countries: {
        LV: { label: 'Latvia', series: series(6.9, 6.8) },
        EE: { label: 'Estonia', series: series(7.4, 7.2) },
        LT: { label: 'Lithuania', series: series(6.1, 6.3) },
      } as unknown as BalticCompareData['countries'],
      reference,
      source: 'Eurostat (une_rt_m)',
      assumptions: [],
    };
  }

  async function renderWith(reference: BalticCompareData['reference']) {
    fetchBalticCompare.mockResolvedValue(payload(reference));
    render(<BalticCompareChart indicator="unemployment" title="Unemployment" />);
    await screen.findByText('Unemployment');
  }

  const REAL = {
    code: 'EU27_2020', label: 'EU27',
    fullLabel: 'European Union — 27 countries (from 2020)',
    series: [{ period: '2026-Q1', value: 6.1 }, { period: '2026-Q2', value: 6.0 }],
    latest: 6.0, latestPeriod: '2026-Q2',
  };

  it('shows the EU figure beside the three, so "good or bad" is answerable', async () => {
    await renderWith(REAL);
    expect(screen.getByText('EU27')).toBeTruthy();
    expect(screen.getByText('6.0%')).toBeTruthy();
    expect(screen.getByText(/LV vs EE vs LT vs EU27/)).toBeTruthy();
  });

  it('withholds everything about it when the cube carries none', async () => {
    // The companion assertion. A chart with no benchmark must look intentional
    // rather than broken, so nothing about it renders at all — not a label, not
    // an empty line, not a dash.
    await renderWith(null);
    expect(screen.queryByText('EU27')).toBeNull();
    expect(screen.getByText(/LV vs EE vs LT ·/)).toBeTruthy();
    expect(screen.queryByText(/vs EU27/)).toBeNull();
  });

  it('never gives it a country swatch or a flag', async () => {
    // DESIGN.md §3.6 reserves the series palette for the three flags, and the
    // EU is not a Baltic state. The benchmark is marked with a dashed rule.
    await renderWith(REAL);
    const eu = screen.getByText('EU27').closest('div');
    expect(eu).toBeTruthy();
    expect(eu!.querySelector('.border-dashed'), 'the benchmark needs its own mark').toBeTruthy();
    expect(eu!.textContent, 'no flag on the denominator').not.toMatch(/🇱🇻|🇪🇪|🇱🇹|🇪🇺/);
  });

  it('names the composition for a screen reader rather than only "EU27"', async () => {
    await renderWith(REAL);
    expect(screen.getByText(/European Union — 27 countries \(from 2020\) average:/)).toBeTruthy();
  });

  it('still renders the three countries when the benchmark is absent', async () => {
    // The benchmark is additive. Losing it must not cost the comparison.
    await renderWith(null);
    expect(screen.getByText('6.8%')).toBeTruthy();
    expect(screen.getByText('7.2%')).toBeTruthy();
    expect(screen.getByText('6.3%')).toBeTruthy();
  });
});

describe('the reference never becomes a fourth country', () => {
  const handler = require('../api/baltic-compare/index.js');

  it('keeps EU27 out of the countries record', () => {
    // The structural half of "denominator, not subject". Asserted on the
    // handler's own splitting so a future refactor cannot merge them back.
    expect(handler.GEOS).toEqual(['LV', 'EE', 'LT']);
    expect(handler.GEOS).not.toContain('EU27_2020');
    expect(handler.REFERENCE_GEO).toBe('EU27_2020');
  });
});
