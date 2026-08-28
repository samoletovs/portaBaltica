/**
 * A grade may not be smuggled in through arithmetic.
 *
 * `imports` is a declared abstention with a written reason: *"a rise is
 * domestic demand or it is dependency."* `trade_balance` was `higher-better`.
 * But a trade balance is exports minus imports, so grading it green-when-up
 * **graded imports after all**, in the opposite direction, through a series
 * the reader is never told is derived. The site held two contradictory
 * positions on one quantity, and every existing guard passed: the polarity
 * admission test reads one id at a time, and a relationship between two ids is
 * invisible to it.
 *
 * The fix is not an entry saying `trade_balance` is neutral. That fixes today
 * and prevents nothing — the registry has 71 definitions and will grow. The
 * rule is: **an indicator arithmetically derived from a declined indicator
 * cannot itself be graded.**
 *
 * ## What is derived, and what is merely written down
 *
 * The two halves are separated on purpose, because only one of them is free of
 * invention and the difference decides how much each can be trusted.
 *
 * **Derived — `stk_flow`, from the registry, zero invention.** Eurostat's
 * `stk_flow` dimension *is* the arithmetic: `BAL` on an item is `CRE` minus
 * `DEB` on that same item. Every definition records both `bop_item` and
 * `stk_flow` in its query string, so the relation is read rather than
 * asserted. This alone catches `goods_balance`, whose two sides are `exports`
 * (G/CRE) and `imports` (G/DEB) — and it catches any future pair without
 * anyone adding a line.
 *
 * **Not derived — composition, and the tempting shortcut is wrong.** There is
 * no `GS/CRE` or `GS/DEB` in the registry, so the rule above cannot reach
 * `trade_balance`; that needs `GS ⊃ {G, S}`. The obvious derivation is to
 * split the code into letters, and it is a lexical proxy for a structural
 * relation — the trap this repo has fallen into repeatedly. It produces a
 * false positive immediately: `SC` is a *child* of `S`, not `S` plus `C`, so
 * letter-splitting would claim transport services are composed of services and
 * something called C.
 *
 * So the containment is data. It is stated as an **equality over every `BAL`
 * series in the registry** rather than as a list of the ones that matter: a
 * new balance is not silently uncovered, it fails until someone places it.
 *
 * `GS ⊃ {G, S}` is not this file's assertion either. `AGENTS.md` records it as
 * a cheap invariant and `tests/indicators.live.test.ts` checks it against live
 * Eurostat every run — *"reconciles goods and services against the trade
 * balance"*. This reads a relationship the repo already verifies numerically.
 *
 * ## Why this is a test and not a runtime module
 *
 * It reads `api/shared/indicators.js`, a CommonJS file the browser bundle does
 * not import and must not start importing for a check that has no runtime
 * effect. Nothing here changes what a reader sees; it changes what a future
 * contributor is allowed to write.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { DELIBERATELY_NEUTRAL, polarityOf } from '../src/utils/polarity';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js') as Record<
  string,
  { dataset: string; params: string; title: string }
>;

const entries = Object.entries(INDICATORS);

function param(params: string, name: string): string | null {
  return new URLSearchParams(params).get(name);
}

/**
 * Which `bop_item` contains which, as a fact about the vocabulary rather than
 * about these particular indicators.
 *
 * Written down because it cannot be read off the codes without a false
 * positive — see the header. Every entry is BPM6's own hierarchy:
 *
 *   GS  goods and services            = G + S
 *   S   services                      ⊃ SC transport, SG financial,
 *                                       SI telecom/computer/information,
 *                                       SJ other business
 *   CA  current account               ⊃ GS, plus primary and secondary income
 *                                       which this registry does not carry
 *
 * `CA` is deliberately included even though the registry holds only one of its
 * components: a partial composition is still a real dependency. A current
 * account balance moves with the trade balance, so it inherits the same
 * problem, and being unable to see the other components is a reason to be more
 * cautious rather than less.
 */
const CONTAINS: Record<string, readonly string[]> = {
  GS: ['G', 'S'],
  S: ['SC', 'SG', 'SI', 'SJ'],
  CA: ['GS'],
};

interface Series {
  id: string;
  item: string;
  flow: string;
}

/** Every balance-of-payments definition, with the two dimensions that matter. */
const bop: Series[] = entries
  .filter(([, def]) => def.dataset === 'bop_c6_q')
  .map(([id, def]) => ({
    id,
    item: param(def.params, 'bop_item') ?? '',
    flow: param(def.params, 'stk_flow') ?? '',
  }))
  .filter((s) => s.item !== '' && s.flow !== '');

const byItemFlow = new Map(bop.map((s) => [`${s.item}/${s.flow}`, s.id]));

