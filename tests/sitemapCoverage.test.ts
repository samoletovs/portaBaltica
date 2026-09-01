/**
 * Does the sitemap know every route the app declares?
 *
 * WHAT WENT WRONG, AND WHY A LINE WOULD NOT HAVE FIXED IT
 * -------------------------------------------------------
 * `/newsroom` is in the site navigation, `main.tsx` routes it to
 * `CorrespondentPage`, it serves HTTP 200, it declares its own canonical — and
 * it was absent from the sitemap, while all five `/newsroom/{id}` pages
 * beneath it were listed by a loop three lines away. `/api-docs` was absent for
 * the same reason and nobody had noticed that one at all.
 *
 * The class, not the instance: a sitemap cannot report what it omits. Adding
 * two `add(...)` calls fixes today and leaves the next route to fall out in
 * exactly the same silence. So this asserts the two enumerations agree, in both
 * directions, and states the exclusions as an EQUALITY so that a new route
 * forces a decision instead of defaulting to absent.
 *
 * WHY A COMPILE-TIME CHECK RATHER THAN A SHARED VALUE
 * ---------------------------------------------------
 * The Function App is deployed from `api/` alone and cannot import from
 * `src/`, which is the constraint `api/shared/securityHeaders.js` already
 * records about `staticwebapp.config.json`. Two lists that cannot be one can at
 * least be required to agree.
 *
 * WHY NOT A LIVENESS PROBE
 * ------------------------
 * Because it cannot fail. Measured against production at 2026-08-28T13:09:32Z:
 *
 *     /indicator/definitely-not-an-indicator   HTTP 200
 *     /newsroom/not-a-person                   HTTP 200
 *     /data/not-a-section                      HTTP 200
 *     /utterly-invented-page                   HTTP 200
 *     /article/not-a-real-slug                 HTTP 404   <- the only real 404
 *
 * The SPA fallback answers 200 for anything that is not an article, so a
 * sitemap full of invented URLs would look perfectly healthy to any status
 * check — including Google's. The structural direction below is therefore the
 * only thing that can catch an invented entry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { DASHBOARD_SECTIONS } from '../src/sections';
import { CORRESPONDENTS } from '../src/newsroom/correspondents';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const SITE = 'https://portabaltica.naurolabs.com';

const sitemap = require(resolve(ROOT, 'api/news-sitemap/index.js')) as
  ((context: unknown, req: unknown) => Promise<void>) & {
    NOT_IN_SITEMAP: Record<string, string>;
    SECTIONS: string[];
    CORRESPONDENTS: string[];
    indicatorIds: () => string[];
  };

/** The registry the dashboard renders from, and the sitemap now derives from. */
const registry = require(resolve(ROOT, 'api/shared/indicators.js')) as Record<string, unknown>;

const mainSource = readFileSync(resolve(ROOT, 'src/main.tsx'), 'utf-8');

// ─── what the app routes ───────────────────────────────────────────────────

/**
 * Every path `main.tsx` declares, plus `/` for the index route.
 *
 * A regex over `<Route path="...">` is reading a syntactic declaration rather
 * than guessing at vocabulary, but it is still a parser and it can be defeated
 * — by routes built from an array, say. The anti-vacuity assertions below are
 * what stop it silently returning fewer routes and passing everything.
 */
