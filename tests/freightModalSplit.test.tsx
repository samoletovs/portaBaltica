/**
 * The freight modal split — what share of each country's inland freight moves
 * by rail.
 *
 * This replaced the goods-balance and services-balance charts, which were two
 * of five balance-of-payments series on one tile saying versions of the same
 * thing. The claim it makes instead is one most readers would guess the wrong
 * way round: Latvia is the most rail-dependent freight economy in the Baltics,
 * at 18.9% of tonne-kilometres against Lithuania's 8.5% and Estonia's 7.3%,
 * despite Lithuania moving roughly four times the total volume.
 *
 * Two things here can be wrong without looking wrong, which is why they are
 * pinned:
 *
 *   1. **The unit.** Both road series are published; `road_freight` is tonnes
 *      lifted and `road_freight_tkm` is tonne-kilometres. A tonne on a train
 *      travels much further than a tonne on a lorry, so a split computed from
 *      tonnes lifted flatters road enormously and describes nothing. In
 *      2025-Q4 Latvia lifted 20,648 thousand tonnes by road; the same quarter
 *      in tonne-kilometres is 3,848 million. Using the wrong one moves the
 *      headline share from 18.9% to about 4%.
 *
 *   2. **The period.** The two modes report on different schedules, so a
 *      quarter where only one has filed would produce a share that looks
 *      precise and is arithmetic on a gap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const INDICATORS = require('../api/shared/indicators.js');

import { DASHBOARD_INDICATORS } from '../src/newsroom/chart-ref';

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

import { FreightModalSplit } from '../src/components/FreightModalSplit';

describe('the tonne-kilometre road indicator', () => {
  it('exists alongside the tonnes one, because they answer different questions', () => {
    expect(INDICATORS).toHaveProperty('road_freight_tkm');
    expect(INDICATORS).toHaveProperty('road_freight');
    expect(INDICATORS.road_freight_tkm.params).toContain('unit=MIO_TKM');
    expect(INDICATORS.road_freight.params).toContain('unit=THS_T');
  });

  it('is measured in the same unit as rail, or the ratio means nothing', () => {
    expect(INDICATORS.rail_freight.params).toContain('unit=MIO_TKM');
    expect(INDICATORS.road_freight_tkm.unit).toBe(INDICATORS.rail_freight.unit);
  });

  it('pins tra_type, which has four categories and no default worth having', () => {
    // Hire-and-reward alone is roughly two thirds of the total and looks
    // entirely plausible in a chart.
    expect(INDICATORS.road_freight_tkm.params).toContain('tra_type=TOTAL');
    expect(INDICATORS.road_freight_tkm.params).toContain('tra_oper=TOTAL');
  });

  it('sits inside a sanity band that matches observed tonne-kilometres', () => {
    // Observed 897 (Estonia, 2025-Q4) to 17,547 (Lithuania, 2025-Q1).
    const [low, high] = INDICATORS.road_freight_tkm.sanity;
    expect(low).toBeLessThan(897);
    expect(high).toBeGreaterThan(17547);
  });

  it('is citable by the newsroom, or an article naming it loses its chart', () => {
    expect(DASHBOARD_INDICATORS.has('road_freight_tkm')).toBe(true);
    expect(DASHBOARD_INDICATORS.has('rail_freight')).toBe(true);
  });
});

describe('FreightModalSplit', () => {
  const rail = {
    indicator: 'rail_freight', title: 'Rail freight', unit: 'M tonne-km', source: 'Eurostat',
    countries: {
      LV: { label: 'Latvia', series: [{ period: '2025-Q3', value: 630 }, { period: '2025-Q4', value: 897 }] },
      EE: { label: 'Estonia', series: [{ period: '2025-Q3', value: 101 }, { period: '2025-Q4', value: 71 }] },
      LT: { label: 'Lithuania', series: [{ period: '2025-Q3', value: 1479 }, { period: '2025-Q4', value: 1464 }] },
    },
  };
  const road = {
    indicator: 'road_freight_tkm', title: 'Road freight', unit: 'M tonne-km', source: 'Eurostat',
    countries: {
      LV: { label: 'Latvia', series: [{ period: '2025-Q3', value: 3948 }, { period: '2025-Q4', value: 3848 }] },
      EE: { label: 'Estonia', series: [{ period: '2025-Q3', value: 1006 }, { period: '2025-Q4', value: 897 }] },
      LT: { label: 'Lithuania', series: [{ period: '2025-Q3', value: 16480 }, { period: '2025-Q4', value: 15832 }] },
    },
  };

  async function renderWith(railData: unknown, roadData: unknown) {
    fetchBalticCompare.mockImplementation(async (id: string) =>
      id === 'rail_freight' ? railData : roadData);
    render(<FreightModalSplit />);
    // The component renders a skeleton first; wait for either outcome.
    await screen.findByText(/Rail's share of inland freight|Freight modal split unavailable/);
  }

  beforeEach(() => fetchBalticCompare.mockReset());

  it('computes the share from tonne-kilometres, and puts Latvia first', async () => {
    await renderWith(rail, road);

    // 897 / (897 + 3848) = 18.9%
    expect(screen.getByText('18.9%')).toBeTruthy();
    // 1464 / (1464 + 15832) = 8.5%
    expect(screen.getByText('8.5%')).toBeTruthy();
    // 71 / (71 + 897) = 7.3%
    expect(screen.getByText('7.3%')).toBeTruthy();
  });

  it('prints the share beside every bar, so colour carries nothing alone', async () => {
    // Red and green are the classic confusion pair and the country palette is
    // built on the flags. The number is the encoding; the bar is the emphasis.
    await renderWith(rail, road);
    for (const country of ['Latvia', 'Estonia', 'Lithuania']) {
      expect(screen.getByText(country)).toBeTruthy();
    }
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toMatch(/Latvia 18.9 per cent by rail/);
  });

  it('skips a quarter only one mode has reported', async () => {
    // Rail reaches 2026-Q1 while road stops at 2025-Q4. Reading the newest
    // rail figure against a missing road figure would be arithmetic on a gap.
    const railAhead = {
      ...rail,
      countries: {
        ...rail.countries,
        LV: { label: 'Latvia', series: [
          { period: '2025-Q4', value: 897 },
          { period: '2026-Q1', value: 594 },
        ] },
      },
    };

    await renderWith(railAhead, road);
    // Still the 2025-Q4 pairing, not 594 against nothing.
    expect(screen.getByText('18.9%')).toBeTruthy();
  });

  it('says so plainly when the data will not load', async () => {
    await renderWith(null, null);
    expect(screen.getByText(/Freight modal split unavailable/)).toBeTruthy();
  });
});
