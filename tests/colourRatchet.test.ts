import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const css = readFileSync(resolve('src/index.css'), 'utf8');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PROPERTY = 'text|bg|border|ring|fill|stroke|from|via|to|placeholder|divide|outline|accent|caret|decoration';

/**
 * Every hardcoded Tailwind colour utility, **including the opacity-variant
 * form**.
 *
 * The `(?:\/\d{1,3})?` group is the entire point of this file. Tailwind emits
 * `text-amber-400/80` as a class literally named `text-amber-400\/80`, which is
 * a *different* class from `text-amber-400` — so a naive pattern that stops at
 * the numeric step matches the plain class, misses the variant, and reports a
 * clean sweep while ninety variants sail past. That omission is how a stale-
 * data notice shipped with a 1.72:1 border and survived two audits.
 *
 * A `hover:`/`focus:`/`sm:` prefix is deliberately *not* part of the match:
 * `hover:bg-slate-500` is covered by `.hover\:bg-slate-500:hover`, which is a
 * rule of its own, so the prefixed and unprefixed forms are tracked separately.
 */
const COLOUR_UTILITY = new RegExp(
  `(?<![\\w:-])(?:${PROPERTY})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:\\/\\d{1,3})?(?![\\w-])`,
  'g',
);

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Strip comments and `sr-only` prose before scanning.
 *
 * Without this the test fails on its own explanatory text: a comment reading
 * "`border-yellow-500` measured 1.91:1" is a *record of a fix*, and failing on
 * it would push the next person to delete the reasoning rather than keep it.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

interface Instance {
  file: string;
  className: string;
}

function instances(): Instance[] {
  const found: Instance[] = [];
  for (const file of sourceFiles()) {
    const text = code(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(COLOUR_UTILITY)) {
      found.push({ file: file.replace(/\\/g, '/'), className: match[0] });
    }
  }
  return found;
}

/** Class selectors the compatibility layer declares, un-escaped. */
const declared = new Set(
  [...css.matchAll(/\.((?:[a-z0-9-]|\\.)+?)(?=[\s,{:])/g)].map((m) => m[1].replace(/\\(.)/g, '$1')),
);
/** `[class*="bg-slate-900"]` matches any class containing that substring. */
const substrings = [...css.matchAll(/\[class\*="([^"]+)"\]/g)].map((m) => m[1]);

function hasRule(className: string): boolean {
  return declared.has(className) || substrings.some((s) => className.includes(s));
}

// ─── the ratchet ───────────────────────────────────────────────────────────

/**
 * What is left to migrate, by file.
 *
 * This is a debt register, and it only goes down. It is committed *passing*
 * rather than failing, deliberately: a red suite on master cannot tell a
 * half-finished migration from a real regression, and this repo's rules say a
 * change that is not finished does not ship. A ratchet gives the same
 * guarantee — no new instances — while keeping the signal honest.
 *
 * When you migrate a file, lower its number. When it reaches zero, delete the
 * line. When the map is empty, delete the compatibility layer.
 */
const REMAINING: Record<string, number> = {
  'src/components/BusinessTile.tsx': 50,
  'src/components/EnvironmentTile.tsx': 38,
  'src/components/SystemStatusFooter.tsx': 25,
  'src/components/EconomyTile.tsx': 24,
  'src/components/PropertyTile.tsx': 24,
  'src/components/PortCard.tsx': 17,
  'src/components/IndicatorTable.tsx': 16,
  'src/components/CargoPanel.tsx': 14,
  'src/components/PortPanelParts.tsx': 13,
  'src/components/IndicatorPage.tsx': 12,
  'src/components/InsightsBanner.tsx': 12,
  'src/components/MaritimeTile.tsx': 10,
  'src/types.ts': 8,
  'src/components/IndicatorCard.tsx': 6,
  'src/App.tsx': 3,
  'src/components/PassengerPanel.tsx': 1,
};

describe('the hardcoded-colour ratchet', () => {
  it('never grows', () => {
    const counted = new Map<string, number>();
    for (const { file } of instances()) counted.set(file, (counted.get(file) ?? 0) + 1);

    const grown: string[] = [];
    for (const [file, n] of counted) {
      const budget = REMAINING[file] ?? 0;
      if (n > budget) grown.push(`${file}: ${n} instances, budget ${budget}`);
    }

    expect(
      grown,
      'a hardcoded Tailwind colour was added. Use a token or a named utility — see DESIGN.md §1.5',
    ).toEqual([]);
  });

  it('has an honest budget, so a migrated file cannot silently keep its allowance', () => {
    // A ratchet whose numbers drift above reality stops ratcheting. If a file
    // is now cleaner than its budget, the budget is wrong and should be lowered
    // in the same change that cleaned it.
    const counted = new Map<string, number>();
    for (const { file } of instances()) counted.set(file, (counted.get(file) ?? 0) + 1);

    const stale = Object.entries(REMAINING)
      .filter(([file, budget]) => (counted.get(file) ?? 0) < budget)
      .map(([file, budget]) => `${file}: budget ${budget}, actually ${counted.get(file) ?? 0}`);

    expect(stale, 'lower these budgets to what the files now contain').toEqual([]);
  });
});

describe('the compatibility layer', () => {
  it('has a rule for every hardcoded class that is still in use', () => {
    // This is the structural check. Contrast tests can only measure a class the
    // layer *claims*; a class with no rule at all is invisible to them, renders
    // as raw Tailwind in both themes, and is found only when somebody happens
    // to measure it. Thirteen were in that state, at ratios from 1.66:1 to
    // 4.76:1, including a text placeholder below the SC 1.4.3 floor.
    const orphans = new Map<string, Set<string>>();
    for (const { file, className } of instances()) {
      if (hasRule(className)) continue;
      if (!orphans.has(className)) orphans.set(className, new Set());
      orphans.get(className)!.add(file);
    }

    const report = [...orphans]
      .sort()
      .map(([className, files]) => `${className} (${[...files].join(', ')})`);

    expect(
      report,
      'these classes reach the browser as raw Tailwind, so neither theme controls them',
    ).toEqual([]);
  });

  it('sees the opacity-variant form, which is what a naive scan misses', () => {
    // Guards the guard. If `COLOUR_UTILITY` is ever "simplified" so it stops
    // matching `/NN`, every test in this file keeps passing while covering
    // strictly less — the exact failure mode this file exists to prevent.
    const sample = 'className="text-amber-400/80 bg-slate-900/50 border-slate-800/40"';
    expect([...sample.matchAll(COLOUR_UTILITY)].map((m) => m[0])).toEqual([
      'text-amber-400/80',
      'bg-slate-900/50',
      'border-slate-800/40',
    ]);
  });

  it('does not count a class named only in a comment', () => {
    // The fixes are documented in comments that name the classes they replaced.
    // Failing on those would delete the reasoning.
    const sample = `
      /* border-yellow-500 measured 1.91:1 on white */
      // bg-slate-400 was 2.63:1
      const x = 1;
    `;
    expect([...code(sample).matchAll(COLOUR_UTILITY)]).toEqual([]);
  });
});
