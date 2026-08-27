/**
 * The deploy-race recovery in index.html.
 *
 * WHAT IT IS FOR
 * --------------
 * Vite content-hashes every bundle and Static Web Apps replaces the asset set
 * on deploy rather than keeping the previous one alongside. Measured against
 * production: every asset hash this site served earlier today —
 * `index-CUmohATZ.js`, `index-BAFFXFvb.js`, `index-HUuJcc7k.js` and two
 * `chartAccessibility-*` chunks — now answers 404. So a reader holding HTML
 * from before a deploy is holding filenames that no longer exist, and this
 * repo deployed about twenty times in a single day.
 *
 * Two failures follow, and only one of them was visible:
 *
 *   - a LAZY CHUNK 404s. React is running, so the error boundary catches it
 *     and shows "Something went wrong" above the words "Failed to fetch
 *     dynamically imported module", with a Reload button. Observed in
 *     production once today.
 *   - the MAIN BUNDLE 404s. Nothing boots, so there is no error boundary to
 *     catch anything and no button to press. A blank page.
 *
 * The second is why the recovery is an inline script in index.html rather than
 * anything in src/: no code inside the bundle can catch the bundle failing to
 * load. The usual advice — retry the dynamic import — covers only the first
 * case, by construction.
 *
 * WHY THIS TEST RUNS THE SHIPPED SCRIPT
 * -------------------------------------
 * An auto-reload is the most dangerous thing on this site: get the condition
 * wrong and every reader with a transient error is put into a loop that
 * reloads until they close the tab. So this does not test a copy of the logic
 * or assert that some string appears in a file — it extracts the actual script
 * from index.html and runs it against fakes, then fires the events a browser
 * would fire and counts reloads.
 *
 * The dangerous direction is a FALSE POSITIVE, so most of what follows is
 * cases that must NOT reload.
 *
 * Chromium behaviour was verified separately against a server whose assets
 * always 404: two page loads over six seconds, never three, for both failure
 * modes — and the reload carried `Cache-Control: max-age=0`, which is what
 * `/api/article-page` reads to decide not to serve the shell it holds in
 * memory.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX = resolve(__dirname, '..', 'index.html');

/** The recovery script exactly as index.html ships it. */
function recoverySource(): string {
  const html = readFileSync(INDEX, 'utf-8');
  // Comments first. The commentary above the script discusses `<script>` tags
  // in prose, and a naive scan happily matches that opening tag and captures
  // English through to the next real closing tag.
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const blocks = withoutComments.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
  const found = blocks.find((block) => block.includes('pb-asset-recovery'));
  if (!found) throw new Error('index.html carries no deploy-race recovery script');
  return found.replace(/^<script>/, '').replace(/<\/script>$/, '');
}

type Handler = (event: unknown) => void;

interface Harness {
  fire: (type: string, event: unknown) => void;
  reloads: () => number;
  types: () => string[];
}

/**
 * Runs the script with injected fakes.
 *
 * `window`, `sessionStorage` and `location` are shadowed as parameters, so the
 * script under test is byte-identical to the shipped one while touching
 * nothing real.
 */
function run(options: { storageThrows?: boolean; now?: () => number } = {}): Harness {
  const handlers: Record<string, Handler[]> = {};
  let reloads = 0;
  const store = new Map<string, string>();

  const win = {
    addEventListener: (type: string, handler: Handler) => {
      (handlers[type] ??= []).push(handler);
    },
  };

  const storage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error('sessionStorage is unavailable');
      return store.has(key) ? store.get(key) : null;
    },
    setItem: (key: string, value: string) => {
      if (options.storageThrows) throw new Error('sessionStorage is unavailable');
      store.set(key, value);
    },
  };

  const location = { reload: () => { reloads += 1; } };
  const clock = options.now ? { now: options.now } : Date;

  const factory = new Function('window', 'sessionStorage', 'location', 'Date', recoverySource());
  factory(win, storage, location, clock);

  return {
    fire: (type, event) => (handlers[type] ?? []).forEach((handler) => handler(event)),
    reloads: () => reloads,
    types: () => Object.keys(handlers),
  };
}

/** A `<script src>` that failed to load, as the browser reports it. */
const deadBundle = { target: { tagName: 'SCRIPT', src: 'https://portabaltica.naurolabs.com/assets/index-CUmohATZ.js' } };

/** A failed `import()`, as the browser reports it. */
const deadChunk = {
  reason: new Error(
    'Failed to fetch dynamically imported module: https://portabaltica.naurolabs.com/assets/chartAccessibility-EIKBOjz1.js'
  ),
};

/**
 * A dead lazy chunk, as the browser really reports it: an `error` event on the
 * `<link rel="modulepreload">` Vite inserts immediately before importing it.
 * Shape taken from a real build, not invented.
 */
const deadChunkPreload = {
  target: {
    tagName: 'LINK',
    rel: 'modulepreload',
    href: 'https://portabaltica.naurolabs.com/assets/App-CkW7B7zC.js',
  },
};

