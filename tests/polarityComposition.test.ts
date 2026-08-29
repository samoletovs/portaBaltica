/**
 * A part must share its whole's polarity.
 *
 * `DELIBERATELY_NEUTRAL` is a hand-maintained set, and the brief that produced
 * this file asked the right question about it: **can the neutrality test be
 * derived rather than listed?** The general admission test — *"would a Baltic
 * finance ministry, a trade union and a central bank all agree on the sign"* —
 * cannot be. It is a judgement about economics, and no dimension of any cube
 * encodes it.
 *
 * But one whole class of it can, and it needs no new vocabulary at all:
 *
 *   **A part is a slice of its whole — the same statistic, cut smaller. So it
 *   must carry the same polarity.**
 *
 * `tests/derivedPolarity.test.ts` already declares every part/whole relation in
 * the registry, in `FAMILIES[].contains`, because `#226` needed it to widen the
 * derivation rule past the family it was found in. Nothing had ever asked that
 * table *this* question. Asking it found three live disagreements:
 *
 *     prc_hicp_minr   inflation     lower-better   vs  admin_prices           neutral
 *                                                  vs  home_energy_inflation  neutral
 *     une_rt_m        unemployment  lower-better   vs  youth_unemployment     neutral
 *
 * ## Why this is not a style point — and what it is *not*, measured
 *
 * `polarityOf` answers `neutral` for an id it does not recognise, which is the
 * correct default and is also why an omission is invisible. Executed on master
 * before the fix, for a **rise**:
 *
 *     unemployment         lower-better  ->  negative  var(--data-negative)
 *     youth_unemployment   neutral       ->  positive  var(--data-positive)
 *
 * The obvious next sentence is that the dashboard draws rising youth
 * unemployment green, and **that sentence is false.** All three of these reach
 * only `BalticCompareChart`, which never calls `sentimentOf`, so they colour no
 * pixel today. `polarityAdmission.test.ts` already recorded that fact about the
 * other seven dormant grades, and its equality is what forced the check when
 * these three joined them.
 *
 * So this is prophylactic. What it buys is that the day one of them moves onto
 * an `IndicatorCard` — a one-line change, and `unemployment` is already on one
 * — it arrives with the sign its own whole carries, instead of being coloured
 * by direction with nobody having decided anything. That is the failure
 * `DELIBERATELY_NEUTRAL` exists to prevent, and an omission cannot be
 * distinguished from a decision without a rule like this one.
 *
 * The live half of the same brief is `ppi`, which *is* on a card and whose
 * colour does invert — but that one is a judgement under the three-party test,
 * not a structural consequence, and it is recorded in `polarity.ts` where the
 * judgement lives.
 *
 * ## The exemption is derived, not listed
 *
 * `bop_c6_q` legitimately disagrees with itself: `exports` is graded and every
 * balance under it is neutral. That is not an omission — `#212` established it,
 * and `#226` proved it holds for every family. So the exemption here is
 * **computed from the same taint rule**: a part may differ from its whole when
 * the arithmetic already forbids grading it. A listed exemption would pass
 * identically today and stop meaning anything the moment the taint set moved.
 *
 * ## What this cannot reach, stated so the gap is a decision
 *
 * `lc_lci_r2_q` carries `wages_mfg` (neutral) and `wages_it` (higher-better) —
 * two NACE sectors of one labour-cost statistic, disagreeing. The containment
 * table cannot see it, because the registry holds **no total** for that cube,
 * so there is no whole for them to be parts of. It is recorded in
 * `SIBLINGS_WITHOUT_A_WHOLE` below rather than left silent, and asserted as an
 * equality so a second such cube has to be looked at.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DELIBERATELY_NEUTRAL, polarityOf, type Polarity } from '../src/utils/polarity';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js') as Record<
  string,
  { dataset: string; params: string; title: string }
>;

const param = (params: string, name: string): string | null =>
  new URLSearchParams(params ?? '').get(name);

/**
 * The part/whole relations, read out of `derivedPolarity.test.ts` rather than
 * retyped here.
 *
 * Retyping would make this a second copy of a table that already exists, and
 * this repository has spent a whole day proving that two copies of a fact
 * drift — including one that drifted the instant the other was corrected. So
 * the source file is parsed for its `FAMILIES` literal. If that parse ever
 * returns nothing the vacuity test below fails rather than this file quietly
 * checking an empty graph.
 */
function declaredFamilies(): { dataset: string; dimension: string; contains: Record<string, string[]> }[] {
  const src = readFileSync(resolve(__dirname, 'derivedPolarity.test.ts'), 'utf-8');
  const block = src.slice(src.indexOf('const FAMILIES'), src.indexOf('const NO_PART_WHOLE'));
  const out: { dataset: string; dimension: string; contains: Record<string, string[]> }[] = [];

  for (const m of block.matchAll(
    /dataset:\s*'([^']+)',\s*\n\s*dimension:\s*'([^']+)',\s*\n\s*contains:\s*\{([^}]*)\}/g,
  )) {
    const contains: Record<string, string[]> = {};
    for (const entry of m[3].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      contains[entry[1]] = [...entry[2].matchAll(/'([^']+)'/g)].map((p) => p[1]);
    }
    out.push({ dataset: m[1], dimension: m[2], contains });
  }
  return out;
}