function declaredRoutes(): string[] {
  const paths = [...mainSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  if (/<Route\s+index\b/.test(mainSource)) paths.push('/');
  return [...new Set(paths)];
}

/** `/data/:section?` and `/newsroom/:id` are templates; `/follow` is not. */
function isTemplate(path: string): boolean {
  return path.includes(':');
}

describe('the parser can actually see the routes', () => {
  // Guard the guard. Every assertion in this file is vacuous if `declaredRoutes`
  // returns nothing, and a regex that silently stops matching is exactly the
  // failure this suite exists to prevent one level down.
  it('finds a plausible number of routes', () => {
    expect(declaredRoutes().length).toBeGreaterThanOrEqual(12);
  });

  it('finds routes it is known to declare, of each shape', () => {
    const routes = declaredRoutes();

    expect(routes, 'the index route').toContain('/');
    expect(routes, 'a plain static route').toContain('/corrections');
    expect(routes, 'a templated route').toContain('/newsroom/:id');
    expect(routes, 'an optional-parameter route').toContain('/data/:section?');
  });
});

// ─── what the sitemap lists ────────────────────────────────────────────────

async function generate(): Promise<string[]> {
  const context: {
    res?: { status: number; body: string };
    log: ReturnType<typeof makeLog>;
  } = { log: makeLog() };

  // The handler reads the article index over the network. Articles are not what
  // this suite is about, so the fetch is stubbed at the module boundary.
  //
  // It reads the corrections log too, for `lastmod`: a corrected article was
  // modified on the day we corrected it, and used to be dated to its original
  // publication. That is stubbed empty here for the same reason — which URLs the
  // sitemap lists is this suite's subject, and a correction changes a `<lastmod>`
  // rather than a `<loc>`. `tests/feedCorrectionDates.test.ts` owns the date.
  const newsroom = require(resolve(ROOT, 'api/shared/newsroom.js')) as {
    fetchIndex: () => Promise<unknown[]>;
    fetchCorrections: () => Promise<Map<string, string>>;
  };
  const realFetchIndex = newsroom.fetchIndex;
  const realFetchCorrections = newsroom.fetchCorrections;
  newsroom.fetchIndex = async () => [
    { slug: 'a-published-article', tier: 'A', status: 'published', published_at: '2026-08-27T00:00:00Z' },
  ];
  newsroom.fetchCorrections = async () => new Map();

  try {
    await sitemap(context, { headers: { 'x-forwarded-for': '10.7.0.9' }, query: {}, url: '/api/news-sitemap' });
  } finally {
    newsroom.fetchIndex = realFetchIndex;
    newsroom.fetchCorrections = realFetchCorrections;
  }

  const body = context.res!.body;
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
}

function makeLog() {
  return Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} });
}

/**
 * Which declared route a listed URL came from, or `undefined` if none does.
 *
 * `/data/economy` resolves to `/data/:section?`, `/newsroom/nida` to
 * `/newsroom/:id`. This is what makes the "cannot invent entries" direction
 * possible: a listed URL matching no route has no business being submitted.
 *
 * Two things this got wrong first, both caught by the control below rather than
 * by reasoning:
 *
 *   - `/:section` is a legacy CATCH-ALL and matches every single-segment path,
 *     so `routeFor('/pricing-page-that-does-not-exist')` resolved happily and
 *     the whole orphan direction was inert for one-segment URLs. The caller
 *     therefore passes only the routes we would actually list.
 *   - returning the FIRST match made the answer depend on the order routes
 *     happen to appear in `main.tsx`. The most specific match — the one with
 *     the most literal segments — is the one React Router would pick, and it
 *     does not move when someone reorders the file.
 */
function routeFor(url: string, candidates: string[]): string | undefined {
  if (candidates.includes(url)) return url;
  const segments = url.split('/').filter(Boolean);

  const matches = candidates.filter((route) => {
    if (!isTemplate(route)) return false;
    const parts = route.split('/').filter(Boolean);
    const optional = parts.filter((p) => p.endsWith('?')).length;
    if (segments.length > parts.length || segments.length < parts.length - optional) return false;
    return parts.every((part, index) => {
      if (index >= segments.length) return part.endsWith('?');
      return part.startsWith(':') || part === segments[index];
    });
  });

  const literals = (route: string) =>
    route.split('/').filter((p) => p && !p.startsWith(':')).length;
  return matches.sort((a, b) => literals(b) - literals(a))[0];
}

/** The routes we would ever put in a sitemap: everything not excluded. */
function listableRoutes(): string[] {
  return declaredRoutes().filter((route) => !(route in sitemap.NOT_IN_SITEMAP));
}

