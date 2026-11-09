import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const https = require('node:https');
const ckan = require('../api/shared/ckan.js');
const trade = require('../api/shared/tradeStats.js');
const status = require('../api/system-status/index.js');
const cache = require('../api/shared/cache.js');
const rateLimit = require('../api/shared/rateLimit.js');
const EXPORTS = '11111111-1111-1111-1111-111111111111';
const IMPORTS = '22222222-2222-2222-2222-222222222222';
const PRIOR = '33333333-3333-3333-3333-333333333333';
const TRADE_PACKAGE = {
  resources: [
    { id: EXPORTS, name: 'ATS_eksports_KN8_2026', datastore_active: true, created: '2026-03-01' },
    { id: IMPORTS, name: 'ATS_imports_KN8_2026', datastore_active: true, created: '2026-03-01' },
    { id: PRIOR, name: 'ATS_eksports_KN8_2025', datastore_active: true, created: '2025-03-01' },
  ],
};
const row = (partner: string, code: number, value: unknown) => ({
  Partnervalsts: partner, Preces_KN_kods: code, Statistiska_vertiba_EUR: value,
});
let asked: URL[];
let failure: string | null;
let truncated: boolean;

async function call(name: string) {
  const context = { res: { status: 0, body: '', headers: {} as Record<string, string> } };
  await require(`../api/${name}/index.js`)(context, { query: {}, headers: {} });
  return { ...context.res, body: JSON.parse(context.res.body) };
}

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  asked = [];
  failure = null;
  truncated = false;
  vi.spyOn(https, 'get').mockImplementation((...args: unknown[]) => {
    const url = new URL(String(args[0]));
    const callback = args[2] as (res: unknown) => void;
    asked.push(url);
    const req = Object.assign(new EventEmitter(), { destroy() {} });
    queueMicrotask(() => {
      let code = 200;
      let body: unknown;
      if (url.pathname.endsWith('datastore_search_sql')) {
        code = 400;
        body = { success: false, error: { message: 'Action name not known: datastore_search_sql' } };
      } else if (url.pathname.endsWith('package_show')) {
        const id = url.searchParams.get('id');
        body = { success: true, result: id === trade.DATASET ? TRADE_PACKAGE : {
          resources: [{ id: id!.startsWith('bis_jly') ? 'permits' : 'certs', datastore_active: true }],
        } };
      } else if (url.pathname.endsWith('datastore_search')) {
        if (failure) {
          code = 400;
          body = { success: false, error: { message: failure } };
        } else {
          const id = url.searchParams.get('resource_id');
          const fields = url.searchParams.get('fields');
          let records: object[];
          if (fields === 'Gads,Menesis') {
            records = [{ Gads: id === PRIOR ? 2025 : 2026, Menesis: id === PRIOR ? 12 : 9 }];
          } else if (id === 'permits') {
            records = ['Ogres novada būvvalde', 'Rīga', 'Rīga', '', 'Rīga']
              .map(Atbildigas_iestades_nosaukums => ({ Atbildigas_iestades_nosaukums }));
          } else if (id === 'certs') {
            records = [null, 'Centralizētā apkure', '', 'Centralizētā apkure', '']
              .map(Energonesejs => ({ Energonesejs }));
          } else {
            const filters = JSON.parse(url.searchParams.get('filters') || '{}');
            records = id === PRIOR
              ? (filters.Gads === 2025 && filters.Menesis === 9 ? [row('LT', 44000000, 50)] : [])
              : [row('LT', 84719000, '100'), row('EE', 85000000, 30),
                row('LT', 3049000, 0), row('EE', 85000000, 80), row('LT', 84719000, null)];
          }
          const offset = Number(url.searchParams.get('offset') || 0);
          const limit = Number(url.searchParams.get('limit') || 100);
          const page = truncated && offset > 0 ? [] : records.slice(offset, offset + Math.min(limit, 2));
          body = { success: true, result: { total: records.length, records: page } };
        }
      } else {
        throw new Error(`Unexpected request: ${url}`);
      }
      const res = Object.assign(new EventEmitter(), { statusCode: code, resume() {} });
      callback(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  });
});
afterEach(() => { vi.restoreAllMocks(); cache.clear(); rateLimit.reset(); });

describe('CKAN without the SQL action', () => {
  it('serves both endpoints from complete, projected datastore pages when SQL returns 400', async () => {
    await expect(ckan.ckan('datastore_search_sql', { sql: 'SELECT 1' }))
      .rejects.toThrow('HTTP 400');
    asked = [];
    const result = await call('trade-partners');
    expect(result.status).toBe(200);
    expect(result.body.unavailable).toBeUndefined();
    for (const direction of ['exports', 'imports']) {
      const side = result.body[direction];
      expect(side.period).toBe('2026-09');
      expect(side.totalEur).toBe(210);
      expect(side.lines).toBe(5);
      expect(side.partners.map((p: { code: string; valueEur: number }) => [p.code, p.valueEur]))
        .toEqual([['EE', 110], ['LT', 100]]);
      expect(side.chapters.map((p: { code: string; valueEur: number }) => [p.code, p.valueEur]))
        .toEqual([['HS85', 110], ['HS84', 100], ['HS03', 0]]);
    }
    expect(result.body.exports.previous).toEqual({ period: '2025-09', valueEur: 50, changePct: 320 });
    expect(result.body.imports.previous).toBeNull();
    const property = await call('property-data');
    expect(property.status).toBe(200);
    expect(property.body.constructionPermits[0]).toEqual({ municipality: 'Rīga', count: 3 });
    expect(property.body.energyCerts[0]).toEqual({ rating: 'Unknown', count: 3 });
    expect(property.body.totalPermits).toBe(5);
    expect(property.body.totalCerts).toBe(5);
    const pages = asked.filter(u => u.searchParams.has('offset'));
    expect(pages.filter(u => u.searchParams.get('resource_id') === EXPORTS)
      .map(u => u.searchParams.get('offset'))).toEqual(['0', '2', '4']);
    expect(pages.every(u => u.searchParams.get('sort') === '_id asc')).toBe(true);
    const newest = asked.filter(u => u.searchParams.get('fields') === 'Gads,Menesis');
    expect(newest.length).toBeGreaterThan(0);
    expect(newest.every(u => u.searchParams.get('sort') === 'Gads desc, Menesis desc' &&
      u.searchParams.get('limit') === '1')).toBe(true);
    expect(pages.find(u => u.searchParams.get('resource_id') === EXPORTS)?.searchParams.get('filters'))
      .toBe('{"Gads":2026,"Menesis":9}');
    expect(asked.some(u => u.pathname.endsWith('datastore_search_sql'))).toBe(false);
  });

  it('surfaces the upstream cause through selection, endpoint and status when every probe fails', async () => {
    failure = 'Action name not known: datastore_search';
    await expect(trade.selectNewestByData(TRADE_PACKAGE, 'exports'))
      .rejects.toThrow(`HTTP 400`);
    const result = await call('trade-partners');
    expect(result.body).toMatchObject({ unavailable: true, error: expect.stringContaining(failure) });
    expect(result.headers['Cache-Control']).toBe('no-store');
    const check = require('../api/shared/statusChecks.js').CHECKS.find((c: { name: string }) => c.name === 'CSP CN-8 trade');
    await expect(status.probe(check)).rejects.toThrow(failure);
  });

  it('uses the same sorted datastore read in the status probe', async () => {
    const check = require('../api/shared/statusChecks.js').CHECKS.find((c: { name: string }) => c.name === 'CSP CN-8 trade');
    expect(await status.probe(check)).toEqual({ period: '2026-09' });
    expect(asked.some(u => u.pathname.endsWith('datastore_search_sql'))).toBe(false);
  });

  it('refuses partial trade sums and reports each failed property breakdown with its cause', async () => {
    truncated = true;
    const result = await call('trade-partners');
    expect(result.body).toMatchObject({ unavailable: true, error: expect.stringContaining('2 of 5 rows') });
    const property = await call('property-data');
    for (const field of ['constructionPermits', 'energyCerts']) {
      expect(property.body[field]).toEqual([]);
      expect(property.body[field + 'Unavailable']).toEqual({
        unavailable: true, error: expect.stringContaining('2 of 5 rows'),
      });
    }
    expect(property.body.totalPermits).toBe(5);
    expect(property.body.totalCerts).toBe(5);
  });

  it('bounds rankings after aggregation, not before, and keeps zero distinct from absence', async () => {
    const scan = vi.spyOn(ckan, 'scanFields').mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => row(`P${i}`, (i + 1) * 1000000 + 700000, String(i))),
    );
    const month = await trade.readMonth(EXPORTS, 202609);
    expect(month.totalEur).toBe(190);
    expect(month.partners).toHaveLength(trade.TOP_PARTNERS);
    expect(month.partners[0]).toEqual({ partner: 'P19', value_eur: 19 });
    expect(month.chapters).toHaveLength(trade.TOP_CHAPTERS);
    expect(month.chapters[0]).toEqual({ chapter: 20, value_eur: 19 });
    scan.mockResolvedValue([row('LT', 44000000, 0)]);
    expect((await trade.readMonth(EXPORTS, 202609)).totalEur).toBe(0);
    scan.mockResolvedValue([row('LT', 44000000, null)]);
    expect(await trade.readMonth(EXPORTS, 202609)).toMatchObject({ totalEur: null, lines: 1, partners: [], chapters: [] });
    scan.mockResolvedValue([]);
    expect(await trade.readMonth(EXPORTS, 202609)).toMatchObject({ totalEur: null, lines: 0 });
  });

  it('keeps the working property breakdown when only its sibling fails', async () => {
    const scan = ckan.scanFields;
    vi.spyOn(ckan, 'scanFields').mockImplementation((...args: unknown[]) => {
      if (args[0] === 'permits') return Promise.reject(new Error('Permit source refused'));
      return scan(...args);
    });
    const property = await call('property-data');
    expect(property.body.constructionPermitsUnavailable).toEqual({ unavailable: true, error: 'Permit source refused' });
    expect(property.body.energyCertsUnavailable).toBeUndefined();
    expect(property.body.energyCerts[0]).toEqual({ rating: 'Unknown', count: 3 });
    expect(property.body.totalPermits).toBe(5);
  });

  it('does not hide an internal breakdown bug behind an upstream-unavailable response', async () => {
    vi.spyOn(ckan, 'scanFields').mockRejectedValue(new TypeError('Private handler bug'));
    const property = await call('property-data');
    expect(property.status).toBe(500);
    expect(property.body).toEqual({ error: 'Internal error' });
    expect(property.headers['Cache-Control']).toBe('no-store');
  });
});
