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
 * ## The population, and the defect that was in this file itself
 *
 * The rule above is general. The first version of this file enforced it with
 * `.filter(([, def]) => def.dataset === 'bop_c6_q')` — **one dataset**, while
 * the registry carries seven families where a part/whole relation exists. Six
 * were ungoverned while looking covered, which is the shape `AGENTS.md` records
 * three prior instances of, arriving here in the guard written to close the
 * third.
 *
 * Widening it found a second instance of the original defect. `gov_revenue` is
 * declined — *"receipts are not by themselves good or bad news"* — and
 * `gov_deficit` is revenue minus expenditure, so grading the deficit would
 * grade receipts through the arithmetic. Nobody had graded it, so nothing was
 * wrong on the page; but nothing was stopping it either.
 *
 * So the containment stays declared data, per the trap above, and the
 * **population** is derived: `compositionCapable()` asks the registry which
 * datasets could possibly hold a part/whole relation, and an equality requires
 * each to be placed in `FAMILIES` or in `NO_PART_WHOLE` with a reason. An
 * eighth family fails until someone decides which it is.
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
 * Which code contains which, per family, as a fact about each vocabulary rather
 * than about these particular indicators.
 *
 * Written down because it cannot be read off the codes without a false positive
 * — see the header, and note the trap is not confined to `bop_item`.
 * `TOT_X_NRG_FOOD` is the HICP total *excluding* energy and food, so any
 * name-parsing shortcut would read it as containing the two things it is
 * defined by removing.
 *
 * A `flow` entry names a dimension that *is* the arithmetic, so that family's
 * relation is read from the registry rather than declared. Only balance of
 * payments has one.
 */
interface Family {
  readonly dataset: string;
  readonly dimension: string;
  readonly contains: Record<string, readonly string[]>;
  readonly flow?: { readonly dimension: string; readonly balance: string; readonly sides: readonly string[] };
}

const FAMILIES: readonly Family[] = [
  {
    // GS  goods and services  = G + S
    // S   services            ⊃ SC transport, SG financial,
    //                           SI telecom/computer/information, SJ other business
    // CA  current account     ⊃ GS, plus primary and secondary income which this
    //                           registry does not carry. A partial composition is
    //                           still a real dependency, and being unable to see
    //                           the other components is a reason to be more
    //                           cautious rather than less.
    dataset: 'bop_c6_q',
    dimension: 'bop_item',
    contains: { GS: ['G', 'S'], S: ['SC', 'SG', 'SI', 'SJ'], CA: ['GS'] },
    flow: { dimension: 'stk_flow', balance: 'BAL', sides: ['CRE', 'DEB'] },
  },
  {
    // The all-items HICP moves with each of its components. `TOT_X_NRG_FOOD` is
    // a component of the total in exactly the sense that matters here — it is
    // most of it — even though it is defined by subtraction.
    dataset: 'prc_hicp_minr',
    dimension: 'coicop18',
    contains: { TOTAL: ['NRG', 'FOOD', 'TOT_X_NRG_FOOD', 'SERV', 'GD', 'AP', 'ELC_GAS'] },
  },
  {
    dataset: 'sts_cobp_q',
    dimension: 'cpa2_1',
    contains: { CPA_F41001_41002: ['CPA_F41001', 'CPA_F41002'] },
  },
  {
    dataset: 'tour_occ_nim',
    dimension: 'c_resid',
    contains: { TOTAL: ['FOR'] },
  },
  {
    dataset: 'nrg_cb_pem',
    dimension: 'siec',
    contains: { TOTAL: ['RA000'] },
  },
  {
    // Net lending/borrowing is revenue minus expenditure. Expenditure is not in
    // this registry, so like `CA` this is a partial composition.
    dataset: 'gov_10q_ggnfa',
    dimension: 'na_item',
    contains: { B9: ['TR'] },
  },
  {
    // A youth unemployment rate is not an addend of the total rate. It is
    // containment of population rather than of arithmetic — and it belongs here
    // anyway, because the rule is about **sign inheritance**, not about
    // addition. If reasonable parties disagreed on the sign of youth
    // unemployment, an aggregate that moves with it could not be graded either.
    dataset: 'une_rt_m',
    dimension: 'age',
    contains: { TOTAL: ['Y_LT25'] },
  },
];

/**
 * Datasets whose several definitions are **siblings**, not parts of one another.
 *
 * Declared rather than left out, because "not a family" and "nobody looked" are
 * the same silence otherwise. Each carries the reason, and the equality below
 * means a new multi-definition dataset lands in one list or the other rather
 * than in neither.
 */
const NO_PART_WHOLE: Record<string, string> = {
  lc_lci_r2_q: 'NACE C and J are two sectors, and the registry carries no total',
  demo_gind: 'net migration rate and birth rate are two components of population change, not parts of each other',
  sts_rb_q: 'registrations and bankruptcies are opposite events, not a decomposition',
  road_go_tq_tott: 'tonnes and tonne-kilometres are the same activity in two units — a restatement, not a part',
};

