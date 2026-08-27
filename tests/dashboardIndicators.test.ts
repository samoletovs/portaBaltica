/**
 * The three indicators that reached the API before they reached the dashboard.
 *
 * Rail freight, road freight and labour productivity were queryable and
 * citable by the newsroom for a day before any tile rendered them. These tests
 * pin them onto the page, but mostly they pin the *captions*, because one of
 * the three carries a claim that was published backwards once already.
 *
 * The brief that introduced labour productivity said Latvia had stalled while
 * Lithuania pulled twelve points ahead. The data says the reverse: Latvia leads
 * at 111.7 against its 2020 base and **Estonia** is the one still below where
 * it started, at 99.6, having peaked at 108.1 in 2021. The cause was a
 * research pass reading `geo=LV&geo=EE&geo=LT` in query-string order rather
 * than through the response's own `dimension.geo.category.index`, and Eurostat
 * returns its canonical alphabetical order — EE, LT, LV — so every value was
 * rotated one position.
 *
 * A wrong number gets corrected. A wrong sentence in a chart title gets
 * screenshotted, so the titles here say what is being measured and nothing
 * about which way it went.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const INDICATORS = require('../api/shared/indicators.js');

import { DASHBOARD_INDICATORS } from '../src/newsroom/chart-ref';

const tile = (name: string) => readFileSync(resolve('src/components', name), 'utf8');

/** Chart id → title, as written on a tile. */
function chartsIn(name: string): Record<string, string> {
  return Object.fromEntries(
    [...tile(name).matchAll(/BalticCompareChart\s+indicator="([^"]+)"\s+title="([^"]+)"/g)]
      .map((m) => [m[1], m[2]]),
  );
}

describe('the freight and productivity indicators are on the page', () => {
  it('renders rail and road freight beside the modal split', () => {
    const charts = chartsIn('TradeTile.tsx');
    expect(charts).toHaveProperty('rail_freight');
    expect(charts).toHaveProperty('road_freight');
    expect(tile('TradeTile.tsx')).toMatch(/FreightModalSplit/);
  });

  it('renders labour productivity on the labour tile', () => {
    expect(chartsIn('LabourTile.tsx')).toHaveProperty('labour_productivity');
  });

  it('draws only indicators the API actually defines', () => {
    // A chart naming an id the API does not serve renders an empty frame.
    for (const name of ['TradeTile.tsx', 'LabourTile.tsx']) {
      for (const id of Object.keys(chartsIn(name))) {
        expect(INDICATORS, `${name} draws "${id}"`).toHaveProperty(id);
      }
    }
  });

  it('keeps them citable, so an article naming one keeps its chart', () => {
    for (const id of ['rail_freight', 'road_freight', 'road_freight_tkm', 'labour_productivity']) {
      expect(DASHBOARD_INDICATORS.has(id), `${id} must resolve for the newsroom`).toBe(true);
    }
  });
});

/**
 * Rail passengers — the one metric on the manager's candidate list that was
 * genuinely absent, and the contract that keeps it honest.
 *
 * Fourteen of the fifteen suggested indicators already existed here. This is
 * the exception, and it is worth having for a reason a coverage count does not
 * show: it *inverts* the freight ranking. Latvia carries roughly twice
 * Estonia's rail passengers and nearly four times Lithuania's, while Lithuania
 * leads rail freight and Latvia's freight has fallen by nearly 90% since 2022.
 * A reader shown only the freight series would conclude the Latvian railway is
 * emptying; the passenger series says the opposite.
 *
 * Measured live against `rail_pa_quartal`, 2019-Q1..2026-Q2:
 *
 *   LV  n=29  latest 4653  min 1924  max 6074
 *   EE  n=30  latest 2058  min  978  max 2163
 *   LT  n=29  latest 1198  min  519  max 1514
 *
 * It deliberately has no chart. The dashboard already draws the same
 * three-line comparison fifty times over, and a metric earns its place in the
 * registry by being citable and collectable, not by adding a fifty-first.
 */
