import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { walk, stripComments, applyReachability, typeOf, classifyRead, namedOnly, annotateRow } from '../scripts/seam-sweep.mjs';

/**
 * Tests for the recursive seam sweep.
 *
 * `AGENTS.md` describes the seam sweep and reports its result across "fourteen
 * endpoints — 107 **top-level** fields". Everything below depth 1 was outside
 * the population, which is 70% of the fields actually served. This file guards
 * the instrument that closed that gap.
 *
 * Each test pins a defect the sweep actually had while it was being built.
 * None is hypothetical.
 */
describe('the seam sweep walks the whole response, not just its surface', () => {
  it('records nested fields with their path and depth', () => {
    const out: Array<{ name: string; path: string; depth: number; type: string }> = [];
    walk({ a: 1, b: { c: { d: 2 } } }, '', 0, out);

    expect(out.map((f) => `${f.path}@${f.depth}`)).toEqual([
      'a@1', 'b@1', 'b.c@2', 'b.c.d@3',
    ]);
  });

  it('walks into arrays and marks them, so a path stays legible', () => {
    // `countries.LV.series[].period` has to read as an array element rather
    // than as a field literally called `series`.
    const out: Array<{ name: string; path: string; depth: number; type: string }> = [];
    walk({ series: [{ period: '2025-Q4', value: 1 }] }, '', 0, out);

    expect(out.map((f) => f.path)).toEqual([
      'series', 'series[].period', 'series[].value',
    ]);
  });

  it('walks one array element, not all of them', () => {
    // A homogeneous array declares the same names in every entry. Walking all
    // of them multiplies each name by the array length and turns a field count
    // into a row count — which would have made `sea-state` and `port-data`
    // dominate the totals for no reason.
    const out: Array<{ name: string; path: string; depth: number; type: string }> = [];
    walk({ xs: [{ k: 1 }, { k: 2 }, { k: 3 }] }, '', 0, out);

    expect(out.filter((f) => f.path.endsWith('.k'))).toHaveLength(1);
  });

  it('reports a null field as null rather than as an object', () => {
    // `typeof null === 'object'`, so a naive walk descends into it and a
    // nullable field silently reports the type of whatever it is not.
    expect(typeOf(null)).toBe('null');
    expect(typeOf([])).toBe('array');
    expect(typeOf(0)).toBe('number');
  });
});

describe('a reader is code, not prose', () => {
  it('does not count a field name that only appears in a comment', () => {
    // The measured defect. The first matcher used `\{[^}]*\bname\b[^}]*\}` for
    // destructuring; `[^}]*` spans newlines, so in this repo — where files
    // carry more prose than code — it matched the name inside a comment.
    //
    // `freshness.allowed` was classified `test-only` on the strength of three
    // files in which `.allowed` never appears: the word occurred in a comment
    // about CSV export, one about the spacing scale, and one about the rate
    // limiter. That inflates readers, which deflates orphans, which fails
    // toward "no finding here".
    const src = `
      // the export is allowed for every visitor
      /* allowed is also discussed at length here */
      const x = { unrelated: 1 };
    `;
    expect(stripComments(src)).not.toMatch(/allowed/);
  });

  it('keeps the code when it strips the comment', () => {
    // The companion half. A stripper that removed everything would also pass
    // the test above, and would report every field as an orphan.
    const src = `const a = payload.allowed; // allowed here too`;
    const out = stripComments(src);
    expect(out).toMatch(/payload\.allowed/);
    expect(out.match(/allowed/g)).toHaveLength(1);
  });

  it('does not mistake a URL for a comment', () => {
    // `//` inside `https://` is not a comment, and treating it as one silently
    // deletes the rest of the line — including any field name on it.
    const src = `const u = 'https://example.com/x'; const v = payload.wanted;`;
    expect(stripComments(src)).toMatch(/payload\.wanted/);
  });
});

