/**
 * A red tick has to mean something.
 *
 * `tests/dashboardCadence.test.tsx` failed about one full-suite run in five
 * and passed 27/27 every time it was run alone. It cost someone else a nearly
 * rejected pull request: a newsroom-only change that touches no frontend file
 * came back red, and the natural reading of a red gate is that the change
 * broke something.
 *
 * Measured here, on one build in one session, with 24 busy node processes on
 * the machine:
 *
 *     before   3 of 5 full-suite runs failed   5298ms, 6113ms, 6562ms
 *     after    0 of 5, and 0 of 6 more at load 40
 *
 * Three separate causes, and only the first is the one that was reported:
 *
 *   1. `await screen.findByText(...)` polls against a **5000ms wall clock**.
 *      In a parallel suite that measures how busy the machine is.
 *   2. The timeout left the DOM behind, so the *next* test failed with
 *      `Found multiple elements` — which reads as a deterministic
 *      ambiguous-query bug and is collateral. Two failures, one cause.
 *   3. `await import('../src/components/PropertyTile')` inside a test body is
 *      not a wait at all, it is Vite transforming recharts — billed to
 *      whichever test ran first and timed against the same 5000ms. Removing
 *      the wall clock alone left this, at 6522–8472ms, still 3 of 5.
 *
 * **The lever refused throughout was `testTimeout`.** `tests/noNetwork.ts`
 * already refuses that trade for the network, and the reasoning transfers: a
 * raised budget hides the next real slowness, and the next one after that.
 *
 * This file is the population check. Fixing the file that bit and stopping
 * there would leave sixteen others carrying the same pattern, which is the
 * "a guard must enumerate the same set as its subject" rule applied to a fix.
 *
 * **The population moved while this was being written, which is the point.**
 * `followReachability.test.tsx` arrived in a pull request that merged after
 * the list was measured, carrying a wall-clock wait the list did not name. A
 * filter of known offenders would have swallowed it; the equality made it a
 * decision. It stays on the list, on evidence rather than because a test went
 * red — its four wall-clock tests run 55–117ms and it imports its components
 * statically, so it has the mechanism without the amplifier.
 *
 * That episode is also why there are now two lists. Measured across 102 unit
 * test files:
 *
 *     wall clock (the mechanism)               17    slowest test 371ms
 *     dynamic import in a test body             7
 *     both — the combination that flaked        2    slowest test 371ms
 *     both, mounting a recharts tree            1    5298ms — the one that bit
 *
 * Seventeen names is close to wallpaper. Two is a list worth reading.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** A wall-clock wait: RTL's async queries and `waitFor` both poll a timer. */
const WALL_CLOCK_WAIT = /\b(?:findBy[A-Za-z]+|findAllBy[A-Za-z]+|waitFor)\b/;

/**
 * Strip comments before scanning, for the reason `colourRatchet.test.ts`
 * strips them: otherwise a file fails on its own explanation. The docstring
 * in `dashboardCadence.test.tsx` names `findByText` while describing why it
 * no longer uses one, and an unstripped scan reported it as an offender —
 * which would have pushed the next person to delete the reasoning.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * This file, which cannot scan itself.
 *
 * `WALL_CLOCK_WAIT` is a regex literal spelling out the very tokens it looks
 * for, and one assertion below quotes `findByText` as a string — so an
 * unexcluded scan reports this file as an offender, permanently and
 * unfixably. Measured: it was the seventeenth name in a list of sixteen.
 *
 * Named as a constant rather than filtered inline so the exclusion is one
 * reviewable line, and asserted below to be the only one.
 */
const SELF = 'suiteDeterminism.test.ts';

function unitTestFiles(): { file: string; text: string }[] {
  const dir = resolve('tests');
  return readdirSync(dir)
    .filter((f) => /\.test\.tsx?$/.test(f) && !f.includes('.live.'))
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}

/** Everything the scan judges: the suite, minus the scanner. */
function scanned(): { file: string; text: string }[] {
  return unitTestFiles().filter(({ file }) => file !== SELF);
}

