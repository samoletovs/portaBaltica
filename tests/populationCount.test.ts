/**
 * A page is not a population.
 *
 * Two endpoints published the size of what they fetched as the size of what
 * exists, and both reached a reader:
 *
 *     /api/property-data    totalPermits   500  against    324,119
 *     /api/business-search  totalMatches    50  against        904
 *
 * Both were found by sweeping every endpoint for `total = something.length` —
 * "enumerate the consumers", applied to a shared *pattern* rather than a shared
 * input. That sweep found two defects and cleared three sites. This is the
 * standing version of it, so the next one is caught when it is written rather
 * than when somebody remembers to look.
 *
 * The shape is deliberately narrow, and both narrowings came from measurement:
 *
 *   - the field name must END with the claim, because `countryOnly` contains
 *     "count" inside "country" and is not a count of anything;
 *   - the length must be STORED, not compared, because `portCodes.length === 0`
 *     asks a question where `total: rows.length` publishes an answer.
 *
 * What it cannot know is whether the collection *is* the population — that
 * needs a human. So it does not judge; it names every site, as an equality, and
 * a new one has to be added deliberately with a reason beside it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolved from the working directory, as the other file-reading suites here
// do — vitest runs from the repo root.
const API = resolve('api');

/**
 * Every `.js` under `api/`, walked recursively.
 *
 * Recursive rather than a flat `readdirSync`, because a guard that enumerates a
 * smaller set than its subject is unguarded in the gap while looking covered —
 * which is how `#178` slipped a whole directory.
 */
function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const CLAIMS = /\b(\w*(?:total|count|matches|size))\s*[:=]\s*([A-Za-z_$][\w$.]*)\.length\b(?!\s*(?:===?|!==?|[<>]))/gi;

function scan(source: string) {
  const found: Array<{ field: string; from: string }> = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    CLAIMS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLAIMS.exec(line)) !== null) found.push({ field: m[1], from: m[2] });
  }
  return found;
}

function sites(): string[] {
  const out: string[] = [];
  for (const file of jsFiles(API)) {
    const rel = relative(API, file).replace(/\\/g, '/');
    for (const hit of scan(readFileSync(file, 'utf8'))) {
      out.push(rel + ':' + hit.field + ':' + hit.from);
    }
  }
  return out.sort();
}

/**
 * Each of these counts a collection that IS its own population — not a page of
 * a larger one. Keyed on file, field and source rather than line number, so an
 * edit above does not invalidate the list.
 */
const COUNTING_ITS_OWN_POPULATION = [
  // The whole fetched series, not a page of it: `summarise` is handed the
  // series and reports how many of its points are non-null.
  'historical-data/index.js:count:valid',
  // A static array declared three lines above.
  'shared/airQuality.js:BAND_COUNT:EAQI_BANDS',
  // The correct pattern, and the one both defects should have called: the
  // datastore's own `total` when it gives one, the rows in hand only when it
  // does not.
  'shared/ckan.js:total:rows',
  // The codes present in the cube dimension this parsed.
  'shared/eurostat.js:optionCount:codes',
  // The checks this run actually performed, in every case.
  'system-status/index.js:optionalTotal:optionalResults',
  'system-status/index.js:requiredTotal:requiredResults',
  'system-status/index.js:total:API_ENDPOINTS',
  'system-status/index.js:total:results',
].sort();

describe('a page is not a population', () => {
  it('names every site that publishes a length as a count, as an equality', () => {
    // An equality, not a filter: a filter cannot notice that it has stopped
    // matching, and a new site would slip in unexamined. Adding an entry here
    // should mean writing the sentence that says why the collection is the
    // population.
    expect(sites(),
      'a new `total = x.length` needs a reason beside it: is x the population, or the page you fetched?')
      .toEqual(COUNTING_ITS_OWN_POPULATION);
  });

  it('matches the two that shipped, so the shape is not merely plausible', () => {
    // The claim "this pattern would have caught them" is testable, so it is
    // tested rather than asserted. Both lines are verbatim from the code that
    // reached production.
    expect(scan('    return { permits: permits, total: records.length };'))
      .toEqual([{ field: 'total', from: 'records' }]);
    expect(scan('        totalMatches: results.length,'))
      .toEqual([{ field: 'totalMatches', from: 'results' }]);
  });

  it('does not fire on a length that is asked about rather than published', () => {
    // `countryOnly` contains "count" inside "country", and the length is
    // compared rather than stored. Both are real lines from api/port-data.
    expect(scan('    const countryOnly = portCodes.length === 0;')).toEqual([]);
    expect(scan('    if (records.length === 0) break;')).toEqual([]);
    // A comment describing the defect is not the defect.
    expect(scan('    // this used to publish totalMatches: results.length')).toEqual([]);
  });

  it('reads every directory under api/, not just the top level', () => {
    // A guard that walks a smaller set than its subject is unguarded in the
    // gap while looking covered.
    const files = jsFiles(API).map((f) => relative(API, f).replace(/\\/g, '/'));
    expect(files.some((f) => f.startsWith('shared/'))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });
});
