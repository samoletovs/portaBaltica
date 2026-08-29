/**
 * What a movement *means*, as opposed to which way it went.
 *
 * Green means up and red means down — that is what a reader scanning a
 * dashboard for momentum expects, and it is what this product asked for.
 *
 * With one exception, and it is the important one. Twelve series are worse
 * when they rise: unemployment, every inflation measure, producer prices,
 * government debt, the gas price, bankruptcies. Colouring those by raw
 * direction means the dashboard renders rising unemployment in green — it
 * editorialises, silently, in the wrong direction, on exactly the series a
 * reader is most likely to care about. So for those the colours flip: a fall
 * is the good news, and it is drawn as such.
 *
 * Everything else is coloured by direction, including the genuinely ambiguous
 * series like house prices and population. That is a deliberate concession:
 * green there means "went up", not "good", and the arrow and the sign say the
 * same thing without any colour at all.
 *
 * An earlier version of this file left ambiguous indicators grey and refused
 * to colour them. It was more defensible and less useful — a dashboard of grey
 * numbers cannot be scanned, and the whole reason to open it is to scan it.
 *
 * **What a grade actually costs, measured rather than assumed.** That last
 * paragraph is the standing argument for grading an indicator, and it applies
 * to only one of the two grades. `sentimentOf` branches on `lower-better` and
 * nothing else, so `higher-better` and `neutral` produce the *same* colour,
 * the same arrow and the same absent note — measured across every entry in
 * the map, a `higher-better` row is indistinguishable from a `neutral` one:
 *
 *     higher-better   rise → positive/green   fall → negative/red   note: —
 *     neutral         rise → positive/green   fall → negative/red   note: —
 *     lower-better    rise → negative/red     fall → positive/green note: "Lower is better"
 *
 * The single difference is the sentence a screen reader hears:
 * `higher-better` says *"up, which is favourable for this indicator"* where
 * `neutral` says *"up"*. So a `higher-better` entry buys no scanability at
 * all — it buys one editorial claim, spoken to the readers least able to
 * check it against the chart.
 *
 * That sets the admission bar for this half of the map, and it is a low-cost
 * bar to fail: removing an entry costs a clause and changes nothing visible.
 * `lower-better` is the expensive half and the one the argument above is
 * really about, because it inverts the colour.
 *
 * See DESIGN.md §3.5.
 */

export type Polarity = 'higher-better' | 'lower-better' | 'neutral';

/** What a delta should be read as, once polarity is applied. */
export type Sentiment = 'positive' | 'negative' | 'none';

/**
 * Polarity is asserted only where it is genuinely uncontroversial.
 *
 * The test for inclusion is whether a Baltic finance ministry, a trade union
 * and a central bank would all agree on the sign. Where they would not, the
 * indicator is absent from this map, is therefore `neutral`, and gets coloured
 * by direction like everything else.
 */
const POLARITY: Record<string, Polarity> = {
  // Higher is better — output, earnings, activity, energy transition. These
  // are coloured by direction, which for them also happens to be by meaning.
  gdp: 'higher-better',
  salary: 'higher-better',
  wages_industry: 'higher-better',
  wages_it: 'higher-better',
  retail_sales: 'higher-better',
  industrial: 'higher-better',
  biz_confidence: 'higher-better',
  renewable_share: 'higher-better',
  exports: 'higher-better',
  tourist_arrivals: 'higher-better',
  hotel_occupancy: 'higher-better',

  // Lower is better. These are the twelve that flip: a rise is drawn red and
  // a fall green, because drawing rising unemployment in green is the one
  // thing a dashboard on this site must not do.
  unemployment: 'lower-better',
  // A slice of `unemployment`, and it was missing. `polarityOf` defaults to
  // `neutral`, so a rise in youth unemployment rendered **green** and was
  // spoken as a bare "up" — on a card `LabourTile` has been rendering all
  // along. That is the thing this file's own header says a dashboard on this
  // site must not do, in the same cube as the indicator the header is about.
  // Nobody decided it; nobody had asked. See tests/polarityComposition.test.ts.
  youth_unemployment: 'lower-better',
  cpi: 'lower-better',
  inflation: 'lower-better',
  core_inflation: 'lower-better',
  food_inflation: 'lower-better',
  energy_inflation: 'lower-better',
  services_inflation: 'lower-better',
  goods_inflation: 'lower-better',
  // Two more slices of `inflation` from the same cube, ungraded by the same
  // omission and rendered by `EnergyTile`. Five of their siblings were graded.
  admin_prices: 'lower-better',
  home_energy_inflation: 'lower-better',
  gov_debt: 'lower-better',
  energy_price_gas: 'lower-better',
  bankruptcies: 'lower-better',

  // Deliberately absent, and therefore coloured by direction only. The list
  // below is the checked copy of this decision — see DELIBERATELY_NEUTRAL.
  //   house_prices        — good if you own, bad if you are buying
  //   population          — the Baltic depopulation story is not ours to grade
  //   imports             — a rise is domestic demand or it is dependency
  //   gov_revenue         — receipts are not by themselves good or bad news
  //   new_vehicles        — more cars is not self-evidently progress
  //   construction_output — building, or the credit cycle that took a quarter
  //                         off Latvia's GDP after 2007
  //   building_permits    — the same story one step earlier, and the leading
  //   …_residential         indicator of it. A finance ministry reads a surge
  //   …_non_residential     as investment and a union as jobs; a central bank
  //                         in this region reads it as a warning, and the
  //                         admission test above needs all three.
  //   trade_balance       — arithmetically exports minus imports, and `imports`
  //                         is declined two lines above. Grading the balance
  //                         grades imports after all, in the opposite
  //                         direction, through a series the reader is not told
  //                         is derived. See DERIVED_FROM_A_DECLINED_INPUT
  //                         below: this one is not a judgement, it is forced.
  //   ppi                 — producer prices, and the one entry here moved out of
  //                         `lower-better` rather than never added. Measured
  //                         live over five years: 167 of 200 observations sit
  //                         below 2% and 73 are outright negative, with LV at
  //                         0.0, EE at -0.3 and LT at -2.4 today. So the site
  //                         was drawing a *further* fall green and speaking it
  //                         as "favourable" while producer prices were already
  //                         contracting. A finance ministry reads cheaper
  //                         inputs; a manufacturing union reads margin squeeze
  //                         and the layoffs behind it; a central bank reads the
  //                         deflation signal it cuts rates against. Unlike the
  //                         HICP measures there is no target to be above, so
  //                         there is not even a level at which the three agree.
};

