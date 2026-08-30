import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
// Module scope, never inside a test body. `tests/suiteDeterminism.test.ts`
// names a dynamic import beside a wall-clock wait as the pair that flaked,
// and it is right: `await import()` in a body is Vite transforming a module
// in competition with every other worker.
import { ThemeProvider } from '../src/ThemeContext';
import { RankedComparison } from '../src/components/RankedComparison';
import { FreightModalSplit } from '../src/components/FreightModalSplit';
import { BalticCompareChart } from '../src/components/BalticCompareChart';
import { FilterProvider } from '../src/FilterContext';
import type { BalticCompareData } from '../src/api';

/**
 * The two dashboard panels that presented a period-indexed reading without
 * judging whether it was recent.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `#215` fixed `IndicatorCard` and `IndicatorTable`. The brief for this change
 * guessed `FreightModalSplit` was the last silent surface. Deriving the
 * population from source rather than accepting that found a second one, and
 * `RankedComparison` turned out to be the worse of the two — three faults, not
 * one:
 *
 *   - the period printed raw as `2022-Q1`, where every other dashboard surface
 *     writes `Q1 2022` through `formatPeriod`;
 *   - the date rendered **only when all three countries agreed on a period**,
 *     so a ranking whose members report on different schedules carried no date
 *     at all — the case most in need of one;
 *   - nothing judged staleness, so a ranking frozen in 2022 read as current,
 *     with a green favourable delta beside it.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS
 * -----------------------------------
 * The plant that mattered in `#215` was one where the assertion checked that a
 * period appeared *anywhere on the page* — and the stale notice carries the same
 * period, so deleting the date from the reading itself left the test green. A
 * check satisfied by the very thing it was written to be independent of.
 *
 * So the date assertions below scope to the element that carries the reading,
 * and the stale-notice assertions scope to the notice. Each one is planted
 * against separately.
 */

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...a: unknown[]) => fetchBalticCompare(...(a as [])),
}));

/**
 * Two `act` flushes rather than `waitFor`.
 *
 * `waitFor` polls against a wall clock, so under worker contention it times out
 * on a component that resolved perfectly well — the diagnosis for the
 * `dashboardCadence` flake, and a rule `suiteDeterminism` now enforces. These
 * components resolve a promise then set two pieces of state; flushing the
 * microtask queue twice is deterministic and needs no clock at all.
 */
async function settle() {
  await act(async () => {});
  await act(async () => {});
}

/**
 * A prior observation, derived rather than hardcoded.
 *
 * The first draft of this file pinned the earlier point at a literal `2019-Q1`,
 * which is *newer* than the `2016-Q1` the stale cases use — so `splitsFrom`,
 * which correctly takes the newest period for which both series report, picked
 * the fixture's "old" point and the panel dated itself 2019. The component was
 * right and the fixture was lying to it. Deriving the prior period from the
 * period under test makes that impossible to reintroduce.
 */
function priorTo(period: string): string {
  const [year, rest] = period.split('-');
  return `${Number(year) - 3}-${rest}`;
}

function compareData(period: string, values: Record<string, number>): BalticCompareData {
  const countries = Object.fromEntries(
    Object.entries(values).map(([code, v]) => [
      code,
      { label: code, series: [{ period: priorTo(period), value: v - 1 }, { period, value: v }] },
    ]),
  );
  return { indicator: 'x', title: 'X', unit: '%', countries } as unknown as BalticCompareData;
}

/** Different periods per country — the case that used to render no date at all. */
function raggedData(periods: Record<string, string>): BalticCompareData {
  const countries = Object.fromEntries(
    Object.entries(periods).map(([code, p], i) => [
      code,
      { label: code, series: [{ period: priorTo(p), value: 10 + i }, { period: p, value: 20 + i }] },
    ]),
  );
  return { indicator: 'x', title: 'X', unit: '%', countries } as unknown as BalticCompareData;
}

const FRESH = new Date().getFullYear();

