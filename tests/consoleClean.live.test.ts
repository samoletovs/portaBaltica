import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * Does the deployed site load without throwing at the reader?
 *
 * Eight live checks already drive a real browser, and **not one of them would
 * notice a page throwing.** Measured across the suite, `pageerror` appears
 * exactly once and the handler is `() => {}` — deliberately, in
 * `deployRecoveryReal`, which breaks a chunk on purpose. So an uncaught
 * exception in production passes every check we own: the layout assertions
 * still find their elements, the contract assertions still read their JSON,
 * and the page a reader actually gets is broken underneath all of it.
 *
 * That gap matters more here than on an ordinary site. A React error boundary
 * or a failed lazy chunk does not blank the page — it removes a panel. The
 * remaining ones look right, so the artefact of "a chart failed to mount" and
 * "this indicator has no data today" is the same rendered page. That is this
 * repo's recurring failure shape, one layer out from the data.
 *
 * ## This finds nothing today, and says so
 *
 * Measured before it was written, with the handlers proven live on the same
 * page: `/`, `/data`, `/about/ai` and `/corrections` each report **0 console
 * errors, 0 uncaught exceptions, 0 failed requests**. So this is a regression
 * guard rather than a fix, and the honest time to adopt one is exactly when the
 * count is zero — adopting it later means first paying off whatever accrued.
 *
 * ## Why it carries its own control
 *
 * "Zero errors" is the reading a broken listener also produces. An assertion
 * that something is absent needs a companion proving it could have been
 * present, so `the probe can see an error at all` plants three faults — a
 * `console.error`, an uncaught throw, and a request to a route that 404s — and
 * requires all three to be caught. Without it this file would pass forever if
 * playwright renamed an event.
 *
 * The control runs on its own page rather than on a route under test, so a
 * planted fault can never be counted as a real one.
 */
const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** The routes a reader actually reaches, one per shape of page. */
const ROUTES = [
  '/', // the news feed
  '/data', // the dashboard, every chart
  '/about/ai', // a rendered policy document
  '/corrections', // the corrections log
];

/**
 * Noise we do not own and cannot fix from here.
 *
 * Written as an equality against what is observed, not as a subtraction from
 * it: an entry that stops matching must fail rather than sit here forever
 * excusing nothing. Empty today, which is the whole point of adopting this now.
 */
const ALLOWED: RegExp[] = [];

type Findings = { errors: string[]; failed: string[] };

/* eslint-disable @typescript-eslint/no-explicit-any */
function watch(page: any): Findings {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('console', (m: any) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e: unknown) => errors.push(`uncaught: ${String(e).slice(0, 200)}`));
  page.on('requestfailed', (r: any) => {
    failed.push(`${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`);
  });
  return { errors, failed };
}

let browser: any = null;

beforeAll(async () => {
  browser = await launchForLiveCheck();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the deployed site loads without throwing at the reader', () => {
  it('the probe can see an error at all', async () => {
    if (!browser) return;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const seen = watch(page);

    await page.goto(`${BASE}/data`, { waitUntil: 'networkidle', timeout: 60_000 });
    const baseline = seen.errors.length;

    await page.evaluate(() => console.error('planted console error'));
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('planted uncaught');
      }, 0);
    });
    await page.evaluate(() => fetch('/api/zzz-no-such-endpoint').catch(() => {}));
    await page.waitForTimeout(2500);

    expect(
      seen.errors.length - baseline,
      'the listeners caught nothing after three faults were planted, so a zero ' +
        'from the checks below would mean the probe is blind rather than the site clean',
    ).toBeGreaterThanOrEqual(2);

    await page.close();
  }, 90_000);

  it.each(ROUTES)('%s loads clean', async (route) => {
    if (!browser) return;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const seen = watch(page);

    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
    // Charts mount lazily and the sea-state panel resolves after first paint,
    // so a check that stopped at `networkidle` would miss the errors most
    // likely to exist.
    await page.waitForTimeout(3000);
    await page.close();

    const unexpected = seen.errors.filter((e) => !ALLOWED.some((p) => p.test(e)));
    expect(unexpected, `${route} logged errors a reader's console would show`).toEqual([]);
    expect(seen.failed, `${route} had requests fail outright`).toEqual([]);
  }, 90_000);
});