/**
 * Ids that reach `sentimentOf` and are ungraded **on purpose**.
 *
 * Read that first line as the membership rule, because it is one. This set is
 * for ids the page actually **colours**; an id nothing hands to `sentimentOf`
 * does not belong here however ungradable it is, and putting one in would make
 * the set mean "things someone thought about" rather than "abstentions the
 * reader can see". Measured: of the ten balance-of-payments definitions in the
 * registry, three reach a colouring surface and seven do not.
 *
 * There are now two different reasons to be ungraded and only one of them
 * lives here:
 *
 *   - **Declined** — a human weighed it and the admission test above failed.
 *     That is this set.
 *   - **Derived** — the arithmetic forbids it, because the series inherits an
 *     input that was declined. Nobody decides those one at a time; a rule
 *     does, and `tests/derivedPolarity.test.ts` is that rule.
 *
 * `trade_balance` is in both categories and is listed here because it is
 * *rendered*, so the sweep below would otherwise report it as an omission.
 *
 * This exists so the abstention is a decision rather than an omission, and so
 * the difference between them is checkable. `polarityOf` answers `neutral` for
 * anything it does not recognise, which is the right default and also means a
 * card added tomorrow with an unregistered id is silently coloured by
 * direction with nobody having decided anything.
 *
 * The newsroom hit the identical shape on the same day: its parity test
 * excluded `freq` with a comment naming the field the newsroom carries it in,
 * and nothing checked that field — so the exclusion read as "not comparable"
 * rather than "compared elsewhere", and the cadence went unverified from the
 * day it was written. A documented decision that nothing enforces decays into
 * an assumption.
 *
 * The port ids carry their reasoning at their own call site in
 * `PortPanelParts.tsx`: a rise in tonnage is trade or it is transit
 * dependency, and a rise in passengers is tourism or it is emigration.
 */
export const DELIBERATELY_NEUTRAL: ReadonlySet<string> = new Set([
  'house_prices',
  'population',
  'imports',
  'gov_revenue',
  'new_vehicles',
  'construction_output',
  'building_permits',
  'building_permits_residential',
  'building_permits_non_residential',
  'trade_balance',
  'ppi',
  'port_goods',
  'port_passengers',
  'port_vessels',
]);

/**
 * Why a rendered series has no colour when its neighbours do.
 *
 * `polarityNote` used to answer only for `lower-better`, so moving an id into
 * `DELIBERATELY_NEUTRAL` removed its colour *and* the one sentence explaining
 * the absence. On a tile where the series either side are graded, an
 * unexplained grey reads as an oversight rather than as a decision — which is
 * the same confusion this whole file exists to remove, arriving at the reader
 * instead of at the maintainer.
 *
 * Only ids that actually reach a colouring surface need one. An abstention
 * nobody can see needs no caption, and `tests/polarityAdmission.test.ts`
 * asserts that correspondence as an equality rather than trusting it.
 */