/**
 * The ids whose value is arithmetically determined by `id`.
 *
 * One step, both rules. `inputsOf` is the inverse — what determines this one.
 */
function inputsOf(series: Series): string[] {
  const found: string[] = [];

  // Rule 1, derived: BAL(x) = CRE(x) − DEB(x).
  if (series.flow === 'BAL') {
    for (const side of ['CRE', 'DEB']) {
      const id = byItemFlow.get(`${series.item}/${side}`);
      if (id) found.push(id);
    }
  }

  // Rule 2, declared: a composite item is the sum of its parts at the same flow.
  for (const part of CONTAINS[series.item] ?? []) {
    const id = byItemFlow.get(`${part}/${series.flow}`);
    if (id) found.push(id);
  }

  return found;
}

/** Everything `id` depends on, transitively. */
function ancestorsOf(id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const series = bop.find((s) => s.id === current);
    if (!series) continue;
    for (const input of inputsOf(series)) {
      if (seen.has(input)) continue;
      seen.add(input);
      queue.push(input);
    }
  }
  return seen;
}

/**
 * Definitions whose `bop_item` the graph cannot place.
 *
 * Extracted as a function of a series list rather than written inline, so a
 * test can hand it a synthetic series and prove it detects one. Inline, the
 * assertion below could be weakened to `.filter(() => false)` and nothing
 * would notice — measured, by planting exactly that: it went green.
 */
function unplacedIn(series: Series[]): string[] {
  const placed = new Set([...Object.keys(CONTAINS), ...Object.values(CONTAINS).flat()]);
  return series
    .filter((s) => !placed.has(s.item) && inputsOf(s).length === 0)
    .map((s) => `${s.id} (${s.item}/${s.flow})`)
    .sort();
}

describe('the derivation graph, before anything is asserted with it', () => {
  it('found the balance family at all', () => {
    // Guard the guard. If the registry moves off `bop_c6_q`, or renames
    // `stk_flow`, every assertion below passes over an empty graph and reports
    // a clean sheet — which is the failure this whole file is about, one level
    // up.
    expect(bop.length, 'no balance-of-payments definitions parsed').toBeGreaterThanOrEqual(10);
    expect(bop.map((s) => s.id)).toContain('trade_balance');
    expect(bop.map((s) => s.id)).toContain('imports');
  });

  it('reads the derived half off the registry rather than a list', () => {
    // `goods_balance` is reachable with no declared containment at all: the
    // registry carries G/CRE and G/DEB, and `stk_flow` says what BAL means.
    const goods = bop.find((s) => s.id === 'goods_balance')!;
    expect(inputsOf(goods).sort()).toEqual(['exports', 'imports']);
  });

  it('places every balance-of-payments item, so a new one cannot slip past', () => {
    // The equality the header promises, and the reason `CONTAINS` is safe to
    // be data rather than derivation.
    //
    // The first version of this asserted every `BAL` series has *inputs*, and
    // it was wrong: the four service sub-balances are leaves — SC, SG, SI and
    // SJ have no CRE/DEB pair in the registry and nothing beneath them — so
    // "has inputs" fails on four correct definitions. What actually has to
    // hold is that every item is **placed**: named in the containment table as
    // a parent or as a child, or resolvable through `stk_flow`. A leaf that
    // someone has placed under `S` is a decision; an item nobody has placed is
    // a series inheriting nothing by accident, and gradeable by default.
    expect(
      unplacedIn(bop),
      'these definitions use a bop_item the containment table does not mention, so the ' +
        'graph cannot tell what they are made of or what they are part of. Add the item to ' +
        'CONTAINS — as a key if it decomposes, as a value if it is part of something larger.',
    ).toEqual([]);
  });

  it('can actually detect an unplaced item, which the empty result above cannot show', () => {
    // The companion, and it exists because its absence was measured rather
    // than imagined: weakening the filter above to `.filter(() => false)` left
    // the whole file green. An empty offender list is the same reading for
    // "everything is placed" and "the detector is switched off".
    const synthetic: Series[] = [{ id: 'a_new_balance', item: 'ZZ', flow: 'BAL' }];

    expect(unplacedIn(synthetic)).toEqual(['a_new_balance (ZZ/BAL)']);

    // And the other direction: a series whose item *is* placed must not be
    // reported, or the detector fires on everything and says nothing.
    expect(unplacedIn([{ id: 'a_known_balance', item: 'SC', flow: 'BAL' }])).toEqual([]);
  });

  it('resolves the chain the whole ruling turns on', () => {
    // trade_balance ← goods_balance ← imports, and none of those steps is
    // stated here: it is what the graph computes.
    //
    // The figure is measured rather than reasoned, and my first guess at it
    // was four. It is eight, because `services_balance` decomposes into the
    // four service categories the tile also draws — a depth I had not counted
    // and the graph had.
    expect([...ancestorsOf('trade_balance')].sort()).toEqual([
      'exports',
      'financial_services',
      'goods_balance',
      'ict_services',
      'imports',
      'other_business_services',
      'services_balance',
      'transport_services',
    ]);

    // And the step that carries the whole ruling, isolated.
    expect([...ancestorsOf('goods_balance')].sort()).toEqual(['exports', 'imports']);
  });

  it('does not claim a relationship that letter-splitting would invent', () => {
    // The false positive that made composition data rather than derivation.
    // `SC` is transport services, a child of S — not S combined with a "C".
    expect(inputsOf(bop.find((s) => s.id === 'transport_services')!)).toEqual([]);
    expect(CONTAINS.SC).toBeUndefined();
  });
});