describe('every route is listed, or declared absent on purpose', () => {
  it('states the exclusions as an equality, so a new route forces a decision', async () => {
    const routes = declaredRoutes();
    const listed = await generate();

    const unlisted = routes
      .filter((route) => !listed.some((url) => routeFor(url, routes) === route))
      .sort();

    // NOT a filter over `unlisted`. An equality: adding a route to main.tsx and
    // forgetting the sitemap turns this red, and so does removing an exclusion
    // whose reason has lapsed. A subtraction would pass in both cases, which is
    // how `/newsroom` and `/api-docs` went missing without anything noticing.
    expect(
      unlisted,
      'a route is missing from the sitemap and from NOT_IN_SITEMAP — list it or name it there, with the reason',
    ).toEqual(Object.keys(sitemap.NOT_IN_SITEMAP).sort());
  });

  it('gives every exclusion a stated reason', () => {
    for (const [path, reason] of Object.entries(sitemap.NOT_IN_SITEMAP)) {
      expect(typeof reason, `${path} has no reason`).toBe('string');
      expect(reason.length, `${path}'s reason is too short to be one`).toBeGreaterThan(20);
    }
  });

  it('excludes only routes that are actually declared', () => {
    // An exclusion for a route that no longer exists is a dead clause that
    // reads as a decision and guards nothing — the same shape as an exemption
    // list nobody prunes.
    const routes = declaredRoutes();

    for (const path of Object.keys(sitemap.NOT_IN_SITEMAP)) {
      expect(routes, `${path} is excluded but main.tsx does not declare it`).toContain(path);
    }
  });
});

describe('the sitemap cannot invent a URL', () => {  it('lists nothing that does not resolve to a route we would list', async () => {
    const listable = listableRoutes();
    const listed = await generate();

    expect(listed.length, 'nothing was generated, so this proves nothing').toBeGreaterThan(10);

    const orphans = listed.filter((url) => !routeFor(url, listable));

    // Measured: the SPA fallback answers HTTP 200 for `/utterly-invented-page`,
    // so no liveness probe can catch this. A URL that matches no route is one
    // we would be asking a crawler to index into a page that renders nothing.
    expect(orphans, 'these sitemap URLs match no route in main.tsx').toEqual([]);
  });

  it('would catch an invented URL', () => {
    // The control, and it earned its place: the first version of `routeFor`
    // resolved `/pricing-page-that-does-not-exist` to the legacy `/:section`
    // catch-all, which would have made the assertion above pass for any
    // single-segment URL anyone ever added.
    const listable = listableRoutes();

    expect(routeFor('/pricing-page-that-does-not-exist', listable)).toBeUndefined();
    expect(routeFor('/data/economy', listable)).toBe('/data/:section?');
    expect(routeFor('/newsroom/nida', listable)).toBe('/newsroom/:id');
    // Specificity, not file order: `/newsroom` is a static route of its own and
    // must not be answered by `/newsroom/:id` or by the catch-all.
    expect(routeFor('/newsroom', listable)).toBe('/newsroom');
  });
});

describe('the expansions come from the same lists the app uses', () => {
  it('expands /data/:section over exactly the dashboard sections', () => {
    // `src/sections.ts` exists because four hand-written copies of this list
    // once agreed and nothing made them agree. The sitemap is a fifth copy that
    // the Function App cannot import, so it is required to match instead.
    expect([...sitemap.SECTIONS].sort()).toEqual([...DASHBOARD_SECTIONS].sort());
  });

  it('expands /newsroom/:id over exactly the correspondents with pages', () => {
    // `CORRESPONDENTS` in src/ holds the five with `/newsroom/:id` pages. The
    // masthead roster adds the AI editor and the accountable publisher, neither
    // of which has a page, so this must not be built from that.
    expect([...sitemap.CORRESPONDENTS].sort()).toEqual(
      CORRESPONDENTS.map((c) => c.id).sort(),
    );
  });

  it('lists a section page for each of them, and the overview', async () => {
    const listed = await generate();

    for (const section of DASHBOARD_SECTIONS) {
      expect(listed, `/data/${section}`).toContain(`/data/${section}`);
    }
    expect(listed).toContain('/data');
  });

  it('expands /indicator/:id from the registry rather than from a copy', () => {
    // `SECTIONS` and `CORRESPONDENTS` above are hand-written copies held to an
    // equality, because the Function App cannot import from `src/`. It CAN
    // import from `api/shared/`, so this expansion needs no copy at all —
    // `indicatorIds()` reads the registry itself. A shared enumeration cannot
    // drift; two enumerations always will, and this file is where three of them
    // met: 24 in `IndicatorPage`, 71 in `chart-ref.ts`, 71 in the registry.
    expect(sitemap.indicatorIds()).toEqual(Object.keys(registry).sort());
    expect(sitemap.indicatorIds().length, 'the registry produced nothing').toBeGreaterThan(60);
  });

  it('lists a page for every indicator the dashboard serves', async () => {
    const listed = await generate();

    const missing = sitemap.indicatorIds().filter((id) => !listed.includes(`/indicator/${id}`));

    expect(missing, 'these indicators have no sitemap entry').toEqual([]);
  });
});