interface Series {
  id: string;
  dataset: string;
  code: string;
  flow: string;
}

const familyOf = (dataset: string): Family | undefined =>
  FAMILIES.find((f) => f.dataset === dataset);

/** Every definition that belongs to a declared family, with the dimensions that matter. */
const series: Series[] = entries
  .flatMap(([id, def]) => {
    const family = familyOf(def.dataset);
    if (!family) return [];
    const code = param(def.params, family.dimension);
    if (code === null) return [];
    return [{
      id,
      dataset: def.dataset,
      code,
      flow: family.flow ? (param(def.params, family.flow.dimension) ?? '') : '',
    }];
  });

/** Kept under its old name: every assertion about balance of payments reads it. */
const bop = series.filter((s) => s.dataset === 'bop_c6_q' && s.flow !== '');

/** The balance-of-payments containment table, still addressable by name. */
const CONTAINS = familyOf('bop_c6_q')!.contains;

const byKey = new Map(series.map((s) => [`${s.dataset}/${s.code}/${s.flow}`, s.id]));

/**
 * The ids whose value determines `series`.
 *
 * Both rules, one step. `ancestorsOf` walks it transitively.
 */
function inputsOf(s: Series): string[] {
  const family = familyOf(s.dataset);
  if (!family) return [];
  const found: string[] = [];

  // Rule 1, derived: a dimension that *is* the arithmetic. BAL(x) = CRE(x) − DEB(x).
  if (family.flow && s.flow === family.flow.balance) {
    for (const side of family.flow.sides) {
      const id = byKey.get(`${s.dataset}/${s.code}/${side}`);
      if (id) found.push(id);
    }
  }

  // Rule 2, declared: a composite code is made of its parts at the same flow.
  for (const part of family.contains[s.code] ?? []) {
    const id = byKey.get(`${s.dataset}/${part}/${s.flow}`);
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
    const found = series.find((s) => s.id === current);
    if (!found) continue;
    for (const input of inputsOf(found)) {
      if (seen.has(input)) continue;
      seen.add(input);
      queue.push(input);
    }
  }
  return seen;
}

/**
 * Definitions whose code the graph cannot place, within their own family.
 *
 * Extracted as a function of a series list rather than written inline, so a
 * test can hand it a synthetic series and prove it detects one. Inline, the
 * assertion below could be weakened to `.filter(() => false)` and nothing
 * would notice — measured, by planting exactly that: it went green.
 */
function unplacedIn(list: Series[]): string[] {
  return list
    .filter((s) => {
      const family = familyOf(s.dataset);
      if (!family) return true;
      const placed = new Set([
        ...Object.keys(family.contains),
        ...Object.values(family.contains).flat(),
      ]);
      return !placed.has(s.code) && inputsOf(s).length === 0;
    })
    .map((s) => `${s.id} (${s.code}${s.flow ? `/${s.flow}` : ''})`)
    .sort();
}

/**
 * Every dataset in the registry where a part/whole relation between two
 * definitions is even **possible** — more than one definition, differing on
 * something other than geography or time.
 *
 * Derived, not listed. This is the population the rule applies to, and the
 * reason it is computed is that the first version of this file filtered to
 * `dataset === 'bop_c6_q'` and so enumerated **one of seven** families while
 * stating a general rule. That is the shape `AGENTS.md` records three prior
 * instances of, arriving in the guard written to close the third.
 */
function compositionCapable(): string[] {
  const IRRELEVANT = new Set(['format', 'lang', 'sinceTimePeriod', 'geo', 'time', 'freq']);
  const byDataset = new Map<string, { id: string; params: string }[]>();
  for (const [id, def] of entries) {
    if (!def?.dataset) continue;
    if (!byDataset.has(def.dataset)) byDataset.set(def.dataset, []);
    byDataset.get(def.dataset)!.push({ id, params: def.params ?? '' });
  }

  return [...byDataset]
    .filter(([, defs]) => {
      if (defs.length < 2) return false;
      const seen = new Map<string, Set<string>>();
      for (const { params } of defs) {
        for (const [k, v] of new URLSearchParams(params)) {
          if (IRRELEVANT.has(k)) continue;
          if (!seen.has(k)) seen.set(k, new Set());
          seen.get(k)!.add(v);
        }
      }
      return [...seen.values()].some((vals) => vals.size > 1);
    })
    .map(([dataset]) => dataset)
    .sort();
}

