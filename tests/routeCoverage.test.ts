import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { navigableRoutes, routerRoutes, sectionRoutes, validSections } from './routes';

/**
 * Does the overflow sweep still know about every route?
 *
 * `/api-docs` scrolled sideways by 45px at 320px for as long as the page had
 * existed, and a live sweep that measures exactly that had been in the suite the
 * whole time without seeing it. Its route list was four of sixteen — chosen
 * correctly for the ticker defect it was written for, its own comment saying so,
 * and then left answering a question about every route.
 *
 * #166 widened the list to seventeen, which fixed the instance. This removes the
 * mechanism: the sweep consumes `navigableRoutes()` now, so the list cannot go
 * stale, and these assertions guard the derivation that replaced it. That is a
 * transfer of risk rather than an elimination of it — a parser that quietly
 * matches nothing returns an empty list, every sweep over it passes, and the
 * result is a clean report about nothing at all. **A check that cannot fail is
 * not a check**, so most of this file is vacuity guards.
 *
 * It deliberately does **not** assert the absence of overflow. Layout needs a
 * browser, jsdom has none, and a structural proxy here — "every `<code>` with a
 * query string carries a break rule" — would be a word list wearing a property's
 * clothes, beaten by the first markup nobody imagined. The measurement stays
 * live; this only keeps it pointed at everything.
 */

const sweepSource = readFileSync(resolve('tests/reducedMotionLayout.live.test.ts'), 'utf8');

describe('the route derivation', () => {
  it('parses the router, and is not silently empty', () => {
    const routes = routerRoutes();
    expect(routes.length, 'no routes parsed from main.tsx — the derivation is broken').toBeGreaterThan(4);

    for (const expected of ['/', '/api-docs', '/about/ai', '/corrections', '/newsroom']) {
      expect(routes, `${expected} is declared in main.tsx but was not derived`).toContain(expected);
    }
  });

  it('parses the navigation, and is not silently empty', () => {
    const sections = sectionRoutes();
    expect(sections.length, 'no sections parsed from Header.tsx — the derivation is broken').toBeGreaterThan(8);

    for (const expected of ['/data', '/data/economy', '/data/maritime', '/data/labour']) {
      expect(sections, `${expected} is in the nav but was not derived`).toContain(expected);
    }
  });

  it('parses the section vocabulary, and is not silently empty', () => {
    const sections = validSections();
    expect(sections.length, 'DashboardSection did not parse').toBeGreaterThan(6);
    // The one that mattered: `/data/overview` was swept as though it were a
    // page. `App.tsx` falls back to 'all' for a name this type does not carry,
    // so it rendered `/data` a second time under a different label.
    expect(sections, 'the overview is /data itself, never /data/overview').not.toContain('overview');
  });

  it('every section a reader can click is one the dashboard will render', () => {
    // The failure this exists for is silent and user-visible. `App.tsx` falls
    // back to `'all'` for a section it does not recognise, so a nav entry whose
    // id is missing from `DASHBOARD_SECTIONS` does not 404 — the reader clicks
    // "Trade", the address bar reads `/data/trade`, and they are served the
    // Overview instead.
    //
    // Nothing caught that. Measured with `trade` deleted from `App.tsx`'s
    // section set alone: `tsc --noEmit` exited 0 (a `Set<string>` is not
    // checked against the union) and all 26 route tests passed, because they
    // derived from the type and from `Header.tsx` and neither had changed.
    //
    // `DASHBOARD_SECTIONS` is now one value that both the renderer and the
    // redirect branch on, so that particular fault can no longer be written.
    // This asserts the half that remains hand-written: `Header.tsx` carries
    // labels and paths, so it cannot be generated from the list, and it can
    // still drift from it in either direction.
    const renderable = new Set(validSections());
    const clickable = sectionRoutes()
      .filter((path) => path.startsWith('/data/'))
      .map((path) => path.slice('/data/'.length));

    expect(clickable.length, 'no /data/<section> links parsed from Header.tsx').toBeGreaterThan(6);

    for (const section of clickable) {
      expect(
        renderable.has(section),
        `the nav links to /data/${section}, which the dashboard does not render — it would silently serve the Overview`,
      ).toBe(true);
    }

    // And the other direction, which is a dead end rather than a wrong page: a
    // section the dashboard renders but nothing links to is only reachable by
    // typing the URL.
    for (const section of renderable) {
      expect(
        clickable.includes(section),
        `the dashboard renders /data/${section} but the nav has no link to it`,
      ).toBe(true);
    }
  });

  it('needs both sources, because neither is sufficient', () => {
    // Asserted rather than left to the comment that says so. `/data/:section?`
    // is one router entry and ten destinations; the nav has no entry for the
    // API docs at all.
    expect(routerRoutes(), 'the router does not enumerate sections').not.toContain('/data/maritime');
    expect(sectionRoutes(), 'the nav has no entry for the API docs').not.toContain('/api-docs');
    expect(navigableRoutes()).toEqual(expect.arrayContaining(['/data/maritime', '/api-docs']));
  });

  it('excludes what cannot be measured blind, and nothing else', () => {
    // "Navigable" means *renders its own content*, which is narrower than
    // "resolves". A `:param` route needs an id that exists, and a redirect
    // renders somebody else's page — `/correspondents` is a `<Navigate to=
    // "/newsroom">`, so sweeping it would measure /newsroom twice under two
    // labels, which is the same redundancy `/data/overview` was.
    const all = navigableRoutes();

    for (const route of all) {
      expect(route, `${route} carries a parameter and cannot be visited blind`).not.toContain(':');
    }
    expect(all, '/correspondents redirects and renders nothing of its own').not.toContain('/correspondents');
    expect(all, '/newsroom is the page /correspondents redirects to').toContain('/newsroom');
  });
});

describe('the live overflow sweep', () => {
  it('takes its routes from the derivation rather than a literal list', () => {
    // The assertion that keeps this from decaying back into a list. Deriving
    // the routes and then not passing them to the measurement would look like a
    // fix and change nothing, which is the shape of defect this file is about.
    expect(sweepSource, 'the sweep must import the derived routes').toMatch(
      /import\s*\{[^}]*navigableRoutes[^}]*\}\s*from\s*'\.\/routes'/,
    );
    expect(sweepSource, 'the derived routes must reach ROUTES').toMatch(
      /const ROUTES\s*=\s*\[\s*\.\.\.navigableRoutes\(\)/,
    );
  });

  it('hardcodes only routes that need a real parameter', () => {
    // One escape hatch, deliberately narrow. `/indicator/gdp` has to be written
    // by a human because the id has to exist — an invented one renders a
    // not-found page, which cannot overflow, so it would be a pass for the
    // wrong reason. Anything else appearing here is the list growing back.
    const block = sweepSource.match(/const CONCRETE_PARAM_ROUTES\s*=\s*\[([\s\S]*?)\];/);
    expect(block, 'CONCRETE_PARAM_ROUTES not found').not.toBeNull();

    const hardcoded = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(hardcoded.length, 'the escape hatch is growing back into a route list').toBeLessThanOrEqual(3);

    const derived = navigableRoutes();
    for (const route of hardcoded) {
      expect(
        derived.includes(route),
        `${route} is already derived — hardcoding it sweeps the same page twice`,
      ).toBe(false);
    }
  });

  it('sweeps a non-trivial number of routes', () => {
    // If the derivation returned nothing, every assertion above would still
    // pass: an empty list misses nothing and contains nothing wrong.
    const count = navigableRoutes().length;
    expect(count, `only ${count} routes derived — the sweep would be nearly empty`).toBeGreaterThanOrEqual(14);
  });
});
