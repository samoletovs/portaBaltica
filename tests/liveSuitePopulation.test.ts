import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The live suite is a population, and nothing was checking its size.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * `npm run test:live` runs whatever matches an include glob. Delete a live file,
 * rename it, or narrow the glob, and the suite reports a pass over fewer checks.
 * Measured before writing this: renaming `tests/indicators.live.test.ts` out of
 * the way took the suite from **10 files to 9**, and **not one of the 1757 unit
 * tests noticed**. The only failure in that run was the known
 * `dashboardCadence` flake.
 *
 * That file is the one holding the arithmetic invariant — goods plus services
 * against the trade balance — which `AGENTS.md` names as the cheap check that
 * would have caught the newsroom incident, where five articles published real
 * Eurostat figures attached to metrics they did not measure. It is also the only
 * check of its kind, because it needs live data and cannot run in the gate. So
 * the single most load-bearing post-deploy assertion in the repository could be
 * removed by deleting one file, and every signal would stay green.
 *
 * A live suite that silently stops running is the purest form of the check that
 * cannot fail, and this repository has already paid for one: `#156`,
 * `reducedMotionLayout.live.test.ts` reporting a pass in 1.4 seconds having
 * launched no browser, for weeks, over a defect it had already found.
 *
 * WHY AN EQUALITY AND NOT A FLOOR
 * -------------------------------
 * `tests/liveBrowserWiring.test.ts` has a vacuity guard, and it is a floor over
 * the *whole* `tests/` directory — `sources.length > 20` against a hundred-odd
 * files. It is correct for what it guards and says nothing about this
 * population: every live file could be deleted and it would still pass.
 *
 * `AGENTS.md` gives the rule and the reason. **State the exemption as an
 * equality against the full set, not as a subtraction from it**, because an
 * equality fails the day the set changes *in either direction* — which is the
 * only thing that gets a list like this pruned. A floor only notices deletion
 * past the floor, and never notices an addition nobody described.
 *
 * WHAT IS NOT DUPLICATED HERE
 * ---------------------------
 * `tests/deployWorkflow.test.ts` already asserts that `deploy.yml` runs
 * `npm run test:live` and installs a browser first. This picks up the chain
 * where that stops: the script, the config, the files, and the skips. Between
 * them every link from the workflow to an individual assertion is held by
 * something.
 */

const LIVE_DIR = resolve('tests');

/**
 * Every live check the deploy is expected to run, and what each one proves.
 *
 * The description is the point. A filename tells the next reader nothing about
 * what is lost by deleting it, and this list exists precisely for the moment
 * someone is deleting one.
 */
const LIVE_CHECKS = new Map<string, string>([
  ['api-contracts.live.test.ts', 'the deployed endpoints answer with the shape the client reads'],
  ['articleMeta.live.test.ts', 'what a social crawler actually receives from the deployed site'],
  [
    'chartNames.live.test.ts',
    'every chart on the deployed dashboard announces what it plots — recharts injects its role at runtime, so no source test can see this',
  ],
  [
    'correctionsRender.live.test.ts',
    'a published correction reaches a reader — present in the accessibility tree, not merely in the JSON',
  ],
  ['deployRecoveryReal.live.test.ts', 'the deploy-race recovery fires on a real chunk failure, in a real browser'],
  ['functionSecurityHeaders.live.test.ts', 'every deployed route carries the security headers'],
  ['headerOneRow.live.test.ts', 'the deployed header keeps its controls on one row'],
  ['historicalData.live.test.ts', 'every Latvian indicator the API advertises still returns data'],
  [
    'indicators.live.test.ts',
    'every indicator definition still returns real data, its series is contiguous, ' +
      'and goods plus services still reconciles against the trade balance — the ' +
      'arithmetic check for a cache collision, which exists nowhere else',
  ],
  ['portData.live.test.ts', 'the Eurostat maritime tables still carry data'],
  ['reducedMotionLayout.live.test.ts', 'the deployed site does not scroll sideways'],
  ['seriesContrast.live.test.ts', 'no text on the deployed site sits below its contrast floor'],
  [
    'forcedColours.live.test.ts',
    'chart series stay above the non-text floor when a reader forces a high-contrast palette',
  ],
  [
    'tabStopNames.live.test.ts',
    'nothing on the deployed site is reachable by keyboard without a name — watching for a link-free scroll strip, which Chromium makes an unnamed tab stop',
  ],
]);

