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

const ROOT = resolve(__dirname, '..');
const DEPLOYED = resolve(ROOT, 'public/staticwebapp.config.json');
const DECOY = resolve(ROOT, 'staticwebapp.config.json');

/** Only the part of the SWA schema these tests actually read. */
interface SwaConfig {
  globalHeaders?: Record<string, string>;
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
});
