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
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const TESTS_DIR = resolve(__dirname);

/** The module that owns the launcher, and so the only one that may import it. */
const HELPER = 'liveBrowser.ts';

/**
 * Every `.ts`/`.tsx` file under `tests/`, **recursively**, with block and line
 * comments removed.
 *
 * The recursion is the whole point rather than tidiness. `vitest.live.config.ts`
 * globs `tests` recursively for `*.live.test.{ts,tsx}`, so the runner descends
 * and a live check in a subdirectory runs exactly like one at the top level. A
 * flat `readdirSync` here would give the guard a *narrower reach than the thing
 * it guards* — and measured, that is not theoretical: a file planted at
 * `tests/live/planted.live.test.ts` importing `playwright-core` and calling
 * `launchPersistentContext` was listed by the live runner and reported `4
 * passed` by this suite.
 *
 * Names are returned relative to `tests/`, so a top-level file is still
 * `liveBrowser.ts` and a nested one is `live/foo.live.test.ts`.
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

/**
 * A direct import of a playwright package, in code rather than prose.
 *
 * `playwright-core` is the one that matters and it is easy to miss: it is a
 * transitive dependency, so it is **already in `node_modules`**, and it exports
 * a `chromium` with a working `launch()`. Verified rather than assumed —
 * `import('playwright-core')` resolves in this repo today and
 * `typeof chromium.launch === 'function'`. So a bare `'playwright'` pattern
 * leaves a working, installed bypass one hyphen away.
 *
 * `@playwright/test` is not installed today, and is included because it is the
 * import path Playwright's own documentation shows — the likeliest thing for
 * whoever writes the fourth live check to reach for.
 */
const DIRECT_IMPORT = /(?:from|import\s*\()\s*['"](?:playwright(?:-core)?|@playwright\/test)['"]/;

/**
 * A call that starts a *local* browser process.
 *
 * `launchPersistentContext` is included because it launches one and hands back
 * a context directly, and `.launch\s*\(` does not match it — the character
 * after `launch` is `P`, not `(`.
 *
 * `connect` and `connectOverCDP` are deliberately **not** here. They attach to a
 * browser someone else started, so the missing-binary branch this helper exists
 * to remove cannot arise. Naming the property rather than collecting verbs that
 * look browser-ish is what keeps this from becoming a word list.
 *
 * Written as an alternation rather than `launch(?:PersistentContext)?` so that
 * the pattern does not contain the literal `.launch(` and therefore match its
 * own definition. Master's narrower `\.launch\s*\(` avoided that by luck — `\s`
 * sat where the `(` needed to be. Worth stating, because the obvious repair for
 * a self-match is to exempt this file, and that would blind both sweeps to a
 * real launcher added here later.
 */
const LAUNCHES = /\.(?:launch|launchPersistentContext)\s*\(/;

describe('live browser checks are wired through the helper', () => {
  it('finds the suite to check, so an empty sweep cannot pass', () => {
    const sources = testSources();
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map((s) => s.name)).toContain(HELPER);
  });

  it('can see a file it is meant to catch, including one in a subdirectory', () => {
    // The control above proves the sweep found *a* suite. It does not prove the
    // sweep can reach *the file that matters*, and those are different claims:
    // `tests/` holds enough top-level files that `> 20` passes whether or not
    // the walk descends at all.
    //
    // So this plants the exact thing the two sweeps forbid, one directory down,
    // and requires both of them to flag it. It depends on no file already in
    // the repo, so it cannot quietly stop proving anything when one is moved.
    //
    // The sample is assembled from fragments rather than written out, because
    // the sweeps read source text and would otherwise flag *this* file for
    // describing a violation. The alternative — exempting this file from its
    // own checks — is the one thing the header rules out, and it would be worse
    // than a cosmetic workaround: it would hide a real launcher added here
    // later, in the file whose entire subject is checks that do not check.
    const pkg = 'play' + 'wright-core';
    const launcher = 'launch' + 'PersistentContext';

    // The fixture goes in an OS scratch directory, **not** under `tests/`, and
    // that is a fix rather than a preference.
    //
    // It used to be planted at `tests/.wiring-control/` and removed again,
    // while `distIsNotRead.test.ts` walks `tests/` recursively in a different
    // worker and `readFileSync`s every `.ts` it finds. Driven deliberately —
    // one process cycling this create/remove against another running that
    // walk — the reader threw in **56 of 368 walks: ENOENT ×53, EPERM ×3**.
    // After the move, with the same probe: **0 of 339**, while the old writer
    // rerun as a control still produced **72 of 387**, so the zero is a fact
    // about the fix rather than about a probe that stopped working.
    //
    // `testSources` takes its root as a parameter, so pointing it at a scratch
    // tree proves exactly the same thing — that the walk descends — while
    // touching nothing another test reads. That closes it for every present
    // and future reader of `tests/`, not just the one reader that exists today.
    const root = mkdtempSync(join(tmpdir(), 'pb-wiring-'));
    const dir = join(root, 'nested');
    const file = join(dir, 'planted.sample.ts');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        file,
        `import { chromium } from '${pkg}';\nconst b = await chromium.${launcher}('/tmp/x');\n`,
      );

      const planted = testSources(root).find((s) => s.name.endsWith('nested/planted.sample.ts'));
      expect(planted, 'the sweep does not descend into subdirectories, so a live check in one is unguarded').toBeDefined();
      expect(DIRECT_IMPORT.test(planted!.code), `the import pattern misses ${pkg}`).toBe(true);
      expect(LAUNCHES.test(planted!.code), `the launch pattern misses ${launcher}`).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