interface Pair {
  dataset: string;
  whole: string;
  part: string;
  wholePolarity: Polarity;
  partPolarity: Polarity;
}

/** Every (whole, part) pair the registry actually contains, with both polarities. */
function partWholePairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const family of declaredFamilies()) {
    const byCode = new Map<string, string>();
    for (const [id, def] of Object.entries(INDICATORS)) {
      if (def?.dataset !== family.dataset) continue;
      const code = param(def.params, family.dimension);
      if (code) byCode.set(code, id);
    }
    for (const [whole, parts] of Object.entries(family.contains)) {
      const wid = byCode.get(whole);
      if (!wid) continue;
      for (const code of parts) {
        const pid = byCode.get(code);
        if (!pid) continue;
        pairs.push({
          dataset: family.dataset,
          whole: wid,
          part: pid,
          wholePolarity: polarityOf(wid),
          partPolarity: polarityOf(pid),
        });
      }
    }
  }
  return pairs;
}

/**
 * Pairs where a part disagrees with its whole **and the arithmetic does not
 * explain it**.
 *
 * Extracted as a function of a pair list rather than written inline, so a test
 * can hand it a synthetic pair and prove it detects one. `#212` measured why
 * that matters: an inline version of this filter was weakened to
 * `.filter(() => false)` and the whole file stayed green, because an empty
 * offender list reads identically for "everything agrees" and "the detector is
 * switched off".
 */
function disagreeingIn(pairs: Pair[], tainted: ReadonlySet<string>): string[] {
  return pairs
    .filter((p) => p.wholePolarity !== p.partPolarity)
    // The derived exemption. A part that the taint rule already forbids grading
    // is *allowed* to differ from a graded whole — that is `exports` against
    // the balances, and it is a decision `#212` made rather than an oversight.
    .filter((p) => !tainted.has(p.part) && !tainted.has(p.whole))
    .map((p) => `${p.dataset}: ${p.whole} (${p.wholePolarity}) vs ${p.part} (${p.partPolarity})`)
    .sort();
}

/**
 * Ids the arithmetic forbids grading, computed the same way
 * `derivedPolarity.test.ts` computes them — from `stk_flow`, not from a list.
 *
 * Kept deliberately small: this only needs the balance family, which is the
 * only one where a whole and a part legitimately carry different polarities.
 */
function taintedIds(): Set<string> {
  const out = new Set<string>();
  const byKey = new Map<string, string>();
  for (const [id, def] of Object.entries(INDICATORS)) {
    if (def?.dataset !== 'bop_c6_q') continue;
    byKey.set(`${param(def.params, 'bop_item')}/${param(def.params, 'stk_flow')}`, id);
  }
  // BAL(x) = CRE(x) - DEB(x): a balance inherits both of its own sides.
  for (const [key, id] of byKey) {
    const [item, flow] = key.split('/');
    if (flow !== 'BAL') continue;
    const inherits = ['CRE', 'DEB'].some((side) => {
      const input = byKey.get(`${item}/${side}`);
      return input !== undefined && DELIBERATELY_NEUTRAL.has(input);
    });
    if (inherits || DELIBERATELY_NEUTRAL.has(id)) out.add(id);
  }
  // Composite balances inherit from the balances beneath them.
  for (const [key, id] of byKey) {
    if (!key.endsWith('/BAL')) continue;
    if (out.size > 0) out.add(id);
  }
  return out;
}

/**
 * Cubes whose definitions are slices of one statistic but carry **no total**,
 * so the containment table cannot reach them.
 *
 * Declared rather than left silent, and asserted as an equality below: a second
 * such cube fails until someone looks at it. The entry records the
 * disagreement rather than blessing it — `wages_mfg` and `wages_it` are two
 * sectors of the same labour-cost index and one is graded, which is a real
 * finding this guard is structurally unable to force.
 */
const SIBLINGS_WITHOUT_A_WHOLE: Record<string, string> = {
  lc_lci_r2_q:
    'NACE C and J are two sectors of one labour cost index and the registry carries no total, ' +
    'so there is no whole to inherit from. wages_mfg is neutral and wages_it is higher-better; ' +
    'grading a labour cost at all is the contested judgement, not which sector.',
};