describe('rail passengers', () => {
  const def = INDICATORS.rail_passengers;

  it('exists, because it was the one real gap in the transport coverage', () => {
    expect(INDICATORS).toHaveProperty('rail_passengers');
    expect(def.dataset).toBe('rail_pa_quartal');
  });

  it('counts people rather than passenger-kilometres', () => {
    // The cube offers exactly two units and they differ by a factor of ~25:
    // MIO_PKM puts Latvia at 162-212, THS_PAS at 4653-6074. Either pins
    // cleanly and either produces a plausible-looking line; only one is the
    // statistic the title claims.
    expect(def.params).toContain('unit=THS_PAS');
    expect(def.params).not.toContain('MIO_PKM');
    expect(def.unit).toMatch(/passenger/i);
  });

  it('pins every dimension the cube carries', () => {
    // freq, unit, geo and time are the whole cube; geo and time are supplied
    // by buildUrl. An unpinned dimension makes the parser choose a slice and
    // report it in `assumptions`.
    for (const dim of ['freq=Q', 'unit=']) {
      expect(def.params, `${dim} must be pinned`).toContain(dim);
    }
    expect(def.freq).toBe('Q');
  });

  it('bands the statistic so the reachable mis-pin fails', () => {
    const [low, high] = def.sanity;

    // Above Latvia's entire MIO_PKM range (162-212), so pinning the wrong unit
    // trips the live contract rather than drawing a quieter chart.
    expect(low, 'the floor must reject a passenger-kilometre series').toBeGreaterThan(212);

    // ...and still below the lowest quarter ever recorded, including the 2020
    // collapse, so a real trough is not mistaken for a fault.
    expect(low, 'the floor must accept the pandemic trough').toBeLessThan(519);
    expect(high, 'the ceiling must accept the busiest quarter').toBeGreaterThan(6074);
  });

  it('is citable, so an article naming it is not silently stripped of its chart', () => {
    expect(DASHBOARD_INDICATORS.has('rail_passengers')).toBe(true);
  });

  it('does not share a request with rail freight', () => {
    // The two rail cubes are one character apart — rail_pa_quartal and
    // rail_go_quartal — and confusing them would put tonne-kilometres under a
    // passenger headline.
    expect(INDICATORS.rail_freight.dataset).not.toBe(def.dataset);
    expect(def.title).toMatch(/passenger/i);
  });
});

/**
 * The industrial electricity price names the band it actually prices.
 *
 * The registry title is not what a reader sees — the tile passes its own
 * `title` to the chart. So the qualifier has to be true in both places or the
 * fix is invisible on the page it was made for.
 */
describe('the industrial electricity price on the energy tile', () => {
  it('tells the reader it is a band rather than every consumer', () => {
    const shown = chartsIn('EnergyTile.tsx').elec_price_industry;

    expect(shown, 'EnergyTile must still draw the industry price').toBeDefined();
    expect(shown, 'the visible title must name the band, not just the registry one')
      .toMatch(/\d+\s*[\u2013-]\s*\d+/);
    expect(shown).toContain('500');
  });

  it('leaves the household price alone, because its total is complete', () => {
    // TOT_KWH carries 9 of 9 periods for all three countries in nrg_pc_204.
    // The band problem is a property of nrg_pc_205, not of the code.
    expect(INDICATORS.elec_price_household.params).toContain('nrg_cons=TOT_KWH');
    expect(chartsIn('EnergyTile.tsx').elec_price_household).not.toMatch(/\d+\s*[\u2013-]\s*\d+/);
  });
});

describe('the captions claim nothing the data does not support', () => {
  it('does not name a leader or a laggard in any freight or productivity title', () => {
    // Latvia leads productivity and Estonia trails; Latvia is also the most
    // rail-dependent of the three at 18.9% against Lithuania's 8.5%. Both are
    // the opposite of the obvious guess, and a title that characterised either
    // would have to be right about it forever.
    const titles = [
      ...Object.values(chartsIn('TradeTile.tsx')),
      ...Object.values(chartsIn('LabourTile.tsx')),
    ];

    const editorialising = titles.filter((t) =>
      /\b(?:Latvia|Estonia|Lithuania|lead|lags?|ahead|behind|stalled|fastest|slowest|best|worst|rises?|falls?)\b/i
        .test(t));

    expect(editorialising, 'a chart title must not grade a country').toEqual([]);
  });

  it('titles the productivity chart by what it measures', () => {
    const title = chartsIn('LabourTile.tsx').labour_productivity;
    expect(title).toMatch(/productivity/i);
    // The index is rebased to 2020, so a title implying a rate of change would
    // misdescribe the series regardless of direction.
    expect(title).not.toMatch(/growth|decline|gain/i);
  });

  it('distinguishes the two road freight series by what they count', () => {
    // `road_freight` is tonnes lifted and `road_freight_tkm` is
    // tonne-kilometres. Confusing them puts Latvia's rail share at about 4%
    // rather than 18.9%, so the page must not imply they are interchangeable.
    expect(INDICATORS.road_freight.params).toContain('unit=THS_T');
    expect(INDICATORS.road_freight_tkm.params).toContain('unit=MIO_TKM');

    const title = chartsIn('TradeTile.tsx').road_freight;
    expect(title, 'the tonnes series should say it is a volume lifted')
      .toMatch(/lifted|tonnes/i);
  });
});

