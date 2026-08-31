/**
 * A duplicate key in a registry is silent in every direction that matters.
 *
 * WHAT HAPPENED
 * -------------
 * `AGENTS.md`'s source survey recorded `migr_asyappctzm` as "Newsworthy; codes
 * unresolved. Worth another attempt." Acting on that, a session resolved the
 * codes, measured the cube, and appended `asylum_applications` to
 * `api/shared/indicators.js`.
 *
 * It was already there, 480 lines above. The survey note was stale, and what
 * the append actually did was:
 *
 *   existing   applicant=FRST   "First-time asylum applications"   sanity [0, 5000]
 *   appended   applicant=TOTAL  "Asylum applications"              sanity [0, 20000]
 *
 * A JavaScript object literal takes the LAST of a repeated key with no error,
 * so the registry silently begins serving a different statistic under a title
 * a reader cannot distinguish -- and with a sanity band that destroys the
 * discrimination the original was sited for. That band is not arbitrary: 5000
 * sits above the Baltic extreme of 1,460 and below the lowest EU27 month ever
 * recorded, 7,845, so it separates "our three countries" from "we are
 * accidentally reading Europe". 20000 clears both and separates nothing.
 *
 * WHY NOTHING CAUGHT IT
 * ---------------------
 * Three guards that each look like they would, and cannot:
 *
 *   - ESLint's `no-dupe-keys` never runs. `eslint.config.js` matches only
 *     TypeScript, and every file under `api/` is plain JavaScript.
 *   - `Object.keys()` deduplicates, so every test that walks the registry --
 *     including the live Eurostat contract and the chart-vocabulary mirror --
 *     sees one entry and passes. The live contract passed against the WRONG
 *     definition, because the appended one was internally consistent.
 *   - `chartRef.test.ts`'s mirror is bidirectional and correct, and is blind
 *     here for a reason worth naming: the id was already served, so it was
 *     never a phantom. A guard can be right and still not cover this.
 *
 * So this reads the SOURCE, the only artefact where the two entries are still
 * distinguishable, and it reads it per declaration block rather than per file:
 * `pageMeta.js` holds four separate maps, and the same key appearing in two of
 * them is ordinary rather than a fault.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `createRequire`, not a bare `import`: `api/` is untyped JavaScript with no
// declaration file, so an ESM import fails the typecheck with TS7016 while
// vitest runs it happily. `chartRef.test.ts` reads the same registry the same
// way for the same reason -- a test that passes under the runner and fails
// under `tsc` breaks master without failing locally.
const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js') as Record<string, unknown>;

/**
 * Files under `api/shared/` that declare keyed registries.
 *
 * Listed rather than globbed. "A file declaring a registry" is not a property
 * a glob can check, and a glob that silently matched nothing would be this
 * file's own subject one level up.
 */
const FILES = [
  'api/shared/indicators.js',
  'api/shared/pageMeta.js',
  'api/shared/articleMeta.js',
] as const;

/**
 * Entry names per top-level `const NAME = {` block, in source order, keeping
 * duplicates.
 *
 * Per block, because a file may declare several unrelated maps and a name they
 * happen to share is not a collision. Blocks end at a line that is exactly
 * `};`, which is this repo's formatting for a top-level literal.
 */
function blocksIn(file: string): { name: string; keys: string[] }[] {
  const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/);
  const blocks: { name: string; keys: string[] }[] = [];
  let current: { name: string; keys: string[] } | null = null;

  for (const line of lines) {
    const opening = /^const ([A-Za-z0-9_]+)\s*=\s*\{\s*$/.exec(line);
    if (opening) {
      current = { name: opening[1], keys: [] };
      blocks.push(current);
      continue;
    }
    if (current && /^\};?\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const entry = /^ {2}([A-Za-z0-9_]+):/.exec(line);
      if (entry) current.keys.push(entry[1]);
    }
  }

  return blocks;
}

describe('a registry cannot define the same key twice', () => {
  for (const file of FILES) {
    it(`${file} defines each entry once`, () => {
      const blocks = blocksIn(file);

      // The control for the scan itself. A pattern that matched nothing would
      // report "no duplicates" forever, which is the same shape of failure as
      // the one under test.
      expect(blocks.length, `${file}: no registry blocks found, so this check is vacuous`)
        .toBeGreaterThan(0);
      expect(
        blocks.filter((block) => block.keys.length > 0).length,
        `${file}: every block scanned empty, so this check is vacuous`,
      ).toBeGreaterThan(0);

      const duplicated = blocks.flatMap(({ name, keys }) =>
        [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))].map(
          (key) => `${name}.${key}`,
        ),
      );

      expect(
        duplicated.sort(),
        'a repeated key is taken last with no error, so the earlier definition — ' +
          'its dataset, its pinned dimensions and its sanity band — is discarded ' +
          'silently and the registry serves a different statistic under the same name',
      ).toEqual([]);
    });
  }

  it('reads the indicator registry as the module itself sees it', () => {
    // The strongest control available, and only `indicators.js` can offer it:
    // it does `module.exports = INDICATORS`, so the loaded object IS the block.
    // The other two export several constants, and comparing a scanned block to
    // a module's top-level exports would be comparing different things.
    const block = blocksIn('api/shared/indicators.js').find((b) => b.name === 'INDICATORS');

    expect(block, 'the INDICATORS block was not found; the scan is reading something else')
      .toBeDefined();
    expect(
      [...new Set(block!.keys)].sort(),
      'the source scan and the loaded registry disagree about which indicators exist',
    ).toEqual(Object.keys(INDICATORS).sort());
  });
});
