#!/usr/bin/env node
/**
 * The seam sweep, applied recursively — and to itself.
 *
 * `AGENTS.md` describes taking the field names a producer writes, taking the
 * names a consumer reads, and diffing them. It reports the result across
 * "fourteen endpoints — 107 **top-level** fields". That qualifier is the whole
 * reason this script exists: `#231` added `freshness` to `/api/baltic-compare`
 * nested under `countries.<CC>`, one level down, where a top-level sweep cannot
 * see it. The population the guard walked was smaller than the population the
 * behaviour walks, which is the exact rule `AGENTS.md` states three instances
 * of (#149, #178, 389d1f9). This is a fourth, in the method that found them.
 *
 * WHAT IT DOES
 *   1. Fetches each endpoint's real response.
 *   2. Walks it recursively, recording every field with its path and depth.
 *      Arrays are walked through their first element; a `[]` marker in the path
 *      records that, so `countries.LV.series[].period` is legible as such.
 *   3. Counts readers in `src/**` and `tests/**` separately, because
 *      **a test is a consumer** — the sweep's first version called `assumptions`
 *      dead on two endpoints when two live tests fail if it is non-empty.
 *   4. Classifies: read by the app, read only by a test, or read by nothing.
 *
 * WHAT IT CANNOT DO, STATED SO THE NUMBER IS NOT OVER-TRUSTED
 * Matching is by leaf NAME, not by path — the same as the original sweep, kept
 * so the two are comparable. A generic name like `label` or `period` therefore
 * matches any reader of any field with that name. That error runs toward
 * "this field has a reader", i.e. toward NO FINDING, which is the dangerous
 * direction, so every name declared by more than one endpoint is reported as
 * `ambiguous` rather than silently counted as read.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SWEEP_BASE || 'https://portabaltica.naurolabs.com';
const REPO = process.env.REPO || process.cwd();

/** The JSON endpoints, with the parameters the API docs page states. */
const ENDPOINTS = [
  ['economy-data', '?country=lv'],
  ['environment-data', '?country=lv'],
  ['historical-data', '?indicator=gdp&years=5'],
  ['baltic-compare', '?indicator=gdp&years=5'],
  ['power-prices', ''],
  ['property-data', ''],
  ['port-data', '?country=LV'],
  ['business-search', '?q=SIA'],
  ['address-search', '?q=Riga'],
  ['eu-funds', ''],
  ['ai-insights', ''],
  ['system-status', ''],
  ['live-grid', ''],
  ['sea-state', ''],
];

export function walk(node, prefix, depth, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    // One element is enough: a homogeneous array declares the same names in
    // every entry, and walking all of them would multiply-count each name.
    if (node.length > 0) walk(node[0], prefix + '[]', depth, out);
    return;
  }
  for (const key of Object.keys(node)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.push({ name: key, path: p, depth: depth + 1, type: typeOf(node[key]) });
    walk(node[key], p, depth + 1, out);
  }
}

export function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Every source file that could read a field. `.tsx` included deliberately.
 *
 * The sweep's own files are excluded, and that is not tidiness. Measured: after
 * `tests/seamSweep.test.ts` was written, the three
 * `countries.<CC>.freshness.warnAfterMonths` orphans flipped to `test-only`,
 * because the test names the field in a fixture string and the matcher counted
 * it. **The instrument consumed its own subject** — a test *about* the sweep is
 * not a consumer of the API contract, and without this the sweep reports fewer
 * orphans the more thoroughly its own findings are documented.
 */
const SELF = ['seam-sweep.mjs', 'seam-sweep.d.mts', 'seamSweep.test.ts'];