describe('a child cannot be read through a parent nobody reads', () => {
  /** The shape the sweep produces, reduced to the fields reachability uses. */
  function row(endpoint: string, path: string, srcReaders: number, testReaders = 0) {
    return {
      endpoint, path, srcReaders, testReaders,
      verdict: srcReaders > 0 ? 'app' : testReaders > 0 ? 'test-only' : 'orphan',
      unreachableVia: null as string | null,
      effective: '',
    };
  }

  it('demotes a descendant of an unread parent', () => {
    // The correction that matters most. Matching by leaf name cannot tell the
    // payload's `countries.LV.freshness.stale` from the client's own computed
    // `stale`, and `src/` is full of the latter because `freshnessOf()` returns
    // an object with the same field names.
    //
    // Measured on production at 2026-08-30T07:29Z: the sweep reported
    // `freshness.period` as read by 19 files while **nothing in `src/` reads
    // `.freshness` at all** — zero occurrences, and not declared in
    // `src/api.ts` or `src/types.ts` either.
    const rows = applyReachability([
      row('baltic-compare', 'countries', 4),
      row('baltic-compare', 'countries.LV', 2),
      row('baltic-compare', 'countries.LV.freshness', 0, 2),
      row('baltic-compare', 'countries.LV.freshness.period', 19, 27),
    ]);

    const child = rows.find((r) => r.path.endsWith('.period'))!;
    expect(child.effective, 'a field under an unread parent is not app-read').toBe('test-only');
    expect(child.unreachableVia).toBe('countries.LV.freshness');
  });

  it('leaves a descendant of a read parent alone', () => {
    // Without this the correction would demote everything and the sweep would
    // report the whole payload as dead.
    const rows = applyReachability([
      row('port-data', 'ports', 5),
      row('port-data', 'ports[].name', 7),
    ]);

    expect(rows.find((r) => r.path === 'ports[].name')!.effective).toBe('app');
    expect(rows.find((r) => r.path === 'ports[].name')!.unreachableVia).toBeNull();
  });

  it('calls a descendant with no test reader an orphan, not merely unreachable', () => {
    // `late` and `stale` under an unread parent are still contract-tested, so
    // they are `test-only`. `warnAfterMonths` is not tested anywhere, so it is
    // an orphan — and the two must not collapse into one word.
    const rows = applyReachability([
      row('baltic-compare', 'countries.LV.freshness', 0, 2),
      row('baltic-compare', 'countries.LV.freshness.warnAfterMonths', 0, 0),
      row('baltic-compare', 'countries.LV.freshness.stale', 8, 6),
    ]);

    expect(rows.find((r) => r.path.endsWith('warnAfterMonths'))!.effective).toBe('orphan');
    expect(rows.find((r) => r.path.endsWith('.stale'))!.effective).toBe('test-only');
  });

  it('stops at the nearest unread ancestor rather than the furthest', () => {
    // Reported so the message names the parent a reader should look at.
    const rows = applyReachability([
      row('x', 'a', 0),
      row('x', 'a.b', 0),
      row('x', 'a.b.c', 3),
    ]);
    expect(rows.find((r) => r.path === 'a.b.c')!.unreachableVia).toBe('a');
  });
});

describe('the instrument does not consume its own subject', () => {
  it('excludes its own files from the consumer population', () => {
    // Measured, and it moved the headline. After this test file was written,
    // the three `countries.<CC>.freshness.warnAfterMonths` orphans flipped to
    // `test-only` — because the fixture below names the field in a string and
    // the matcher counted it as a reader. The sweep reported *fewer* orphans
    // the more thoroughly its own findings were documented.
    //
    // Asserted as an equality rather than a filter, so a fourth file belonging
    // to the sweep fails here instead of being silently absorbed.
    const src = readFileSync(resolve('scripts/seam-sweep.mjs'), 'utf8');
    const declared = /const SELF = \[([^\]]*)\]/.exec(src);

    expect(declared, 'the sweep no longer excludes its own files').not.toBeNull();
    const names = declared![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(names.sort()).toEqual(['seam-sweep.d.mts', 'seam-sweep.mjs', 'seamSweep.test.ts']);
  });

  it('names a field that this very file mentions, proving the exclusion bites', () => {
    // The companion half. The assertion above would pass on a sweep that read
    // no files at all; this one fails unless the string below is genuinely
    // present in a file the sweep excludes.
    //
    // It named `countries.LV.freshness.warnAfterMonths` until that field was
    // deleted from `api/shared/freshness.js`. Nothing would have failed: the
    // assertion only reads this file's own text, so it would have gone on
    // passing while naming a path no payload contains — and a control that
    // cannot appear in the subject controls nothing. The replacement is
    // airQuality.bandCount, which is still served and still an orphan, so the
    // exclusion is what keeps it one.
    const self = readFileSync(resolve('tests/seamSweep.test.ts'), 'utf8');
    expect(self).toMatch(/airQuality\.bandCount/);
  });
});

