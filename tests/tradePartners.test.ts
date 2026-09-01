/**
 * The CN-8 trade endpoint, and the three ways it could be quietly wrong.
 *
 * This wires `ats_kn8_men` — Latvia's monthly customs data, by partner country
 * and eight-digit Combined Nomenclature code. Every assertion here exists
 * because a plausible, well-formed wrong answer was available:
 *
 *   1. THE PERIOD. `datastore_active` is not evidence. On this same portal
 *      `maksatnespejas-procesi` reports 15,660 rows, 23 fields and a newest
 *      proceeding of **2020-10-28** — six years frozen behind current-looking
 *      metadata, which is the maritime failure repeating. So the period is read
 *      from `MAX("Gads" * 100 + "Menesis")` over the rows, and these tests pin
 *      that it is the rows and not the file.
 *
 *   2. THE CHAPTER. `Preces_KN_kods` is numeric, and the portal refuses
 *      `substring()` with HTTP 403, so the HS2 chapter comes from division.
 *      `round` and `floor` both produce a well-formed chapter number and only
 *      one is right: measured on 2026-06 exports, `round` pulls the 84.5-and-up
 *      codes into chapter 85 and reports 221.1m EUR where the truth is 191.3m.
 *
 *   3. THE NAME. Six of the codes the cube uses are Eurostat geonomenclature
 *      rather than ISO 3166. A lookup that always returned a string would have
 *      to invent a country for `XU`, which carries 94m EUR a month.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const trade = require('../api/shared/tradeStats.js');
const endpoint = require('../api/trade-partners/index.js');

const { priorYearResource, rankPartners, rankChapters } = endpoint.__internals;
const { selectNewestByData } = trade;

/**
 * A runner that answers with a period per resource id.
 *
 * Passed in through `selectNewestByData`'s `runner` parameter — the same seam
 * `/api/system-status` uses to supply its own transport. Monkey-patching
 * `trade.runSql` would not work and should not: the function calls its
 * module-local binding, so an export swap cannot reach it. That is the correct
 * shape, and it means a test drives the injection rather than defeating it.
 */
function periodRunner(periods: Record<string, number | null>) {
  return async (statement: string) => {
    const id = /FROM "([0-9a-fA-F-]{36})"/.exec(statement)?.[1] ?? '';
    if (!(id in periods)) throw new Error(`unreadable resource ${id}`);
    const key = periods[id];
    return key === null ? [] : [{ period_key: String(key) }];
  };
}

/** A resource id shaped like the UUIDs CKAN issues. */
const EXPORTS_2026 = '5c5e712f-fb55-47f1-b9fe-786f93487e40';
const EXPORTS_2025 = '048026e2-3602-4db3-abf6-7de2f4e5eb36';
const IMPORTS_2026 = '0dc7bc00-6509-45bc-b415-9a1e8cdccc31';

/** The package shape `package_show` returns, reduced to what selection reads. */
function pkg(resources: { id: string; name: string; created: string; datastore_active?: boolean }[]) {
  return { resources: resources.map((r) => ({ datastore_active: true, ...r })) };
}

const REAL_PACKAGE = pkg([
  { id: IMPORTS_2026, name: 'ATS_imports_KN8_2026', created: '2026-03-12T00:00:00' },
  { id: EXPORTS_2026, name: 'ATS_eksports_KN8_2026', created: '2026-03-12T00:00:00' },
  { id: 'b6a82131-7210-4d9c-af47-e6489dd3d834', name: 'ATS_imports_KN8_2025', created: '2025-03-12T00:00:00' },
  { id: EXPORTS_2025, name: 'ATS_eksports_KN8_2025', created: '2025-03-12T00:00:00' },
  { id: '7981d623-b72a-4c95-b814-a60fbba5d6e5', name: 'Papildmērvienību skaidrojumi', created: '2022-11-04T00:00:00' },
]);