/**
 * Live checks that are deliberately not run, and why.
 *
 * Declared rather than left as an `it.skip` nobody ever sees again. A skip is a
 * filter: it sits in the file forever, reports nothing, and the suite it belongs
 * to goes on saying "passed". Naming it here makes removing it a decision and
 * adding one visible.
 *
 * Empty today. The one entry it held — `/api/system-status`, switched off for
 * "slow — 7 parallel health checks" — was switched back on once both halves of
 * that reason expired: the endpoint carries 12 checks now, and the
 * optional-probe budget capped the one that used to hang. It answers in
 * 259-1086ms.
 *
 * An empty list here would normally blind the control below, which is why that
 * control no longer depends on this list being non-empty.
 */
const DECLARED_SKIPS = new Map<string, string>([]);

/**
 * Every live file the runner would pick up, **recursively**.
 *
 * `vitest.live.config.ts` includes `tests/**"/"*.live.test.{ts,tsx}`, so the
 * runner descends. A flat `readdirSync` here gave the guard a *narrower reach
 * than the thing it guards* — the `#178` shape, and the same defect
 * `distIsNotRead.test.ts` shipped with and `liveBrowserWiring.test.ts` was
 * written to avoid.
 *
 * It was latent rather than live: measured at the time of this change there
 * were **zero** live tests below `tests/` itself, so the equality was correct
 * for every file that existed. That is exactly why it needed fixing rather
 * than watching — the first `tests/live/` subdirectory anyone creates makes
 * this under-cover silently, in the direction that reports success.
 *
 * Names stay relative to `LIVE_DIR` so a nested file reads as `live/foo.live.test.ts`
 * and cannot collide with a root-level file of the same basename.
 */
function liveFiles(): string[] {
  const found: string[] = [];

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(resolve(dir, entry.name), prefix + entry.name + '/');
        continue;
      }
      if (entry.name.endsWith('.live.test.ts') || entry.name.endsWith('.live.test.tsx')) {
        found.push(prefix + entry.name);
      }
    }
  }

  walk(LIVE_DIR, '');
  return found.sort();
}

describe('the live suite is the suite that was declared', () => {
  it('finds live files at all', () => {
    // Guard the guard. An empty directory would make the equality below pass
    // against an empty declaration, which is the failure this file is about.
    expect(liveFiles().length, 'no live checks exist any more').toBeGreaterThan(5);
  });

  it('runs exactly the checks that are declared, no more and no fewer', () => {
    expect(
      liveFiles(),
      'the live suite no longer matches its declaration. A file removed here is a ' +
        'post-deploy check that stops running with nothing turning red; a file added ' +
        'is one nobody has described. Update the list and say what the check proves.',
    ).toEqual([...LIVE_CHECKS.keys()].sort());
  });

  it('says what every declared check proves', () => {
    // A list of bare filenames would satisfy the equality above while telling
    // the next reader nothing about what deleting one costs.
    for (const [file, claim] of LIVE_CHECKS) {
      expect(claim.length, `${file} has no description`).toBeGreaterThan(20);
    }
  });
});

