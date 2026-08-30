/**
 * The ranked comparison, and the one thing it must never do.
 *
 * Ten of the dashboard's comparison charts plot annual series over a five-year
 * window: three lines through five points, carrying a legend and two axes to
 * deliver fifteen numbers. A line chart's job is to show a shape over time, and
 * five points have no shape. This answers the questions a reader actually has
 * of an annual indicator — who leads, by how much, which way it is moving.
 *
 * **A country with no reading must not be ranked.** That is the design
 * constraint, and it comes from a real defect rather than a principle:
 * `classifySeaState` compared a missing wave height with `<` in every branch,
 * every comparison was false for a non-number, and it fell through to the final
 * `return` — so a port with no data was labelled "Very Rough", in red, as
 * confidently as a real storm. A ranking has the same hazard in a sharper form,
 * because a missing value sorts *somewhere* whatever you do, and last place is
 * a claim about a country's performance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { rank } from '../src/utils/rankBaltic';
import { RankedComparison } from '../src/components/RankedComparison';
import type { BalticCompareData } from '../src/api';

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

function payload(series: Record<string, ([string, number | null])[]>): BalticCompareData {
  return {
    indicator: 'test', title: 'Test', unit: '%', source: 'Eurostat',
    countries: Object.fromEntries(
      Object.entries(series).map(([code, points]) => [
        code,
        { label: code, series: points.map(([period, value]) => ({ period, value })) },
      ]),
    ),
  } as BalticCompareData;
}

describe('rank', () => {
  it('orders by the latest value, largest first when higher is better', () => {
    const { ranked } = rank(payload({
      LV: [['2024', 10], ['2025', 12]],
      EE: [['2024', 30], ['2025', 31]],
      LT: [['2024', 20], ['2025', 22]],
    }), true);

    expect(ranked.map((r) => r.code)).toEqual(['EE', 'LT', 'LV']);
    expect(ranked[0].value).toBe(31);
  });

  it('orders smallest first when lower is better', () => {
    // Inequality and government debt. Ranking these largest-first would put
    // the worst performer at the top under a heading that reads as a league
    // table, which is the opposite of what it says.
    const { ranked } = rank(payload({
      LV: [['2025', 35]], EE: [['2025', 30]], LT: [['2025', 40]],
    }), false);

    expect(ranked.map((r) => r.code)).toEqual(['EE', 'LV', 'LT']);
  });

  it('does not rank a country the source published nothing for', () => {
    // The `classifySeaState` failure, in ranking form. Estonia is absent, not
    // last.
    const { ranked, missing } = rank(payload({
      LV: [['2025', 12]],
      EE: [],
      LT: [['2025', 22]],
    }), true);

    expect(ranked.map((r) => r.code)).toEqual(['LT', 'LV']);
    expect(missing).toEqual(['EE']);
  });

  it('treats an all-null series as no reading, not as zero', () => {
    // A null is "not published". Coercing it to 0 would rank the country last
    // on a higher-is-better measure and *first* on a lower-is-better one,
    // which is the more dangerous direction because it looks like success.
    const { ranked, missing } = rank(payload({
      LV: [['2024', null], ['2025', null]],
      EE: [['2025', 30]],
      LT: [['2025', 22]],
    }), false);

    expect(missing).toEqual(['LV']);
    expect(ranked.map((r) => r.code)).toEqual(['LT', 'EE']);
    expect(ranked.some((r) => r.value === 0)).toBe(false);
  });

  it('rejects a non-finite value rather than sorting it', () => {
    // NaN and Infinity compare false against everything, so a sort leaves them
    // wherever they happened to start — a silent, unstable ranking.
    const { ranked, missing } = rank(payload({
      LV: [['2025', Number.NaN]],
      EE: [['2025', Number.POSITIVE_INFINITY]],
      LT: [['2025', 22]],
    }), true);

    expect(ranked.map((r) => r.code)).toEqual(['LT']);
    expect(missing.sort()).toEqual(['EE', 'LV']);
  });

  it('ignores trailing nulls when picking the latest reading', () => {
    // Eurostat pads a cube to the newest period any country filed, so a
    // country one year behind arrives with nulls on the end.
    const { ranked } = rank(payload({
      LV: [['2023', 10], ['2024', 15], ['2025', null]],
    }), true);

    expect(ranked[0].value).toBe(15);
    expect(ranked[0].period).toBe('2024');
  });

  it('measures the change against the earliest reading it has', () => {
    const { ranked } = rank(payload({ LV: [['2021', 10], ['2025', 18]] }), true);
    expect(ranked[0].change).toBe(8);
  });

  it('reports no change when there is only one reading to go on', () => {
    // Not zero. Zero is "it did not move", which is a different claim.
    const { ranked } = rank(payload({ LV: [['2025', 18]] }), true);
    expect(ranked[0].change).toBeNull();
  });

  it('handles a payload with no countries at all', () => {
    const { ranked, missing } = rank(payload({}), true);
    expect(ranked).toEqual([]);
    expect(missing.sort()).toEqual(['EE', 'LT', 'LV']);
  });
});

describe('RankedComparison', () => {
  beforeEach(() => fetchBalticCompare.mockReset());

  async function renderWith(data: unknown) {
    fetchBalticCompare.mockResolvedValue(data);
    render(<RankedComparison indicator="rd_spending" title="R&D expenditure" />);
    await screen.findByText(/R&D expenditure/);
  }

  it('names a country with no reading instead of placing it last', async () => {
    await renderWith(payload({ LV: [['2025', 12]], EE: [], LT: [['2025', 22]] }));

    expect(screen.getByText(/No reading published for Estonia/)).toBeTruthy();
    expect(screen.getByText(/not ranked/)).toBeTruthy();
    // Ranked one and two, not one two and three.
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.queryByText('3.')).toBeNull();
  });

  it('ranks all three when all three reported, with no absence note', async () => {
    await renderWith(payload({
      LV: [['2025', 12]], EE: [['2025', 30]], LT: [['2025', 22]],
    }));

    expect(screen.getByText('3.')).toBeTruthy();
    expect(screen.queryByText(/No reading published/)).toBeNull();
  });

  it('says which way is better, so a rank is not read as merely largest', async () => {
    await renderWith(payload({ LV: [['2025', 12]], EE: [['2025', 30]], LT: [['2025', 22]] }));
    expect(screen.getByText(/Highest first/)).toBeTruthy();
  });

  it('reads its polarity from the map rather than from a prop', async () => {
    // The deterministic version of "the six signs must not change", and it is
    // deliberately not a live page count.
    //
    // I measured the rendered dashboard first: coloured elements on `/data`
    // came back 113, 114 and 115 across five loads **on master alone**, so a
    // one-element difference between two trees was inside the noise and the
    // probe could not settle the question it was built for. Fixed data in
    // jsdom can, and it keeps the answer after the measurement is forgotten.
    //
    // `rd_spending` is `higher-better`, so a rise is favourable. Before this
    // change the same sentence was produced by a `higherIsBetter` prop; the
    // point is that it now comes from `polarityOf`, and this is what fails if
    // someone reintroduces the prop and gets the sign wrong.
    await renderWith(payload({
      LV: [['2024', 10], ['2025', 12]],
      EE: [['2024', 33], ['2025', 30]],
      LT: [['2024', 22], ['2025', 22]],
    }));

    expect(screen.getByText(/up, which is favourable for this indicator/)).toBeTruthy();
    expect(screen.getByText(/down, which is unfavourable for this indicator/)).toBeTruthy();
  });

  it('inverts for a lower-better indicator, without being told to', async () => {
    // `inequality` is `lower-better` in the map and nothing here says so. The
    // same rise that is favourable above must be unfavourable here — that is
    // the whole content of "the map decides", stated as one contrast rather
    // than as six values compared by eye.
    fetchBalticCompare.mockResolvedValue(payload({
      LV: [['2024', 10], ['2025', 12]],
      EE: [['2024', 33], ['2025', 30]],
      LT: [['2024', 22], ['2025', 22]],
    }));
    render(<RankedComparison indicator="inequality" title="Income inequality" />);
    await screen.findByText(/Income inequality/);

    expect(screen.getByText(/up, which is unfavourable for this indicator/)).toBeTruthy();
    expect(screen.getByText(/down, which is favourable for this indicator/)).toBeTruthy();
    // And the ranking follows the same decision: smallest first.
    expect(screen.getByText(/Lowest first/)).toBeTruthy();
  });

  it('withholds the judgement for an indicator the map declines to grade', async () => {
    // The case that was **unreachable by construction** before this change.
    //
    // `higherIsBetter` is a boolean and the map has three states, so a
    // `DELIBERATELY_NEUTRAL` id passed to this component was necessarily
    // spoken as favourable or unfavourable — there was no third thing the prop
    // could say. `house_prices` is declined in writing, "good if you own, bad
    // if you are buying", and on master it said "up, which is favourable for
    // this indicator".
    //
    // What it must say now is the bare direction. Note what this does *not*
    // assert: that the row is grey. A declined series is still coloured by
    // direction, because `polarity.ts` says so in terms and names this exact
    // series while saying it — green there means "went up", not "good". Making
    // this component the only surface that greys them would be a new
    // inconsistency, not a fix.
    fetchBalticCompare.mockResolvedValue(payload({
      LV: [['2024', 10], ['2025', 12]],
      EE: [['2024', 33], ['2025', 30]],
      LT: [['2024', 22], ['2025', 22]],
    }));
    render(<RankedComparison indicator="house_prices" title="House prices" />);
    await screen.findByText(/House prices/);

    expect(screen.queryByText(/favourable/)).toBeNull();
    expect(screen.queryByText(/unfavourable/)).toBeNull();
    // The positive control for that absence: the direction is still spoken, so
    // the two `queryByText` nulls above are a withheld judgement rather than a
    // missing sentence or a component that failed to render its deltas.
    expect(screen.getAllByText(/\b(up|down)\b/).length).toBeGreaterThan(0);
  });

  it('dates each row when the countries report different years', async () => {
    // Ranking figures from different years against each other without saying
    // so is the shared-as-of problem the maritime tile already had once.
    await renderWith(payload({
      LV: [['2025', 12]], EE: [['2024', 30]], LT: [['2025', 22]],
    }));

    expect(screen.getByText('2024')).toBeTruthy();
    expect(screen.getAllByText('2025').length).toBeGreaterThan(0);
  });

  it('says so plainly when nothing at all can be ranked', async () => {
    await renderWith(payload({ LV: [], EE: [], LT: [] }));
    expect(screen.getByText(/unavailable/)).toBeTruthy();
  });
});
