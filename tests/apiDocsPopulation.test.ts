import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * The API docs page must not advertise an endpoint that does not exist, and
 * must not omit one a reader is meant to call.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * `ApiDocsPage.tsx` carries a hand-written list of endpoints. `api/` carries
 * the endpoints. Nothing compared them, so the two enumerated the same subject
 * separately — the shape `AGENTS.md` names as "two enumerations always drift,
 * and the drift is silent in the direction that reports success".
 *
 * It had already drifted. Measured on master at `f4607d4`:
 *
 *     api/ directories with an index.js : 20
 *     documented on /api-docs           : 12
 *     documented but nonexistent        : 0
 *
 * Among the eight was `data-export` — the endpoint that exists so a reader can
 * `curl` a series or point a spreadsheet at it. It returned 200 in production
 * and was named nowhere on the page whose entire job is to tell people what to
 * call. A feature nobody can discover is the producer/consumer seam this
 * repository keeps paying for, arriving in the one place where the consumer is
 * a person.
 *
 * WHY AN ALLOW-LIST AND NOT AN EQUALITY
 * -------------------------------------
 * Not every directory under `api/` is a public data endpoint, and an equality
 * would fail every run for reasons nobody should have to re-litigate:
 *
 *   - `news-rss`, `news-jsonfeed`, `news-sitemap` are served at `/rss.xml`,
 *     `/feed.json` and `/sitemap.xml`. They are reader-facing, but as feeds at
 *     their own addresses rather than as things to call with parameters.
 *   - `article-page` and `page-shell` are server-side rendering helpers. A
 *     reader never calls them; the rewrite does.
 *
 * So the undocumented set is stated as an equality against a named list, per
 * `AGENTS.md`: **state the exemption as an equality against the full set, not
 * as a subtraction from it**. Add an endpoint and this fails until you either
 * document it or say here, in one line, why a reader would never call it.
 * Delete one and it fails too, which is what stops the list fossilising.
 */

const API_DIR = resolve('api');
const DOCS = resolve('src/components/ApiDocsPage.tsx');

/**
 * Endpoints that exist and are absent from the docs page, each with its reason.
 *
 * Two distinct kinds live here, and the distinction matters:
 *
 *   NOT A CALL — a reader receives the output without ever addressing it. A
 *   feed at its own URL, or an SSR helper behind a rewrite. These are settled.
 *
 *   UNDECIDED — a public data endpoint that returns 200 and is not documented,
 *   where whether it *should* be is a product judgement nobody has made. These
 *   are recorded here rather than left silent, because an open question in a
 *   list that fails when it changes is visible, and an open question in nobody's
 *   head is not.
 *
 * "It is internal" is not a reason on its own — `page-shell` is internal
 * *because the rewrite calls it and a reader receives its output as the page
 * they asked for*.
 */
const NOT_A_DOCUMENTED_ENDPOINT = new Map<string, string>([
  // Not a call.
  ['news-rss', 'served at /rss.xml; a feed at its own address, not a call'],
  ['news-jsonfeed', 'served at /feed.json; a feed at its own address'],
  ['news-sitemap', 'served at /sitemap.xml; for crawlers, not readers'],
  ['article-page', 'SSR helper behind the /article/<slug> rewrite'],
  ['page-shell', 'SSR helper that serves the app shell with a page-specific head'],
]);

/** Every `api/<name>/index.js` — the endpoints that actually exist. */
function existingEndpoints(): string[] {
  return readdirSync(API_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(API_DIR, e.name, 'index.js')))
    .map((e) => e.name)
    .sort();
}

/** Every `/api/<name>` named in the docs page's endpoint table. */
function documentedEndpoints(): string[] {
  const source = readFileSync(DOCS, 'utf8');
  const found = new Set<string>();
  for (const m of source.matchAll(/path:\s*'\/api\/([a-z-]+)'/g)) found.add(m[1]);
  return [...found].sort();
}

describe('the API docs page and the API agree', () => {
  it('reads both sides, and neither is silently empty', () => {
    // Guard the guard. Either side returning nothing would make every
    // comparison below pass against nothing, which is the failure this file
    // exists to prevent one level down.
    expect(existingEndpoints().length, 'no endpoints found under api/').toBeGreaterThan(10);
    expect(documentedEndpoints().length, 'no endpoints parsed from ApiDocsPage').toBeGreaterThan(10);
  });

  it('documents no endpoint that does not exist', () => {
    const existing = new Set(existingEndpoints());
    const ghosts = documentedEndpoints().filter((name) => !existing.has(name));

    expect(ghosts, 'the docs page advertises an endpoint with no api/<name>/index.js behind it')
      .toEqual([]);
  });

  it('omits exactly the endpoints declared as not-a-call, and no others', () => {
    const documented = new Set(documentedEndpoints());
    const undocumented = existingEndpoints().filter((name) => !documented.has(name));

    // An equality, not a subtraction: this fails when an endpoint is added and
    // left undocumented, AND when a declared exemption stops existing.
    expect(
      undocumented.sort(),
      'an endpoint exists that the docs page does not name. Document it, or add it to ' +
        'NOT_A_DOCUMENTED_ENDPOINT with the reason a reader would never call it.',
    ).toEqual([...NOT_A_DOCUMENTED_ENDPOINT.keys()].sort());
  });

  it('gives every exemption a reason worth reading', () => {
    for (const [name, reason] of NOT_A_DOCUMENTED_ENDPOINT) {
      expect(reason.length, `${name} is exempt with no reason given`).toBeGreaterThan(20);
    }
  });

  it('names data-export, because a reader cannot curl what is not written down', () => {
    // The instance that prompted this file. Pinned by name rather than left to
    // the equality above, so deleting the row is a deliberate act with a
    // failing test attached rather than a quiet omission.
    expect(documentedEndpoints()).toContain('data-export');

    const source = readFileSync(DOCS, 'utf8');
    expect(source, 'the export entry should state its parameters').toContain('format=csv|json');
  });
});