describe('the recovery is wired to both failures', () => {
  /**
   * These hand the handler an event and check what it does. That is a fair
   * test of the handler and NOT a test that the event ever arrives — a
   * distinction this file learned the hard way.
   *
   * "reloads when a lazy chunk is gone" used to live here, synthesising an
   * `unhandledrejection`. It passed for a release in which the recovery never
   * once ran, because `React.lazy` catches its own rejection and re-throws it
   * during render, so the browser dispatches no `unhandledrejection` for a
   * failed chunk at all. The handler was right, the test was green, and the
   * trigger did not exist.
   *
   * **A test that constructs its own input cannot discover that the real input
   * never comes.** The real input is measured in
   * `tests/deployRecoveryReal.live.test.ts`, which builds the app, 404s a real
   * chunk and watches a real browser. Nothing below may be read as evidence
   * that a real failure reaches this code.
   */
  it('listens for a resource error and an unhandled rejection', () => {
    expect(run().types().sort()).toEqual(['error', 'unhandledrejection']);
  });

  it('reloads when the main bundle is gone', () => {
    // This one the browser really does dispatch: a failed <script> reports an
    // `error` event on the element. Verified against a real build.
    const harness = run();
    harness.fire('error', deadBundle);
    expect(harness.reloads()).toBe(1);
  });

  it('reloads when a lazy chunk s modulepreload fails', () => {
    // The signal that actually arrives for a dead lazy chunk. Vite inserts
    // `<link rel="modulepreload" as="script">` before importing one, and a 404
    // fires an `error` event on that link — measured on /, /about/ai and /data
    // against a real build, one event each, always this shape.
    const harness = run();
    harness.fire('error', deadChunkPreload);
    expect(harness.reloads()).toBe(1);
  });

  it('still reloads on a bare dynamic import rejection, where one occurs', () => {
    // Kept because a direct `import()` outside React.lazy does reject here.
    // No longer the only path relied upon, which is what made it dangerous.
    const harness = run();
    harness.fire('unhandledrejection', deadChunk);
    expect(harness.reloads()).toBe(1);
  });

  it('reloads on the other wording browsers use for the same fault', () => {
    const harness = run();
    harness.fire('unhandledrejection', {
      reason: new Error('Importing a module script failed.'),
    });
    expect(harness.reloads()).toBe(1);
  });
});

describe('what must never trigger a reload', () => {
  // A false positive here puts a reader in a reload loop, so this is the half
  // of the contract that matters most.

  it('an ordinary runtime error', () => {
    // Runtime errors reach the same listener. They report `window` as their
    // target, not an element, and a bug that reloaded on them would reload on
    // every uncaught exception the site has ever thrown.
    const harness = run();
    harness.fire('error', { target: { location: 'https://portabaltica.naurolabs.com/' } });
    harness.fire('error', { target: undefined });
    harness.fire('error', {});
    expect(harness.reloads()).toBe(0);
  });

  it('a script that is not one of our hashed assets', () => {
    const harness = run();
    harness.fire('error', { target: { tagName: 'SCRIPT', src: 'https://example.com/tracker.js' } });
    harness.fire('error', { target: { tagName: 'SCRIPT', src: '' } });
    expect(harness.reloads()).toBe(0);
  });

  it('a stylesheet or an image that failed', () => {
    // These fail without stopping the app, and reloading would not fix them.
    // The modulepreload branch makes this sharper than it was: a LINK now can
    // trigger a reload, so the *other* kinds of LINK have to be proven inert.
    const harness = run();
    harness.fire('error', { target: { tagName: 'LINK', rel: 'stylesheet', href: '/assets/index-abc.css' } });
    harness.fire('error', { target: { tagName: 'LINK', rel: 'icon', href: '/favicon.svg' } });
    harness.fire('error', { target: { tagName: 'LINK', rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } });
    harness.fire('error', { target: { tagName: 'IMG', src: '/assets/og.png' } });
    expect(harness.reloads()).toBe(0);
  });

  it('a modulepreload for something that is not one of our assets', () => {
    const harness = run();
    harness.fire('error', {
      target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://cdn.example.com/thing.js' },
    });
    harness.fire('error', { target: { tagName: 'LINK', rel: 'modulepreload', href: '' } });
    expect(harness.reloads()).toBe(0);
  });

  it('an unrelated rejected promise', () => {
    const harness = run();
    harness.fire('unhandledrejection', { reason: new Error('HTTP 500 from /api/port-data') });
    harness.fire('unhandledrejection', { reason: new Error('The user aborted a request.') });
    harness.fire('unhandledrejection', {});
    harness.fire('unhandledrejection', { reason: null });
    expect(harness.reloads()).toBe(0);
  });
});

