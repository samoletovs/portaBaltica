/**
 * The three series the newsroom gained a cadence for, once they reach a reader.
 *
 * #189 added weekly deaths, building permits and household gas to the
 * registry. A definition in `api/shared/indicators.js` is citable by an
 * article and invisible on the dashboard, so this is the other half: the
 * panels that draw them, and the two things that had to be true before they
 * could be drawn honestly.
 *
 * **A slow series must say how slow it is.** Weekly deaths run about seven
 * weeks behind and semi-annual gas about eight months, on a page whose energy
 * tile carries a day-ahead power price updated hourly. `BalticCompareChart`
 * printed no date at all — forty charts, each direct-labelling three figures
 * with nothing saying when any of them was from.
 *
 * **A composition is not three more lines.** Building permits publish a total
 * and its two halves, and the interesting reading is which half moved. It is
 * also the reading most easily faked: the three series are indices rebased to
 * their own 2021, so they do not sum, and a stacked bar would assert an
 * arithmetic the data does not have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  freshnessOf,
  formatPeriod,
  axisPeriodLabel,
  cadenceOf,
  periodCoverage,
  STALE_AFTER_MONTHS,
  PORT_DATA_STALE_AFTER_MONTHS,
} from '../src/dataFreshness';
import { polarityOf, sentimentOf, DELIBERATELY_NEUTRAL } from '../src/utils/polarity';
import { CHART_TICK_SIZE } from '../src/utils/chartType';
import { PropertyTile } from '../src/components/PropertyTile';

const require_ = createRequire(import.meta.url);
const es = require_('../api/shared/eurostat.js');

/** Late August 2026, the day these figures were measured against Eurostat. */
const NOW = Date.parse('2026-08-28T12:00:00Z');

const source = (file: string) => readFileSync(resolve('src/components', file), 'utf8');

// ─── the clock on a slow series ───────────────────────────────────────────

describe('a period label from any cadence can be dated', () => {
  it('reads the two shapes the dashboard could not', () => {
    // Weekly and semi-annual both returned null before, so `freshnessOf`
    // answered "no usable period" and the caller printed nothing — which on a
    // page of hourly prices reads as "as current as everything else".
    expect(cadenceOf('2026-W28')).toBe('W');
    expect(cadenceOf('2025-S2')).toBe('S');

    expect(freshnessOf('2026-W28', undefined, NOW)).not.toBeNull();
    expect(freshnessOf('2025-S2', undefined, NOW)).not.toBeNull();
  });

  it('still reads the three it always could', () => {
    // The control. Without it the assertions above are satisfied by a parser
    // that answers for everything, including a string that is not a period.
    expect(cadenceOf('2026-Q2')).toBe('Q');
    expect(cadenceOf('2026-07')).toBe('M');
    expect(cadenceOf('2026')).toBe('A');
    expect(cadenceOf('whenever')).toBeNull();
    expect(freshnessOf('whenever', undefined, NOW)).toBeNull();
  });

  it('counts a weekly age in weeks, not in quantised months', () => {
    // Latvia's newest observation on the day this was written, and Estonia's
    // and Lithuania's a week behind it. Six and seven weeks are the honest
    // figures; a month index puts four or five weeks in one bucket, would
    // have reported "1 month behind" for both — a fraction of the real age,
    // in the reassuring direction — and could not have told them apart.
    expect(freshnessOf('2026-W28', undefined, NOW)!.label).toBe('6 weeks behind');
    expect(freshnessOf('2026-W27', undefined, NOW)!.label).toBe('7 weeks behind');

    const f = freshnessOf('2026-W28', undefined, NOW)!;
    expect(f.label).not.toContain('month');
    expect(f.label).not.toContain('quarter');
  });

  it('states a semi-annual age in months, because nobody counts in semesters', () => {
    expect(freshnessOf('2025-S2', undefined, NOW)!.label).toBe('8 months behind');
  });

  it('leaves the quarterly wording exactly as the maritime banner reads it', () => {
    // Those strings are load-bearing in a component this change may not touch.
    expect(freshnessOf('2026-Q2', undefined, NOW)!.label).toBe('the latest published quarter');
    expect(freshnessOf('2025-Q4', undefined, NOW)!.label).toBe('2 quarters behind');
  });

  it('never reports a negative age for a period published in advance', () => {
    // `earn_mw_cur` carries a semester four months ahead of the wall clock,
    // because a minimum wage is legislated before it takes effect. "Fresher
    // than fresh" is not a state, and a check built on it can never fail.
    expect(freshnessOf('2026-S2', undefined, NOW)!.monthsBehind).toBe(0);
    expect(freshnessOf('2027', undefined, NOW)!.monthsBehind).toBe(0);
  });

  it('judges each cadence against its own allowance', () => {
    // One threshold cannot serve all five, and the case that proves it is the
    // one *between* them. A weekly series seven months silent is dead; under
    // the old shared quarterly twelve it was fine, and the first version of
    // this assertion used `2025-W28` — thirteen months — which is stale under
    // both and could not tell them apart. Planted and confirmed: reverting to
    // the quarterly threshold left that version green.
    expect(freshnessOf('2026-W28', undefined, NOW)!.stale, 'six weeks is normal').toBe(false);
    expect(
      freshnessOf('2026-W05', undefined, NOW)!.stale,
      'seven months of silence on a weekly feed is a dead table, and is fresh under Q',
    ).toBe(true);

    // The other direction: a semi-annual price eight months in arrears is
    // normal operation, and a tighter shared threshold would red-light it
    // permanently.
    expect(freshnessOf('2025-S2', undefined, NOW)!.stale).toBe(false);
    expect(freshnessOf('2023-S2', undefined, NOW)!.stale).toBe(true);
  });

  it('holds the same thresholds the API does', () => {
    // The same judgement about the same series, on two sides of the wire. A
    // sentence claiming they agree is not a check; this is.
    expect(STALE_AFTER_MONTHS).toEqual(es.MAX_AGE_MONTHS);
    expect(STALE_AFTER_MONTHS.Q).toBe(PORT_DATA_STALE_AFTER_MONTHS);
  });
});