function collect(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      collect(full, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !SELF.includes(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Comments stripped before matching, and it is not a refinement.
 *
 * The first version of this matcher used `\{[^}]*\bname\b[^}]*\}` for
 * destructuring. `[^}]*` spans newlines, so in a repo whose files carry more
 * prose than code it matched the field name **inside a comment** and reported a
 * reader that does not exist. Measured: `freshness.allowed` was classified
 * `test-only` on the strength of three files where `.allowed` never appears —
 * the word occurred in a comment about CSV export, a comment about the spacing
 * scale, and a comment about the rate limiter.
 *
 * That error inflates readers, which deflates orphans, which fails toward
 * "no finding here" — the direction `AGENTS.md` warns about, in the instrument
 * built to find exactly that class of fault.
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function readerCount(files, name) {
  // Anchored forms only. A destructuring or shorthand property is
  // `{ name`, `, name`, `name }` or `name:` — matched within a few characters
  // rather than across an unbounded span.
  const dot = new RegExp('\\.' + name + '\\b');
  const bracket = new RegExp('\\[\\s*[\'"]' + name + '[\'"]\\s*\\]');
  const destructure = new RegExp('[{,]\\s*' + name + '\\s*[,}:]');
  const keyed = new RegExp('[\'"]' + name + '[\'"]\\s*:');
  let n = 0;
  const where = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (dot.test(src) || bracket.test(src) || destructure.test(src) || keyed.test(src)) {
      n++;
      where.push(path.relative(REPO, f).replace(/\\/g, '/'));
    }
  }
  return { n, where };
}

/**
 * Reachability, and it is the correction that matters most here.
 *
 * Matching by leaf name cannot tell the payload's `countries.LV.freshness.stale`
 * from the client's own computed `stale` — and `src/` is full of the latter,
 * because `freshnessOf()` returns an object with the same field names. So the
 * name sweep reports `freshness.period` as read by 19 files while **nothing in
 * `src/` reads `.freshness` at all**: verified directly, zero occurrences, and
 * it is not declared in `src/api.ts` or `src/types.ts` either.
 *
 * A child cannot be reached through a parent nobody reads. So a field is
 * app-reachable only if every ancestor on its path is also app-read. Without
 * this the nested sweep is *worse* than the top-level one it replaces: it adds
 * hundreds of deep names and confidently marks them read on the strength of a
 * name collision with a sibling module — an under-count of orphans, which is
 * the direction that fails toward "no finding here".
 */
export function applyReachability(rows) {
  const byPath = new Map();
  for (const r of rows) byPath.set(r.endpoint + '|' + r.path, r);

  for (const r of rows) {
    const parts = r.path.split('.');
    let unreachableAt = null;
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('.');
      const a = byPath.get(r.endpoint + '|' + ancestorPath);
      if (a && a.srcReaders === 0) { unreachableAt = ancestorPath; break; }
    }
    r.unreachableVia = unreachableAt;
    r.effective = unreachableAt
      ? (r.testReaders > 0 ? 'test-only' : 'orphan')
      : r.verdict;
  }
  return rows;
}

async function main() {
  const srcFiles = collect(path.join(REPO, 'src'), []);
  const testFiles = collect(path.join(REPO, 'tests'), []);
  process.stderr.write(`consumer population: ${srcFiles.length} src, ${testFiles.length} tests\n`);

  const rows = [];
  const failed = [];

  for (const [ep, qs] of ENDPOINTS) {
    const url = `${BASE}/api/${ep}${qs}`;
    let body;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) { failed.push(`${ep} HTTP ${res.status}`); continue; }
      body = await res.json();
    } catch (e) {
      failed.push(`${ep} ${String(e.message || e).slice(0, 50)}`);
      continue;
    }
    const fields = [];
    walk(body, '', 0, fields);
    for (const f of fields) rows.push({ endpoint: ep, ...f });
    process.stderr.write(`  ${ep}: ${fields.length} fields\n`);
    await new Promise((r) => setTimeout(r, 400));
  }

  // How many distinct endpoints declare each name — the ambiguity measure.
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, new Set());
    byName.get(r.name).add(r.endpoint);
  }

  const cache = new Map();
  for (const r of rows) {
    if (!cache.has(r.name)) {
      cache.set(r.name, {
        src: readerCount(srcFiles, r.name),
        test: readerCount(testFiles, r.name),
      });
    }
    const c = cache.get(r.name);
    r.srcReaders = c.src.n;
    r.testReaders = c.test.n;
    r.srcWhere = c.src.where.slice(0, 3);
    r.testWhere = c.test.where.slice(0, 3);
    r.declaredBy = byName.get(r.name).size;
    r.verdict = c.src.n > 0 ? 'app' : c.test.n > 0 ? 'test-only' : 'orphan';
    r.ambiguous = c.src.n + c.test.n > 0 && byName.get(r.name).size > 1;
  }

  applyReachability(rows);

  console.log(JSON.stringify({ base: BASE, failed, rows }, null, 1));
}

// Only sweep when run directly. Importing this from a test must not fire
// fourteen network requests.
if (process.argv[1] && process.argv[1].endsWith('seam-sweep.mjs')) {
  main();
}
