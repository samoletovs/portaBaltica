/**
 * What a movement *means*, as opposed to which way it went.
 *
 * Every indicator card used to colour a rise green and a fall red. So rising
 * unemployment was green. Rising inflation was green. Rising government debt
 * was green. On every load, silently, the dashboard editorialised — and in the
 * wrong direction on exactly the series a reader is most likely to care about.
 *
 * Financial interfaces get away with green-up because they show *prices*,
 * where up is unambiguously good for whoever is holding the thing. Macro
 * statistics are not prices. The FT's own charts use a neutral series colour
 * and leave the judgement to the reader.
 *
 * So an indicator declares one of three polarities, and `neutral` is both the
 * default and, for most series, the correct answer. Whether rising house
 * prices are good news depends entirely on whether you already own one, and it
 * is not this dashboard's job to decide that on the reader's behalf. A neutral
 * indicator still shows its direction — arrow, sign and value — it just does
 * not colour it as approval.
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
 * indicator is absent from this map and is therefore neutral.
 */
const POLARITY: Record<string, Polarity> = {
  // Higher is better — output, earnings, activity, energy transition.
  gdp: 'higher-better',
  salary: 'higher-better',
  wages_industry: 'higher-better',
  wages_it: 'higher-better',
  retail_sales: 'higher-better',
  industrial: 'higher-better',
  construction_output: 'higher-better',
  building_permits: 'higher-better',
  biz_confidence: 'higher-better',
  renewable_share: 'higher-better',
  exports: 'higher-better',
  trade_balance: 'higher-better',
  tourist_arrivals: 'higher-better',
  hotel_occupancy: 'higher-better',

  // Lower is better — joblessness, price growth, indebtedness, energy cost.
  unemployment: 'lower-better',
  cpi: 'lower-better',
  inflation: 'lower-better',
  core_inflation: 'lower-better',
  food_inflation: 'lower-better',
  energy_inflation: 'lower-better',
  services_inflation: 'lower-better',
  goods_inflation: 'lower-better',
  ppi: 'lower-better',
  gov_debt: 'lower-better',
  energy_price_gas: 'lower-better',
  bankruptcies: 'lower-better',

  // Deliberately absent, and therefore neutral:
  //   house_prices  — good if you own, bad if you are buying
  //   population    — the Baltic depopulation story is not ours to grade
  //   imports       — a rise is domestic demand or it is dependency
  //   gov_revenue   — receipts are not by themselves good or bad news
  //   new_vehicles  — more cars is not self-evidently progress
};

/** The polarity of an indicator. Unknown ids are neutral, which is the safe default. */
export function polarityOf(id: string): Polarity {
  return POLARITY[id] ?? 'neutral';
}

/**
 * How a change should be coloured.
 *
 * `none` is returned both for neutral indicators and for a change of exactly
 * zero, because a series that did not move has not delivered good or bad news.
 */
export function sentimentOf(id: string, change: number | null | undefined): Sentiment {
  if (change === null || change === undefined || !Number.isFinite(change) || change === 0) {
    return 'none';
  }

  switch (polarityOf(id)) {
    case 'higher-better':
      return change > 0 ? 'positive' : 'negative';
    case 'lower-better':
      return change > 0 ? 'negative' : 'positive';
    default:
      return 'none';
  }
}

/** The CSS custom property a sentiment resolves to. */
export function sentimentColor(sentiment: Sentiment): string {
  if (sentiment === 'positive') return 'var(--data-positive)';
  if (sentiment === 'negative') return 'var(--data-negative)';
  return 'var(--text-secondary)';
}

/**
 * The direction of a change, spelled out for a screen reader.
 *
 * Colour is the third encoding here, never the first: the arrow and the sign
 * carry the direction, this carries the meaning, and the colour only confirms
 * what both already said (WCAG 2.2 SC 1.4.1).
 */
export function changeDescription(id: string, change: number | null | undefined): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return 'no change data';
  if (change === 0) return 'unchanged';

  const direction = change > 0 ? 'up' : 'down';
  const sentiment = sentimentOf(id, change);
  if (sentiment === 'none') return direction;
  return `${direction}, which is ${sentiment === 'positive' ? 'favourable' : 'unfavourable'} for this indicator`;
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