describe('the period comes from the rows, not from the metadata', () => {
  it('asks for the newest year AND month together, never either alone', () => {
    const sql = trade.newestPeriodSql(EXPORTS_2026);

    // `MAX("Gads")` finds 2026 and `MAX("Menesis")` finds 12, and December 2026
    // does not exist. Combining them is what makes the comparison mean what it
    // says, so the combination is what is asserted — not the presence of MAX.
    expect(sql).toContain('"Gads" * 100 + "Menesis"');
    expect(sql).toMatch(/MAX\(\s*"Gads" \* 100 \+ "Menesis"\s*\)/);
  });

  it('reads a period key back into the month it names', () => {
    expect(trade.periodLabel(202606)).toBe('2026-06');
    expect(trade.periodLabel(202612)).toBe('2026-12');
    // Single-digit months are padded, so a label sorts lexically. `2026-6`
    // would sort after `2026-12`, which is how a dateline names the wrong month.
    expect(trade.periodLabel(202601)).toBe('2026-01');
  });

  it('refuses a key that is not a month rather than inventing one', () => {
    // Month 13 and month 0 are both well-formed integers and neither is a
    // month. Returning null is what lets the endpoint throw instead of
    // dating a panel to a period that does not exist.
    expect(trade.periodLabel(202613)).toBeNull();
    expect(trade.periodLabel(202600)).toBeNull();
    expect(trade.periodLabel(null)).toBeNull();
    expect(trade.periodLabel('')).toBeNull();
    expect(trade.periodLabel(NaN)).toBeNull();
  });

  it('round-trips a label through a key', () => {
    for (const label of ['2026-06', '2025-01', '2019-12']) {
      expect(trade.periodLabel(trade.periodKey(label))).toBe(label);
    }
    expect(trade.periodKey('2026-13')).toBeNull();
    expect(trade.periodKey('2026-6')).toBeNull();
  });
});

describe('the HS chapter is floored, because rounding is well-formed and wrong', () => {
  it('divides and floors, and does not round', () => {
    const expr = trade.chapterExpr();
    expect(expr).toBe('floor("Preces_KN_kods" / 1000000)');
    // Pinned by name. `round` on this expression is a legal SQL function that
    // returns a legal chapter number, and reports 221.1m EUR for chapter 85
    // where the truth is 191.3m — measured on live 2026-06 exports.
    expect(expr).not.toContain('round');
  });

  it('does not use substring, which this portal refuses with HTTP 403', () => {
    // The obvious way to take the first two digits. Measured: forbidden.
    // 403 is "forbidden" and 409 is "your SQL is wrong" — a distinction that
    // matters, because reading one as the other is how `ckan.js` came to record
    // the whole SQL action as disabled when it is not.
    expect(trade.chaptersSql(EXPORTS_2026, 202606)).not.toContain('substring');
  });

  it('names a chapter a reader can hold, or admits it cannot', () => {
    expect(trade.chapterName(44)).toBe('Wood and wood articles');
    expect(trade.chapterName(27)).toBe('Mineral fuels and oils');
    expect(trade.chapterName(85)).toBe('Electrical machinery');
    // 77 is reserved and unused in the Harmonised System. Null, not a guess.
    expect(trade.chapterName(77)).toBeNull();
    expect(trade.chapterName(0)).toBeNull();
    expect(trade.chapterName(null)).toBeNull();
  });

  it('pads a chapter code so it reads as a code', () => {
    expect(trade.chapterCode(4)).toBe('HS04');
    expect(trade.chapterCode(44)).toBe('HS44');
    expect(trade.chapterCode(0)).toBeNull();
    expect(trade.chapterCode(100)).toBeNull();
  });
});

describe('a partner code is named or shown, never invented', () => {
  it('names the ordinary ISO codes', () => {
    expect(trade.partnerName('LT')).toBe('Lithuania');
    expect(trade.partnerName('EE')).toBe('Estonia');
    expect(trade.partnerName('DE')).toBe('Germany');
    expect(trade.partnerName('lt')).toBe('Lithuania');
  });

  it('names the six codes that are not countries', () => {
    // Measured live: 160 partner codes appear in one month, and these are the
    // ones that are Eurostat geonomenclature rather than ISO 3166. `XU` alone
    // carries about 94m EUR a month, so filing it under "unknown" would drop a
    // real quantity into a bucket that reads as a failure.
    expect(trade.partnerName('XU')).toBe('United Kingdom (excl. N. Ireland)');
    expect(trade.partnerName('XI')).toBe('Northern Ireland');
    expect(trade.partnerName('QS')).toContain('Not specified');
    expect(trade.partnerName('QR')).toContain('Not specified');
  });

  it('returns null for a code it does not know, rather than a plausible name', () => {
    expect(trade.partnerName('ZZ')).toBeNull();
    expect(trade.partnerName('')).toBeNull();
    expect(trade.partnerName(null)).toBeNull();
    expect(trade.partnerName(undefined)).toBeNull();
  });

  it('does not collide two different codes onto one name', () => {
    // `XS` is Serbia in the cube's own scheme and `RS` is Serbia in ISO. Both
    // resolve, and they are distinct keys — a map that folded them would make
    // two rows of a ranking look like one duplicated row.
    expect(trade.partnerName('XS')).toBeTruthy();
    expect(trade.partnerName('RS')).toBeTruthy();
    const names = Object.keys(trade.COUNTRY_NAMES);
    expect(new Set(names).size, 'a duplicated key silently overwrites').toBe(names.length);
  });
});