describe('the suite does not decide correctness on a wall clock', () => {
  it('is looking at the suite, so everything below is about something', () => {
    // Guard the guard. A scan that finds no files reports a clean sheet.
    const files = unitTestFiles();
    expect(files.length, 'no unit test files found').toBeGreaterThan(50);
    expect(files.some((f) => f.file === 'dashboardCadence.test.tsx')).toBe(true);
  });

  it('excludes itself and nothing else', () => {
    // The exclusion is load-bearing — this file spells the tokens out — and
    // it is exactly one file wide. Asserted, because an exclusion that grows
    // by a filename is how a scan comes to cover less than it claims.
    expect(unitTestFiles().length - scanned().length).toBe(1);
    expect(unitTestFiles().some((f) => f.file === SELF)).toBe(true);
    expect(WALL_CLOCK_WAIT.test(code(readFileSync(resolve('tests', SELF), 'utf8'))))
      .toBe(true);
  });

  it('names every file that still waits on one, as an equality', () => {
    // Seventeen files, all pre-existing, none of them mine to change —
    // reported rather than reached for.
    //
    // They are not all equally exposed, and the measurement says so. A wall
    // clock is the *mechanism*; what bit was the mechanism with 4930ms of work
    // inside a 5000ms budget. Measured per test, the slowest anywhere in this
    // list is **371ms**, which is thirteen times the room it needs — so these
    // are the same mechanism at a margin that is not in question today.
    //
    // `followReachability.test.tsx` arrived in #201 after this list was
    // measured, and this assertion is what turned that into a decision rather
    // than a silent addition. It is here on evidence, not because a test went
    // red: its four wall-clock tests run 55–117ms, and it imports its
    // components statically, so it does not carry the amplifier that made the
    // file below flake — see the combination check further down.
    //
    // An equality rather than a filter of known offenders, because a filter
    // stops matching the day one is fixed and then guards nothing — and
    // because the number going *up* is the thing worth noticing. It went up
    // by one and someone had to look, which is the whole point.
    const offenders = scanned()
      .filter(({ text }) => WALL_CLOCK_WAIT.test(code(text)))
      .map(({ file }) => file)
      .sort();

    expect(
      offenders,
      'a new wall-clock wait in a parallel suite is a new source of ambiguous red ticks; ' +
        'prefer draining the event loop to polling a timer',
    ).toEqual([
      'chartEmbed.test.tsx',
      'chartEmbedCompact.test.tsx',
      'euReference.test.tsx',
      'followPage.test.tsx',
      'followReachability.test.tsx',
      'freightModalSplit.test.tsx',
      'legendWrap.test.tsx',
      'liveGrid.test.tsx',
      'newsFeed.test.tsx',
      'policyCommitments.test.tsx',
      'promiseScope.test.tsx',
      'rankedComparison.test.tsx',
      'referenceScale.test.tsx',
      'sectionTabs.test.tsx',
      'seriesColourUsage.test.tsx',
      'visitCounts.test.tsx',
      'weeklyWrap.test.tsx',
    ]);
  });

  it('names the files carrying both halves of the defect, which is the sharper list', () => {
    // The list above is an inventory of a *mechanism*, and seventeen entries
    // is close to wallpaper. This is the inventory of the **defect**: a
    // wall-clock wait and a dynamic import in a test body, together.
    //
    // Separated because they measure differently. Across the suite: 17 files
    // carry the clock, 7 carry a dynamic import, and **2 carry both** — which
    // is the structural position `dashboardCadence.test.tsx` was in when it
    // failed one full-suite run in five.
    //
    // Both are comfortable today: worst test 371ms in `chartEmbed` and 161ms
    // in `visitCounts`, against 5000ms. Their dynamic imports are small
    // modules rather than a recharts tree, which is the difference. Listed
    // rather than fixed for the same reason as the seventeen — neither is
    // mine — but listed *separately*, because a third name here means
    // something a third name above does not.
    const both = scanned()
      .filter(({ text }) => WALL_CLOCK_WAIT.test(code(text)) && /await import\(/.test(code(text)))
      .map(({ file }) => file)
      .sort();

    expect(
      both,
      'a wall clock and a dynamic import in the same file is the combination that flaked; ' +
        'hoist the import to module scope, which costs nothing and removes the amplifier',
    ).toEqual(['chartEmbed.test.tsx', 'visitCounts.test.tsx']);
  });

  it('has taken the one that actually bit out of that list', () => {
    // The companion to the equality above: it would still pass if the list
    // simply had not been updated, and this says which way the count moved.
    const cadence = unitTestFiles().find((f) => f.file === 'dashboardCadence.test.tsx')!;
    expect(WALL_CLOCK_WAIT.test(code(cadence.text))).toBe(false);
    // And that its comment still explains why, which the scan must not see.
    expect(cadence.text).toContain('findByText');
  });

  it('does not import a component inside a test body, where it is timed', () => {
    // A dynamic import in a test is real work — Vite transforming the module
    // graph — attributed to that test and measured against its budget. It is
    // the cause that survived removing the wall clock, and the one that looks
    // least like a cause.
    const cadence = unitTestFiles().find((f) => f.file === 'dashboardCadence.test.tsx')!;
    expect(code(cadence.text)).not.toMatch(/await import\(/);
  });

  it('has not bought quiet with a bigger budget', () => {
    // The lever that was available throughout and refused. If a future change
    // needs it, this is where the argument has to be made rather than made
    // silently in a config file.
    const config = readFileSync(resolve('vitest.config.ts'), 'utf8');
    expect(code(config), 'a raised timeout hides the next real slowness').not.toMatch(/testTimeout/);

    const cadence = unitTestFiles().find((f) => f.file === 'dashboardCadence.test.tsx')!;
    expect(code(cadence.text), 'per-test timeout override').not.toMatch(/\}, \d[\d_]*\);/);
  });
});

describe('a test does not repeat expensive work it could do once', () => {
  it('scans the source tree once in the colour ratchet, not ten times', () => {
    // `instances()` walks 90 files, reads each and regex-scans it. It was
    // called at five sites, one of them inside a loop of six, so a single run
    // walked the tree ten times — which made this the slowest file in the
    // suite and, on a loaded machine, a flaky one: it timed out once at
    // 5266ms in the same five runs that caught the cadence file.
    //
    // The scan is a pure function of the working tree and nothing mutates it,
    // so it is computed once. Faster, and a truer statement of what it is.
    const text = code(readFileSync(resolve('tests/colourRatchet.test.ts'), 'utf8'));

    // The declaration is `function instances(): Instance[]`, which also reads
    // as `instances()` — so a naive count says two and means one. Counting
    // call sites means excluding the site that defines it.
    const calls = [...text.matchAll(/(?<!function )\binstances\(\)/g)].length;
    expect(calls, 'instances() should be called exactly once, to build ALL_INSTANCES').toBe(1);
    expect(text).toMatch(/const ALL_INSTANCES: Instance\[\] = instances\(\);/);

    // The companion: the memo has to actually be what the assertions read, or
    // the call count above is satisfied by a constant nobody uses.
    expect([...text.matchAll(/\bALL_INSTANCES\b/g)].length).toBeGreaterThan(4);
  });
});
