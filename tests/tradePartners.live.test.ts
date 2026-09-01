/**
 * Contract test: `ats_kn8_men` still carries data, and still means what the
 * endpoint says it means.
 *
 * This is the test whose absence let the maritime tile serve a frozen March
 * snapshot for half a year, written for the source that could repeat it. The
 * failure mode is not an outage: data.gov.lv answers HTTP 200, lists the
 * dataset, reports `datastore_active: true`, and serves rows. All of that is
 * currently true of `maksatnespejas-procesi` on the same portal, whose newest
 * insolvency proceeding began **2020-10-28** — six years frozen, entirely
 * invisible to any structural check.
 *
 * So the assertions are about the *data*:
 *
 *   - the newest period is read from the rows and is inside living memory,
 *     which is the only thing that separates a live table from a fossil;
 *   - the totals sit in a sanity band that describes what the statistic
 *     *means*, which is what catches a definition pointing at a real table
 *     measuring something else;
 *   - the partner ranking is a ranking, and its shares are shares.
 *
 * It lives in the live suite because it depends on data.gov.lv being
 * reachable, and a gate that red-lights a correct pull request because a
 * government portal was slow teaches people to bypass gates.
 *
 * ⚠️ The default vitest config EXCLUDES `*.live.test.ts`. Run it with
 * `npx vitest run --config vitest.live.config.ts`; a bare `npx vitest run` on
 * this path reports "No test files found", which reads exactly like a missing
 * file.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ckan = require('../api/shared/ckan.js');
const trade = require('../api/shared/tradeStats.js');

const OPTIONS = { deadlineMs: 30000 };

/**
 * Sanity bands, in euro per month, describing what the statistic means.
 *
 * Latvia is a 2.5-million-person economy that trades roughly 1.5–2.5bn EUR of
 * goods each way per month and runs a persistent goods deficit. The bands are
 * wide enough that a normal year never trips them and narrow enough that a
 * definition pointing at the wrong cube — thousands instead of euro, or one
 * commodity instead of all of them — cannot pass.
 */
const BANDS = {
  exports: { min: 0.8e9, max: 4e9 },
  imports: { min: 0.9e9, max: 5e9 },
};

/** How far behind the newest month may be before this is a fossil rather than a lag. */
const MAX_MONTHS_BEHIND = 12;

function monthsBehind(period: string): number {
  const [year, month] = period.split('-').map(Number);
  const now = new Date();
  return (now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) - (year * 12 + month);
}

async function newestOf(resourceId: string) {
  const rows = await trade.runSql(trade.newestPeriodSql(resourceId), OPTIONS);
  const key = trade.num(rows[0] && rows[0].period_key);
  return { key, period: key === null ? null : trade.periodLabel(key) };
}

describe('the CN-8 trade dataset is alive', () => {
  it('still exists, and still has an active resource per direction', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);

    for (const direction of Object.keys(trade.DIRECTIONS) as ('exports' | 'imports')[]) {
      const prefix = trade.DIRECTIONS[direction].namePrefix;
      const picked = ckan.pickLatestActive(pkg, prefix, 1);
      expect(picked.length, `no datastore-active ${prefix}* resource`).toBeGreaterThan(0);
      expect(picked[0].name).toContain(prefix);
    }
  });

  it('answers SQL aggregates, which ckan.js\'s docstring says it does not', async () => {
    // `api/shared/ckan.js` records "The portal's `datastore_search_sql` action
    // is disabled (it answers HTTP 409)". Measured 2026-09-01, it is not — a
    // 409 is what the portal returns for a *bad query*, and reading that as a
    // disabled action is two states collapsed into one artefact.
    //
    // This endpoint depends on the aggregate, so the disagreement is pinned
    // rather than left in a comment. If the portal ever genuinely disables it,
    // this fails and names the reason.
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);
    const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.exports.namePrefix, 1)[0];

    const rows = await trade.runSql(trade.newestPeriodSql(resource.id), OPTIONS);
    expect(rows.length, 'the SQL action returned no rows').toBeGreaterThan(0);
    expect(trade.num(rows[0].period_key)).not.toBeNull();
  });

  it('has a newest month inside living memory, read from the rows', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);

    for (const direction of Object.keys(trade.DIRECTIONS) as ('exports' | 'imports')[]) {
      const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS[direction].namePrefix, 1)[0];
      const { period } = await newestOf(resource.id);

      expect(period, `${direction} carries no readable month`).not.toBeNull();

      const behind = monthsBehind(period!);
      // Not negative: a period ahead of the wall clock would mean this is a
      // forecast rather than a reading, which is the trap that makes a source
      // structurally incapable of going stale. `telpiskas-juras-prognozes` on
      // this same portal runs nine days into the future for exactly that reason.
      expect(behind, `${direction} newest period ${period} is in the future`).toBeGreaterThanOrEqual(0);
      expect(behind, `${direction} newest period ${period} is ${behind} months behind`)
        .toBeLessThanOrEqual(MAX_MONTHS_BEHIND);
    }
  });
});

