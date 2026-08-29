/**
 * What a polarity is allowed to claim, and what it costs to claim it.
 *
 * `polarity.ts` states its own admission test — *"whether a Baltic finance
 * ministry, a trade union and a central bank would all agree on the sign"* —
 * and says an indicator that fails it should be **absent** from the map and
 * therefore `neutral`. The rule is written once and applied by hand two dozen
 * times, which is the shape where a rule and its applications drift apart with
 * nothing comparing them.
 *
 * Two of them were drifted. `building_permits` and `construction_output` are
 * the same economic story one step apart, and both were `higher-better`: a
 * finance ministry reads a permit surge as investment and a union reads it as
 * jobs, but a central bank in a region that lost a quarter of its GDP after
 * 2007 reads it as a warning. Three parties, not unanimous.
 *
 * The cost of cutting them was measured before they were cut, and it is the
 * finding that made the decision easy rather than close: **`higher-better` and
 * `neutral` are behaviourally identical everywhere except one sentence.** The
 * first two describes below are that measurement, kept as assertions, because
 * the argument for grading anything rests on it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  ABSTENTION_NOTE,
  DELIBERATELY_NEUTRAL,
  changeDescription,
  polarityNote,
  polarityOf,
  sentimentColor,
  sentimentOf,
} from '../src/utils/polarity';

const polaritySource = readFileSync(resolve('src/utils/polarity.ts'), 'utf8');

/** Every id the map grades, read from the map rather than restated. */
const GRADED = [...polaritySource.matchAll(/^ {2}(\w+): '(higher-better|lower-better)',$/gm)]
  .map((m) => ({ id: m[1], polarity: m[2] }));

function componentFiles(): { file: string; text: string }[] {
  const dir = resolve('src/components');
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.tsx') ? [join(d, e.name)] : [],
    );
  return walk(dir).map((path) => ({ file: path.split(/[\\/]/).pop()!, text: readFileSync(path, 'utf8') }));
}

// ─── what a grade costs ───────────────────────────────────────────────────

describe('the cost of a grade, which is the reason the map may be pruned', () => {
  it('finds the map, so everything below is about something', () => {
    // The regex above is the only thing tying these assertions to the file. If
    // it stops matching, every `it.each` under it silently runs zero cases.
    expect(GRADED.length, 'no graded ids parsed out of polarity.ts').toBeGreaterThan(15);
    expect(GRADED.filter((g) => g.polarity === 'higher-better').length).toBeGreaterThan(5);
    expect(GRADED.filter((g) => g.polarity === 'lower-better').length).toBeGreaterThan(5);
  });

  it('draws a `higher-better` series exactly as it draws an ungraded one', () => {
    // This is the measurement the pruning rests on. `sentimentOf` branches on
    // `lower-better` and nothing else, so a `higher-better` entry buys no
    // colour, no arrow and no note — it buys one clause in the spoken
    // description. If someone gives `higher-better` a visual of its own, this
    // fails, and the argument for cutting an entry has to be made again.
    const ungraded = 'an-id-nobody-has-classified';
    expect(polarityOf(ungraded)).toBe('neutral');

    for (const { id } of GRADED.filter((g) => g.polarity === 'higher-better')) {
      for (const change of [2.5, -2.5]) {
        expect(sentimentOf(id, change), `${id} sentiment`).toBe(sentimentOf(ungraded, change));
        expect(sentimentColor(sentimentOf(id, change)), `${id} colour`)
          .toBe(sentimentColor(sentimentOf(ungraded, change)));
      }
      expect(polarityNote(id), `${id} note`).toBe(polarityNote(ungraded));
    }
  });

  it('differs from an ungraded one in exactly one place: what is spoken', () => {
    // The companion. Without it the assertion above is satisfied by a
    // `higher-better` that does nothing at all, and the map would be pure
    // decoration rather than a claim worth auditing.
    const higher = GRADED.filter((g) => g.polarity === 'higher-better');
    expect(higher.length).toBeGreaterThan(0);

    for (const { id } of higher) {
      expect(changeDescription(id, 2.5)).toBe('up, which is favourable for this indicator');
      expect(changeDescription('an-id-nobody-has-classified', 2.5)).toBe('up');
    }
  });

  it('makes `lower-better` the expensive half, which is why it is not pruned here', () => {
    // A `lower-better` entry inverts the colour and adds a note. Removing one
    // is a visible change to a card; removing a `higher-better` one is not.
    for (const { id } of GRADED.filter((g) => g.polarity === 'lower-better')) {
      expect(sentimentOf(id, 2.5), `${id} rising`).toBe('negative');
      expect(sentimentOf(id, -2.5), `${id} falling`).toBe('positive');
      expect(polarityNote(id), `${id} note`).toBe('Lower is better');
    }
  });
});