describe('the rule covers every family the registry has, not the one it was found in', () => {
  it('names every dataset where a part/whole relation is possible, as an equality', () => {
    // The population check, and it is an equality rather than a subtraction so
    // that a *seventh* family forces a decision instead of passing silently.
    // A new multi-definition dataset must land in FAMILIES with its containment
    // or in NO_PART_WHOLE with a reason. Landing in neither is what this file
    // exists to make impossible.
    expect(
      compositionCapable(),
      'this dataset has several definitions differing on a real dimension, so one of them ' +
        'may be part of another. Add it to FAMILIES with its containment, or to ' +
        'NO_PART_WHOLE with the reason its definitions are siblings.',
    ).toEqual([...FAMILIES.map((f) => f.dataset), ...Object.keys(NO_PART_WHOLE)].sort());
  });

  it('is looking at a real population, so the equality above is not vacuous', () => {
    // The companion. If `compositionCapable()` returned nothing — a renamed
    // field, a changed param shape — the equality would only pass with both
    // lists empty, but a *future* edit emptying the lists to match would then
    // sail through. This pins that the registry really does carry families.
    const found = compositionCapable();
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(found).toContain('bop_c6_q');
    expect(found).toContain('prc_hicp_minr');
  });

  it('builds a graph for every family, not just the one with the flow dimension', () => {
    // `bop_c6_q` is the only family whose arithmetic is readable off a
    // dimension. If the graph silently covered only that one — the original
    // defect — every other family would have zero series and every assertion
    // about them would pass over nothing.
    for (const family of FAMILIES) {
      const members = series.filter((s) => s.dataset === family.dataset);
      expect(members.length, `no series parsed for ${family.dataset}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('places every code in every family, so a new one cannot slip past', () => {
    // The equality the header promises, now over all seven families rather
    // than over balance of payments alone.
    expect(
      unplacedIn(series),
      'these definitions use a code their family containment table does not mention, so ' +
        'the graph cannot tell what they are made of or what they are part of.',
    ).toEqual([]);
  });
});

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
    const synthetic: Series[] = [{ id: 'a_new_balance', dataset: 'bop_c6_q', code: 'ZZ', flow: 'BAL' }];

    expect(unplacedIn(synthetic)).toEqual(['a_new_balance (ZZ/BAL)']);

    // And the other direction: a series whose item *is* placed must not be
    // reported, or the detector fires on everything and says nothing.
    expect(unplacedIn([{ id: 'a_known_balance', dataset: 'bop_c6_q', code: 'SC', flow: 'BAL' }])).toEqual([]);

    // And once more in a family with no flow dimension, because the detector
    // now spans seven vocabularies and passing in one proves nothing about the
    // other six.
    expect(unplacedIn([{ id: 'a_new_permit', dataset: 'sts_cobp_q', code: 'ZZ', flow: '' }]))
      .toEqual(['a_new_permit (ZZ)']);
    expect(unplacedIn([{ id: 'a_known_permit', dataset: 'sts_cobp_q', code: 'CPA_F41001', flow: '' }]))
      .toEqual([]);
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
  /**
   * Ids that inherit an abstention, whatever anyone would like to say about
   * them.
   *
   * Computed over **every** family rather than over balance of payments alone.
   * That is the correction this file needed: the rule it states is general and
   * its first implementation filtered to one dataset, so six families were
   * ungoverned while looking covered.
   */
  const tainted = series
    .filter((s) => [...ancestorsOf(s.id)].some((a) => DELIBERATELY_NEUTRAL.has(a)))
    .map((s) => s.id)
    .sort();

  it('names them, computed rather than listed', () => {
    // Not an exemption list. Each of these is here because the graph says a
    // declined series determines its value, and the day `imports` is graded
    // they all leave on their own.
    //
    // Two names arrived when the graph widened from one family to seven, and
    // they are different in kind.
    //
    // `building_permits` is already declined on its own account, so the taint
    // now says the same thing about it twice, from two directions. That is the
    // correct reading rather than a redundancy to trim: if the total were ever
    // re-graded while the two component permit series stayed declined, the
    // arithmetic would still refuse it.
    //
    // **`gov_deficit` is the find.** `gov_revenue` is declined with a written
    // reason — *"receipts are not by themselves good or bad news"* — and net
    // lending/borrowing is revenue minus expenditure, so grading the deficit
    // would grade receipts after all, in whichever direction the arithmetic
    // carried. That is `trade_balance`/`imports` exactly, in a second family,
    // and the bop-scoped version of this file could not see it. It is not a
    // live fault: `gov_deficit` is ungraded today. It is now ungraded *by
    // rule* rather than by nobody having asked.
    expect(tainted).toEqual([
      'building_permits',
      'current_account',
      'goods_balance',
      'gov_deficit',
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

  it('reaches beyond the family the rule was found in', () => {
    // The assertion that would have failed before this change and passes now,
    // stated on its own so the widening cannot be quietly undone. If the graph
    // narrowed back to `bop_c6_q`, every name here would still be produced —
    // except this one.
    expect(tainted.some((id) => !bop.some((s) => s.id === id)), 'the taint is bop-only again')
      .toBe(true);
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
