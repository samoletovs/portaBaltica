import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Two indicator registries share an id space, and nothing stopped one being
 * served under the other's title.
 *
 *   api/historical-data/index.js   24 Latvian series from CSP PxWeb
 *   api/shared/indicators.js       71 Baltic series from Eurostat
 *
 * Fourteen ids exist in both. Nine of those fourteen name *different
 * statistics*, measured 2026-08-28:
 *
 *   salary            "Average Gross Salary"        vs "Hourly labour cost"
 *   building_permits  "New buildings started"       vs "Building permits"
 *   wages_it          "Wages: IT sector"            vs "Labour cost: IT sector"
 *   exports           "Exports (seasonally adjusted)" vs "Exports of goods"
 *
 * A permit is issued before a start and many never become one. A labour cost
 * includes employer contributions a wage does not. These are not synonyms.
 *
 * The mechanism that could serve one as the other already exists:
 * `eurostatFallback` on a PxWeb definition, used when the national table is
 * unavailable or stale. Four are declared today and all four are sound. But
 * adding `eurostatFallback: 'building_permits'` -- one line, obviously correct
 * to anyone reading the ids rather than the titles -- would render Eurostat
 * *permits* under the heading "New buildings started", with a real number, a
 * real source line and a real date.
 *
 * That exact failure has shipped in this repository before, one layer down: a
 * cache keyed on a URL that ignored query parameters served one metric's
 * payload under another metric's label, and five articles published genuine
 * Eurostat figures attached to statistics they did not measure -- including a
 * piece headlined "bankruptcy declarations" carrying the *registrations*
 * value, which means the opposite thing about an economy. Every editorial gate
 * passed, because the figures were real and traceable. `AGENTS.md` records the
 * lesson as: **the contract protects figures, not subjects.**
 *
 * So the pairing is declared here rather than left to whoever next reads two
 * matching ids, and it is declared as an EQUALITY over the whole overlap. A
 * filter -- "these known ones are allowed to differ, ignore them" -- would go
 * on passing forever once a pair was reconciled, and would say nothing when a
 * fifteenth shared id appeared. An equality fails the day the overlap changes,
 * in either direction, which is the only thing that gets a list like this
 * pruned.
 */

const PXWEB_SOURCE = readFileSync(resolve('api/historical-data/index.js'), 'utf8');
const EUROSTAT = require(resolve('api/shared/indicators.js')) as Record<
  string,
  { title: string; unit?: string }
>;

interface PxWebDefinition {
  id: string;
  title: string | null;
  unit: string | null;
  fallback: string | null;
}

/**
 * Parsed by brace depth rather than by a line regex: this file nests four
 * levels of PxWeb query objects, and every one carries `code:` and `values:`
 * keys that a flat grep counts as indicators.
 */
function pxwebDefinitions(): PxWebDefinition[] {
  const lines = PXWEB_SOURCE.split(/\r?\n/);
  const start = lines.findIndex((l) => /^var INDICATORS = \{/.test(l));
  expect(start, 'the PxWeb INDICATORS declaration moved').toBeGreaterThanOrEqual(0);

  const found: PxWebDefinition[] = [];
  let current: PxWebDefinition | null = null;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const before = depth;
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (before === 1) {
      const m = lines[i].match(/^\s{2}([a-z0-9_]+)\s*:/);
      if (m) {
        current = { id: m[1], title: null, unit: null, fallback: null };
        found.push(current);
      }
    }
    if (current) {
      const title = lines[i].match(/title: '([^']*)'/);
      if (title) current.title ??= title[1];
      const unit = lines[i].match(/unit: '([^']*)'/);
      if (unit) current.unit ??= unit[1];
      const fallback = lines[i].match(/eurostatFallback: '([^']*)'/);
      if (fallback) current.fallback = fallback[1];
    }
    if (depth === 0 && i > start) break;
  }
  return found;
}

/**
 * Shared ids where the two registries measure the same thing, so one may
 * legitimately stand in for the other. Cosmetic wording differences only.
 */
const SAME_STATISTIC = new Set([
  'gdp',
  'unemployment',
  'house_prices',
  'population',
  'gov_revenue',
  'industrial', // "Industrial Production Growth" / "Industrial production"
  'ppi', // "Producer prices (PPI)" / "Producer prices"
]);

/**
 * Shared ids that name *different* statistics. Each must say why, because the
 * reason is the whole content of the entry -- a reader who cannot see the
 * difference is exactly the reader who would wire a fallback between them.
 */
const DIFFERENT_STATISTIC = new Map([
  ['salary', 'a gross monthly wage is not an hourly labour cost, which includes employer contributions'],
  ['wages_it', 'same distinction, one sector down'],
  ['building_permits', 'a permit is issued before a start, and many permits never become one'],
  ['exports', 'the PxWeb series is all exports; the Eurostat one is goods only'],
  ['imports', 'the PxWeb series is all imports; the Eurostat one is goods only'],
  ['trade_balance', 'the Eurostat series is goods and services together; the PxWeb one is not'],
  ['hotel_occupancy', 'occupancy of establishments against net occupancy of bed places'],
]);

describe('the two indicator registries share an id space', () => {
  it('accounts for every id that exists in both, as an equality', () => {
    const shared = pxwebDefinitions()
      .map((d) => d.id)
      .filter((id) => Object.hasOwn(EUROSTAT, id))
      .sort();

    const declared = [...SAME_STATISTIC, ...DIFFERENT_STATISTIC.keys()].sort();

    expect(
      shared,
      'an id now exists in both registries without being classified as the same statistic or a different one. ' +
        'Decide which it is and add it, because the answer determines whether a Eurostat fallback may be wired to it.',
    ).toEqual(declared);
  });

  it('never lets a Eurostat fallback point at a different statistic', () => {
    const offenders = pxwebDefinitions()
      .filter((d) => d.fallback !== null)
      .filter((d) => DIFFERENT_STATISTIC.has(d.fallback!))
      .map((d) => `${d.id} -> ${d.fallback}: ${DIFFERENT_STATISTIC.get(d.fallback!)}`);

    expect(
      offenders,
      'a PxWeb indicator falls back to a Eurostat series that measures something else. ' +
        'The number will be real, the source line will be right, and the title will be a lie.',
    ).toEqual([]);
  });

  it('points every declared fallback at a Eurostat indicator that exists', () => {
    // A fallback naming a missing id fails only when the national table goes
    // stale -- which is the moment nobody is watching, and the moment the
    // fallback exists for.
    const broken = pxwebDefinitions()
      .filter((d) => d.fallback !== null && !Object.hasOwn(EUROSTAT, d.fallback!))
      .map((d) => `${d.id} -> ${d.fallback} (no such Eurostat indicator)`);

    expect(broken, 'a eurostatFallback names an indicator that does not exist').toEqual([]);
  });

  it('has fallbacks at all, so the checks above are not vacuous', () => {
    // Without this, deleting every `eurostatFallback` in the file would turn
    // both assertions above green while removing the behaviour they guard.
    // AGENTS.md: an assertion that something is absent needs a companion
    // proving it could have been present.
    const withFallback = pxwebDefinitions().filter((d) => d.fallback !== null);
    expect(withFallback.length, 'no PxWeb indicator declares a Eurostat fallback any more').toBeGreaterThan(0);
    for (const d of withFallback) {
      expect(SAME_STATISTIC.has(d.fallback!) || d.fallback !== d.id, `${d.id} fallback`).toBe(true);
    }
  });
});