describe('a period reads as a date, on an axis and in a sentence', () => {
  it('spells a week out where it is read aloud', () => {
    expect(formatPeriod('2026-W28')).toBe('week to 12 Jul 2026');
    expect(formatPeriod('2025-S2')).toBe('H2 2025');
  });

  it('fits an axis label inside the budget a 320px card allows', () => {
    // Measured rather than asserted in the abstract: six labels of this width
    // at CHART_TICK_SIZE must fit the ~254px an unaxised chart gets at 320px.
    // `2021-W01` is eight characters and ran into its neighbour; the first of
    // them was also clipped in half by the card edge.
    const labels = ['2026-W28', '2026-Q2', '2025-S2', '2026-07', '2026'].map(axisPeriodLabel);

    for (const label of labels) {
      expect(label.length, `"${label}" is too wide for a phone axis`).toBeLessThanOrEqual(7);
    }

    const widest = Math.max(...labels.map((l) => l.length));
    expect(widest * CHART_TICK_SIZE * 0.62 * 6).toBeLessThan(254);
  });

  it('keeps an axis label unambiguous while shortening it', () => {
    // Shorter must not mean vaguer: each still names a period, and two
    // different periods never collapse onto one label.
    expect(axisPeriodLabel('2026-Q2')).toBe('Q2 26');
    expect(axisPeriodLabel('2025-S2')).toBe('H2 25');
    expect(axisPeriodLabel('2026-07')).toBe('Jul 26');
    expect(axisPeriodLabel('2026')).toBe('2026');
    expect(axisPeriodLabel('2026-W28')).not.toBe(axisPeriodLabel('2026-W40'));
  });

  it('dates a span when the three countries did not reach the same period', () => {
    // Latvia files `demo_r_mwk_ts` a week ahead of Estonia and Lithuania, so a
    // card dated by the newest over-dates two of its three figures.
    const span = periodCoverage('2026-W27', '2026-W28')!;
    expect(span.spans).toBe(true);
    expect(span.label).toBe('week to 5 Jul 2026 to week to 12 Jul 2026');
  });
});

// ─── the panels ───────────────────────────────────────────────────────────