// ─── the two the sweep moved ──────────────────────────────────────────────

describe('building permits and construction output', () => {
  const PERMITS = [
    'building_permits',
    'building_permits_residential',
    'building_permits_non_residential',
  ];

  it('are ungraded, because the admission test needs three parties and gets two', () => {
    for (const id of [...PERMITS, 'construction_output']) {
      expect(polarityOf(id), `${id}`).toBe('neutral');
    }
  });

  it('say so on the record rather than being absent by accident', () => {
    // `polarityOf` answers `neutral` for anything it does not recognise, so an
    // id that fell out of the map by a bad merge is indistinguishable from one
    // that was reasoned about. The set is what makes the difference checkable.
    for (const id of [...PERMITS, 'construction_output']) {
      expect(DELIBERATELY_NEUTRAL.has(id), `${id} is ungraded but nothing says why`).toBe(true);
    }
  });

  it('agree with each other, whatever they are', () => {
    // The durable half. Permits are the leading indicator of construction
    // output, so grading one and not the other makes the page contradict
    // itself two cards apart on the same tile — a green "favourable" on the
    // outturn beside an ungraded lead. This does not pin `neutral`: it pins
    // that the four move together.
    const grades = new Set([...PERMITS, 'construction_output'].map(polarityOf));
    expect([...grades], 'the same story one step apart, graded two ways').toHaveLength(1);
  });

  it('keeps every remaining grade defensible under the same test', () => {
    // A named list rather than a filter, so a new grade is a visible diff line
    // and this assertion has to be looked at. Written as an equality: a filter
    // of known-good ids stops matching silently the day one is renamed.
    //
    // It has already earned that twice. `trade_balance` left when the
    // derivation guard was added, and the equality is what made its departure a
    // decision rather than a silent shrink. Then three arrived and one left at
    // once: `youth_unemployment`, `admin_prices` and `home_energy_inflation`
    // are slices of graded wholes and were ungraded only by omission — see
    // `tests/polarityComposition.test.ts`, which derives that from the
    // containment table rather than listing it — while `ppi` left on the
    // three-party test, measured. Twenty-five now.
    expect(GRADED.map((g) => g.id).sort()).toEqual([
      'admin_prices',
      'bankruptcies',
      'biz_confidence',
      'core_inflation',
      'cpi',
      'energy_inflation',
      'energy_price_gas',
      'exports',
      'food_inflation',
      'gdp',
      'goods_inflation',
      'gov_debt',
      'home_energy_inflation',
      'hotel_occupancy',
      'industrial',
      'inflation',
      'renewable_share',
      'retail_sales',
      'salary',
      'services_inflation',
      'tourist_arrivals',
      'unemployment',
      'wages_industry',
      'wages_it',
      'youth_unemployment',
    ]);
  });
});

// ─── grades that colour nothing ───────────────────────────────────────────