describe('the figures mean what the endpoint says they mean', () => {
  it('puts each direction inside its sanity band', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);

    for (const direction of Object.keys(trade.DIRECTIONS) as ('exports' | 'imports')[]) {
      const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS[direction].namePrefix, 1)[0];
      const { key } = await newestOf(resource.id);
      const rows = await trade.runSql(trade.totalSql(resource.id, key), OPTIONS);
      const total = trade.num(rows[0] && rows[0].value_eur);

      expect(total, `${direction} total is absent`).not.toBeNull();
      const band = BANDS[direction];
      expect(total, `${direction} total ${total} EUR is outside [${band.min}, ${band.max}]`)
        .toBeGreaterThan(band.min);
      expect(total).toBeLessThan(band.max);
    }
  });

  it('ranks partners in descending order, with shares that are shares', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);
    const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.exports.namePrefix, 1)[0];
    const { key } = await newestOf(resource.id);

    const [totalRows, partnerRows] = await Promise.all([
      trade.runSql(trade.totalSql(resource.id, key), OPTIONS),
      trade.runSql(trade.partnersSql(resource.id, key), OPTIONS),
    ]);
    const total = trade.num(totalRows[0].value_eur);
    const values = partnerRows.map((r: { value_eur: unknown }) => trade.num(r.value_eur));

    expect(values.length).toBeGreaterThan(3);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], 'the ranking is not descending').toBeLessThanOrEqual(values[i - 1]);
    }
    // The ranked head cannot exceed the whole, which is the cheap invariant
    // that catches a total and a ranking read from different months.
    const ranked = values.reduce((a: number, b: number) => a + b, 0);
    expect(ranked, 'the top partners sum to more than the month').toBeLessThanOrEqual(total * 1.001);
  });

  it('names the partner codes it actually returns', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);
    const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.exports.namePrefix, 1)[0];
    const { key } = await newestOf(resource.id);
    const rows = await trade.runSql(trade.partnersSql(resource.id, key), OPTIONS);

    const unnamed = rows
      .map((r: { partner: string }) => r.partner)
      .filter((code: string) => trade.partnerName(code) === null);

    // Not an assertion that every conceivable code is mapped — 160 appear in a
    // month and the tail is long. This is about the ones large enough to reach
    // the panel: an unnamed code there renders as `[XX]`, which is honest but
    // uninformative, and a code in the top twelve is worth naming.
    expect(unnamed, `top partner codes with no English name: ${unnamed.join(', ')}`).toEqual([]);
  });

  it('resolves every chapter it ranks to a Harmonised System name', async () => {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);
    const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.imports.namePrefix, 1)[0];
    const { key } = await newestOf(resource.id);
    const rows = await trade.runSql(trade.chaptersSql(resource.id, key), OPTIONS);

    const unnamed = rows
      .map((r: { chapter: unknown }) => trade.num(r.chapter))
      .filter((n: number | null) => n === null || trade.chapterName(n) === null);

    expect(unnamed, `ranked chapters with no name: ${unnamed.join(', ')}`).toEqual([]);
  });

  it('floors the chapter, because the chapter IS the leading two digits', async () => {
    // `floor` and `round` are both legal SQL returning a legal chapter number,
    // and they disagree: measured on 2026-06 exports, `round` reported 221.1m
    // EUR for chapter 85 where `floor` reports 191.3m, because CN code 84719000
    // is 84.719 and rounds *up* into chapter 85.
    //
    // The property tested here is the definition rather than a direction —
    // rounding shifts codes both ways, so no uniform inequality between the two
    // aggregates holds, and an earlier version of this test asserted one that
    // does not. The HS chapter of an eight-digit CN code is its leading two
    // digits, full stop, and that is checkable against real codes.
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, OPTIONS);
    const resource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.exports.namePrefix, 1)[0];
    const { key } = await newestOf(resource.id);

    const rows = await trade.runSql(
      `SELECT DISTINCT "Preces_KN_kods" AS k FROM "${resource.id}"` +
      ` WHERE ${trade.periodKeyExpr()} = ${key} LIMIT 2000`,
      OPTIONS,
    );
    const codes = rows.map((r: { k: unknown }) => trade.num(r.k)).filter((n: number | null) => n !== null);
    expect(codes.length, 'no CN codes came back — the comparison would prove nothing').toBeGreaterThan(100);

    const leadingTwo = (code: number) => Number(String(code).padStart(8, '0').slice(0, 2));

    const wrong = codes.filter((code: number) => Math.floor(code / 1000000) !== leadingTwo(code));
    expect(wrong.slice(0, 5), 'floor disagrees with the leading two digits').toEqual([]);

    // The control: `round` must actually get some of these wrong, or the choice
    // between the two is not load-bearing and this test is decorative.
    const roundWrong = codes.filter((code: number) => Math.round(code / 1000000) !== leadingTwo(code));
    expect(
      roundWrong.length,
      'round agreed with floor on every live code — the floor/round choice would be moot',
    ).toBeGreaterThan(0);
  });
});

describe('the status probe reads what the endpoint reads', () => {
  it('resolves the same resource the handler resolves', async () => {
    const registry = require('../api/shared/statusChecks.js');
    const check = registry.CHECKS.find((c: { name: string }) => c.name === 'CSP CN-8 trade');
    expect(check, 'the CN-8 check is missing from the registry').toBeTruthy();

    const pkg = await ckan.ckan('package_show', { id: check.dataset }, OPTIONS);
    const probeResource = ckan.pickLatestActive(pkg, check.namePrefix, 1)[0];
    const handlerResource = ckan.pickLatestActive(pkg, trade.DIRECTIONS.exports.namePrefix, 1)[0];

    // The probe and the handler must land on the same row of the same table.
    // `AGENTS.md` records three probes that drifted from their subject, and
    // every one of them restated a query instead of calling the builder.
    expect(probeResource.id).toBe(handlerResource.id);
  });
});
