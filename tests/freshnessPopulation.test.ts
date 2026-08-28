import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/**
 * Every surface that presents a reading off a period-indexed series must judge
 * whether that reading is stale.
 *
 * The defect this guards against does not look like a defect. `/api/historical-data`
 * already computes `stale` and `age` and ships them in the payload; a component that
 * ignores them renders a confident number under "Latest" with a favourable green
 * arrow, and every layer upstream reports success. `AGENTS.md` records
 * `prc_hicp_manr` answering HTTP 200 with valid JSON-stat and plausible values while
 * frozen at 2025-12 for eight months. A reader looking at the dashboard through those
 * eight months had nothing to look at that would have told them.
 *
 * The population is DERIVED, not listed. A list would have to be extended by whoever
 * adds the next silent component, which is precisely the person who did not think
 * about staleness — and a guard that must be updated by the author of the fault is
 * not a guard. So the set is computed from source on every run: any component that
 * indexes the newest element of something period-shaped is in scope, whether or not
 * anyone remembered to add it here.
 *
 * There is no exemption list. When this was written the derivation had two members
 * that did not call `freshnessOf` themselves — `CargoPanel` and `PortPanelParts` —
 * and naming them as exceptions would have encoded a fact about today's component
 * tree as a permanent licence. They are covered because `MaritimeTile` judges on
 * their behalf, on the oldest of the measures it shows, so coverage is computed
 * transitively through the import graph instead. The day `MaritimeTile` stops
 * judging, both of them fail here, which is the outcome a list could not produce.
 */

const SRC = resolve(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * `.tsx`, and the extension is doing real work here rather than following a naming
 * convention: TypeScript will not parse JSX in a `.ts` file at all. Measured with
 * this repo's own compiler — `export const x = <div>hi</div>;` in a `.ts` gives
 * `TS1161: Unterminated regular expression literal`, because `<div>` is read as a
 * regex. So "can this file present anything to a reader" is enforced by the
 * compiler, not asserted by me.
 *
 * That matters because the first draft of this walk took `.ts` too and swept in
 * `api.ts` and `types.ts`. Neither picks a newest anything; they matched on
 * `latest: number;` and `latest: string | null;` — type declarations. A guard that
 * demands a staleness notice from an interface definition is not strict, it is
 * broken, and the exemption someone would reach for to quiet it would be permanent.
 *
 * Stated limitation, because silence here is weaker than proof: a component whose
 * newest-picking is done entirely inside a `.ts` helper, and which never itself
 * mentions a period, is invisible to this. Today that gap is empty — the only
 * period-shaped helper that picks newest is `portStats`, and both of its consumers
 * are in scope on their own. This is sound, not complete.
 */

/** The newsroom is a separate surface with its own provenance block. */
const files = walk(SRC).filter((f) => !f.includes(`${join('components', 'news')}`));

const source = new Map<string, string>(files.map((f) => [f, readFileSync(f, 'utf8')]));
const nameOf = (f: string) => basename(f).replace(/\.tsx?$/, '');

/**
 * "Presents the newest reading of a period-indexed series."
 *
 * Two halves, and both are needed. The newest-picker alone matches any array
 * access; `period` alone matches a file that merely passes a series through.
 */
const PICKS_NEWEST = /\[\s*[\w.]+\.length\s*-\s*1\s*\]|\.slice\(\s*-1\s*\)|\.at\(\s*-1\s*\)|\blatest\b/;
const PERIOD_SHAPED = /\bperiods?\b/;

const inScope = files.filter((f) => {
  const t = source.get(f)!;
  return PICKS_NEWEST.test(t) && PERIOD_SHAPED.test(t);
});

const judges = (f: string) => /\bfreshnessOf\s*\(/.test(source.get(f)!);

/** Who renders this module. Resolved by module name, since every import here is relative. */
function importersOf(f: string): string[] {
  const name = nameOf(f);
  const spec = new RegExp(`from\\s+'[^']*\\/${name}'`);
  return files.filter((other) => other !== f && spec.test(source.get(other)!));
}

/**
 * A component is covered if it judges, or if it is only ever rendered by covered
 * components. `every` rather than `some`: a panel rendered on two surfaces where
 * only one of them dates the data is silent on the other, and that is the case
 * worth catching. A component with no importer is a root and must judge itself.
 */
function covered(f: string, seen = new Set<string>()): boolean {
  if (judges(f)) return true;
  if (seen.has(f)) return false;
  seen.add(f);
  const parents = importersOf(f);
  return parents.length > 0 && parents.every((p) => covered(p, seen));
}

describe('freshness judgement reaches every dated surface', () => {
  it('the derivation finds components to check', () => {
    // Vacuity floor. A regex that matches nothing passes the assertion below
    // without looking at anything, and reads exactly like a clean bill of health.
    expect(inScope.length).toBeGreaterThanOrEqual(6);
  });

  it('BalticCompareChart is in scope and judges', () => {
    // Positive control: a component known to do the right thing, so a run that
    // reports "all covered" is distinguishable from one whose probe is broken.
    const chart = inScope.find((f) => nameOf(f) === 'BalticCompareChart');
    expect(chart, `in scope: ${inScope.map(nameOf).join(', ')}`).toBeDefined();
    expect(judges(chart!)).toBe(true);
  });

  it('a component outside the population is not silently exempted', () => {
    // Negative control on the derivation itself. `PortCard` is a .tsx that renders
    // live marine weather and mentions periods, but presents no period-indexed
    // series. If the filter swept it in, it is matching everything, and the
    // assertion below would prove nothing about the components it does catch.
    expect(inScope.map(nameOf)).not.toContain('PortCard');
  });

  it('the derivation reads code, not type declarations', () => {
    // `types.ts` and `api.ts` match the newest-picker on `latest: number;` alone.
    // They are excluded structurally rather than by name — see the walk — and this
    // fails if that ever stops being true, because demanding a staleness notice
    // from an interface is the kind of false positive that gets a guard exempted.
    const names = inScope.map(nameOf);
    expect(names).not.toContain('types');
    expect(names).not.toContain('api');
  });

  it('every component presenting a period-indexed reading judges its staleness', () => {
    const silent = inScope.filter((f) => !covered(f)).map(nameOf).sort();

    expect(
      silent,
      'these render the newest observation of a dated series without asking whether ' +
        'it is recent. A frozen upstream then reads as a current figure, which is ' +
        'the failure AGENTS.md records costing eight months behind a healthy HTTP 200. ' +
        'Call freshnessOf(period) and show the canonical notice, or render only ' +
        'inside a parent that already does.',
    ).toEqual([]);
  });

  it('reports how each member is covered', () => {
    const rows = inScope
      .map((f) => `${nameOf(f)}: ${judges(f) ? 'judges' : `via ${importersOf(f).map(nameOf).join(', ')}`}`)
      .sort();
    // Derived and printed rather than pinned, so the shape of the population is
    // legible in the run without an equality that has to be edited to add a component.
    process.stderr.write(`\n[freshness population] ${inScope.length} members\n  ${rows.join('\n  ')}\n`);
    expect(rows.length).toBe(inScope.length);
  });
});