describe('resource selection asks the data, because no metadata field is right', () => {
  /**
   * Both counter-examples are live on data.gov.lv, and they disagree about
   * which field to trust — which is the whole reason the selection reads the
   * data instead of either one.
   *
   *   ATS_eksports_KN8_2026  created 2026-03-12  modified 2026-08-11  2026-06
   *   ATS_eksports_KN8_2025  created 2025-03-12  modified 2026-08-11  2025-12
   *     last_modified is IDENTICAL — CSP revised both files in one pass — so
   *     sorting by it is a coin flip between this year and last.
   *
   *   maksatnespejas-procesi  two resources, THE SAME NAME
   *     8065ad80  created 11:47:43  modified 2026-08-31  live, 17,983 rows
   *     0f6587a0  created 11:48:14  modified (none)      dead since 2020-10-28
   *     The ABANDONED one was created thirty-one seconds later, so `created`
   *     descending picks the corpse.
   *
   * A reviewer of the first draft of this endpoint caught exactly that: it
   * sorted by `created`, and a sweep built the same way reported the package
   * dead when its live resource had been updated the previous evening.
   */
  it('takes the resource holding the newest month, not the newest file', async () => {
    const picked = await selectNewestByData(REAL_PACKAGE, 'exports', {}, periodRunner({
      [EXPORTS_2026]: 202606,
      [EXPORTS_2025]: 202512,
    }));
    expect(picked.resource.name).toBe('ATS_eksports_KN8_2026');
    expect(picked.key).toBe(202606);
  });

  it('prefers the newer DATA even when the older file was modified last', async () => {
    // The `maksatnespejas-procesi` shape, generalised: whichever resource the
    // metadata would favour, the one carrying the newer month wins.
    const picked = await selectNewestByData(REAL_PACKAGE, 'exports', {}, periodRunner({
      [EXPORTS_2026]: 202401,
      [EXPORTS_2025]: 202512,
    }));
    expect(picked.resource.name, 'the newest month must win regardless of file dates')
      .toBe('ATS_eksports_KN8_2025');
  });

  it('separates imports from exports by name prefix', async () => {
    const runner = periodRunner({ [EXPORTS_2026]: 202606, [EXPORTS_2025]: 202512, [IMPORTS_2026]: 202606 });
    const ex = await selectNewestByData(REAL_PACKAGE, 'exports', {}, runner);
    const im = await selectNewestByData(REAL_PACKAGE, 'imports', {}, runner);
    expect(ex.resource.name).toContain('eksports');
    expect(im.resource.name).toContain('imports');
  });

  it('does not mistake the units glossary for a data resource', async () => {
    // Sorting the whole package by `last_modified` picks `Papildmērvienību
    // skaidrojumi` — measured live. The prefix is what excludes it.
    const picked = await selectNewestByData(REAL_PACKAGE, 'exports', {}, periodRunner({
      [EXPORTS_2026]: 202606, [EXPORTS_2025]: 202512,
    }));
    expect(picked.resource.name).not.toContain('Papildmērvienību');
  });

  it('survives one unreadable candidate rather than losing the direction', async () => {
    // An abandoned twin that no longer answers is exactly the case this
    // function exists for, so it must not take its live sibling down.
    const picked = await selectNewestByData(REAL_PACKAGE, 'exports', {}, periodRunner({
      [EXPORTS_2025]: 202512,
    }));
    expect(picked.resource.name).toBe('ATS_eksports_KN8_2025');
  });

  it('reports a direction with no readable month as absent, not as the other one', async () => {
    expect(await selectNewestByData(REAL_PACKAGE, 'exports', {}, periodRunner({}))).toBeNull();
  });

  it('ignores a resource the datastore will not serve', async () => {
    const inactive = pkg([
      { id: EXPORTS_2026, name: 'ATS_eksports_KN8_2026', created: '2026-03-12T00:00:00', datastore_active: false },
      { id: EXPORTS_2025, name: 'ATS_eksports_KN8_2025', created: '2025-03-12T00:00:00' },
    ]);
    const picked = await selectNewestByData(inactive, 'exports', {}, periodRunner({
      [EXPORTS_2026]: 202606, [EXPORTS_2025]: 202512,
    }));
    expect(picked.resource.name).toBe('ATS_eksports_KN8_2025');
  });

  it('refuses a direction it does not know', async () => {
    await expect(selectNewestByData(REAL_PACKAGE, 'sideways', {}, periodRunner({})))
      .rejects.toThrow(/Unknown trade direction/);
  });

  it('bounds how many candidates one request will interrogate', () => {
    // An unbounded package would turn one reader's request into dozens of
    // upstream calls. Three excludes the 2005–2020 archive, whose MAX()
    // measured 1547ms across 3.7M rows against ~350ms for each per-year
    // file — and which cannot hold the newest month anyway.
    expect(trade.MAX_CANDIDATES).toBeLessThanOrEqual(4);
    expect(trade.MAX_CANDIDATES).toBeGreaterThan(1);
  });
});