describe('the part/whole graph, before anything is asserted with it', () => {
  it('read the containment table rather than keeping a second copy of it', () => {
    // If the parse breaks — a rename, a reformat — every assertion below runs
    // over an empty list and reports a clean sheet. That is the failure this
    // whole file is about, one level up.
    const families = declaredFamilies();
    expect(families.length, 'no families parsed out of derivedPolarity.test.ts').toBeGreaterThanOrEqual(7);
    expect(families.map((f) => f.dataset)).toContain('une_rt_m');
    expect(families.map((f) => f.dataset)).toContain('prc_hicp_minr');
  });

  it('resolves those codes to real registry ids', () => {
    const pairs = partWholePairs();
    expect(pairs.length, 'no part/whole pairs resolved').toBeGreaterThanOrEqual(10);
    expect(pairs.some((p) => p.whole === 'unemployment' && p.part === 'youth_unemployment')).toBe(true);
    expect(pairs.some((p) => p.whole === 'inflation' && p.part === 'admin_prices')).toBe(true);
  });

  it('computes the exemption from the arithmetic rather than from a list', () => {
    // `exports` is graded while every balance under it is neutral, and that is
    // correct. It must be *derived* correct, not listed correct — a listed
    // exemption passes identically today and stops meaning anything the moment
    // the taint set moves.
    const tainted = taintedIds();
    expect(tainted.size, 'the taint rule found nothing, so the exemption is vacuous').toBeGreaterThan(0);
    expect(tainted).toContain('trade_balance');
  });
});

describe('a part carries the polarity of the whole it is a slice of', () => {
  it('finds no disagreement the arithmetic does not explain', () => {
    expect(
      disagreeingIn(partWholePairs(), taintedIds()),
      'a part is the same statistic as its whole, cut smaller, so it cannot carry a different ' +
        'sign. Left ungraded it is not neutral-by-decision, it is neutral-by-omission: polarityOf ' +
        'defaults to neutral, so the card renders a rise green with nobody having decided anything.',
    ).toEqual([]);
  });

  it('can actually detect a disagreement, which the empty result above cannot show', () => {
    // The companion. Without it, weakening the filter to `.filter(() => false)`
    // leaves this file green — measured in `#212`, on this exact shape.
    const synthetic: Pair[] = [
      {
        dataset: 'zz_cube',
        whole: 'a_whole',
        part: 'a_part',
        wholePolarity: 'lower-better',
        partPolarity: 'neutral',
      },
    ];
    expect(disagreeingIn(synthetic, new Set())).toEqual([
      'zz_cube: a_whole (lower-better) vs a_part (neutral)',
    ]);

    // And the other direction, or the detector fires on everything and says
    // nothing: agreement must not be reported.
    expect(
      disagreeingIn(
        [{ ...synthetic[0], partPolarity: 'lower-better' }],
        new Set(),
      ),
    ).toEqual([]);

    // And the exemption must actually exempt, or it is decoration.
    expect(disagreeingIn(synthetic, new Set(['a_part']))).toEqual([]);
  });

  it('regrades the three that were neutral only because nobody had asked', () => {
    // The assertion that fails without the change. All three reach only a
    // compare chart today, so this is prophylactic rather than a live fix —
    // see the header, and `polarityAdmission.test.ts` for the dormant list they
    // join.
    for (const id of ['youth_unemployment', 'admin_prices', 'home_energy_inflation']) {
      expect(polarityOf(id), `${id} is a slice of a lower-better whole`).toBe('lower-better');
      expect(DELIBERATELY_NEUTRAL.has(id), `${id} is graded, so it is not an abstention`).toBe(false);
    }
  });
});

describe('what the containment table cannot reach is declared, not silent', () => {
  it('names every cube whose siblings have no whole, as an equality', () => {
    // Derived population, declared exceptions — the same shape `#226` used. A
    // cube whose definitions differ only on a slice dimension, with no total
    // among them, cannot be checked by the rule above; it has to be named.
    const SLICE_DIMENSIONS = new Set(['nace_r2', 'age', 'coicop18', 'c_resid', 'siec', 'cpa2_1']);
    const withoutAWhole: string[] = [];

    const covered = new Set(declaredFamilies().map((f) => f.dataset));
    const byDataset = new Map<string, string[]>();
    for (const [id, def] of Object.entries(INDICATORS)) {
      if (!def?.dataset) continue;
      if (!byDataset.has(def.dataset)) byDataset.set(def.dataset, []);
      byDataset.get(def.dataset)!.push(id);
    }

    for (const [dataset, ids] of byDataset) {
      if (covered.has(dataset) || ids.length < 2) continue;
      const varies = [...SLICE_DIMENSIONS].some((dim) => {
        const seen = new Set(ids.map((id) => param(INDICATORS[id].params, dim)));
        return seen.size > 1 && !seen.has(null);
      });
      if (varies) withoutAWhole.push(dataset);
    }

    expect(
      withoutAWhole.sort(),
      'this cube slices one statistic several ways but carries no total, so the part/whole rule ' +
        'cannot force its slices to agree. Declare it with the reason, or add the total to the registry.',
    ).toEqual(Object.keys(SIBLINGS_WITHOUT_A_WHOLE).sort());
  });

  it('gives a reason for each, rather than only a name', () => {
    for (const [dataset, reason] of Object.entries(SIBLINGS_WITHOUT_A_WHOLE)) {
      expect(reason.length, `${dataset} is named with no reason`).toBeGreaterThan(40);
    }
  });
});
