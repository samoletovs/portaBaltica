/**
 * Does the deploy-race recovery fire on a REAL chunk failure?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT IN THE UNIT SUITE
 * ---------------------------------------------------
 * `tests/deployRecovery.test.ts` proves the handler reloads when it is handed
 * the event. It cannot prove the event arrives, because it constructs the
 * event itself — and for one release it did not arrive. React.lazy catches its
 * own rejection and re-throws it during render, so a failed lazy chunk
 * dispatches no `unhandledrejection` at all. The handler was correct, the test
 * was green, and the recovery never ran.
 *
 * **A test that constructs its own input cannot discover that the real input
 * never comes.** That is the same shape as the two other instruments this
 * project caught: an ordering assertion that passed because `indexOf` returned
 * `-1` with one operand absent, and a browser suite that reported a pass in
 * 1.4 seconds having launched no browser. In each the check was fine and the
 * thing feeding it was not.
 *
 * So this feeds the real thing. It builds the actual app with Vite, serves the
 * output, 404s one real chunk — which is exactly what Static Web Apps does to a
 * reader mid-deploy, since it replaces the asset set rather than keeping the
 * old one — and then watches a real browser to see whether the page recovers.
 * Nothing here is synthesised: not the bundle, not the failure, not the event.
 *
 * It builds into its own temp directory rather than reading `dist/`. `dist` is
 * gitignored and `npm test` never builds it, and a test that reads whatever
 * build is lying in the working directory is how this suite previously turned
 * master red across three merges. Building fresh costs a few seconds and
 * depends on nothing.
 *
 * It lives in the live suite because it needs a browser and several seconds,
 * and because — like the rest of that suite — it must not gate a pull request
 * on a machine that has no Chromium.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { launchForLiveCheck } from './liveBrowser';

const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, '.tmp-recovery-build');
const PORT = 4412;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/** The chunk this server pretends the deploy has already replaced. */
let killed = '';
let server: Server | undefined;
let built = false;

/**
 * Document requests the server has served.
 *
 * Counted here rather than from Playwright's `framenavigated`, which was the
 * first instrument tried and was the wrong one: it also fires for same-document
 * history navigations, so React Router moving between routes on `/data` counted
 * as a reload and a perfectly healthy page appeared to reload itself. A request
 * arriving at the server for the HTML document is unambiguous — it is what a
 * reload *is*, and an SPA navigation does not produce one.
 */
let documentRequests = 0;

beforeAll(() => {
  // Fresh build into our own directory. Never `dist/`.
  execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir'], {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  built = existsSync(join(OUT, 'index.html'));

  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (killed && url.includes(killed)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('gone');
      return;
    }
    let file = join(OUT, url);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(OUT, 'index.html');
    // Only a real navigation counts. The SPA fallback answers index.html for
    // every unmatched path, so the app's own /api/* calls land here too — the
    // second instrument this test needed, after counting those made a healthy
    // page look like it had reloaded eighty-four times. `Sec-Fetch-Dest` is
    // the browser saying what it is fetching *for*, which is the question.
    if (file === join(OUT, 'index.html') && req.headers['sec-fetch-dest'] === 'document') {
      documentRequests += 1;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  server.listen(PORT);
}, 180_000);

afterAll(() => {
  server?.close();
  rmSync(OUT, { recursive: true, force: true });
});

/**
 * Loads a route with one chunk missing, and reports what the reader ends up with.
 *
 * The browser comes from `launchForLiveCheck` rather than a local launcher, so
 * that "no browser" means the same thing here as in the other two live browser
 * checks: **skip locally, fail in CI.** This file previously carried its own
 * copy, which soft-skipped on a missing *package* even on a runner — safe only
 * because `deploy.yml` runs a plain `npm ci` that happens to install
 * devDependencies. That is safety by circumstance rather than by construction,
 * and the circumstance is one line in a workflow away from changing. #156 is
 * exactly what that costs: a live suite reporting a pass in 1.4 seconds having
 * launched nothing, for weeks, over a defect it had already found.
 */
async function visit(route: string, killChunk: string) {
  const browser = await launchForLiveCheck();
  if (!browser) return null;

  killed = killChunk;
  documentRequests = 0;
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', () => {});

  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'load' }).catch(() => {});
  // Long enough for the failure, the recovery, and the reload that follows it.
  await page.waitForTimeout(4000);

  const body = (await page.locator('body').textContent().catch(() => '')) ?? '';
  await context.close();
  await browser.close();
  killed = '';
  return { loads: documentRequests, body: body.trim() };
}

/** The built name of a chunk, e.g. `App-CkW7B7zC.js` for `App`. */
function chunkNamed(prefix: string): string {
  const match = readdirSync(join(OUT, 'assets')).find(
    (name) => name.startsWith(prefix) && name.endsWith('.js')
  );
  if (!match) throw new Error(`no built chunk named ${prefix}*`);
  return match;
}

describe('a real chunk failure, in a real browser', () => {
  it('built the app, so the rest of this suite is testing something', () => {
    expect(built, 'vite build produced no index.html').toBe(true);
    expect(readdirSync(join(OUT, 'assets')).length).toBeGreaterThan(3);
  });

  it('recovers when a lazy route chunk is gone', async () => {
    // THE REGRESSION THIS EXISTS FOR. Before the modulepreload branch was
    // added, this reloaded zero times and the reader was left on the error
    // boundary, while the unit test asserting "reloads when a lazy chunk is
    // gone" passed by handing the handler an event the browser never sends.
    const result = await visit('/data', chunkNamed('App-'));
    if (!result) {
      console.warn('playwright is not installed; skipping the browser measurement');
      return;
    }

    // Two document loads: the first, and the recovery's reload. The reload
    // is served the same 404 by this server, so the page cannot end up healthy
    // — what is being measured is that the recovery *ran*.
    expect(result.loads, 'the recovery did not reload').toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('recovers when the main bundle is gone', async () => {
    // The severer case: nothing boots, so no error boundary exists to catch
    // anything. Covered by the SCRIPT branch rather than the LINK one, and
    // measured here so the two are never assumed to share a path again.
    const html = readFileSync(join(OUT, 'index.html'), 'utf-8');
    const entry = /<script type="module"[^>]*src="\/assets\/([^"]+)"/.exec(html);
    expect(entry, 'built HTML has no module entry').not.toBeNull();

    const result = await visit('/', (entry as RegExpExecArray)[1]);
    if (!result) return;

    expect(result.loads, 'the recovery did not reload').toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('does not reload a page whose chunks are all present', async () => {
    // The direction that matters most. A recovery that fires on a healthy page
    // is a reload loop, and every reader gets it.
    const result = await visit('/data', '');
    if (!result) return;

    expect(result.loads, 'a healthy page reloaded itself').toBe(1);
    expect(result.body.length).toBeGreaterThan(0);
  }, 120_000);
});