describe('a listed page has to claim to be a page', () => {
  /**
   * Every listed URL's component must set its own head.
   *
   * This is the check that would have caught the real defect underneath the
   * missing routes. Measured in a rendering Chromium against production at
   * 2026-08-28T13:12:28Z, before this change:
   *
   *     /data              canonical=/   DISOWNS ITSELF
   *     /data/economy      canonical=/   DISOWNS ITSELF     ... and 8 more
   *     /api-docs          canonical=/   DISOWNS ITSELF
   *     /indicator/salary  canonical=/   DISOWNS ITSELF
   *     /corrections       canonical=/corrections    self   <- control
   *
   * Ten of the twenty non-article URLs in our own sitemap were submitted for
   * indexing by a document declaring the home page as their canonical. The
   * sitemap said "index this"; the page said "index that instead". Nothing was
   * red, because a canonical is only ever read by machines that do not report
   * back.
   */
  const lazyImports = new Map(
    [...mainSource.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('([^']+)'\)/g)]
      .map((m) => [m[1], m[2]] as const),
  );
  const staticImports = new Map(
    [...mainSource.matchAll(/import\s*\{\s*(\w+)[^}]*\}\s*from\s*'([^']+)'/g)]
      .map((m) => [m[1], m[2]] as const),
  );

  /** The file that renders a route, from `element={<X ... />}`. */
  function componentFor(route: string): string | undefined {
    const pattern = new RegExp(
      `<Route\\s+(?:index\\s+)?path="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*element=\\{<(\\w+)`,
    );
    const name = mainSource.match(pattern)?.[1];
    if (!name) return undefined;
    const from = lazyImports.get(name) ?? staticImports.get(name);
    return from ? resolve(ROOT, 'src', from.replace(/^\.\//, '')) : undefined;
  }

  it('resolves a component file for every listed static route', async () => {
    // Anti-vacuity: the assertion below only means something for routes whose
    // component this actually found.
    const routes = declaredRoutes().filter((r) => !isTemplate(r) && r !== '/');
    const listed = await generate();
    const unresolved = routes
      .filter((r) => listed.includes(r))
      .filter((r) => !componentFor(r));

    expect(unresolved, 'could not find the component for these routes').toEqual([]);
  });

  it('requires each of them to set its own title and canonical', async () => {
    const routes = declaredRoutes().filter((r) => !isTemplate(r) && r !== '/');
    const listed = await generate();

    const silent = routes
      .filter((r) => listed.includes(r))
      .filter((r) => {
        const file = componentFor(r);
        return file ? !readFileSync(file, 'utf-8').includes('usePageMeta(') : false;
      });

    expect(
      silent,
      'these are in the sitemap but set no head of their own, so they inherit the shell canonical, which names the home page',
    ).toEqual([]);
  });

  it('holds for the dashboard, which is where it was broken', () => {
    // Named explicitly because `/data/:section?` is a template and so is skipped
    // by the route-driven assertion above — the ten URLs it produces were the
    // ten that disowned themselves, and a check that cannot see them is not a
    // check.
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf-8');

    expect(app, 'App.tsx must set the head for every /data URL').toContain('usePageMeta(');
    expect(app, 'and it must claim /data as its canonical, not inherit /').toMatch(
      /canonicalPath:[^\n]*\/data/,
    );
  });

  it('holds for the indicator pages, which are 71 of the 93', () => {
    // Same reason: `/indicator/:id` is a template, so the route-driven check
    // cannot see the URLs it produces — and they are now three quarters of the
    // non-article sitemap. Before this change all 71 declared the HOME PAGE as
    // canonical, so listing them would have submitted 71 duplicates of one page.
    const page = readFileSync(resolve(ROOT, 'src/components/IndicatorPage.tsx'), 'utf-8');

    expect(page, 'IndicatorPage must set its own head').toContain('usePageMeta(');
    expect(page, 'and claim its own URL, not inherit /').toMatch(
      /canonicalPath:[^\n]*\/indicator\//,
    );
  });

  it('withholds a URL that renders nothing from the index, since it cannot 404', () => {
    // `/indicator/not-a-real-indicator` answers HTTP 200 like every route on
    // this SPA — measured against production, `/utterly-invented-page` does
    // too — so a crawler has no status code to go on. `noindex` is the only
    // signal available, and the page has to send it on the dead-end branch.
    const page = readFileSync(resolve(ROOT, 'src/components/IndicatorPage.tsx'), 'utf-8');

    expect(page, 'the unknown-indicator branch must set index: false').toMatch(
      /index:\s*known/,
    );
  });
});

describe('every listed URL gets its head in the served bytes', () => {
  /**
   * The layer `usePageMeta` cannot reach.
   *
   * Measured against production on 2026-08-28, raw HTML with no JavaScript:
   * every non-article URL in this sitemap shipped the generic title and a
   * canonical naming the HOME PAGE. `usePageMeta` fixes the rendered document,
   * so Google is fine; X, Facebook, LinkedIn, Slack, WhatsApp and Bing are not,
   * because none of them execute JavaScript.
   *
   * So a sitemap entry is only worth as much as the bytes at that URL. This
   * asserts the two agree: everything we ask a crawler to index must have a
   * head the crawler can actually read.
   */
  const pageMeta = require(resolve(ROOT, 'api/shared/pageMeta.js')) as {
    metaFor: (path: string) => { title: string | null; index: boolean } | null;
  };

  interface SwaConfig { routes?: { route: string; rewrite?: string }[] }
  const swaRoutes = (): { route: string; rewrite?: string }[] =>
    (JSON.parse(
      readFileSync(resolve(ROOT, 'public/staticwebapp.config.json'), 'utf-8'),
    ) as SwaConfig).routes ?? [];

  it('has server-rendered meta for every non-article URL it lists', async () => {
    const listed = (await generate()).filter((url) => !url.startsWith('/article/'));

    expect(listed.length, 'nothing was listed, so this proves nothing').toBeGreaterThan(20);

    const generic = listed.filter((url) => {
      const meta = pageMeta.metaFor(url);
      return meta === null || meta.title === null;
    });

    expect(generic, 'these are in the sitemap but ship the generic head to a crawler').toEqual([]);
  });

  it('routes every one of them to the function that injects it', () => {
    // A head the function can build is worth nothing if the URL never reaches
    // the function. SWA takes the first matching route, so each family needs a
    // rule ahead of the catch-all.
    const routes = swaRoutes();
    const all = routes.map((r) => r.route);
    const catchAll = all.indexOf('/*');

    for (const route of ['/', '/data', '/data/*', '/indicator/*', '/newsroom', '/newsroom/*',
      '/follow', '/weekly', '/corrections', '/about/ai', '/api-docs']) {
      const index = all.indexOf(route);
      expect(index, `${route} has no rule`).toBeGreaterThanOrEqual(0);
      expect(routes[index].rewrite, `${route} rewrite`).toBe('/api/page-shell');
      expect(index, `${route} is behind the catch-all and never runs`).toBeLessThan(catchAll);
    }
  });

  it('leaves /article/* to its own function, ahead of everything', () => {
    // Two functions claiming one URL would put two canonicals in one document.
    const all = swaRoutes().map((r) => r.route);

    expect(all.indexOf('/article/*')).toBeLessThan(all.indexOf('/*'));
    expect(swaRoutes().find((r) => r.route === '/article/*')?.rewrite).toBe('/api/article-page');
    expect(pageMeta.metaFor('/article/anything')).toBeNull();
  });

  it('does not swallow the blob route or the API', () => {
    // `/articles/*` is the published article JSON and `/api/*` is every
    // endpoint. Both must stay ahead of the new rules; answering either with
    // the HTML shell would take the whole front page down.
    const all = swaRoutes().map((r) => r.route);

    expect(all.indexOf('/articles/*')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('/api/*')).toBeLessThan(all.indexOf('/'));
    expect(all.indexOf('/articles/*')).toBeLessThan(all.indexOf('/'));
  });
});

describe('the legacy URLs redirect rather than answering 200', () => {
  /**
   * Measured against production, 2026-08-29T08:44Z: `/economy` and
   * `/correspondents` answered HTTP 200 with `canonical=/`. Both are declared
   * in `main.tsx` as client-side `Navigate` redirects, so a reader lands in the
   * right place — but a crawler that runs no JavaScript is told the home page
   * is the canonical version of them, and every inbound link to an old URL
   * consolidates to `/` rather than to the section it names.
   *
   * A 301 at the edge says the thing that is actually true. It also fires
   * before the SPA loads, which is faster for the reader than a render followed
   * by a history replacement.
   *
   * These stay OUT of the sitemap — the exclusion list in `news-sitemap`
   * already names them, and a sitemap should list destinations, not the URLs
   * that point at them.
   */
  interface SwaConfig {
    routes?: { route: string; rewrite?: string; redirect?: string; statusCode?: number }[];
  }
  const routes = (): NonNullable<SwaConfig['routes']> =>
    (JSON.parse(
      readFileSync(resolve(ROOT, 'public/staticwebapp.config.json'), 'utf-8'),
    ) as SwaConfig).routes ?? [];

  const LEGACY: [string, string][] = [
    ['/correspondents', '/newsroom'],
    ['/correspondents/*', '/newsroom'],
    ...DASHBOARD_SECTIONS.map((s) => [`/${s}`, `/data/${s}`] as [string, string]),
  ];

  it.each(LEGACY)('%s redirects permanently to %s', (from, to) => {
    const rule = routes().find((r) => r.route === from);

    expect(rule, `${from} has no rule`).toBeDefined();
    expect(rule!.redirect, `${from} destination`).toBe(to);
    expect(rule!.statusCode, `${from} must be permanent`).toBe(301);
  });

  it('covers every section the app declares, as an equality', () => {
    // A section added to `sections.ts` gets a legacy URL for free, because
    // `main.tsx` routes `/:section` for all of them. If this list were a subset,
    // the new one would silently keep answering 200 with the wrong canonical.
    const redirecting = routes()
      .filter((r) => r.redirect?.startsWith('/data/'))
      .map((r) => r.route.slice(1))
      .sort();

    expect(redirecting).toEqual([...DASHBOARD_SECTIONS].sort());
  });

  it('puts them ahead of the page-shell rules that would otherwise answer 200', () => {
    // `/*` and the family rewrites both match these paths. SWA takes the first
    // rule, so a redirect behind them never runs — which is exactly the state
    // this is fixing.
    const all = routes().map((r) => r.route);

    for (const [from] of LEGACY) {
      expect(all.indexOf(from), `${from} is missing`).toBeGreaterThanOrEqual(0);
      expect(all.indexOf(from), `${from} is behind the catch-all`).toBeLessThan(all.indexOf('/*'));
      expect(all.indexOf(from), `${from} is behind the shell rules`).toBeLessThan(all.indexOf('/'));
    }
  });

  it('does not redirect a destination onto itself', () => {
    // `/data/economy` must not acquire a rule; a redirect loop would take the
    // dashboard down and answer 301 forever, which browsers cache.
    const all = routes().filter((r) => r.redirect).map((r) => r.route);

    for (const route of all) {
      expect(route.startsWith('/data/'), `${route} would loop`).toBe(false);
      expect(route).not.toBe('/newsroom');
    }
  });

  it('leaves them out of the sitemap, which lists destinations', () => {
    const excluded = Object.keys(sitemap.NOT_IN_SITEMAP);

    expect(excluded).toContain('/:section');
    expect(excluded).toContain('/correspondents');
  });
});