describe('a declined input taints everything computed from it', () => {
  /** Ids that inherit an abstention, whatever anyone would like to say about them. */
  const tainted = bop
    .filter((s) => [...ancestorsOf(s.id)].some((a) => DELIBERATELY_NEUTRAL.has(a)))
    .map((s) => s.id)
    .sort();

  it('names them, computed rather than listed', () => {
    // Not an exemption list. Each of these is here because the graph says a
    // declined series determines its value, and the day `imports` is graded
    // they all leave on their own.
    expect(tainted).toEqual([
      'current_account',
      'goods_balance',
      'trade_balance',
    ]);
  });

  it('is measuring against a real abstention, not an empty set', () => {
    // The companion. With nothing declined, `tainted` is empty and the
    // assertion below is vacuous — it would pass on a codebase that grades
    // everything.
    expect(tainted.length).toBeGreaterThan(0);
    expect(DELIBERATELY_NEUTRAL.has('imports'), 'the declined input this rests on').toBe(true);
  });

  it('grades none of them', () => {
    // The rule, and the only assertion here that is about the product rather
    // than about the graph.
    const graded = tainted.filter((id) => polarityOf(id) !== 'neutral');

    expect(
      graded,
      'each of these is arithmetically determined by an indicator this codebase declined ' +
        'to grade, with a written reason. Grading the derived series grades the declined ' +
        'one after all, in whichever direction the arithmetic happens to carry — through a ' +
        'number the reader is not told is derived. Either grade the input, or leave these.',
    ).toEqual([]);
  });

  it('leaves a raw flow alone, so the rule is precise rather than broad', () => {
    // The rule must not swallow `exports`. A balance is the *same quantity* as
    // its inputs combined, so grading it re-grades them; exports is a
    // different quantity from imports, and "more foreign demand for our output
    // is good" is a claim no one here has declined. A rule that took exports
    // too would be over-broad, and over-broad is how a guard starts costing
    // correct work.
    expect(polarityOf('exports')).toBe('higher-better');
    expect(tainted).not.toContain('exports');
  });
});

describe('the site does not hold two positions on one quantity', () => {
  it('does not grade a balance while declining what it is made of', () => {
    // The general form, stated over the whole registry rather than over the
    // family that produced it. This is the assertion that would have failed on
    // master.
    const contradictions: string[] = [];
    for (const series of bop) {
      if (polarityOf(series.id) === 'neutral') continue;
      for (const ancestor of ancestorsOf(series.id)) {
        if (DELIBERATELY_NEUTRAL.has(ancestor)) {
          contradictions.push(`${series.id} is graded but derives from ${ancestor}, which is declined`);
        }
      }
    }
    expect(contradictions).toEqual([]);
  });

  it('keeps the abstention set to ids the page actually colours', () => {
    // `DELIBERATELY_NEUTRAL`'s first line is its membership rule: *"Ids that
    // reach `sentimentOf`"*. Seven of the ten balance definitions never reach
    // a colouring surface, so declaring them there would make the set mean
    // "things someone thought about" instead of "abstentions a reader can
    // see" — and would fix two of seventy-one while the graph above covers
    // all of them.
    //
    // This is why `goods_balance` and `services_balance` are *not* added to
    // that set: they are ungraded by rule, which is checkable, rather than by
    // omission, which is not.
    for (const id of ['goods_balance', 'services_balance', 'current_account']) {
      expect(polarityOf(id), `${id} must not be graded`).toBe('neutral');
      expect(
        DELIBERATELY_NEUTRAL.has(id),
        `${id} is not rendered by a colouring surface, so it does not belong in a set ` +
          'whose stated membership is "ids that reach sentimentOf"',
      ).toBe(false);
    }

    // And the one that is rendered is in there, because for that one the
    // omission would be visible.
    expect(DELIBERATELY_NEUTRAL.has('trade_balance')).toBe(true);
  });
});
