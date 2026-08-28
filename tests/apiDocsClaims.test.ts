import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The API docs page states numbers about the API. Nothing checked them.
 *
 * Measured on 2026-08-28, live, against the deployed endpoints:
 *
 *   page said "across 55 indicators" for /api/baltic-compare
 *   ?list=1 returned                 71
 *
 *   page listed "CSV data export" as a Pro (EUR 15/month) feature marked
 *   "Coming soon" -- ninety minutes after CSV and JSON export shipped free to
 *   everyone in #187, on the very surfaces this page documents.
 *
 * Neither is a rendering bug and no design or typography check can see either.
 * They are *claims*, and a claim on a public pricing page is a promise. This
 * repo already treats published policy sentences that way and binds them to
 * the code with tests; a pricing page deserves the same, because the failure is
 * worse -- a reader is told to pay for something they already have.
 *
 * So the counts are asserted against the registries they describe rather than
 * maintained by hand. A number nobody checks is a number that drifts, and it
 * drifts silently in the direction of overstating what the product does.
 */

const PAGE = readFileSync(resolve('src/components/ApiDocsPage.tsx'), 'utf8');

/** Top-level keys of an object literal, counted by brace depth rather than by
 *  a line regex: `api/historical-data/index.js` nests four levels of PxWeb
 *  query objects, and every one of them has `code:`/`values:` keys that a flat
 *  grep would count as indicators. */
function topLevelKeys(source: string, declaration: RegExp): string[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => declaration.test(l));
  expect(start, `declaration ${declaration} not found`).toBeGreaterThanOrEqual(0);

  const keys: string[] = [];
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const before = depth;
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (before === 1) {
      const m = lines[i].match(/^\s{2}([a-z0-9_]+)\s*:/);
      if (m) keys.push(m[1]);
    }
    if (depth === 0 && i > start) break;
  }
  return keys;
}

describe('the API docs page states numbers that are true', () => {
  it('names the real size of the Baltic comparison catalogue', () => {
    const indicators = require(resolve('api/shared/indicators.js')) as Record<string, unknown>;
    const actual = Object.keys(indicators).length;

    const claimed = PAGE.match(/across (\d+) indicators/);
    expect(claimed, 'the baltic-compare description no longer states a count').not.toBeNull();
    expect(
      Number(claimed![1]),
      'the /api/baltic-compare description states a count that no longer matches api/shared/indicators.js',
    ).toBe(actual);

    expect(
      PAGE,
      'the Free tier states a Baltic indicator count that no longer matches the registry',
    ).toContain(`${actual} Baltic comparison indicators`);
  });

  it('names the real size of the Latvian historical registry', () => {
    const source = readFileSync(resolve('api/historical-data/index.js'), 'utf8');
    const actual = topLevelKeys(source, /^var INDICATORS = \{/).length;

    expect(
      PAGE,
      'the /api/historical-data description states a count that no longer matches its registry',
    ).toContain(`${actual} Latvian indicators`);
    expect(PAGE).toContain(`${actual} Latvian indicators from CSP PxWeb`);
  });

  it('does not sell a feature that is already free', () => {
    // The whole point. #187 shipped CSV and JSON export to every visitor, and
    // the Pro column went on advertising "CSV data export" as something to pay
    // for. Splitting on the Pro heading rather than searching the whole file,
    // because the words must still be allowed to appear in the Free column.
    const proStart = PAGE.indexOf('>Pro<');
    const proEnd = PAGE.indexOf('>Enterprise<');
    expect(proStart, 'the Pro tier heading moved').toBeGreaterThan(0);
    expect(proEnd, 'the Enterprise tier heading moved').toBeGreaterThan(proStart);
    const pro = PAGE.slice(proStart, proEnd);

    for (const shipped of [/CSV/i, /JSON export/i]) {
      expect(
        pro,
        `the Pro tier advertises ${shipped} as coming soon, but export shipped free in #187`,
      ).not.toMatch(shipped);
    }
  });

  it('does not describe full history as a paid upgrade', () => {
    // `?years=30` answers for everyone: measured live, unemployment returned 67
    // observations at years=5 and 367 at years=30, unauthenticated.
    const proStart = PAGE.indexOf('>Pro<');
    const proEnd = PAGE.indexOf('>Enterprise<');
    const pro = PAGE.slice(proStart, proEnd);
    expect(
      pro,
      'the Pro tier offers a longer history than Free, but ?years=30 is already unauthenticated',
    ).not.toMatch(/\d+\+?\s*day history/i);
  });

  it('lists exactly the indicators the historical endpoint serves', () => {
    // The page carries its own copy of the 24 names. That copy is what the
    // reader sees, so it is the one that has to be right -- and a duplicate
    // list is a second place the truth lives, which is how the count above
    // drifted in the first place.
    //
    // Compared as SETS, both ways, not by filtering the registry through the
    // page. The first version of this assertion did the latter, and it could
    // only ever see an omission: an id the page listed but the endpoint had
    // stopped serving passed silently, while the failure message claimed to
    // check both. That is a guard enumerating a smaller population than its
    // own subject, which AGENTS.md names as the quieter sibling of a guard
    // that reproduces its subject's logic.
    const source = readFileSync(resolve('api/historical-data/index.js'), 'utf8');
    const registry = topLevelKeys(source, /^var INDICATORS = \{/).sort();

    const block = PAGE.match(/const INDICATORS = \[([\s\S]*?)\];/);
    expect(block, 'the page no longer carries its own INDICATORS list').not.toBeNull();
    const listed = [...block![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();

    expect(
      listed,
      'the page lists indicator ids that api/historical-data no longer serves, or omits ones it does',
    ).toEqual(registry);
  });

  it('states the eu-funds sample size the endpoint actually returns', () => {
    // This claim said "955 projects" for months. The endpoint returns a
    // twenty-project sample and a separate total, and 955 was neither: the
    // live total measured 1682. It was missed when the three claims above
    // were pinned, which is this repo's own guard-population fault committed
    // inside the guard written against it — so the count is derived here
    // rather than restated.
    const source = readFileSync(resolve('api/eu-funds/index.js'), 'utf8');
    const slice = source.match(/\.slice\(0,\s*(\d+)\)/);
    expect(slice, 'api/eu-funds no longer slices a fixed sample').not.toBeNull();

    expect(
      PAGE,
      'the /api/eu-funds description states a sample size that no longer matches api/eu-funds/index.js',
    ).toContain(`the ${slice![1]} most recent projects`);
  });

  it('states no project total, because the total is upstream and would go stale silently', () => {
    // The rule the policy audit established: a published sentence that counts
    // is false the instant the thing it counts grows, so either drop the
    // number or bind it. `total` comes from data.gov.lv and no live check
    // covers it, so this one is dropped rather than bound.
    const line = PAGE.match(/'\/api\/eu-funds'[^\n]*/);
    expect(line, 'the eu-funds row is gone from the endpoint table').not.toBeNull();

    // Scope to the description: `cache: '1 hour'` is a number too, and the
    // first version of this assertion failed on it.
    const description = line![0].match(/description:\s*'([^']*)'/);
    expect(description, 'the eu-funds row no longer carries a description').not.toBeNull();

    const counts = description![1].match(/\b\d[\d,]*\b/g) ?? [];
    expect(
      counts,
      'the eu-funds description states a project total; it varies upstream and nothing checks it',
    ).toEqual(['20']);
  });
});
