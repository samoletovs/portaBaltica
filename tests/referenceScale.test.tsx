/**
 * The benchmark must not cost the comparison.
 *
 * `/api/baltic-compare` withholds the EU figure where the registry declares the
 * statistic a total, and that is the right gate. This is the second half: the
 * chart measures the axis it is about to draw, because the registry entry is a
 * hand-written classification of sixty-six indicators and nothing upstream
 * checks that a classification is true.
 *
 * Every fixture below is a real reading, taken live from Eurostat over a
 * five-year window on 389d1f9, so the thresholds are held against observed data
 * rather than against invented data that agrees with them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  measureReferenceScale,
  referenceSharesAxis,
  MIN_AXIS_RETENTION,
  MIN_LEGIBLE_BAND,
} from '../src/utils/referenceScale';
import { BalticCompareChart } from '../src/components/BalticCompareChart';
import type { BalticCompareData } from '../src/api';

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

/** Endpoints of a real series, which is all the axis arithmetic reads. */
const RUINED = {
  // The three charts in the bug report, and the two orders of magnitude that
  // made them useless. Retention measured at 0.002, 0.002 and 0.006.
  tourism_foreign: { baltic: [17_200, 530_523], eu: [5_556_793, 240_360_724] },
  tourism: { baltic: [79_289, 1_220_439], eu: [29_668_841, 511_537_058] },
  air_passengers: { baltic: [84_838, 2_150_299], eu: [25_203_113, 337_989_035] },
  population: { baltic: [1_330_068, 2_890_664], eu: [445_891_011, 450_646_971] },
  // The mildest of the eleven, and still 0.034.
  road_freight_tkm: { baltic: [897, 17_703], eu: [451_439, 496_427] },
};

const KEPT = {
  // The three most distant *legitimate* benchmarks. The gap to the EU is the
  // finding on each of them, and the three still read as three.
  gov_debt_gdp: { baltic: [18.4, 46.9], eu: [80.5, 86.7] },
  salary: { baltic: [11.3, 21.1], eu: [28.8, 34.9] },
  gdp_per_capita: { baltic: [16_580, 22_800], eu: [32_470, 34_100] },
  unemployment: { baltic: [5.0, 8.5], eu: [5.8, 7.5] },
  inflation: { baltic: [-0.4, 25.2], eu: [1.2, 11.5] },
};

describe('a benchmark that would flatten the three is not drawn', () => {
  it.each(Object.entries(RUINED))('withholds it on %s', (_id, { baltic, eu }) => {
    const scale = measureReferenceScale(baltic, eu)!;
    expect(scale.retention).toBeLessThan(MIN_AXIS_RETENTION);
    expect(scale.sharesAxis).toBe(false);
  });

  // The companion assertion. Without it every case above would also pass
  // against a function that returns false for everything, which is the same
  // fault as a probe that reports "absent" because it can see nothing.
  it.each(Object.entries(KEPT))('keeps it on %s, where the distance is the point', (_id, { baltic, eu }) => {
    const scale = measureReferenceScale(baltic, eu)!;
    expect(scale.retention).toBeGreaterThanOrEqual(MIN_AXIS_RETENTION);
    expect(scale.sharesAxis).toBe(true);
  });

  it('separates the two groups by two orders of magnitude, not by a hair', () => {
    // The threshold is only defensible if it sits in empty space. If a future
    // indicator lands between these, the number needs re-deriving rather than
    // nudging.
    const worstKept = Math.min(
      ...Object.values(KEPT).map((f) => measureReferenceScale(f.baltic, f.eu)!.retention),
    );
    const bestRuined = Math.max(
      ...Object.values(RUINED).map((f) => measureReferenceScale(f.baltic, f.eu)!.retention),
    );
    expect(bestRuined).toBeLessThan(0.05);
    expect(worstKept).toBeGreaterThan(0.5);
    expect(MIN_AXIS_RETENTION).toBeGreaterThan(bestRuined);
    expect(MIN_AXIS_RETENTION).toBeLessThan(worstKept);
  });
});

