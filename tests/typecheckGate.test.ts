/**
 * `npm test` must typecheck.
 *
 * Two sessions hit the same `TS2345` on the same afternoon — a type argument
 * dropped while narrowing a `.then` — and in both cases the whole suite ran
 * green and only `npm run build` objected. A contributor who runs the tests
 * and reads "1160 passed" has been told something that is not quite true.
 *
 * The hole was wider than that. `tsconfig.app.json` includes only `src` and
 * `tsconfig.node.json` only `vite.config.ts`, so **nothing** typechecked
 * `tests/` — not vitest, not lint, and not the build either. Verified before
 * changing anything, by putting this in a test file:
 *
 *     function needsNumber(n: number): number { return n * 2; }
 *     const wrong: string = 'not a number';
 *     needsNumber(wrong);
 *
 * and watching `npm test`, `npm run lint` and `npm run build` all pass.
 *
 * These assertions are on the wiring rather than on a compiler outcome,
 * because the compiler's outcome is already the gate: if `tsc` fails, `npm
 * test` exits non-zero and vitest never runs, so no assertion here could
 * observe it. What can silently regress is the *plumbing* — someone
 * simplifying `test` back to `vitest run`, or widening the exclude list to
 * quiet a new error rather than fix it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const testConfig = readFileSync(resolve('tsconfig.test.json'), 'utf8');

describe('the test script', () => {
  it('typechecks before it runs the tests', () => {
    expect(pkg.scripts.typecheck, 'no typecheck script').toBeDefined();
    expect(
      pkg.scripts.test,
      '`npm test` must fail on a type error, not report 1160 passing',
    ).toMatch(/npm run typecheck/);
  });

  it('typechecks the tests as well as the app', () => {
    // `tsc -b` would only cover `src`, which is the half that was already
    // covered by the build. The point of this change is the other half.
    expect(pkg.scripts.typecheck).toContain('tsconfig.test.json');
    expect(testConfig).toMatch(/"include":\s*\[\s*"src",\s*"tests"\s*\]/);
  });

  it('keeps the build as its own typecheck too', () => {
    // `npm run build` is what CI runs to produce the bundle, and it should
    // still refuse to emit from code that does not compile.
    expect(pkg.scripts.build).toMatch(/tsc -b/);
  });
});

describe('the excluded test files', () => {
  /**
   * Five files carry 34 pre-existing errors and are excluded so the gate can
   * be switched on at all. Every one of them tests code owned by another
   * session — `api/**` or the newsroom — so the fixes belong with that work.
   *
   * The list is asserted rather than merely written down so that "exclude one
   * more file" is a visible, reviewable change to a named list rather than a
   * number quietly going up.
   */
  const KNOWN = [
    'tests/aiInsightsFanout.test.ts',
    'tests/airQualityBands.test.ts',
    'tests/articlePageFunction.test.ts',
    'tests/byline.test.tsx',
    'tests/functionSecurityHeaders.test.ts',
  ];

  it('are exactly the five that were already unclean', () => {
    const excluded = [...testConfig.matchAll(/"(tests\/[^"]+)"/g)].map((m) => m[1]);
    expect(
      excluded.sort(),
      'a new exclusion hides an error rather than fixing it',
    ).toEqual([...KNOWN].sort());
  });

  it('are named individually rather than matched by a pattern', () => {
    // `tests/**` or `*.test.ts` in the exclude list would switch the whole
    // thing off while still looking like it was on.
    for (const file of KNOWN) {
      expect(testConfig, `${file} should be listed literally`).toContain(`"${file}"`);
    }
    expect(testConfig, 'a glob would exclude far more than intended').not.toMatch(/"tests\/[^"]*\*/);
  });
});
