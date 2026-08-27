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

  // `EconomyTile` is deliberately absent and must be added by the follow-up
  // that cuts its GDP and unemployment charts and retitles house prices. It
  // is in the colour migration's inventory (27 hardcoded instances), so its
  // three remaining clashes are being fixed in a separate PR that can be
  // sequenced against that work rather than racing it. Running this test
  // against `EconomyTile` today reports exactly those three, which is the
  // to-do list for that PR.
  const TILES = ['EnergyTile.tsx', 'GovernmentTile.tsx', 'LabourTile.tsx', 'TradeTile.tsx'];

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
