import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { finite, fixed, list } from '../src/utils/payload';

/**
 * Reading a payload that may not be the shape it claims.
 *
 * Four page-level failures came from `!data` standing in for validating what
 * actually arrived, and two of them did something worse than crash: they
 * rendered a value nobody measured. `AQI_STYLES.good` was the fallback for an
 * unrecognised air-quality status, so a failed fetch said the air was clean;
 * `classifySeaState` ended a chain of `<` with a bare `return`, and every one
 * of those comparisons is false for `NaN`, so a missing wave height said the
 * sea was "Very Rough". Opposite defaults, same defect.
 */
describe('list', () => {
  it('passes a real array through untouched', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(list(rows)).toBe(rows);
  });

  it('turns every not-an-array into nothing to draw', () => {
    for (const value of [undefined, null, 0, '', 'abc', {}, Number.NaN, true]) {
      expect(list(value), `${JSON.stringify(value)} should yield []`).toEqual([]);
    }
  });

  it('does not invent a row', () => {
    // The failure mode being prevented is a *plausible* default. An empty list
    // renders as "nothing to show", which is true; a one-element default would
    // render as data.
    expect(list(undefined)).toHaveLength(0);
  });
});

describe('finite', () => {
  it('accepts a real reading, including a genuine zero', () => {
    expect(finite(0)).toBe(0);
    expect(finite(-12.5)).toBe(-12.5);
    expect(finite(84_748)).toBe(84_748);
  });

  it('rejects the values that arrive from an absent field', () => {
    // NaN and Infinity are what arithmetic on a missing field produces. They
    // format as "NaN" or divide a layout by zero, and neither came from a
    // source.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(finite(value)).toBeNull();
    }
  });

  it('rejects a number-shaped string rather than coercing it', () => {
    // Coercion here would paper over an upstream contract change: a field that
    // silently became a string is a thing we want to notice, not absorb.
    expect(finite('42')).toBeNull();
    expect(finite(null)).toBeNull();
    expect(finite(undefined)).toBeNull();
  });

  it('never answers zero for a missing value', () => {
    // "Suspended activities: 0" survived on this dashboard as a confident
    // answer produced by a 404. Zero is a reading.
    expect(finite(undefined)).not.toBe(0);
    expect(finite(null)).not.toBe(0);
  });
});

describe('fixed', () => {
  it('formats a real number to the requested precision', () => {
    expect(fixed(82.4, 2)).toBe('82.40');
    expect(fixed(0, 1)).toBe('0.0');
  });

  it('renders an absent value as a dash, never as a number', () => {
    // DESIGN.md §3.8: where a value is unavailable, render "—", never 0.
    for (const value of [undefined, null, Number.NaN]) {
      expect(fixed(value, 2)).toBe('—');
    }
  });
});

// ─── the sweep ─────────────────────────────────────────────────────────────

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the components fed by an upstream', () => {
  /** Components that receive a payload the network produced. */
  const API_FED = [
    'PropertyTile.tsx',
    'EnvironmentTile.tsx',
    'EconomyTile.tsx',
    'BusinessTile.tsx',
    'DataTicker.tsx',
    'CargoPanel.tsx',
    'SystemStatusFooter.tsx',
  ];

  it('never calls an array method straight off a payload field', () => {
    // `!data` checks that something arrived, not that it has the field the
    // next line reads. This is the mechanical signature of that gap.
    const offenders: string[] = [];
    const risky = /\b(data|d|euFunds|status|searchResult|addrResult|measure|mix)\.([\w$]+)\.(map|slice|forEach|filter|reduce)\b/g;

    for (const file of sourceFiles()) {
      if (!API_FED.includes(file.split(/[\\/]/).pop()!)) continue;
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const match of text.matchAll(risky)) {
        offenders.push(`${file.replace(/\\/g, '/')}: ${match[0]}`);
      }
    }

    expect(offenders, 'wrap the field in list() so an absent one renders as empty').toEqual([]);
  });

  it('never calls a number method straight off a payload field', () => {
    const offenders: string[] = [];
    const risky = /\b(data|d|euFunds|status|searchResult|addrResult|rate|w|aq)\.([\w$]+)\.(toFixed|toLocaleString)\b/g;

    for (const file of sourceFiles()) {
      if (!API_FED.includes(file.split(/[\\/]/).pop()!)) continue;
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const match of text.matchAll(risky)) {
        offenders.push(`${file.replace(/\\/g, '/')}: ${match[0]}`);
      }
    }

    expect(offenders, 'use fixed()/finite() so an absent one renders as a dash').toEqual([]);
  });
});

describe('a comparison chain that classifies a reading', () => {
  it('rejects a non-number before it starts comparing', () => {
    // Every `<` is false for NaN, so a chain that ends in a bare `return`
    // hands its last branch to exactly the values it never measured. The guard
    // has to come first, not last.
    const types = readFileSync(resolve('src/types.ts'), 'utf8');
    const fn = types.slice(types.indexOf('export function classifySeaState'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    const guardAt = body.indexOf('Number.isFinite');
    const firstComparison = body.indexOf('<');
    expect(guardAt, 'classifySeaState must reject a non-number').toBeGreaterThan(-1);
    expect(guardAt, 'the guard must precede the first comparison').toBeLessThan(firstComparison);
  });
});

describe('what renders outside the per-section error boundaries', () => {
  it('is only what cannot take the page down', () => {
    // App wraps each section in its own boundary, so a tile that throws costs
    // one tile. Anything rendered *outside* those wrappers has the whole page
    // as its blast radius — and SystemStatusFooter, the component whose job is
    // to report an outage, was there and unguarded.
    const app = stripComments(readFileSync(resolve('src/App.tsx'), 'utf8'));
    const footer = stripComments(readFileSync(resolve('src/components/SystemStatusFooter.tsx'), 'utf8'));

    expect(app, 'the footer still renders outside a Section').toMatch(/<SystemStatusFooter \/>/);
    expect(
      footer,
      'so it has to validate the shape it got, not just that it got something',
    ).toMatch(/typeof counts\.healthy !== 'number'/);
  });
});
