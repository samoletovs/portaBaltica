/**
 * Guards the Static Web Apps configuration.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo carried two copies of `staticwebapp.config.json`: one at the repo
 * root and one in `public/`. They were byte-identical apart from drift, and
 * only the `public/` copy is ever deployed — the deploy job uses
 * `app_location: dist` with `skip_app_build: true`, and Vite copies `public/*`
 * into `dist/`. The root copy is read by nothing.
 *
 * That cost a full deploy cycle: a CSP fix was applied to the root file,
 * shipped, and had no effect, because the browser was still being served the
 * unmodified header from the `public/` copy. Nothing failed — the change was
 * simply inert, which is the hardest kind of bug to see.
 *
 * The root copy is now deleted and these tests keep it that way.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const DEPLOYED = resolve(ROOT, 'public/staticwebapp.config.json');
const DECOY = resolve(ROOT, 'staticwebapp.config.json');

/** Shape of the parts of the SWA config these tests assert on. */
interface SwaConfig {
  globalHeaders?: Record<string, string>;
  routes?: { route: string; rewrite?: string }[];
  navigationFallback?: { rewrite?: string; exclude?: string[] };
}

function deployedConfig(): SwaConfig {
  return JSON.parse(readFileSync(DEPLOYED, 'utf-8')) as SwaConfig;
}

describe('Static Web Apps configuration', () => {
  it('lives in public/ so the build copies it into dist', () => {
    expect(existsSync(DEPLOYED)).toBe(true);
  });

  it('has no second copy at the repo root', () => {
    // A root copy is not merely redundant: it is the file a reader edits by
    // default, and edits there are silently ignored.
    expect(existsSync(DECOY)).toBe(false);
  });

  it('is valid JSON', () => {
    expect(() => deployedConfig()).not.toThrow();
  });

  describe('Content-Security-Policy', () => {
    const csp = (): string =>
      deployedConfig().globalHeaders?.['Content-Security-Policy'] ?? '';

    it('allows the articles blob origin in connect-src', () => {
      // The front page fetches articles/index.json from blob storage. SWA
      // cannot proxy to an external host and SWA Free cannot hold a managed
      // identity, so this cross-origin fetch is the only route to the
      // published articles. Without it the front page renders its error state.
      expect(csp()).toContain('https://stportabalticabpmff5so.blob.core.windows.net');
    });

    it('still restricts default-src to self', () => {
      expect(csp()).toContain("default-src 'self'");
    });

    it('still forbids framing', () => {
      expect(csp()).toContain("frame-ancestors 'none'");
    });
  });

  describe('article pages', () => {
    const routes = (): { route: string; rewrite?: string }[] => deployedConfig().routes ?? [];

    it('sends /article/* to the function that injects per-article metadata', () => {
      const rule = routes().find((r) => r.route === '/article/*');
      expect(rule).toBeDefined();
      expect(rule?.rewrite).toBe('/api/article-page');
    });

    it('keeps that rule ahead of the catch-all', () => {
      // SWA takes the first matching route. Behind `/*` this rule never runs,
      // and the failure is invisible: the site keeps serving the static shell,
      // which is exactly what it did before and looks like nothing changed.
      const all = routes().map((r) => r.route);
      expect(all.indexOf('/article/*')).toBeGreaterThanOrEqual(0);
      expect(all.indexOf('/article/*')).toBeLessThan(all.indexOf('/*'));
    });

    it('does not swallow the /articles/* blob route', () => {
      // `/article*` — one character shorter — matches `/articles/foo.json`
      // too, and this rule sits above `/articles/*`. Every article payload
      // would then be answered by the HTML function, the front page would stop
      // loading, and the article pages would keep working, so the cause would
      // look like anything but this.
      const all = routes().map((r) => r.route);
      expect(all).toContain('/article/*');
      expect(all).not.toContain('/article*');
      expect(all).toContain('/articles/*');
    });
  });

  describe('security headers on function-served HTML', () => {
    /**
     * MEASURED, NOT ASSUMED
     * ---------------------
     * `globalHeaders` does not reach a managed function's response. Against
     * production on 2026-08-27, the static shell came back with CSP,
     * X-Frame-Options, X-Content-Type-Options, Referrer-Policy and
     * Permissions-Policy; `/rss.xml`, `/sitemap.xml` and `/api/system-status`
     * came back with none of them.
     *
     * Moving `/article/*` onto a function therefore drops the CSP from the one
     * route that renders model-written prose and third-party headlines, unless
     * the function sets them itself. It does — and this is what stops the copy
     * drifting from the config it copies, which the Function App cannot read at
     * runtime because it is deployed from `api/` alone.
     */
    it('are byte-identical to the globalHeaders the static pipeline applies', () => {
      const { SECURITY_HEADERS } = require(resolve(ROOT, 'api/shared/securityHeaders.js'));
      expect(SECURITY_HEADERS).toEqual(deployedConfig().globalHeaders);
    });
  });
});
