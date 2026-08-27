/**
 * What a reader is told when the page breaks.
 *
 * The boundary rendered `this.state.error?.message` straight to the viewport,
 * so a visitor could be shown **"Failed to fetch dynamically imported
 * module"** — a sentence about our build system, handed to someone who wanted
 * to read an article, with no indication of whether it was their fault or
 * whether anything they could do would help.
 *
 * ─── The distinction, which turned out to be reachable ───
 *
 * Two situations arrive here and they read identically to a reader:
 *
 *   - a **stale asset**: the site was rebuilt mid-visit, so their HTML names
 *     bundles that no longer exist. Reloading genuinely fixes it.
 *   - a **runtime fault**: our code threw. Reloading will probably reproduce
 *     it, and telling them to try again is a friendlier lie than the exception
 *     it replaces.
 *
 * The premise for this work was that the first case can no longer reach here,
 * because #134 added a recovery script to `index.html` that reloads on a dead
 * asset. **Measured against a server that 404s one lazy chunk, it still
 * does.** The recovery listens for `unhandledrejection`, and a `React.lazy()`
 * failure never fires one: React catches the rejection itself and re-throws it
 * during render, so the browser has nothing to report and the boundary gets it
 * instead. Both the first visit and the second — with the recovery's guard
 * refusing — showed the raw message.
 *
 * That is worth stating plainly because #134's own test asserts the opposite,
 * and is right to pass: it *synthesises* an `unhandledrejection` and checks the
 * handler reloads. The handler works. The event does not arrive. A test that
 * constructs its own input cannot discover that.
 *
 * So the distinction is not only reachable, it is the one that decides whether
 * reloading is worth the reader's time — and the boundary is the only place
 * left that can make it.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type React from 'react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

/** A child that throws on first render, which is what a boundary is for. */
function Throws({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

const CHUNK = 'Failed to fetch dynamically imported module: https://portabaltica.naurolabs.com/assets/ApiDocsPage-Y1KAE3BD.js';
const RUNTIME = "Cannot read properties of undefined (reading 'toLowerCase')";

function mount(message: string) {
  // React logs the caught error; that is the boundary working, not noise worth
  // failing a test over.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = render(
    <ErrorBoundary>
      <Throws message={message} />
    </ErrorBoundary>,
  );
  return { ...result, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('the message a reader is shown', () => {
  it('never puts the raw exception where the explanation goes', () => {
    const { container } = mount(CHUNK);

    const heading = screen.getByRole('heading').textContent ?? '';
    expect(heading, 'the headline must not be build-system vocabulary').not.toMatch(/dynamically imported|module/i);

    // The paragraph directly under the heading is the explanation. The raw
    // message may appear further down, in the disclosure — that is the point
    // of moving it rather than deleting it.
    const explanation = container.querySelector('p')?.textContent ?? '';
    expect(explanation, 'the explanation must be a sentence for a reader').not.toMatch(/dynamically imported|module/i);
    expect(explanation.length, 'the explanation must say something').toBeGreaterThan(30);
  });

  it('says a stale bundle is worth reloading, and says so in the reader’s terms', () => {
    mount(CHUNK);

    const heading = screen.getByRole('heading').textContent ?? '';
    expect(heading).toMatch(/updated while you were reading/i);
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
  });

  it('does not tell a reader to retry a fault that will recur', () => {
    const { container } = mount(RUNTIME);

    const explanation = container.querySelector('p')?.textContent ?? '';
    // The honest version: it is ours, not theirs, and reloading is not the
    // likely fix. "Try again" here would be the friendlier lie.
    expect(explanation).toMatch(/our side|our end/i);
    expect(explanation).toMatch(/may well hit it again|may not help/i);
  });

  it('always offers somewhere to go, so the page is never a dead end', () => {
    for (const message of [CHUNK, RUNTIME]) {
      const { unmount } = mount(message);
      const link = screen.getByRole('link', { name: /dashboard/i });
      expect(link.getAttribute('href')).toBe('/data');
      unmount();
    }
  });

  it('stops offering reload once a reload has already failed', () => {
    // The recovery script stamps this key when it reloads. If the reader is
    // still here, that reload did not work, and offering the same button again
    // is the dead end the raw exception was.
    sessionStorage.setItem('pb-asset-recovery', String(Date.now()));
    mount(CHUNK);

    expect(screen.queryByRole('button', { name: /reload/i }), 'reload was offered after it had already failed').toBeNull();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeTruthy();
  });
});

describe('the exception itself', () => {
  it('is kept, not discarded', () => {
    // A copy fix that loses the only diagnostic anybody gets for a fault that
    // reaches here would be a bad trade, and it is exactly the shape of thing
    // that looks like an improvement in review.
    const { container } = mount(CHUNK);
    expect(container.textContent, 'the exception is gone entirely').toContain('Failed to fetch dynamically imported module');
  });

  it('is behind a disclosure rather than in the reader’s face', () => {
    const { container } = mount(CHUNK);
    const details = container.querySelector('details');
    expect(details, 'the exception should be in a disclosure').not.toBeNull();
    expect(details!.hasAttribute('open'), 'and shut by default').toBe(false);
    expect(details!.textContent).toContain('Failed to fetch dynamically imported module');
  });

  it('still reaches the console, which is where a developer looks', () => {
    const { spy } = mount(RUNTIME);
    const logged = spy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('portaBaltica error boundary')),
    );
    expect(logged, 'componentDidCatch must keep logging').toBe(true);
  });
});

describe('the two copies of the browser vocabulary', () => {
  it('agree', () => {
    // `index.html` must run before the bundle it guards, so it cannot import
    // the pattern from here — the wordings are necessarily written twice. Two
    // copies of a vocabulary drift, and only one of them is the one that
    // fires, so this asserts they still recognise the same faults.
    const boundary = readFileSync(resolve('src/components/ErrorBoundary.tsx'), 'utf8');
    const html = readFileSync(resolve('index.html'), 'utf8');

    for (const wording of ['dynamically imported module', 'Importing a module script failed']) {
      expect(boundary, `the boundary does not recognise "${wording}"`).toContain(wording);
      expect(html, `the recovery script does not recognise "${wording}"`).toContain(wording);
    }
  });

  it('share the guard key, so the two cannot reload in turn', () => {
    const boundary = readFileSync(resolve('src/components/ErrorBoundary.tsx'), 'utf8');
    const html = readFileSync(resolve('index.html'), 'utf8');
    expect(boundary).toContain('pb-asset-recovery');
    expect(html).toContain('pb-asset-recovery');
  });
});