describe('the year-on-year comparison is addressed by label', () => {
  it('finds the same direction one year back', () => {
    const prior = priorYearResource(REAL_PACKAGE, 'exports', 2026);
    expect(prior).not.toBeNull();
    expect(prior.name).toBe('ATS_eksports_KN8_2025');
    expect(prior.id).toBe(EXPORTS_2025);
  });

  it('does not cross directions', () => {
    // The failure this guards: reaching for "the previous resource" and getting
    // last year's IMPORTS while labelling it exports.
    expect(priorYearResource(REAL_PACKAGE, 'imports', 2026).name).toBe('ATS_imports_KN8_2025');
    expect(priorYearResource(REAL_PACKAGE, 'exports', 2026).name).not.toContain('imports');
  });

  it('returns null when the previous year was never published', () => {
    // Omitted, not approximated. A comparison against a different period is a
    // confident wrong number; no comparison is an honest absence.
    expect(priorYearResource(REAL_PACKAGE, 'exports', 2019)).toBeNull();
  });

  it('names the previous year by convention rather than by position', () => {
    expect(trade.resourceNameFor('exports', 2025)).toBe('ATS_eksports_KN8_2025');
    expect(trade.resourceNameFor('imports', 2025)).toBe('ATS_imports_KN8_2025');
    expect(() => trade.resourceNameFor('sideways', 2025)).toThrow(/Unknown trade direction/);
  });
});