export const ABSTENTION_NOTE: Record<string, string> = {
  ppi: 'Not graded: a fall is disinflation or it is contraction',
  trade_balance: 'Not graded: derived from imports, which is not graded',
  house_prices: 'Not graded: good if you own, bad if you are buying',
  imports: 'Not graded: a rise is domestic demand or it is dependency',
  population: 'Not graded: the Baltic depopulation story is not ours to grade',
  new_vehicles: 'Not graded: more cars is not self-evidently progress',
  construction_output: 'Not graded: building, or the credit cycle behind it',
  building_permits: 'Not graded: investment, jobs, or a credit bubble',
  building_permits_residential: 'Not graded: investment, jobs, or a credit bubble',
  building_permits_non_residential: 'Not graded: investment, jobs, or a credit bubble',
  gov_revenue: 'Not graded: receipts are not by themselves good or bad news',
};

/** The polarity of an indicator. Unknown ids are neutral, which is the safe default. */
export function polarityOf(id: string): Polarity {
  return POLARITY[id] ?? 'neutral';
}

/**
 * How a change should be coloured.
 *
 * Green for up and red for down, except on a `lower-better` series where the
 * two swap. `none` is returned only when nothing moved or nothing is known —
 * a series that did not change has not delivered news either way.
 */
export function sentimentOf(id: string, change: number | null | undefined): Sentiment {
  if (change === null || change === undefined || !Number.isFinite(change) || change === 0) {
    return 'none';
  }

  const rose = change > 0;
  return polarityOf(id) === 'lower-better'
    ? (rose ? 'negative' : 'positive')
    : (rose ? 'positive' : 'negative');
}

/** The CSS custom property a sentiment resolves to. */
export function sentimentColor(sentiment: Sentiment): string {
  if (sentiment === 'positive') return 'var(--data-positive)';
  if (sentiment === 'negative') return 'var(--data-negative)';
  return 'var(--text-secondary)';
}

/**
 * A short note explaining a colour that contradicts the naive reading.
 *
 * On a `lower-better` series a fall is drawn green, which is correct and is the
 * whole point of this module — but on a dashboard it puts a green ▼ next to a
 * red ▼ on cards that are both falling, and a reader cannot tell from the
 * colour whether green meant "up" or meant "good". Both were true somewhere on
 * the screen.
 *
 * That was reported as "some indicators do not represent the trend with the
 * colour — is the rate going up or down, not clear", and the report is fair:
 * DESIGN.md §3.5 anticipated the ambiguity and judged the arrow enough to
 * resolve it. A 12px glyph tinted the same colour as the number beside it is
 * not enough; it reads as part of the coloured blob rather than as an
 * independent channel.
 *
 * The fix is to say the thing rather than to imply it. `lower-better` needs a
 * note because a rise is drawn red where an unprimed reader expects green.
 *
 * A **declined** series needs one for the opposite reason: it is drawn by
 * direction like `higher-better`, so nothing on the card distinguishes "we
 * weighed this and abstained" from "nobody thought about it". That mattered the
 * moment `ppi` moved out of `lower-better` — its colour inverted and its
 * caption vanished in the same change, on a tile where the series either side
 * of it keep theirs. `higher-better` still gets nothing, because there a rise
 * is drawn green and a note would explain the obvious.
 */
export function polarityNote(id: string): string | null {
  if (polarityOf(id) === 'lower-better') return 'Lower is better';
  return ABSTENTION_NOTE[id] ?? null;
}

/**
 * The direction of a change, spelled out for a screen reader.
 *
 * Colour is the third encoding here, never the first: the arrow and the sign
 * carry the direction, this carries the meaning, and the colour only confirms
 * what both already said (WCAG 2.2 SC 1.4.1). That redundancy is not
 * decoration — red and green are the classic confusion pair, and measured
 * under a Brettel deuteranopia simulation our own `--data-positive` and
 * `--data-negative` sit at ΔE 8, which is to say indistinguishable. For
 * roughly 8% of men the arrow *is* the encoding.
 */
export function changeDescription(id: string, change: number | null | undefined): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return 'no change data';
  if (change === 0) return 'unchanged';

  const direction = change > 0 ? 'up' : 'down';
  if (polarityOf(id) === 'neutral') return direction;
  return `${direction}, which is ${sentimentOf(id, change) === 'positive' ? 'favourable' : 'unfavourable'} for this indicator`;
}

/**
 * A signed number for display.
 *
 * Uses U+2212 MINUS SIGN rather than a hyphen: a hyphen is narrower than a
 * digit and breaks column alignment even in a tabular face, which is exactly
 * the twitch tabular figures are there to prevent.
 */
export function signed(formatted: string, change: number): string {
  return change > 0 ? `+${formatted}` : `\u2212${formatted}`;
}