describe('a card and a chart never carry the same title', () => {
  /**
   * Six pairs did. Not similar wording — the identical string on the same
   * tile, so "GDP growth" appeared twice one above the other.
   *
   * The fix was not to delete the chart in most cases. The card is *this
   * country, latest value, delta, sparkline*; the chart is *three countries
   * over time*. Those are different questions, and cross-country comparison is
   * the premise of the site, so cutting it to resolve a naming collision would
   * throw away the better half. Four were retitled to say which question they
   * answer; two were cut, because GDP and unemployment already appear as a
   * card *and* in the ticker, making the chart a third telling of the same
   * number.
   */
  const MAP: Record<string, string> = (() => {
    const src = readFileSync(resolve('src/components/IndicatorCard.tsx'), 'utf8');
    const block = src.match(/EUROSTAT_FALLBACK[^=]*=\s*\{([\s\S]*?)\n\};/);
    return Object.fromEntries(
      [...(block?.[1] ?? '').matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
    );
  })();

  // Every tile, including `EconomyTile`. It was excluded while its three
  // clashes were pending, because that file carries twenty-seven hardcoded
  // colour instances and was being rewritten by the colour migration at the
  // same time, so its fix was sequenced rather than raced. The exclusion is
  // closed now and the assertion covers the whole dashboard.
  const TILES = ['EconomyTile.tsx', 'EnergyTile.tsx', 'GovernmentTile.tsx',
    'LabourTile.tsx', 'TradeTile.tsx'];

  it.each(TILES)('%s gives its card and chart distinct titles', (name) => {
    const text = tile(name);
    const cards = [...text.matchAll(/IndicatorCard\s+id="([^"]+)"\s+title="([^"]+)"/g)]
      .map((m) => ({ id: MAP[m[1]] ?? m[1], title: m[2] }));
    const charts = [...text.matchAll(/BalticCompareChart\s+indicator="([^"]+)"\s+title="([^"]+)"/g)]
      .map((m) => ({ id: m[1], title: m[2] }));

    const clashes: string[] = [];
    for (const card of cards) {
      for (const chart of charts) {
        if (card.id === chart.id && card.title.trim() === chart.title.trim()) {
          clashes.push(`${card.id}: "${card.title}" appears as both`);
        }
      }
    }

    expect(clashes, `${name} repeats a title`).toEqual([]);
  });
});

describe('the thinnest charts are gone', () => {
  /**
   * Measured, not assumed. At the dashboard's default five-year window these
   * were the point counts per line, taken from the live API across LV, EE and
   * LT: `digital_skills` 3, `online_shoppers` 5, `net_migration` 5,
   * `poverty_risk` 5. A three-point line chart carrying a legend and two axes
   * is a table pretending to be a chart.
   *
   * Ten of the forty-six charts had six points or fewer. Only four are cut
   * here — thinness was half the argument and editorial weight the other half,
   * and the remaining six are worth keeping until there is a compact "three
   * countries, latest, ranked" component to move them into. Replacing ten
   * charts with ten of something else would be a redesign wearing a removal's
   * clothes.
   */
  it.each(['digital_skills', 'online_shoppers', 'net_migration', 'poverty_risk'])(
    'no tile still draws %s', (id) => {
      const drawn = ['EconomyTile.tsx', 'EnergyTile.tsx', 'GovernmentTile.tsx',
        'LabourTile.tsx', 'TradeTile.tsx']
        .filter((name) => new RegExp(`indicator="${id}"`).test(tile(name)));
      expect(drawn, `${id} is still drawn`).toEqual([]);
    });

  it('keeps the indicators themselves, which the newsroom may still cite', () => {
    // Removing a visual is not the same as removing a statistic. These stay
    // queryable through /api/baltic-compare and resolvable for an article.
    for (const id of ['digital_skills', 'online_shoppers', 'net_migration', 'poverty_risk']) {
      expect(INDICATORS, `${id} must remain available`).toHaveProperty(id);
      expect(DASHBOARD_INDICATORS.has(id), `${id} must stay citable`).toBe(true);
    }
  });
});
