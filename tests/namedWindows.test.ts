/**
 * A constant that names a window must govern it.
 *
 * `api/live-grid` declared `GRACE_MS = 30 * 60 * 1000` and then handed
 * `withCache` a bare `1800000`. The two agreed, so nothing looked wrong — and
 * the constant was inert: setting it to zero changed nothing a reader would
 * experience, because the literal in the options still granted the full thirty
 * minutes. The layer a reader's outage actually passes through was governed by
 * the copy without the explanatory name.
 *
 * That was found by accident: a planted fault reported "not load-bearing"
 * rather than red. This is the standing version, so the next one fails when it
 * is written.
 *
 * **A named constant that does not control what it names is worse than a magic
 * number**, because it invites the reasoning that costs the time — read the
 * constant, believe the behaviour.
 *
 * Only values of 1000 or more are considered. A literal `0`, `1` or `100`
 * matching some constant is coincidence, not duplication, and flagging those
 * would make this wallpaper.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const API = resolve('api');

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const DECL = /^\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*([0-9][0-9_\s*+/.-]*[0-9])\s*;/gm;

function evalNum(expr: string): number | null {
  if (!/^[0-9_\s*+/.()-]+$/.test(expr)) return null;
  try { return Function('"use strict";return (' + expr + ')')() as number; } catch { return null; }
}

/** Every place a file restates one of its own named constants as a bare literal. */
export function restatements(source: string): Array<{ name: string; value: number; line: number }> {
  const consts: Array<{ name: string; value: number }> = [];
  let m: RegExpExecArray | null;
  DECL.lastIndex = 0;
  while ((m = DECL.exec(source)) !== null) {
    const v = evalNum(m[2]);
    if (v !== null && Math.abs(v) >= 1000) consts.push({ name: m[1], value: v });
  }
  if (consts.length === 0) return [];

  const found: Array<{ name: string; value: number; line: number }> = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(?:\/\/|\*)/.test(line)) return;              // a comment is not code
    DECL.lastIndex = 0;
    if (DECL.test(line)) { DECL.lastIndex = 0; return; }   // the declaration itself
    DECL.lastIndex = 0;
    for (const c of consts) {
      const re = new RegExp('(?<![\\w.])' + String(c.value) + '(?![\\w.])');
      if (re.test(line) && !line.includes(c.name)) {
        found.push({ name: c.name, value: c.value, line: i + 1 });
      }
    }
  });
  return found;
}

function sites(): string[] {
  const out: string[] = [];
  for (const file of jsFiles(API)) {
    const rel = relative(API, file).replace(/\\/g, '/');
    for (const r of restatements(readFileSync(file, 'utf8'))) out.push(rel + ':' + r.name);
  }
  return out.sort();
}

describe('a constant that names a window governs it', () => {
  it('finds no endpoint restating its own named constant as a literal', () => {
    // An equality against the empty set rather than a filter, so a new
    // duplication fails here instead of being absorbed. If one is ever
    // legitimate, it belongs in this list with the sentence that says why.
    expect(sites(),
      'a bare literal equal to a named constant is a second copy that can drift, '
      + 'and the copy without the name is usually the one that governs')
      .toEqual([]);
  });

  it('catches the shape that shipped, so the silence above means something', () => {
    // Verbatim from `api/live-grid/index.js` before #281. Without this the
    // assertion above would pass on a scanner that found nothing ever.
    const shipped = [
      'const TTL_MS = 5 * 60 * 1000;',
      'const GRACE_MS = 30 * 60 * 1000;',
      'module.exports = withSecurity(withCache(handler, {',
      '  ttlMs: 300000,',
      '  graceMs: 1800000,',
      '}));',
    ].join('\n');

    expect(restatements(shipped).map((r) => r.name).sort()).toEqual(['GRACE_MS', 'TTL_MS']);
  });

  it('does not fire on a constant that is used, or on small coincidences', () => {
    // The fixed form: the constant is passed, so there is no second copy.
    expect(restatements([
      'const GRACE_MS = 30 * 60 * 1000;',
      '  graceMs: GRACE_MS,',
    ].join('\n'))).toEqual([]);

    // Two windows that are deliberately different numbers are not a
    // duplication — `environment-data` caches one Open-Meteo answer for ten
    // minutes and the assembled response for fifteen.
    expect(restatements([
      'const WEATHER_TTL_MS = 10 * 60 * 1000;',
      '  ttlMs: 900000,',
    ].join('\n'))).toEqual([]);

    // A small literal that happens to match is coincidence, not a second copy.
    expect(restatements([
      'const RETRIES = 100;',
      '  const pct = value * 100;',
    ].join('\n'))).toEqual([]);
  });
});
