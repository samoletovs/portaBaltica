import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every route a reader can reach, derived from the router and the navigation
 * rather than listed by hand.
 *
 * #169 replaced the overflow sweep's four-route list with a carefully chosen
 * seventeen, and that list is better than the one before it in every respect
 * except one: it is still a list. The defect that produced it was a list going
 * stale — four routes chosen correctly for the ticker, then left standing while
 * the app grew to sixteen — and a fresh list has the same future.
 *
 * A list also drifts in *both* directions, which is easy to miss. Compared
 * against the router and the nav, the seventeen contain `/data/overview`, which
 * is not a section: `VALID_SECTIONS` in `App.tsx` has no `overview`, so the
 * route falls back to `'all'`, the sweep measures `/data` a second time under a
 * different name, and a green result names a page that was never rendered.
 *
 * So this derives, and `routeCoverage.test.ts` compares. The hand-written list
 * stays — it carries `/indicator/gdp`, a parameterised route with a real id
 * that no derivation can invent — but it may no longer silently miss a route or
 * name one that does not exist.
 *
 * "Navigable" here means **renders its own content**, which is narrower than
 * "resolves". Parameterised routes are excluded because an invented id renders
 * a not-found page, and declared redirects are excluded because they render
 * somebody else's page: `/correspondents` is a `<Navigate to="/newsroom">`, so
 * measuring it would be the same redundancy as `/data/overview`, reached
 * deliberately rather than by accident. A set that included either would make
 * the sweep slower and no more thorough.
 */

/** Routes declared in the router that render their own content. */
export function routerRoutes(): string[] {
  const source = readFileSync(resolve('src/main.tsx'), 'utf8');
  const found = new Set<string>(['/']); // the index route has no `path`

  for (const match of source.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const [, path, element] = match;

    // A `:param` route needs a real slug or id, and an invented one renders a
    // not-found page — which cannot overflow, so including it blind would add a
    // pass for the wrong reason rather than coverage. The sweep names concrete
    // ones itself.
    if (path.includes(':')) continue;

    // A redirect renders no content of its own: visiting `/correspondents`
    // measures `/newsroom` under a different label. Listing it would be the
    // same redundancy `/data/overview` is, arrived at deliberately instead of
    // by accident — so the derivation means "routes that render their own
    // content", which is the set the sweep actually needs.
    if (/\bNavigate\b|Redirect\b/.test(element)) continue;

    found.add(path);
  }

  return [...found].sort();
}

/** Dashboard sections, from the navigation a reader actually clicks. */
export function sectionRoutes(): string[] {
  const source = readFileSync(resolve('src/components/Header.tsx'), 'utf8');
  const block = source.match(/const SECTIONS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error('SECTIONS not found in Header.tsx — the derivation is broken');

  return [...block[1].matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * The section ids the dashboard will actually honour.
 *
 * `/data/:section?` matches anything, and `App.tsx` falls back to `'all'` for a
 * section it does not recognise — so an unknown section renders the overview
 * silently rather than a not-found. That is a reasonable thing for the app to
 * do and a trap for anything that lists routes: `/data/overview` looks like a
 * distinct page and is not one.
 *
 * This reads the `DASHBOARD_SECTIONS` **value**, not the `DashboardSection`
 * type, because the value is now what `App.tsx` and `main.tsx` both branch on
 * and the type is derived from it. Reading the type would still work and would
 * be measuring the wrong artefact — a type cannot decide what renders.
 *
 * The emptiness check is not decoration. The previous version scraped quoted
 * strings out of the type alias, and against a derived type
 * (`typeof DASHBOARD_SECTIONS[number]`) that regex still *matches* and finds no
 * quotes — so it would have returned `[]`, and an empty expected-set makes
 * every comparison against it pass. Absence has to be an error here, because
 * absence is indistinguishable from agreement.
 */
export function validSections(): string[] {
  const source = readFileSync(resolve('src/sections.ts'), 'utf8');
  const block = source.match(/export const DASHBOARD_SECTIONS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!block) throw new Error('DASHBOARD_SECTIONS not found in sections.ts — the derivation is broken');

  const found = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (found.length === 0) {
    throw new Error('DASHBOARD_SECTIONS parsed to an empty list — the derivation is broken');
  }
  return found;
}

/**
 * Routes the router declares only to send the reader somewhere else.
 *
 * `routerRoutes()` skips these because they render nobody's content of their
 * own. They are worth naming separately because a *sitemap* must not list them:
 * a redirect's destination declares its own canonical, so advertising the old
 * form tells a search engine to index a URL the landing page disowns.
 */
export function redirectRoutes(): string[] {
  const source = readFileSync(resolve('src/main.tsx'), 'utf8');
  const found: string[] = [];

  for (const match of source.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const [, path, element] = match;
    if (/\bNavigate\b|Redirect\b/.test(element)) found.push(path);
  }

  if (found.length === 0) {
    throw new Error('no redirect routes parsed from main.tsx — the derivation is broken');
  }
  return found.sort();
}

/**
 * The full navigable set.
 *
 * Both sources are needed and neither is sufficient: `/data/:section?` is one
 * router entry and eleven destinations, so the router alone under-counts the
 * dashboard by ten, and the nav has no entry for `/api-docs` at all.
 */
export function navigableRoutes(): string[] {
  return [...new Set([...routerRoutes(), ...sectionRoutes()])].sort();
}
