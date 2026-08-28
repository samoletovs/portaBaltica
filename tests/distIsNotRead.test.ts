import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * No test may read from `dist/`, and the question must be answerable by machine.
 *
 * WHY THIS EXISTS RATHER THAN A GREP
 * ----------------------------------
 * `dist` is gitignored and `npm test` never builds, so a test reading it gets
 * whatever the last local build left behind — or, on a runner, nothing at all.
 * That took master red across three merges: three assertions in
 * `deployRecovery.test.ts` read `dist/index.html`, passed for anyone who had
 * built recently, and could never pass in CI.
 *
 * The fix moved those assertions to the source. But the comment explaining the
 * move **necessarily contains the string it forbids** — you cannot write "this
 * no longer reads `dist/index.html`" without writing `dist/index.html`. So the
 * obvious audit, grepping the suite for `dist`, returns four confident hits in
 * the one file whose entire subject is that it does not read it.
 *
 * That is not hypothetical. It fired during this programme: a grep for
 * `dist/index.html` came back positive against the fixed tree and was one step
 * from being reported as a regression in merged, working code. It was caught
 * only because the answer contradicted an earlier measurement, which is luck.
 *
 * So the check strips comments first and looks at what the code *does*. It
 * answers the question the grep was trying to ask, correctly, and keeps
 * answering it — which is the difference between a lexical proxy and the
 * property itself.
 *
 * IF THIS EVER FAILS LEGITIMATELY
 * -------------------------------
 * It means somebody wants a test to read a build artefact, and the honest way
 * to have that is a build step in the `quality` job — deliberately removed,
 * because nothing needed it. Add the build back, or read the deployed page in
 * the live suite, which is stronger: it asserts the file reached a reader
 * rather than a folder. Do not weaken this by allowing one more file.
 */

const TESTS_DIR = resolve(__dirname);

/**
 * The one file that may name a `dist` path in code: this one.
 *
 * A check that forbids a pattern has to contain the pattern to prove it can
 * see it — the positive control below is a literal `dist/index.html`. So this
 * file is an offender by construction, and excluding it is not a tolerated
 * exception but a definitional one.
 *
 * Named individually rather than tolerated by a count or a glob, following the
 * typecheck gate: a threshold quietly absorbs the next offender, whereas
 * "exclude one more" against a named list is a reviewable change to a list.
 * The test below asserts the list is exactly this file.
 */
const SELF = 'distIsNotRead.test.ts';

/**
 * Every `.ts`/`.tsx` file under `tests/`, **recursively**, with block and line
 * comments removed.
 *
 * The recursion is not tidiness. This walked flat while its own docstring
 * claimed "every file in `tests/`", so the claim was false the moment a
 * subdirectory held a test — and one did, briefly: `tests/live/planted.live.
 * test.ts`, created while verifying `#178`. `liveBrowserWiring.test.ts` was made
 * recursive for exactly this exposure and this file was not, so two guards over
 * the same tree disagreed about what "the suite" means.
 *
 * That is the guard-reach rule in `AGENTS.md` applied to the guard that taught
 * it: **a guard must enumerate the same set as the thing it guards.**
 *
 * Names are returned relative to `tests/`, so a top-level file is still
 * `distIsNotRead.test.ts` and a nested one is `sub/foo.test.ts`.
 */
function testSources(dir = TESTS_DIR, prefix = ''): { name: string; code: string }[] {
  const out: { name: string; code: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...testSources(join(dir, entry.name), name));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const raw = readFileSync(join(dir, entry.name), 'utf-8');
      out.push({
        name,
        code: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
      });
    }
  }
  return out;
}

/** A path reference into `dist`, in code rather than prose. */
const DIST_PATH = /['"`][^'"`]*\bdist\/[^'"`]*['"`]|\bresolve\([^)]*['"`]dist['"`]/;

describe('no test reads from dist/', () => {
  it('finds the suite to check, so an empty sweep cannot pass', () => {
    const sources = testSources();
    expect(sources.length).toBeGreaterThan(40);
    expect(sources.map((s) => s.name)).toContain('deployRecovery.test.ts');
  });

  it('sees a dist path when one is present, in code', () => {
    // The positive control. Without it, the sweep below passes on a regex that
    // matches nothing at all, which is the failure this file is about.
    const planted = "const INDEX = resolve(__dirname, '..', 'dist/index.html');";
    expect(DIST_PATH.test(planted)).toBe(true);
  });

  it('does not see one in a comment that merely mentions it', () => {
    // The exact shape that produced the false positive: prose naming the path
    // it forbids. After stripping, nothing of it is left to match.
    const prose = ['/**', ' * It used to read `dist/index.html`, and that was wrong.', ' */'].join(
      '\n'
    );
    const stripped = prose.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(DIST_PATH.test(stripped)).toBe(false);
  });

  it('excludes exactly one file, and that file is this one', () => {
    // So the exclusion cannot quietly grow. A second entry here is a visible
    // change to a named list rather than a number nobody reads.
    expect([SELF]).toEqual(['distIsNotRead.test.ts']);
    expect(DIST_PATH.test(testSources().find((s) => s.name === SELF)!.code)).toBe(true);
  });

  it('reads no build artefact anywhere in the suite', () => {
    const offenders = testSources()
      .filter(({ name }) => name !== SELF)
      .filter(({ code }) => DIST_PATH.test(code))
      .map(({ name }) => name);

    expect(
      offenders,
      'these tests read dist/, which npm test never builds and CI never has'
    ).toEqual([]);
  });
});