describe('the loop guard', () => {
  it('reloads once, not once per failing asset', () => {
    // A broken deploy fails every chunk the page asks for, so the listener
    // fires repeatedly within milliseconds.
    const harness = run();
    for (let i = 0; i < 20; i++) harness.fire('error', deadBundle);
    harness.fire('unhandledrejection', deadChunk);
    expect(harness.reloads()).toBe(1);
  });

  it('does not reload again when the reload did not help', () => {
    // Same tab, same session storage, a second load that fails the same way.
    // This is the genuinely broken deploy, and the answer is to stop.
    const store = new Map<string, string>();
    const shared = {
      getItem: (key: string) => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: string) => store.set(key, value),
    };

    let reloads = 0;
    const source = recoverySource();

    for (let attempt = 0; attempt < 3; attempt++) {
      const handlers: Record<string, Handler[]> = {};
      new Function('window', 'sessionStorage', 'location', 'Date', source)(
        { addEventListener: (t: string, h: Handler) => { (handlers[t] ??= []).push(h); } },
        shared,
        { reload: () => { reloads += 1; } },
        Date
      );
      (handlers.error ?? []).forEach((handler) => handler(deadBundle));
    }

    expect(reloads).toBe(1);
  });

  it('allows another attempt once the window has passed', () => {
    // A deploy an hour later is a different event and deserves a fresh try.
    let clock = 1_000_000;
    const store = new Map<string, string>();
    const shared = {
      getItem: (key: string) => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: string) => store.set(key, value),
    };

    let reloads = 0;
    const source = recoverySource();

    for (const at of [1_000_000, 1_000_000 + 29_000, 1_000_000 + 61_000]) {
      clock = at;
      const handlers: Record<string, Handler[]> = {};
      new Function('window', 'sessionStorage', 'location', 'Date', source)(
        { addEventListener: (t: string, h: Handler) => { (handlers[t] ??= []).push(h); } },
        shared,
        { reload: () => { reloads += 1; } },
        { now: () => clock }
      );
      (handlers.error ?? []).forEach((handler) => handler(deadBundle));
    }

    // First fires; 29s later is inside the guard; 61s later is a new attempt.
    expect(reloads).toBe(2);
  });

  it('does nothing at all when sessionStorage is unavailable', () => {
    // Without somewhere to record the attempt there is no way to count one, so
    // reloading would be unbounded. Doing nothing leaves the reader where they
    // already were rather than in a loop.
    const harness = run({ storageThrows: true });
    harness.fire('error', deadBundle);
    harness.fire('unhandledrejection', deadChunk);
    expect(harness.reloads()).toBe(0);
  });
});

describe('where the recovery sits in the document', () => {
  /**
   * WHY THIS READS THE SOURCE AND NOT `dist/`
   * -----------------------------------------
   * It used to read `dist/index.html`, and that was wrong twice over.
   *
   * `dist` is gitignored and `npm test` never builds, so in CI — which runs
   * `npm ci`, lint, `tsc -b`, `npm test`, with the build in a separate job —
   * the file simply is not there and these tests could never pass. They failed
   * the merge of #134 and, because `build_and_deploy` declares
   * `needs: quality`, blocked its deployment.
   *
   * Locally it was worse than failing: it read whatever build happened to be
   * lying in the working directory. Against a STALE `dist` the presence check
   * failed while the ordering check below passed for the wrong reason —
   * `indexOf` answers `-1` when the string is absent, and `-1` is less than any
   * position, so an assertion about ordering silently passed on a file that did
   * not contain the thing being ordered. One visible failure, one inert
   * assertion, and a rebuild made both green. That is what a flake that
   * "re-runs away" is made of.
   *
   * Ordering is a property of the source: Vite rewrites the module script's src
   * but does not move script tags past each other. Whether the recovery
   * survives the build at all is a question about what actually ships, so it is
   * asked in `tests/articleMeta.live.test.ts` against the deployed HTML — the
   * only copy whose contents matter to a reader.
   */
  const html = readFileSync(INDEX, 'utf-8');

  it('is in the document at all', () => {
    // Stated separately so the ordering assertion below cannot stand in for it.
    expect(html.indexOf('pb-asset-recovery')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('unhandledrejection')).toBeGreaterThanOrEqual(0);
  });

  it('runs before the bundle it is guarding', () => {
    // A listener registered after the failing tag never hears about it.
    const recovery = html.indexOf('pb-asset-recovery');
    const entry = html.indexOf('<script type="module"');
    // Both must be present before comparing, or `-1` makes this pass by
    // accident — which is exactly how it passed against a stale build.
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeLessThan(entry);
  });

  it('recognises the path shape the build rewrites that entry to', () => {
    // Vite turns `/src/main.tsx` into `/assets/index-<hash>.js`. The guard only
    // fires on `/assets/`, so a build that emitted anything else would leave it
    // watching for something that never happens.
    expect(html).toContain('<script type="module" src="/src/main.tsx">');
    expect(/\/assets\//.test('/assets/index-COMvuAev.js')).toBe(true);
  });
});
