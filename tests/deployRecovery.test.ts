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

import { describe, it, expect, beforeEach } from 'vitest';
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

describe('the recovery is wired to both failures', () => {
  it('listens for a resource error and an unhandled rejection', () => {
    // The main-bundle case arrives as an `error` event on the element, which
    // only the capture phase sees; the lazy-chunk case arrives as a rejected
    // promise. Missing either leaves half the problem.
    expect(run().types().sort()).toEqual(['error', 'unhandledrejection']);
  });

  it('reloads when the main bundle is gone', () => {
    const harness = run();
    harness.fire('error', deadBundle);
    expect(harness.reloads()).toBe(1);
  });

  it('reloads when a lazy chunk is gone', () => {
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
    const harness = run();
    harness.fire('error', { target: { tagName: 'LINK', href: '/assets/index-abc.css' } });
    harness.fire('error', { target: { tagName: 'IMG', src: '/assets/og.png' } });
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

describe('the script the browser actually receives', () => {
  let built: string;

  beforeEach(() => {
    // Vite rewrites index.html; the recovery must survive that, not merely
    // exist in the source.
    const dist = resolve(__dirname, '..', 'dist/index.html');
    built = readFileSync(dist, 'utf-8');
  });

  it('is present in the built HTML', () => {
    expect(built).toContain('pb-asset-recovery');
    expect(built).toContain('unhandledrejection');
  });

  it('still matches the hashed asset paths the build emits', () => {
    // The build's own output is the fixture: whatever path shape Vite emits
    // for the entry bundle has to be one the guard recognises.
    const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(built);
    expect(entry, 'built HTML has no module entry').not.toBeNull();
    expect(/\/assets\//.test((entry as RegExpExecArray)[1])).toBe(true);
  });

  it('runs before the bundle it is guarding', () => {
    // A listener registered after the failing tag never hears about it.
    const entry = built.indexOf('<script type="module"');
    expect(built.indexOf('pb-asset-recovery')).toBeLessThan(entry);
  });
});
