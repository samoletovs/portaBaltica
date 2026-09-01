import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { launchForLiveCheck } from './liveBrowser';
import { DASHBOARD_SECTIONS } from '../src/sections';

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
 * ## It is derived, not hardcoded
 *
 * Which indicators are late changes as feeds publish. So the expectation comes
 * from `/api/baltic-compare` — the same judgement the component reads — rather
 * than from a list here that would rot into a lie. Asking the application is
 * also what keeps this honest when the thresholds move.
 *
 * ## And it refuses to pass vacuously
 *
 * If nothing anywhere is late, every assertion below is trivially satisfiable
 * and the suite would report success while checking nothing. That is the
 * absence-resolving-to-success trap, so the first test fails in that case
 * rather than passing.
 */
const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** The wording `FreshnessNotice` renders. Shared with the jsdom suite. */
const NOTICE = /is later than usual: nothing newer than/;

type Freshness = { period: string; monthsBehind: number; late: boolean; stale: boolean };
type Compare = { countries: Record<string, { freshness?: Freshness }> };

/** Indicator ids that are late in at least one country, from the API itself. */
async function lateIndicators(ids: string[]): Promise<Map<string, number>> {
  const late = new Map<string, number>();
  for (const id of ids) {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=${id}&years=2`);
    if (!r.ok) continue;
    const d = (await r.json()) as Compare;
    let worst = 0;
    for (const cc of Object.keys(d.countries ?? {})) {
      const f = d.countries[cc]?.freshness;
      if (f?.late) worst = Math.max(worst, f.monthsBehind);
    }
    if (worst > 0) late.set(id, worst);
  }
  return late;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let browser: any = null;
let lateIds: Map<string, number> = new Map();

beforeAll(async () => {
  browser = await launchForLiveCheck();

  // `require`, not `await import()`: the latter trips TS7016 on an untyped JS
  // module, and adding this file to the typecheck exclusion list would be a
  // number quietly going up in a list built so that cannot happen.
  const registry = require('../api/shared/indicators.js') as Record<string, unknown>;
  const reg = (registry.INDICATORS ?? registry.indicators ?? registry) as Record<string, unknown>;
  lateIds = await lateIndicators(Object.keys(reg));
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

describe('a series months behind says so on the deployed site', () => {
  it('some series is late, so the checks below can discriminate', () => {
    // The vacuity guard. With nothing late, a page showing no notice is correct
    // and this file would pass while proving nothing — which is the reading a
    // broken probe also produces.
    expect(
      lateIds.size,
      'no indicator is late in production, so this suite cannot tell a working ' +
        'notice from a missing one. That is a good day for the data and a bad ' +
        'one for this check: read it as unverified rather than as a pass.',
    ).toBeGreaterThan(0);
  });

  it('at least one dashboard section renders the notice', async () => {
    if (!browser) return;
    expect(lateIds.size).toBeGreaterThan(0);

    const found: string[] = [];
    let charted = 0;

    for (const section of DASHBOARD_SECTIONS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
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
      `${lateIds.size} indicators are late in production — ` +
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
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
});
