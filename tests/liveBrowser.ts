/**
 * Getting a browser for a live check, and refusing to pretend when there
 * isn't one.
 *
 * Both browser-based live tests opened with the same shape:
 *
 *     let browser;
 *     try { browser = await browserType.launch(); }
 *     catch { console.warn('no chromium binary — skipping'); return; }
 *
 * Locally that is right. Playwright is a devDependency but the browser binary
 * is not, so a contributor who has never run `npx playwright install` should
 * not have `npm run test:live` fail at them for a check they were not trying
 * to run.
 *
 * On a runner it is a lie. **No workflow in this repository has ever installed
 * the browser**, so on every deploy since #109 the layout check took that
 * branch, printed a warning nobody reads, and reported a pass. Measured by
 * pointing `PLAYWRIGHT_BROWSERS_PATH` at an empty directory: the two
 * browser-based live files report `Tests 2 passed` in **3.38 seconds**, having
 * launched nothing.
 *
 * That is the "check that cannot fail" in its purest form, and worse than the
 * usual kind — this one had already caught a real defect (a 196px sideways
 * scroll on every phone width) and reported it as a pass, for weeks, because
 * the environment it ran in could not run it.
 *
 * So the rule is: **skip locally, fail in CI.** The same absence means
 * different things in the two places, and a helper is the only way to keep
 * both call sites honest about which one they are in.
 */

/** The chromium launcher, or `null` when playwright itself is absent. */
export async function chromiumOrNull() {
  try {
    const playwright = await import('playwright');
    return playwright.chromium;
  } catch {
    return null;
  }
}

/**
 * Launch a browser for a live check.
 *
 * Returns `null` when there is no browser and the caller should skip — which
 * only ever happens outside CI. Inside CI it throws instead, because a live
 * check that silently does not run is indistinguishable from one that ran and
 * found nothing, and the second is the message the runner would otherwise
 * send.
 */
export async function launchForLiveCheck() {
  const inCI = Boolean(process.env.CI);

  const browserType = await chromiumOrNull();
  if (!browserType) {
    if (inCI) {
      throw new Error(
        'playwright is not installed, so this live check cannot run. ' +
        'It must not report a pass — add it to devDependencies.',
      );
    }
    console.warn('playwright is not installed; skipping the live browser check');
    return null;
  }

  try {
    return await browserType.launch();
  } catch (cause) {
    if (inCI) {
      throw new Error(
        'no chromium binary on this runner, so this live check cannot run. ' +
        'It must not report a pass — run `npx playwright install --with-deps chromium` ' +
        'before `npm run test:live`.',
        { cause },
      );
    }
    console.warn('no chromium binary — run `npx playwright install chromium`; skipping');
    return null;
  }
}