describe('the map against what the dashboard actually renders', () => {
  /**
   * Every id handed to `sentimentOf` by a surface that renders it.
   *
   * Deliberately **not** the values of a `Record` literal. `IndicatorCard`'s
   * `EUROSTAT_FALLBACK` and `IndicatorPage`'s `EUROSTAT_MAP` map a dashboard
   * id to a *baltic-compare indicator*, so `cpi: 'inflation'` means the CPI
   * card falls back to the Eurostat inflation series — `sentimentOf` is called
   * with `cpi` and never with `inflation`. A first version of this sweep
   * counted those values as rendered and reported six dormant grades where
   * there are seven, which is the sweep being wrong in the direction that
   * makes the list look healthier.
   *
   * No graded id reaches a surface only through such a map: the four in
   * `DataTicker`'s label lookup are all `IndicatorCard`s as well, checked.
   */
  function renderedIds(): Set<string> {
    const ids = new Set<string>();
    for (const { text } of componentFiles()) {
      for (const m of text.matchAll(/<IndicatorCard[^>]*\bid="([^"]+)"/g)) ids.add(m[1]);
      for (const m of text.matchAll(/^ {2}\{ id: '([a-z_]+)'/gm)) ids.add(m[1]);
      const list = text.match(/const INDICATORS = \[([^\]]+)\]/);
      if (list) for (const m of list[1].matchAll(/'([^']+)'/g)) ids.add(m[1]);
    }
    return ids;
  }

  it('sweeps enough of the page to be worth reading', () => {
    expect(renderedIds().size, 'the sweep found almost nothing, so it proves nothing')
      .toBeGreaterThan(20);
  });

  it('names the grades that currently colour nothing, as a list', () => {
    // Not a defect, and not nothing either. These are graded and rendered only
    // by `BalticCompareChart`, which never calls `sentimentOf` — so those
    // entries decide the colour of no pixel on the site today. Keeping them is
    // right: a card added tomorrow would otherwise be coloured by direction
    // with nobody having decided anything, which is the failure
    // `DELIBERATELY_NEUTRAL` exists to prevent one level up.
    //
    // Stated as an equality so the list cannot quietly grow. A map where most
    // entries govern nothing has stopped being a record of live decisions, and
    // the only way to notice is to count. Ten of twenty-five today.
    //
    // **This assertion earned itself again, against a claim rather than a
    // defect.** The part/whole guard found `youth_unemployment` ungraded beside
    // a `lower-better` `unemployment`, and `sentimentOf` really does answer
    // *positive* — green — for a rise in it. The natural next sentence is that
    // the dashboard renders rising youth unemployment green, and that sentence
    // is false: it reaches only a compare chart, which colours nothing. The
    // equality went red, which is what forced the check. Executing the function
    // is not executing the surface, and the three arriving here are a
    // prophylactic fix, not a live one.
    const rendered = renderedIds();
    const dormant = GRADED.map((g) => g.id).filter((id) => !rendered.has(id)).sort();

    expect(dormant).toEqual([
      'admin_prices',
      'bankruptcies',
      'core_inflation',
      'energy_inflation',
      'food_inflation',
      'goods_inflation',
      'home_energy_inflation',
      'inflation',
      'services_inflation',
      'youth_unemployment',
    ]);
  });

  it('explains every abstention a reader can actually see, as an equality', () => {
    // The companion problem to the dormant list above, from the other side.
    //
    // A declined series is drawn by direction, exactly like a `higher-better`
    // one, so nothing on the card separates *"we weighed this and abstained"*
    // from *"nobody thought about it"*. On a tile where the neighbours carry
    // "Lower is better", an unexplained grey reads as an oversight — the same
    // confusion `DELIBERATELY_NEUTRAL` exists to remove, arriving at the reader
    // instead of at the maintainer. It became live the moment `ppi` moved out
    // of `lower-better`: its colour inverted and its caption vanished together.
    //
    // Stated as an equality in both directions: a rendered abstention with no
    // note fails, and a note for something that is no longer declined fails
    // too, so the map cannot accumulate captions for series nobody colours.
    const rendered = renderedIds();
    const visibleAbstentions = [...DELIBERATELY_NEUTRAL].filter((id) => rendered.has(id)).sort();

    expect(
      visibleAbstentions.filter((id) => !polarityNote(id)),
      'this series is declined and rendered, so its card is grey with no reason given',
    ).toEqual([]);

    expect(
      Object.keys(ABSTENTION_NOTE).filter((id) => !DELIBERATELY_NEUTRAL.has(id)).sort(),
      'a note explaining an abstention that is no longer an abstention',
    ).toEqual([]);

    // Vacuity companion. With nothing rendered the first assertion passes over
    // an empty list and says nothing — this repository's most reproduced
    // failure, and the reason `ppi` is named here rather than counted.
    expect(visibleAbstentions.length, 'no declined id renders, so the rule above is empty').toBeGreaterThan(0);
    expect(visibleAbstentions, 'the abstention this rule was written for').toContain('ppi');
    expect(polarityNote('ppi')).toMatch(/^Not graded:/);
  });
});

