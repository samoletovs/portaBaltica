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
  construction_output: 'higher-better',
  building_permits: 'higher-better',
  biz_confidence: 'higher-better',
  renewable_share: 'higher-better',
  exports: 'higher-better',
  trade_balance: 'higher-better',
  tourist_arrivals: 'higher-better',
  hotel_occupancy: 'higher-better',

  // Lower is better. These are the twelve that flip: a rise is drawn red and
  // a fall green, because drawing rising unemployment in green is the one
  // thing a dashboard on this site must not do.
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

  // Deliberately absent, and therefore coloured by direction only:
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
