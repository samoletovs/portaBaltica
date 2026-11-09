import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { launchForLiveCheck } from './liveBrowser';
import { DASHBOARD_SECTIONS } from '../src/sections';
import { freshnessOf } from '../src/dataFreshness';

const require = createRequire(import.meta.url);

/**
 * Does a reader actually see that a series is months behind?
 *
 * `freshnessOf` has always returned two verdicts. Every gate reads `stale` —
 * "the feed looks dead" — and measured against production on 2026-09-01 across
 * 72 indicators and 216 series, **0 are stale**. The apparatus that fires is
 * `late`, and **22 of those 216 series are late right now**, between 9 and 21
 * months behind:
 *
 *     rd_spending      LV EE LT   2024      21 months   A
 *     life_expectancy  LV EE LT   2024      21 months   A
 *     hotel_occupancy  LV EE LT   2024      21 months   A
 *     road_freight     LV EE LT   2025-Q4    9 months   Q
 *     job_vacancy      LT         2025-Q4    9 months   Q
 *
 * The notice is the only thing standing between those figures and a reader who
 * takes them for current. `tests/indicatorFreshness.test.tsx` covers it well —
 * in jsdom, against a mocked payload. **Nothing checks the deployed site.**
 *
 * That gap is the shape this repo keeps finding: the unit test passes on a
 * component, and production can still be silent for a reason no component test
 * can see — the API stops sending `freshness`, a build drops the component, a
 * style hides it. All three render as a page that looks fine.
 *
 * The transport now supplies controlled late and frozen series at a fixed
 * clock. Catching up upstream must not fail a deployment, and a frozen weekly
 * series must exercise the stale branch, not merely the late-only notice.
 */
const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** The wording `FreshnessNotice` renders. Shared with the jsdom suite. */
const NOTICE = /is later than usual: nothing newer than/;

const NOW = new Date('2026-11-09T00:00:00Z');
const registry = require('../api/shared/indicators.js');
const points = (id: string) => id === 'weekly_deaths'
  ? [{ period: '2026-W27', value: 300 }, { period: '2026-W28', value: 310 }]
  : [{ period: '2025-Q3', value: 300 }, { period: '2025-Q4', value: 310 }];

/* eslint-disable @typescript-eslint/no-explicit-any */
let browser: any = null;
const lateIds = new Map(Object.keys(registry).flatMap(id => {
  const f = freshnessOf(points(id).at(-1)!.period, undefined, NOW.getTime());
  return f?.late ? [[id, f.monthsBehind] as const] : [];
}));

async function disclosurePage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.clock.setFixedTime(NOW);
  await page.route('**/api/**', (route: any) => route.fulfill({
    status: 200, json: { unavailable: true }, headers: { 'Cache-Control': 'no-store' },
  }));
  await page.route(/\/api\/baltic-compare(?:-batch)?\?/, (route: any) => {
    const url = new URL(route.request().url());
    const years = Number(url.searchParams.get('years'));
    const data = (id: string) => ({
      indicator: id, years, title: registry[id].title, unit: registry[id].unit,
      dataset: registry[id].dataset, source: 'Controlled disclosure fixture',
      countries: Object.fromEntries(['LV', 'EE', 'LT'].map(cc => [
        cc, { label: cc, series: points(id) },
      ])),
      reference: null, assumptions: [],
    });
    const ids = url.searchParams.get('indicators');
    return route.fulfill({ json: ids === null
      ? data(url.searchParams.get('indicator')!)
      : { results: ids.split(',').map(id => ({
        indicator: id, years, status: 200, data: data(id),
        cache: { ageSeconds: 0, state: 'miss' },
      })) },
    });
  });
  return page;
}

beforeAll(async () => {
  browser = await launchForLiveCheck();
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

describe('a series months behind says so on the deployed site', () => {
  it('the controlled series exercise both late and stale disclosure', () => {
    // Validate the fixtures against the same judgement the renderer uses.
    expect(
      lateIds.size,
      'no controlled indicator is late, so this suite cannot tell a working ' +
        'notice from a missing one. That is a good day for the data and a bad ' +
        'one for this check: read it as unverified rather than as a pass.',
    ).toBeGreaterThan(0);
    expect(freshnessOf(points('weekly_deaths').at(-1)!.period, undefined, NOW.getTime())?.stale).toBe(true);
    expect(freshnessOf(points('unemployment').at(-1)!.period, undefined, NOW.getTime())?.stale).toBe(false);
  });

  it('at least one dashboard section renders the notice', async () => {
    if (!browser) return;
    expect(lateIds.size).toBeGreaterThan(0);

    const found: string[] = [];
    let charted = 0;

    for (const section of DASHBOARD_SECTIONS) {
      const page = await disclosurePage();
      await page.goto(`${BASE}/data/${section}`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      // Charts and their notices mount after first paint.
      await page.waitForTimeout(3500);

      const body: string = (await page.textContent('body')) ?? '';
      charted += await page.locator('svg.recharts-surface').count();
      if (NOTICE.test(body)) found.push(section);
      await page.close();
    }

    // The control, and it is what makes the assertion below mean anything: a
    // site that rendered no charts at all would also render no notices, and
    // the two are indistinguishable from the notice count alone.
    expect(
      charted,
      'no chart rendered on any section, so the absence of a notice says ' +
        'nothing about the notice',
    ).toBeGreaterThan(0);

    expect(
      found,
      `${lateIds.size} controlled indicators are late — ` +
        `${[...lateIds.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([id, m]) => `${id} ${m}mo`)
          .join(', ')} — but no section page told a reader so`,
    ).not.toEqual([]);
  }, 300_000);

  it('the notice names a period, so a reader can judge it themselves', async () => {
    if (!browser) return;

    // A notice saying only "later than usual" is a mood. The period is what
    // lets a reader decide whether nine months matters for their question, and
    // it is the part a refactor is most likely to drop.
    const page = await disclosurePage();
    let sentence: string | null = null;

    for (const section of DASHBOARD_SECTIONS) {
      await page.goto(`${BASE}/data/${section}`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      await page.waitForTimeout(3500);
      const body: string = (await page.textContent('body')) ?? '';
      const m = body.match(/is later than usual: nothing newer than ([^.]{1,40})/);
      if (m) {
        sentence = m[1].trim();
        break;
      }
    }
    await page.close();

    expect(sentence, 'no notice found to inspect').not.toBeNull();
    // A year, a quarter or a month — anything a reader can place in time.
    expect(
      sentence,
      `the notice named "${sentence}", which does not identify a period`,
    ).toMatch(/\d{4}|Q[1-4]|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
  }, 300_000);

  it('discloses the frozen weekly-deaths series rather than treating it as current', async () => {
    if (!browser) return;
    const page = await disclosurePage();
    try {
      await page.goto(`${BASE}/data/environment`, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.getByText(/has published nothing newer than/).first().waitFor();
      expect(await page.textContent('body')).toContain('2026');
    } finally {
      await page.close();
    }
  });
});