// ─── the phone-width grids ────────────────────────────────────────────────

describe('a grid does not declare more columns than a phone can hold', () => {
  it('lists the components with three or more columns at base width, as an equality', () => {
    // `PowerMarketCard` had four `text-center` columns inside a 320px card —
    // about 57px each, against a label that is a swatch, a flag and the word
    // "Lithuania". Measured in Chromium: the zone column and its label each
    // overflowed by 4px, at 320 only, and the document did not scroll, so
    // nothing caught it.
    //
    // An equality rather than a filter of known offenders, because a filter
    // stops matching the day one is fixed and then guards nothing.
    const offenders = componentFiles()
      .filter(({ text }) => /className="[^"]*(?:^|[\s"])grid-cols-(?:[3-9]|\d\d)/m.test(
        text.replace(/[a-z]+:grid-cols-\d+/g, ''),
      ))
      .map(({ file }) => file)
      .sort();

    expect(offenders, 'a new unprefixed multi-column grid needs measuring at 320px').toEqual([
      // A skeleton: four placeholder bars with no text, so there is no
      // min-content to overflow with.
      'EnvironmentTile.tsx',
      // Three columns of short numeric readings; measured clean at 320.
      'GridStatePanel.tsx',
      'PortCard.tsx',
    ]);
  });

  it('gives the indicator table as many base tracks as it has base cells', () => {
    // The row declared four tracks and, below `sm`, had three cells: both the
    // "previous" column and the sparkline are `hidden sm:block`, so they are
    // not grid items at all — but an explicitly-declared track occupies its
    // width regardless. Measured at 320px, that phantom track and its gap took
    // 80px of the 254px inside the row's padding and left the title column at
    // **18px** against 46px of content, so every title truncated to nothing.
    const text = componentFiles().find((c) => c.file === 'IndicatorTable.tsx')!.text;

    const templates = [...text.matchAll(/grid-cols-\[([^\]]+)\] sm:grid-cols-\[([^\]]+)\]/g)];
    expect(templates.length, 'header row and data row').toBe(2);

    for (const [, base, wide] of templates) {
      expect(base.split('_'), `base template ${base}`).toHaveLength(3);
      expect(wide.split('_'), `sm template ${wide}`).toHaveLength(5);
    }

    // The header and the data row must carry the same template or the columns
    // stop lining up, and a mismatch is invisible until someone looks.
    expect(templates[0][1]).toBe(templates[1][1]);
    expect(templates[0][2]).toBe(templates[1][2]);

    // 3 base tracks + 2 cells hidden below `sm` = the 5 tracks above.
    const hiddenBelowSm = [...text.matchAll(/className="hidden sm:/g)].length;
    expect(hiddenBelowSm, 'cells that are not grid items below sm').toBe(4); // 2 header, 2 row
  });
});