describe('a band that was already unreadable is not the benchmark\'s fault', () => {
  // Measured with no EU line drawn at all: life expectancy spans 7.6% of its
  // own zero-based axis, the employment rate 9.5%, labour productivity 12.4%.
  // That is what a zero-based axis does to a series living at 73–79, and
  // withholding the benchmark does not widen it by one pixel — it only removes
  // a reading the chart could otherwise give.
  const ALREADY_TIGHT = {
    life_expectancy: { baltic: [73.2, 79.4], eu: [80.0, 81.5] },
    employment_rate: { baltic: [74.7, 82.5], eu: [71.9, 76.3] },
    labour_productivity: { baltic: [97.8, 111.7], eu: [104.67, 106.59] },
  };

  it.each(Object.entries(ALREADY_TIGHT))('keeps it on %s', (_id, { baltic, eu }) => {
    const scale = measureReferenceScale(baltic, eu)!;
    expect(scale.bandWithout, 'this fixture is only meaningful if the band is tight to begin with')
      .toBeLessThan(MIN_LEGIBLE_BAND);
    expect(scale.sharesAxis).toBe(true);
  });
});

describe('absence resolves to withholding, not to drawing', () => {
  it.each([
    ['no readings at all', [], []],
    ['no benchmark', [5, 8], []],
    ['no countries', [], [6]],
    ['nulls where readings should be', [null, null], [6]],
    ['a series that is entirely zero', [0, 0], [0]],
  ])('%s', (_case, baltic, eu) => {
    expect(referenceSharesAxis(baltic as number[], eu as number[])).toBe(false);
  });

  it('still draws it when there is something to measure', () => {
    // Proves the cases above fail for the reason claimed rather than because
    // the predicate never returns true.
    expect(referenceSharesAxis([5, 8.5], [6, 7.5])).toBe(true);
  });
});

describe('the chart shows the figure even when it withholds the line', () => {
  beforeEach(() => fetchBalticCompare.mockReset());

  /**
   * The disclosure, matched without committing to the apostrophe.
   *
   * The markup uses a typographic `&rsquo;` and the first draft of this file
   * searched for a straight `'`. The positive assertion failed loudly, which
   * was lucky — the *negative* one two tests below would have passed for the
   * same reason, reporting "the note is absent" about a note it could never
   * have found. An absent result is a claim about the instrument first.
   */
  const SCALE_NOTE = /off this chart.s scale/;

  function payload(euLow: number, euHigh: number): BalticCompareData {
    const series = (a: number, b: number) => [
      { period: '2026-Q1', value: a },
      { period: '2026-Q2', value: b },
    ];
    return {
      indicator: 'tourism', title: 'Tourist arrivals', unit: 'persons',
      countries: {
        LV: { label: 'Latvia', series: series(528_988, 530_523) },
        EE: { label: 'Estonia', series: series(718_385, 720_000) },
        LT: { label: 'Lithuania', series: series(948_906, 950_000) },
      } as unknown as BalticCompareData['countries'],
      reference: {
        code: 'EU27_2020', label: 'EU27',
        fullLabel: 'European Union — 27 countries (from 2020)',
        series: series(euLow, euHigh),
        latest: euHigh, latestPeriod: '2026-Q2',
      },
      source: 'Eurostat (tour_occ_nim)',
      assumptions: [],
    };
  }

  async function renderWith(euLow: number, euHigh: number) {
    fetchBalticCompare.mockResolvedValue(payload(euLow, euHigh));
    render(<BalticCompareChart indicator="tourism" title="Tourist arrivals" />);
    await screen.findByText('Tourist arrivals');
  }

  it('keeps the EU figure beside the three and says why it is not drawn', async () => {
    await renderWith(287_000_000, 287_500_000);
    expect(screen.getByText('EU27')).toBeTruthy();
    expect(screen.getByText('288m')).toBeTruthy();
    expect(screen.getByText(SCALE_NOTE)).toBeTruthy();
  });

  it('drops the dashed key with the line rather than pointing it at nothing', async () => {
    await renderWith(287_000_000, 287_500_000);
    const eu = screen.getByText('EU27').closest('div');
    expect(eu!.querySelector('.border-dashed')).toBeNull();
  });

  it('says nothing about the scale when the benchmark is drawn', async () => {
    // The control. Same component, same reference shape, a benchmark that fits
    // — and the assertion above proves `SCALE_NOTE` can match, so this absence
    // is about the chart rather than about the pattern.
    await renderWith(900_000, 910_000);
    expect(screen.queryByText(SCALE_NOTE)).toBeNull();
    const eu = screen.getByText('EU27').closest('div');
    expect(eu!.querySelector('.border-dashed')).toBeTruthy();
  });
});