function renderRanked() {
  return render(
    <ThemeProvider>
      <RankedComparison indicator="gdp_per_capita" title="Test ranking" unit="%" />
    </ThemeProvider>,
  );
}

/** The multi-country chart, which judges on the laggard and so must not say
    "this series" when the countries disagree about their newest period. */
function renderCompare() {
  return render(
    <ThemeProvider>
      <FilterProvider>
        <BalticCompareChart indicator="x" title="Test comparison" />
      </FilterProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  fetchBalticCompare.mockReset();
});

describe('the multi-country chart does not blame one series for the slowest', () => {
  it('says "the slowest of these" when the countries disagree on their newest period', async () => {
    // The verdict is taken on the laggard, so the singular sentence was false
    // for whichever countries had already published. Measured on the built
    // app: 47 cards pair a span with this notice. Line 528 of the chart
    // already qualifies its inline label with "oldest " for exactly this
    // case; the notice never got the same treatment.
    fetchBalticCompare.mockResolvedValue(raggedData({ LV: '2016-Q1', EE: '2015-Q3', LT: '2016-Q1' }));
    const { container } = renderCompare();
    await settle();

    expect(container.textContent, 'the notice must not claim every series stopped')
      .not.toContain('This series has published nothing newer');
    expect(container.textContent).toContain(
      'The slowest of these series has published nothing newer than Q3 2015.',
    );
  });

  it('keeps the singular sentence when they agree, so the wording is not simply reworded', async () => {
    // The control. Without this, replacing the sentence unconditionally would
    // pass the assertion above while making a different claim false.
    fetchBalticCompare.mockResolvedValue(compareData('2015-Q3', { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderCompare();
    await settle();

    expect(container.textContent).toContain(
      'This series has published nothing newer than Q3 2015.',
    );
  });
});

describe('RankedComparison dates and judges its reading', () => {
  it('renders the period beside the ranking, formatted', async () => {
    fetchBalticCompare.mockResolvedValue(compareData(`${FRESH}-Q1`, { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderRanked();
    await settle();

    // Scoped to the header line that carries the coverage label, not to the whole
    // document — the #215 plant proved a page-wide assertion is satisfied by the
    // stale notice and so cannot see the date being deleted.
    const header = container.querySelector('.flex.items-baseline.justify-between');
    expect(header?.textContent, container.textContent ?? '').toContain(`Q1 ${FRESH}`);
    // Raw ISO must not reach a reader.
    expect(container.textContent).not.toContain(`${FRESH}-Q1`);
  });

  it('dates a ranking whose countries report different periods', async () => {
    // The regression that carried no date at all. `periods.length === 1` gated
    // the whole dateline, so precisely the ragged case said nothing.
    fetchBalticCompare.mockResolvedValue(
      raggedData({ LV: `${FRESH}-Q1`, EE: `${FRESH - 1}-Q3`, LT: `${FRESH}-Q1` }),
    );
    const { container } = renderRanked();
    await settle();

    const header = container.querySelector('.flex.items-baseline.justify-between');
    expect(header?.textContent, container.textContent ?? '').toMatch(/Q3 \d{4}/);
  });

  it('formats the per-row period, which only renders when the periods differ', async () => {
    // A separate assertion from the one above, and it has to be: the per-row
    // label is a different element on a different code path, and the header
    // dateline is present either way. A plant that restored the raw `{row.period}`
    // left every other test in this file green, which is how this gap was found.
    fetchBalticCompare.mockResolvedValue(
      raggedData({ LV: `${FRESH}-Q1`, EE: `${FRESH - 1}-Q3`, LT: `${FRESH}-Q1` }),
    );
    const { container } = renderRanked();
    await settle();

    const rowLabels = [...container.querySelectorAll('p.font-mono')].map((n) => n.textContent);
    expect(rowLabels.length, `rows: ${JSON.stringify(rowLabels)}`).toBeGreaterThan(0);
    // No raw ISO reaches a reader on any row.
    for (const label of rowLabels) {
      expect(label).not.toMatch(/^\d{4}-/);
      expect(label).toMatch(/^Q\d \d{4}$/);
    }
  });

  it('says so when the ranking has published nothing recent', async () => {
    fetchBalticCompare.mockResolvedValue(compareData('2016-Q1', { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderRanked();
    await settle();

    expect(container.textContent).toContain(
      'This series has published nothing newer than Q1 2016.',
    );
  });

  it('judges on the oldest member, not the newest', async () => {
    // A comparison is only as current as the member furthest behind. Dating it
    // by the leader gives the laggard a quarter it never reached — the same
    // reasoning as MaritimeTile, which judges on the oldest measure it shows.
    fetchBalticCompare.mockResolvedValue(
      raggedData({ LV: `${FRESH}-Q1`, EE: '2016-Q1', LT: `${FRESH}-Q1` }),
    );
    const { container } = renderRanked();
    await settle();

    expect(container.textContent).toContain('published nothing newer than Q1 2016');
  });

  it('stays quiet when the ranking is current', async () => {
    // Control. A notice that fires on everything is one readers route around,
    // which is worse than none because it also covers the real ones.
    fetchBalticCompare.mockResolvedValue(compareData(`${FRESH}-Q1`, { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderRanked();
    await settle();

    expect(container.textContent).not.toContain('published nothing newer');
  });

  it('neutralises the delta when stale, for both readers at once', async () => {
    fetchBalticCompare.mockResolvedValue(compareData('2016-Q1', { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderRanked();
    await settle();

    // Sighted: no sentiment colour. "Favourable" is a present-tense judgement
    // and the change stopped a decade ago.
    expect(container.innerHTML).not.toContain('--data-positive');
    // Screen reader: the SAME answer. The first draft of the #215 fix greyed the
    // delta while still announcing "favourable", which is one claim with two
    // answers split by how you read the page.
    expect(container.textContent).not.toContain('favourable');
    // But the delta itself survives — it is a true statement about the last two
    // readings, and a card showing one when fresh and nothing when stale is
    // structurally different from its neighbours in a grid, where a missing
    // delta reads as "no change" rather than "no recent change".
    expect(container.textContent).toMatch(/as of Q1 2016, the last reading published/);
  });

  it('keeps the sentiment claim when the ranking is current', async () => {
    // Positive control for the assertion above: proves the words it looks for
    // can actually appear, so their absence when stale is evidence rather than
    // a probe that never sees anything.
    fetchBalticCompare.mockResolvedValue(compareData(`${FRESH}-Q1`, { LV: 5, EE: 4, LT: 3 }));
    const { container } = renderRanked();
    await settle();

    expect(container.textContent).toContain('favourable');
  });
});

describe('FreightModalSplit dates and judges its reading', () => {
  it('says so when the split has published nothing recent', async () => {
    fetchBalticCompare.mockResolvedValue(compareData('2016-Q1', { LV: 5, EE: 4, LT: 3 }));
    const { container } = render(
      <ThemeProvider>
        <FreightModalSplit />
      </ThemeProvider>,
    );
    await settle();

    expect(container.textContent).toContain(
      'This series has published nothing newer than Q1 2016.',
    );
  });

  it('stays quiet when the split is current', async () => {
    fetchBalticCompare.mockResolvedValue(compareData(`${FRESH}-Q1`, { LV: 5, EE: 4, LT: 3 }));
    const { container } = render(
      <ThemeProvider>
        <FreightModalSplit />
      </ThemeProvider>,
    );
    await settle();

    expect(container.textContent).not.toContain('published nothing newer');
    // Control: the panel rendered at all. Without this, the assertion above
    // passes just as well on a component that threw and rendered nothing —
    // an absent result is a claim about the instrument before it is a claim
    // about the code.
    expect(container.textContent?.length ?? 0).toBeGreaterThan(20);
  });
});
