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
]);

/**
 * Live checks that are deliberately not run, and why.
 *
 * Declared rather than left as an `it.skip` nobody ever sees again. A skip is a
 * filter: it sits in the file forever, reports nothing, and the suite it belongs
 * to goes on saying "passed". Naming it here makes removing it a decision and
 * adding one visible.
 */
const DECLARED_SKIPS = new Map<string, string>([
  [
    'api-contracts.live.test.ts',
    'GET /api/system-status returns health data (slow — 7 parallel health checks)',
  ],
]);

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
  /** Every `it.skip` / `describe.skip` in the live suite, with its title. */
  function skipsInLiveSuite(): { file: string; title: string }[] {
    const found: { file: string; title: string }[] = [];
    for (const file of liveFiles()) {
      const text = readFileSync(resolve(LIVE_DIR, file), 'utf8');
      for (const match of text.matchAll(
        /\b(?:it|test|describe)\.(?:skip|todo)\s*\(\s*(['"`])([\s\S]*?)\1/g,
      )) {
        found.push({ file, title: match[2] });
      }
    }
    return found;
  }

  it('can see a skip when there is one', () => {
    // Guard the guard: with no skip anywhere, the equality below is an empty
    // list equalling an empty list, and would keep passing if the scanner broke.
    // There is exactly one today, so this is a live control rather than a hope.
    expect(
      skipsInLiveSuite().length,
      'no skip found — either the suite has none, in which case DECLARED_SKIPS ' +
        'should be empty too, or the scanner has stopped matching',
    ).toBe(DECLARED_SKIPS.size);
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
