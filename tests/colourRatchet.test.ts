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

/**
 * Every hardcoded colour utility in `src/`, scanned once.
 *
 * This walks 90 files, reads each one and regex-scans it, and it used to be
 * re-run at every call site — including six times inside a single `it`, once
 * per class name in a loop. Ten full walks of the tree per run.
 *
 * That made this the slowest file in the suite and, under a loaded machine,
 * a flaky one: measured across five full-suite runs with 24 busy node
 * processes, it timed out once at **5266ms** against the default 5000ms
 * budget. A test that fails because the machine was busy makes every red tick
 * ambiguous, which is worse than a slow test.
 *
 * The fix is not a bigger budget. The scan is a pure function of the working
 * tree and nothing here mutates it, so it is computed once — which is both
 * faster and a truer statement of what it is.
 */
const ALL_INSTANCES: Instance[] = instances();

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
 * It is empty. The dashboard is fully migrated: no component writes a
 * hardcoded Tailwind colour, and the ~150-line compatibility layer that used
 * to remap them with `!important` is deleted rather than left dormant.
 *
 * The map stays, rather than this file being deleted with the debt, because
 * its job has changed from *shrinking* the count to *holding* it at zero.
 * Adding a file back would be a deliberate act with a number attached, which
 * is the point: the next `text-slate-400` has to be argued for.
 */
const REMAINING: Record<string, number> = {};

describe('the hardcoded-colour ratchet', () => {
  it('never grows', () => {
    const counted = new Map<string, number>();
    for (const { file } of ALL_INSTANCES) counted.set(file, (counted.get(file) ?? 0) + 1);

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
    for (const { file } of ALL_INSTANCES) counted.set(file, (counted.get(file) ?? 0) + 1);

    const stale = Object.entries(REMAINING)
      .filter(([file, budget]) => (counted.get(file) ?? 0) < budget)
      .map(([file, budget]) => `${file}: budget ${budget}, actually ${counted.get(file) ?? 0}`);

    expect(stale, 'lower these budgets to what the files now contain').toEqual([]);
  });
});

describe('the compatibility layer', () => {
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  it('is gone, and nothing writes the classes it used to rescue', () => {
    // Both halves, because either alone rots: a dormant rule invites the class
    // back, and a class with no rule is the invisible state that started all
    // of this.
    expect(ALL_INSTANCES, 'a hardcoded Tailwind colour is back in a component').toEqual([]);

    const survivors = [...cssCode.matchAll(/^\s*(?:\[[^\]]*\]\s*)?\.((?:[a-z0-9-]|\\.)+?)\s*[,{]/gm)]
      .map((m) => m[1].replace(/\\(.)/g, '$1'))
      .filter(
        (selector) =>
          /^(?:text|bg|border|ring|fill|stroke|placeholder|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/.test(
            selector,
          ) || /^(?:text|bg|border)-(?:white|black)$/.test(selector),
      );

    expect(survivors, 'these compatibility rules outlived the classes they rescued').toEqual([]);
  });

  it('no longer governs a colour namespace by substring', () => {
    // `[class*="bg-slate-900"]` matched a substring of the class attribute.
    // That is what made most opacity variants theme-aware — and also what made
    // the rule indiscriminate, since any future class merely containing that
    // text would have been silently repainted.
    const attributeSelectors = [...cssCode.matchAll(/\[class\*="([^"]+)"\]/g)].map((m) => m[1]);
    expect(
      attributeSelectors.filter((s) =>
        /(?:slate|gray|red|emerald|amber|yellow|cyan|teal)-?\d*$/.test(s),
      ),
      'a colour namespace is still governed by a substring match',
    ).toEqual([]);
  });

  it('needs !important for motion and for nothing else', () => {
    // `prefers-reduced-motion` has to beat inline and utility animation, so it
    // earns the escape hatch. Colour no longer does: every colour rule now
    // declares a class of its own rather than fighting a generated one.
    const important = [...cssCode.matchAll(/^[^\n]*!important[^\n]*$/gm)].map((m) => m[0].trim());
    expect(
      important.filter((line) => !/animation|transition|scroll-behavior/.test(line)),
      'colour should no longer need !important anywhere',
    ).toEqual([]);
  });

  it('declares a named class for every step it replaced', () => {
    for (const [utility, property, token] of [
      ['dash-fg', 'color', '--text-primary'],
      ['dash-body', 'color', '--text-body'],
      ['dash-muted', 'color', '--text-secondary'],
      ['dash-subtle', 'color', '--text-tertiary'],
      ['dash-card', 'background', '--bg-card'],
      ['dash-raised', 'background', '--bg-card-hover'],
      ['dash-input', 'background', '--bg-raised'],
      ['dash-edge', 'border-color', '--border-card'],
      ['dash-positive', 'color', '--data-positive'],
      ['dash-negative', 'color', '--data-negative'],
      ['dash-warning', 'color', '--data-warning'],
    ]) {
      expect(css, `.${utility} is missing or does not use ${token}`).toMatch(
        new RegExp(String.raw`\.${utility}\s*\{\s*${property}:\s*var\(${token}\)`),
      );
    }
  });

  it('keeps the light-theme card shadow that was keyed on the old class', () => {
    // A white card on a near-white page is a 1.06:1 step, so the shadow is the
    // only thing giving it an edge. It was attached to `.bg-slate-900\/50`, so
    // deleting that rule without noticing would have flattened every card in
    // the light theme — a silent regression produced by a cleanup.
    expect(css, 'the light-theme card shadow was lost with the layer').toMatch(
      /\[data-theme="light"\]\s*\.dash-card\s*\{\s*box-shadow:/,
    );
  });

  it('no longer rescues the text ramp, because nothing writes it', () => {
    // The neutral text ramp is migrated: `text-white` and every `text-slate-*`
    // are gone from src/, and the four `!important` rules that used to remap
    // them are deleted rather than left as a safety net. A dormant rule is an
    // invitation to write the class again.
    for (const className of [
      'text-white',
      'text-slate-200',
      'text-slate-300',
      'text-slate-400',
      'text-slate-500',
      'text-slate-600',
    ]) {
      expect(
        ALL_INSTANCES.filter((i) => i.className === className),
        `${className} is back in a component; use dash-fg/body/muted/subtle`,
      ).toEqual([]);
      expect(
        cssCode,
        `the override for ${className} should be gone, not dormant`,
      ).not.toMatch(new RegExp(String.raw`^\.${className}\s*[,{]`, 'm'));
    }
  });

  it('declares the four named text steps it replaced them with', () => {
    // Declared rather than overridden, which is what makes them visible to the
    // contrast tests: those resolve a class through the cascade, and a rule
    // that does not exist cannot be measured.
    for (const [utility, token] of [
      ['dash-fg', '--text-primary'],
      ['dash-body', '--text-body'],
      ['dash-muted', '--text-secondary'],
      ['dash-subtle', '--text-tertiary'],
    ]) {
      expect(css, `.${utility} is missing`).toMatch(
        new RegExp(String.raw`\.${utility}\s*\{\s*color:\s*var\(${token}\)`),
      );
    }
  });

  it('has a rule for every hardcoded class that is still in use', () => {
    // This is the structural check. Contrast tests can only measure a class the
    // layer *claims*; a class with no rule at all is invisible to them, renders
    // as raw Tailwind in both themes, and is found only when somebody happens
    // to measure it. Thirteen were in that state, at ratios from 1.66:1 to
    // 4.76:1, including a text placeholder below the SC 1.4.3 floor.
    const orphans = new Map<string, Set<string>>();
    for (const { file, className } of ALL_INSTANCES) {
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