describe('reading a field and binding its name are different evidence', () => {
  /**
   * The measured case, and it is the parent-level twin of the reachability
   * correction above.
   *
   * `#256` added `FreshnessNotice`, whose prop is named `freshness` and which
   * carries the value `freshnessOf()` computes **on the client**. Measured on
   * master `0dd4770`, 2026-08-31:
   *
   *     .freshness        dot-reads in src/   0    <- what AGENTS.md greps for
   *     { freshness, | :  weaker matches      5    <- props and type members
   *
   * So the sweep reported the payload's `freshness` as read by five files
   * while nothing in `src/` reads it at all, and 26 of the 28 fields in a
   * `freshness` subtree were promoted to `app` on the strength of a prop name.
   * The sweep contradicted the book's own grep, and the sweep was wrong.
   *
   * The reachability fix cannot catch this: it demotes children of an unread
   * parent, and here the *parent itself* was falsely marked read.
   */
  it('calls a dot access strong', () => {
    expect(classifyRead('const p = payload.freshness;', 'freshness')).toBe('strong');
  });

  it('calls a bracket access strong', () => {
    expect(classifyRead("const p = payload['freshness'];", 'freshness')).toBe('strong');
  });

  it('calls a destructured binding weak, not strong', () => {
    // Genuinely ambiguous, and deliberately not resolved: this is how a payload
    // field is read *and* how a component receives a prop. No pattern can
    // separate them, so the sweep reports the ambiguity instead of guessing.
    expect(classifyRead('function Notice({ freshness, spans }) {}', 'freshness')).toBe('weak');
  });

  it('calls a type member weak', () => {
    expect(classifyRead('interface P {\n  freshness: Freshness | null;\n}', 'freshness')).toBe('weak');
  });

  it('finds nothing when the name is absent', () => {
    // The negative control. Without it every assertion above would pass on a
    // classifier that answered 'weak' for everything.
    expect(classifyRead('const x = payload.series;', 'freshness')).toBe('none');
  });

  it('still ignores a name that appears only in a comment', () => {
    // The earlier defect, re-asserted through the new entry point.
    //
    // The fixture must contain a form that WOULD match if comments survived —
    // the first version used `// freshness is discussed here`, which contains
    // no dot and no braces, so it classified as `none` whether comments were
    // stripped or not. The mutation control caught it: removing `stripComments`
    // left the suite green. A test whose fixture cannot exercise the code is a
    // control that controls nothing.
    expect(classifyRead('// const p = payload.freshness;\nconst x = 1;', 'freshness')).toBe('none');
    expect(classifyRead('/* function N({ freshness }) {} */\nconst x = 1;', 'freshness')).toBe('none');
  });

  it('flags a field matched only by name as evidence of nothing', () => {
    // `srcNamedOnly` had no test at all until the mutation control found it:
    // replacing it with `false` left the suite green, so the flag this whole
    // section exists to raise was unguarded.
    expect(namedOnly({ n: 5, strong: 0 }), 'five bindings, no access').toBe(true);
    expect(namedOnly({ n: 5, strong: 1 }), 'one real access is enough').toBe(false);
    expect(namedOnly({ n: 0, strong: 0 }), 'no match at all is an orphan, not a collision').toBe(false);
  });

  it('carries the flag through to the row the sweep reports', () => {
    // The wiring, not just the helper. The mutation control killed
    // `namedOnly` on its own but not its call site, which was inline in
    // `main()` and therefore unreachable from any test — a guard on the wrong
    // side of the seam. This is the measured `freshness` case end to end.
    const weak = annotateRow({}, { n: 5, strong: 0, where: [] }, { n: 2, where: [] }, 1);
    expect(weak.srcNamedOnly, 'the payload freshness case').toBe(true);
    expect(weak.verdict, 'still reported as app-read; the flag is a caveat, not a demotion').toBe('app');

    const real = annotateRow({}, { n: 5, strong: 3, where: [] }, { n: 2, where: [] }, 1);
    expect(real.srcNamedOnly).toBe(false);
    expect(real.srcStrongReaders).toBe(3);
  });
});