describe('the chain from the workflow down to a live file', () => {
  // `deployWorkflow.test.ts` holds the top link: deploy.yml runs
  // `npm run test:live`, after installing chromium. These are the links below
  // it, each of which could be cut without that assertion noticing.

  it('points npm run test:live at the live config', () => {
    // The gap this closes: `deploy.yml` invoking `npm run test:live` proves
    // nothing about what that script does. Redefine it as `echo ok` and the
    // workflow assertion still passes, the step still goes green, and no live
    // check runs at all.
    const scripts = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts as Record<
      string,
      string
    >;

    expect(scripts['test:live'], 'no test:live script').toBeDefined();
    expect(scripts['test:live']).toContain('vitest');
    expect(scripts['test:live']).toContain('vitest.live.config.ts');
  });

  it('lets the live config reach every live file', () => {
    // Narrowing the include to a single file would leave nine checks unrun with
    // everything green. The glob is asserted whole rather than merely non-empty.
    const config = readFileSync(resolve('vitest.live.config.ts'), 'utf8');
    const include = config.match(/include:\s*\[([^\]]*)\]/);

    expect(include, 'the live config declares no include').not.toBeNull();
    expect(
      include![1],
      'the live config no longer sweeps the whole live suite',
    ).toContain('tests/**/*.live.test.{ts,tsx}');
  });

  it('keeps the live files out of the unit gate', () => {
    // The other direction, and it is not cosmetic: `tests/noNetwork.ts` refuses
    // every outbound connection in the unit suite, so a live file running there
    // would fail on the guard rather than reach the deployed site.
    const config = readFileSync(resolve('vitest.config.ts'), 'utf8');
    const exclude = config.match(/exclude:\s*\[([^\]]*)\]/);

    expect(exclude, 'the unit config declares no exclude').not.toBeNull();
    expect(exclude![1]).toContain('.live.test.');
    expect(config, 'the unit suite must not load the live config').not.toMatch(
      /include:[^\]]*live\.test/,
    );
  });
});

describe('a live check that is switched off says so', () => {
  const SKIP_PATTERN = /\b(?:it|test|describe)\.(?:skip|todo)\s*\(\s*(['"`])([\s\S]*?)\1/g;

  /** Every `it.skip` / `describe.skip` title in one file's text. */
  function skipsIn(text: string): string[] {
    return [...text.matchAll(SKIP_PATTERN)].map((m) => m[2]);
  }

  /** Every `it.skip` / `describe.skip` in the live suite, with its title. */
  function skipsInLiveSuite(): { file: string; title: string }[] {
    const found: { file: string; title: string }[] = [];
    for (const file of liveFiles()) {
      const text = readFileSync(resolve(LIVE_DIR, file), 'utf8');
      for (const title of skipsIn(text)) found.push({ file, title });
    }
    return found;
  }

  // The control used to be "there is exactly one skip today, so the equality
  // below is not empty-equals-empty". That was true and it expired the moment
  // the last skip was switched back on -- an exemption whose control depends on
  // the exemption still existing.
  //
  // So the control is now on the scanner itself, against text this test owns.
  // It holds whether or not the suite has a skip, which is the property the
  // previous version was missing.
  it('matches a skip, so an empty result means an empty suite', () => {
    expect(skipsIn("it.skip('a switched-off check', async () => {});")).toEqual([
      'a switched-off check',
    ]);
    expect(skipsIn('describe.skip("a whole group", () => {});')).toEqual(['a whole group']);
    expect(skipsIn('test.todo(`not written yet`);')).toEqual(['not written yet']);

    // Negative control on the same shape: an ordinary check must not match, or
    // the scanner would report every test in the suite as switched off.
    expect(skipsIn("it('an ordinary check', async () => {});")).toEqual([]);
    expect(skipsIn("describe('an ordinary group', () => {});")).toEqual([]);
  });

  it('has declared every switched-off check, as an equality', () => {
    const actual = skipsInLiveSuite()
      .map((s) => `${s.file}: ${s.title}`)
      .sort();
    const declared = [...DECLARED_SKIPS].map(([file, title]) => `${file}: ${title}`).sort();

    expect(
      actual,
      'a live check is switched off without being declared, or a declared one has been ' +
        'switched back on. Either way the list is now a lie, and a skipped check in the ' +
        'suite that verifies production is the quietest way to stop verifying it.',
    ).toEqual(declared);
  });
});
