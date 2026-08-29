/**
 * `/api/property-data` published the page size as the dataset total.
 *
 * `total: records.length` was a flat 500 against 324,119 construction cases,
 * rendered to a reader with `toLocaleString()` — punctuated, so presented as a
 * count worth reading. The ranking beside it was tallied from the same page,
 * and `datastore_search` returns rows in `_id` order, so that page was `_id`
 * 1..500: the oldest 0.15% of the table, which is a contiguous block rather
 * than a sample.
 *
 * Measured against the live datastore, the block was not merely imprecise, it
 * was wrong about the subject:
 *
 *     oldest 500 rows      Adazi 189, Rezekne 134, Tukums 115
 *     all 324,119 rows     RIGA 52,033, Ogre 12,361, Marupe 11,693
 *
 * Riga leads by four times the next authority and did not appear in the
 * published list at all; Adazi is eighth.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const https = require('https');

type Reply = { status?: number; body: unknown };
let routes: Array<{ match: RegExp; reply: Reply }> = [];
let asked: string[] = [];
let originalGet: typeof https.get;

function stubHttps() {
  originalGet = https.get;
  https.get = (url: string, _opts: unknown, cb?: (r: unknown) => void) => {
    const done = typeof _opts === 'function' ? (_opts as (r: unknown) => void) : cb!;
    asked.push(url);
    const hit = routes.find((r) => r.match.test(url));
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
    res.statusCode = hit && hit.reply.status ? hit.reply.status : (hit ? 200 : 404);
    res.resume = () => {};
    setImmediate(() => {
      done(res);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.emit('data', JSON.stringify(hit ? hit.reply.body : {}));
      }
      res.emit('end');
    });
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    return req;
  };
}

function callApi() {
  delete require.cache[require.resolve('../api/property-data/index.js')];
  const cache = require('../api/shared/cache.js');
  cache.clear();
  const handler = require('../api/property-data/index.js');
  const ctx: { res?: { body: string; status: number } } = {};
  return handler(ctx, { query: {}, headers: {} })
    .then(() => ({ status: ctx.res!.status, body: JSON.parse(ctx.res!.body) }));
}

/** A package with one datastore-active resource. */
function pkg(id: string) {
  return { success: true, result: { resources: [{ id, datastore_active: true }] } };
}
/** `datastore_search` reports the whole table's `total` however few rows it returns. */
function search(total: number) {
  return { success: true, result: { total, records: [{ _id: 1 }] } };
}
function groupRows(rows: Array<[string | null, number]>) {
  return { success: true, result: { records: rows.map(([k, n]) => ({ k, n })) } };
}

describe('/api/property-data reports the dataset, not the page', () => {
  beforeEach(() => {
    asked = [];
    stubHttps();
    routes = [
      { match: /package_show\?id=bis_jlyakg7hgslonjnwyrwc6w/, reply: { body: pkg('res-construction') } },
      { match: /package_show\?id=bis_yjv2q8uzi-oidtg81mkifg/, reply: { body: pkg('res-certs') } },
      { match: /datastore_search\?resource_id=res-construction/, reply: { body: search(324119) } },
      { match: /datastore_search\?resource_id=res-certs/, reply: { body: search(48269) } },
      { match: /datastore_search_sql.*res-construction/, reply: {
        body: groupRows([['RĪGAS VALSTSPILSĒTAS DEPARTAMENTS', 52033], ['', 18198], ['Ogres novada būvvalde', 12361]]) } },
      { match: /datastore_search_sql.*res-certs/, reply: {
        body: groupRows([[null, 21037], ['Centralizētā apkure', 20143]]) } },
    ];
  });
  afterEach(() => { https.get = originalGet; });

  it('takes the total from the datastore, never from how many rows it read', async () => {
    const { body } = await callApi();
    expect(body.totalPermits).toBe(324119);
    expect(body.totalCerts).toBe(48269);
    // The old value was the page size. It must not be able to come back.
    expect(body.totalPermits).not.toBe(500);
    expect(body.totalCerts).not.toBe(500);
  });

  it('ranks across the whole table, so the largest authority is not missing', async () => {
    const { body } = await callApi();
    expect(body.constructionPermits[0]).toEqual({
      municipality: 'RĪGAS VALSTSPILSĒTAS DEPARTAMENTS', count: 52033,
    });
    // Aggregated, not tallied: a page tally could never produce a count larger
    // than the page it was tallied from.
    expect(body.constructionPermits[0].count).toBeGreaterThan(500);
  });

  it('keeps the rows that record nothing, rather than showing a profile of the rest', async () => {
    // 21,037 of 48,269 certificates carry no energy carrier. Dropping them
    // would render the 57% that do and imply it was the whole.
    const { body } = await callApi();
    expect(body.energyCerts[0]).toEqual({ rating: 'Unknown', count: 21037 });
    const blank = body.constructionPermits.find((p: { municipality: string }) => p.municipality === 'Unknown');
    expect(blank).toEqual({ municipality: 'Unknown', count: 18198 });
  });

  it('omits the ranking when the datastore will not aggregate, rather than tallying a page', async () => {
    // The fallback must not be the behaviour this replaced. An empty list is an
    // honest empty state in the tile; a block-of-500 tally is a wrong ranking.
    routes = routes.filter((r) => !/search_sql/.test(String(r.match)));
    const { body } = await callApi();
    expect(body.constructionPermits).toEqual([]);
    expect(body.energyCerts).toEqual([]);
    // The totals come from a different call and survive.
    expect(body.totalPermits).toBe(324119);
    expect(body.totalCerts).toBe(48269);
  });

  it('treats CKAN\u2019s HTTP 200 with success:false as a failure', async () => {
    // The portal answers 200 for an action it does not have, so a status check
    // alone would read the refusal as an aggregation result.
    routes = routes.map((r) => (/search_sql/.test(String(r.match))
      ? { match: r.match, reply: { status: 200, body: { success: false, error: { message: 'no such action' } } } }
      : r));
    const { body } = await callApi();
    expect(body.constructionPermits).toEqual([]);
    expect(body.totalPermits).toBe(324119);
  });

  it('asks the datastore to aggregate rather than downloading rows to count', async () => {
    await callApi();
    const sqlCalls = asked.filter((u) => u.includes('datastore_search_sql'));
    expect(sqlCalls.length).toBe(2);
    expect(sqlCalls.every((u) => /GROUP\+BY|GROUP%20BY/.test(u))).toBe(true);
    // No 500-row page is fetched any more.
    expect(asked.some((u) => /datastore_search\?[^&]*&limit=500/.test(u))).toBe(false);
  });
});