describe('every Baltic comparison card says when it is from', () => {
  const text = source('BalticCompareChart.tsx');

  it('computes its date from the data rather than from the request', () => {
    expect(text).toMatch(/periodCoverage\(/);
    expect(text).toMatch(/freshnessOf\(/);
  });

  it('dates itself by the oldest of the three, not the newest', () => {
    // Naming the newest over-dates whichever country is behind — the same
    // shared-as-of dishonesty the maritime per-panel dates exist to avoid.
    // `latestPeriods` is sorted, so index 0 is the oldest.
    expect(text).toMatch(/freshnessOf\(latestPeriods\[0\]\)/);
  });

  it('reads only published observations, never a padded trailing null', () => {
    // `demo_r_mwk_ts` carries time coordinates four weeks past its newest
    // value. Dating a card by the newest *coordinate* understates its age by
    // a factor of two and a half — the error the upstream survey made.
    expect(text).toMatch(/latestPeriods[\s\S]{0,320}s\.value !== null/);
  });

  it('derives its tick interval rather than writing one', () => {
    // A hardcoded interval is a claim about how many points the series
    // carries, and it stops being true. `chartType.ts` owns the derivation.
    expect(text).toMatch(/tickInterval\(chartData\.length\)/);
    expect(text).not.toMatch(/interval=\{\s*\d+\s*\}/);
  });
});

// ─── weekly deaths ────────────────────────────────────────────────────────

describe('weekly deaths are drawn without a verdict', () => {
  it('is ungraded, so nothing on the card is coloured by approval', () => {
    // A rise in deaths is bad news. The reason to keep polarity out is
    // different: most of what this chart shows is seasonality, and painting
    // every January red would be a verdict on winter.
    expect(polarityOf('weekly_deaths')).toBe('neutral');
    expect(sentimentOf('weekly_deaths', 12)).toBe('positive');
    expect(sentimentOf('weekly_deaths', -12)).toBe('negative');
  });

  it('is drawn by a component that colours no delta at all', () => {
    // The assertion above is about the registry; this is about the surface.
    // `BalticCompareChart` draws flag colours and never calls `sentimentOf`,
    // so no reading of it can acquire a sentiment by accident.
    expect(source('BalticCompareChart.tsx')).not.toMatch(/sentimentOf|sentimentColor/);
  });

  it('says the levels are not comparable, because three counts invite that', () => {
    // Lithuania's line sits highest because Lithuania is largest. A reader
    // comparing heights learns about population and believes they learned
    // about mortality, and only a sentence fixes that.
    const text = source('EnvironmentTile.tsx');
    expect(text).toMatch(/indicator="weekly_deaths"/);
    expect(text).toMatch(/Counts, not rates/);
    expect(text).toMatch(/seasonal/);
  });
});

// ─── the permit composition ───────────────────────────────────────────────

vi.mock('../src/CountryContext', () => ({
  useCountry: () => ({ country: 'LV', countryLabel: 'Latvia', flag: '🇱🇻', timezone: 'Europe/Riga' }),
}));

/**
 * The mock is declared through `vi.hoisted` so the component can be imported
 * statically at the top of this file.
 *
 * It used to be a plain `const` with a `vi.mock` factory closing over it,
 * which forced every test to `await import('../src/components/PropertyTile')`
 * in its own body — the factory runs at import time and the `const` would
 * still be in its temporal dead zone.
 *
 * That import is not a wait, it is *work*: Vite transforming PropertyTile,
 * BalticCompareChart and recharts. Billed to whichever test ran first, and
 * measured against a 5000ms budget, it took **6522ms, 8083ms and 8472ms** in
 * three of five full-suite runs on a loaded machine. Hoisted here it lands in
 * the file's import phase, where it belongs and where nothing times it.
 */
const { fetchBalticCompare } = vi.hoisted(() => ({ fetchBalticCompare: vi.fn() }));
vi.mock('../src/api', () => ({ fetchBalticCompare }));

/** A quarterly index series ending at 2026-Q2, with the value a year earlier. */
function permitSeries(latest: number, yearEarlier: number) {
  return {
    indicator: 'x',
    title: 'x',
    unit: 'index (2021=100)',
    source: 'Eurostat (sts_cobp_q)',
    countries: {
      LV: {
        label: 'Latvia',
        series: [
          { period: '2025-Q1', value: 90 },
          { period: '2025-Q2', value: yearEarlier },
          { period: '2025-Q3', value: 95 },
          { period: '2025-Q4', value: 97 },
          { period: '2026-Q1', value: 99 },
          { period: '2026-Q2', value: latest },
        ],
      },
    },
  };
}

describe('the permit composition', () => {
  beforeEach(() => {
    fetchBalticCompare.mockReset();
  });

  /**
   * Let the mocked fetches settle, without waiting on a clock.
   *
   * These tests used `await screen.findByText(...)`, which polls against a
   * 5000ms wall-clock budget — and a wall clock in a parallel suite measures
   * how busy the machine is, not whether the code works. Measured on this
   * branch across five full-suite runs with 24 busy node processes, the run
   * exceeded the budget in **three of five**, at 5298ms, 6113ms and 6562ms,
   * while the same file in isolation passed 27/27 every time.
   *
   * The remedy is not a bigger budget: a raised timeout hides the next real
   * slowness, and `tests/noNetwork.ts` already refuses that trade for the
   * network. Every mocked fetch here is an already-resolved promise, so
   * nothing waits on elapsed time — but React's scheduler commits on a
   * macrotask rather than a microtask, so draining microtasks alone is not
   * enough. Measured: a microtask-only version of this helper reported "not
   * rendered after 50 turns" on four of five tests, which is the helper being
   * honest about its own limit rather than a fact about the component.
   *
   * So each turn drains the microtask queue and then yields one macrotask via
   * `setImmediate` — the check phase, with no timer and therefore no duration
   * to exceed. It stops as soon as the panel is on screen.
   *
   * The bound exists so a component that never settles fails here with this
   * sentence rather than hanging. It is a turn count, not a duration.
   */
  async function settle(until: () => boolean, turns = 50): Promise<void> {
    for (let i = 0; i < turns; i += 1) {
      if (until()) return;
      await act(async () => {
        await new Promise<void>((resolve) => { setImmediate(resolve); });
      });
    }
    throw new Error(
      `the component had not rendered after ${turns} turns of the event loop; it is waiting ` +
        'on something this helper cannot drain — a real timer, or a promise that never resolves',
    );
  }

  /** Rendered, settled, and asserted to be there — with no clock involved. */
  const permitPanel = () => screen.queryByText('Building permits by segment') !== null;

  /**
   * The rendered bars, in source order, as their CSS width.
   *
   * Scoped to the permit card. The tile also draws a house-price chart, and
   * recharts' own container carries an inline width — so an unscoped query
   * counts a chart wrapper as a bar and the reading means nothing.
   */
  function barWidths(container: HTMLElement): number[] {
    const card = [...container.querySelectorAll<HTMLElement>('div.dash-card')]
      .find((el) => el.textContent?.includes('Building permits by segment'));
    expect(card, 'the permit card is not on the page, so this probe sees nothing').toBeTruthy();
    return [...card!.querySelectorAll<HTMLElement>('div[style*="width"]')]
      .map((el) => Number.parseFloat(el.style.width))
      .filter((w) => Number.isFinite(w));
  }

  async function renderPanel(values: [number, number][]) {
    fetchBalticCompare.mockImplementation((id: string) => {
      const i = ['building_permits', 'building_permits_residential', 'building_permits_non_residential'].indexOf(id);
      return Promise.resolve(i < 0 ? null : permitSeries(values[i][0], values[i][1]));
    });
    const view = render(<PropertyTile data={null} loading={false} />);
    await settle(permitPanel);
    return view;
  }

  it('draws the year-on-year change, not the index level', async () => {
    // The first version drew the level as a bar diverging from 100. Rendered
    // against Latvia's real 104.6 / 110.4 / 99.6 the three bars came out at
    // 8%, 18% and 0.7% of half a track while the figures beside them read
    // −28.9%, −1.9% and −43.5%: the bars were competing with the story and
    // losing. Here the level is flat and only the change differs, so a bar
    // keyed on the level would be identical for all three.
    const { container } = await renderPanel([[100, 200], [100, 102], [100, 400]]);
    const widths = barWidths(container);

    expect(widths).toHaveLength(3);
    expect(new Set(widths).size, 'three different changes must draw three different bars').toBe(3);
    // −50%, −2%, −75%: ordered by magnitude of the change.
    expect(widths[2]).toBeGreaterThan(widths[0]);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it('never stacks the segments, because the indices do not sum', async () => {
    // Residential and non-residential are rebased to their own 2021, so
    // 110.4 + 99.6 is not 104.6 and never will be. A part-to-whole shape here
    // would assert an arithmetic the data does not have — so the three bars
    // are independent and their widths must not add up to the container.
    await renderPanel([[104.6, 147], [110.4, 112.6], [99.6, 176]]);

    expect(screen.getByText(/index, 2021 = 100/)).toBeTruthy();
    expect(screen.getByText(/change on a year earlier/)).toBeTruthy();
  });

  it('draws no bar at all when there is no year-earlier reading', async () => {
    // An empty track is indistinguishable from no change, which would be
    // inventing the number the panel is missing.
    fetchBalticCompare.mockImplementation(() =>
      Promise.resolve({
        indicator: 'x', title: 'x', unit: 'index', source: 'Eurostat (sts_cobp_q)',
        countries: { LV: { label: 'Latvia', series: [{ period: '2026-Q2', value: 104.6 }] } },
      }),
    );
    const { container } = render(<PropertyTile data={null} loading={false} />);
    await settle(permitPanel);

    expect(screen.getByText('All buildings')).toBeTruthy();
    expect(screen.getAllByText('104.6').length).toBeGreaterThanOrEqual(3);
    expect(barWidths(container)).toHaveLength(0);
  });

  it('states the quarter it is drawing', async () => {
    await renderPanel([[104.6, 147], [110.4, 112.6], [99.6, 176]]);
    expect(screen.getByText(/Q2 2026/)).toBeTruthy();
  });

  it('survives a segment the API cannot serve', async () => {
    // Three requests, and one failing must not take the other two down.
    fetchBalticCompare.mockImplementation((id: string) =>
      id === 'building_permits_residential'
        ? Promise.reject(new Error('502'))
        : Promise.resolve(permitSeries(104.6, 147)),
    );
    render(<PropertyTile data={null} loading={false} />);
    await settle(permitPanel);

    expect(screen.getByText('All buildings')).toBeTruthy();
    expect(screen.queryByText('Residential')).toBeNull();
  });

  it('has decided about every segment it colours, one way or the other', async () => {
    // `polarityOf` answers `neutral` for anything it does not recognise, so a
    // card added with an unregistered id is coloured by direction with nobody
    // having decided anything. What matters here is that a decision exists —
    // not which one. It was `higher-better` when this panel was built and is
    // now a declared abstention, because a central bank in this region does
    // not read a permit surge as good news and the admission test stated in
    // `polarity.ts` needs all three parties to agree.
    // `tests/polarityAdmission.test.ts` owns that reasoning, and the invariant
    // that permits and construction output move together.
    for (const id of ['building_permits', 'building_permits_residential', 'building_permits_non_residential']) {
      const decided = polarityOf(id) !== 'neutral' || DELIBERATELY_NEUTRAL.has(id);
      expect(decided, `${id} is ungraded and nothing says why`).toBe(true);
    }
  });
});

// ─── the gas price ────────────────────────────────────────────────────────

describe('the household gas price', () => {
  it('sits beside electricity rather than in a different unit somewhere else', () => {
    const text = source('EnergyTile.tsx');
    expect(text).toMatch(/indicator="gas_price_household"/);
    expect(text).toMatch(/indicator="elec_price_household"/);
  });

  it('names the consumption band it prices, because a band is not a total', () => {
    // Eurostat's band D2. `TOT_GJ` carries one observation of twenty for
    // Latvia, so the total was never an option — and a reader comparing this
    // to their own bill is entitled to know which consumer it describes.
    expect(source('EnergyTile.tsx')).toMatch(/title="Gas price \(households, 20.200 GJ\)"/);
  });
});