describe('ranking a month, including the rows that are not there', () => {
  const TOTAL = 1000;

  it('keeps the ranked total separate from the reported total', () => {
    const { rows, rankedEur } = rankPartners(
      [{ partner: 'LT', value_eur: '600' },
        { partner: 'EE', value_eur: '300' }],
      TOTAL,
    );
    expect(rankedEur).toBe(900);
    // The remainder the panel states comes from the difference, so a top-N
    // ranking never implies it is everything.
    //
    // `rows` arrives from a `require`d CommonJS module and is therefore `any`,
    // so the callback parameter needs an annotation under `noImplicitAny`.
    // `npx vitest run` cannot see that — esbuild strips types without checking
    // them — which is why the gate here has to be `npm test`.
    expect(rows.map((r: { share: number | null }) => r.share)).toEqual([0.6, 0.3]);
  });

  it('reads the portal\'s stringified sums as numbers', () => {
    // `datastore_search_sql` returns SUM() as a *string*. Left as one, `+`
    // concatenates and the remainder arithmetic silently produces nonsense.
    const { rows } = rankPartners([{ partner: 'LT', value_eur: '600' }], TOTAL);
    expect(rows[0].valueEur).toBe(600);
    expect(typeof rows[0].valueEur).toBe('number');
  });

  it('drops a row with no value rather than counting it as zero', () => {
    // A confident zero is this codebase's signature failure — a missing dataset
    // once rendered as "0 Suspended Activities" and looked entirely fine.
    const { rows, rankedEur } = rankPartners(
      [{ partner: 'LT', value_eur: '600' }, { partner: 'ZZ', value_eur: null }],
      TOTAL,
    );
    expect(rows).toHaveLength(1);
    expect(rankedEur).toBe(600);
  });

  it('carries a null name through, so the panel can show the code', () => {
    const { rows } = rankPartners([{ partner: 'ZZ', value_eur: '5' }], TOTAL);
    expect(rows[0].code).toBe('ZZ');
    expect(rows[0].name).toBeNull();
  });

  it('reports share as null when the total is unknown, never as zero', () => {
    const { rows } = rankPartners([{ partner: 'LT', value_eur: '600' }], null);
    expect(rows[0].share).toBeNull();
  });

  it('survives a payload that is not the shape it claims', () => {
    for (const hostile of [undefined, null, []]) {
      expect(() => rankPartners(hostile as never, TOTAL)).not.toThrow();
      expect(() => rankChapters(hostile as never, TOTAL)).not.toThrow();
    }
  });

  it('drops a chapter row with no chapter, which would otherwise rank as HS00', () => {
    const { rows } = rankChapters(
      [{ chapter: 44, value_eur: '100' }, { chapter: null, value_eur: '50' }],
      TOTAL,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('HS44');
    expect(rows[0].name).toBe('Wood and wood articles');
  });
});

describe('the statements are built, not concatenated from anything a caller sends', () => {
  it('refuses a resource id that is not a UUID', () => {
    // These identifiers come from `package_show` rather than from a reader, so
    // this is a programming error rather than an injection vector — but a stray
    // quote would change the shape of the statement, so it is refused instead
    // of escaped.
    for (const bad of ['" OR 1=1 --', 'not-a-uuid', '', null]) {
      expect(() => trade.newestPeriodSql(bad)).toThrow(/non-UUID/);
      expect(() => trade.partnersSql(bad, 202606)).toThrow(/non-UUID/);
    }
  });

  it('refuses a period that is not a period, rather than emitting NaN', () => {
    // `Number('202606; DROP TABLE x')` is NaN, and NaN interpolates into the
    // statement as the literal text `NaN`. The injection is gone either way —
    // but what replaces it is a MALFORMED QUERY, which the portal answers with
    // HTTP 409, and this codebase has already misread a 409 once as "the action
    // is disabled". Refusing here fails at the mistake, with the value that
    // caused it, instead of at an upstream that can only say the SQL was bad.
    for (const bad of ['202606; DROP TABLE x', 'abc', null, undefined, 202606.5, 13]) {
      expect(() => trade.partnersSql(EXPORTS_2026, bad)).toThrow(/non-period key/);
      expect(() => trade.chaptersSql(EXPORTS_2026, bad)).toThrow(/non-period key/);
      expect(() => trade.totalSql(EXPORTS_2026, bad)).toThrow(/non-period key/);
    }
  });

  it('emits a real period as a bare integer', () => {
    const sql = trade.partnersSql(EXPORTS_2026, 202606);
    expect(sql).toContain('= 202606');
    expect(sql).not.toContain('NaN');
  });

  it('bounds every ranking', () => {
    expect(trade.partnersSql(EXPORTS_2026, 202606)).toContain(`LIMIT ${trade.TOP_PARTNERS}`);
    expect(trade.chaptersSql(EXPORTS_2026, 202606)).toContain(`LIMIT ${trade.TOP_CHAPTERS}`);
  });

  it('builds its URL through the CKAN client rather than assembling one', () => {
    const url = trade.sqlUrl('SELECT 1');
    expect(url).toContain('/datastore_search_sql?sql=');
    // Encoded, so a statement containing & or = cannot truncate the query.
    expect(url).toContain('SELECT%201');
  });
});

describe('the numbers the panel receives are the ones the cube holds', () => {
  it('turns an absent aggregate into null, never into NaN', () => {
    // NaN compares false against everything, which is how a missing wave height
    // once rendered as "Very Rough" in this codebase.
    for (const absent of [null, undefined, '']) expect(trade.num(absent)).toBeNull();
    expect(trade.num('not a number')).toBeNull();
    expect(trade.num(Infinity)).toBeNull();
  });

  it('keeps a genuine zero, which is a reading rather than an absence', () => {
    expect(trade.num(0)).toBe(0);
    expect(trade.num('0')).toBe(0);
  });
});

describe('the response cache cannot serve one subject under another', () => {
  it('declares no query parameters, because the handler reads none', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../api/trade-partners/index.js'), 'utf8');
    expect(source).toMatch(/keyOn: \[\]/);
    // The claim behind the empty list: nothing is read off the query string.
    // `req.query` appearing here would make `keyOn: []` a lie, and the failure
    // is not a slow page — it is one request's answer under another's key.
    const handlerBody = source.slice(source.indexOf('const handler ='), source.indexOf('module.exports ='));
    expect(handlerBody).not.toMatch(/req\.query/);
  });
});
