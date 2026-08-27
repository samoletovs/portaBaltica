/**
 * Every live browser check must get its browser from `liveBrowser.ts`.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION
 * ---------------------------------------
 * `launchForLiveCheck` exists to make one distinction that a local launcher
 * cannot: **skip locally, fail in CI.** A contributor who has never run
 * `npx playwright install` should not have `npm run test:live` fail at them.
 * A runner that cannot launch a browser must not report a pass.
 *
 * `#156` is what the second half costs. No workflow had ever installed the
 * browser, so the layout check took the skip branch on every deploy, printed a
 * warning nobody reads, and reported a pass — for weeks, over a 196px sideways
 * scroll it had already found. The suite finished in 1.4 seconds having
 * launched nothing.
 *
 * The helper fixed the two files that existed. A third was then written with
 * its own copy of the launcher, and that copy soft-skipped on a missing
 * *package* even inside CI. It was safe only because `deploy.yml` runs a plain
 * `npm ci`, which happens to install devDependencies — safety by circumstance,
 * one `--omit=dev` away from being #156 again, in a file whose entire subject
 * is that a check which does not run reports a pass.
 *
 * So the wiring is asserted rather than left to whoever writes the fourth one.
 *
 * WHY THERE IS NO EXEMPTION LIST
 * -------------------------------
 * There is exactly one legitimate importer — the helper itself — and it is
 * identified by being the module that *defines* the export, not by being named
 * in a list. An exemption list here would be the thing `AGENTS.md` warns
 * about: a subtraction that cannot tell a legitimate case from a silenced one.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TESTS_DIR = resolve(__dirname);

/** The module that owns the launcher, and so the only one that may import it. */
const HELPER = 'liveBrowser.ts';

/** Every `.ts`/`.tsx` file in `tests/`, with block and line comments removed. */
function testSources(): { name: string; code: string }[] {
  return readdirSync(TESTS_DIR)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((name) => {
      const raw = readFileSync(resolve(TESTS_DIR, name), 'utf-8');
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return { name, code };
    });
}

/** A direct import of playwright, in code rather than prose. */
const DIRECT_IMPORT = /(?:from|import\s*\()\s*['"]playwright['"]/;

/** A call that starts a browser. */
const LAUNCHES = /\.launch\s*\(/;

describe('live browser checks are wired through the helper', () => {
  it('finds the suite to check, so an empty sweep cannot pass', () => {
    const sources = testSources();
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map((s) => s.name)).toContain(HELPER);
  });

  it('is the helper alone that imports playwright', () => {
    const offenders = testSources()
      .filter((s) => s.name !== HELPER && DIRECT_IMPORT.test(s.code))
      .map((s) => s.name);

    expect(
      offenders,
      'these import playwright directly instead of using launchForLiveCheck, ' +
        'so a missing browser skips them silently on a runner rather than failing',
    ).toEqual([]);
  });

  it('is the helper alone that calls launch()', () => {
    // The import and the launch are separate leaks. A file could take the
    // browser type from the helper and still call `.launch()` itself, which
    // reintroduces the branch the helper exists to remove.
    const offenders = testSources()
      .filter((s) => s.name !== HELPER && LAUNCHES.test(s.code))
      .map((s) => s.name);

    expect(
      offenders,
      'these start a browser themselves rather than through launchForLiveCheck',
    ).toEqual([]);
  });

  it('the helper still fails rather than skips when CI has no browser', () => {
    // The positive control. If the helper ever loses its `inCI` throw, the two
    // sweeps above go on passing while enforcing nothing — every file would be
    // correctly wired to a helper that no longer refuses.
    const helper = readFileSync(resolve(TESTS_DIR, HELPER), 'utf-8');

    expect(helper, 'the helper no longer distinguishes CI from local').toMatch(
      /process\.env\.CI/,
    );
    expect(
      (helper.match(/throw new Error/g) ?? []).length,
      'the helper must throw on both the missing package and the missing binary',
    ).toBe(2);
  });
});
