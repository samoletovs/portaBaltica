import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
interface Response { status: number; headers: Record<string, string>; body: string }
type Handler = (context: { res?: Response }, req: { query: Record<string, unknown>; headers: object }) => Promise<void>;
interface Transport {
  get: (url: string, options: unknown, callback: (response: EventEmitter & { statusCode: number; resume: () => void }) => void) => EventEmitter;
  request: (options: { path: string }, callback: (response: EventEmitter & { statusCode: number; resume: () => void }) => void) => EventEmitter;
}
const https: Transport = require('node:https');
const es: { httpJson: (url: string, options?: unknown) => Promise<unknown> } = require('../api/shared/eurostat.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const rateLimit: { reset: () => void } = require('../api/shared/rateLimit.js');
let requests: string[];
let respond: (url: string) => unknown;
let post: () => unknown;

function cube(periods: string[], value: unknown, geo = false) {
  return {
    id: geo ? ['geo', 'time'] : ['TIME'],
    size: geo ? [1, periods.length] : [periods.length],
    dimension: {
      ...(geo ? { geo: { category: { index: { LV: 0 }, label: { LV: 'Latvia' } } } } : {}),
      [geo ? 'time' : 'TIME']: { category: { index: Object.fromEntries(periods.map((p, i) => [p, i])) } },
    },
    value,
  };
}

const prices = () => ({
  success: true,
  data: Object.fromEntries(['ee', 'lv', 'lt', 'fi'].map(zone => [zone,
    [0, 15, 30, 45].map((minute, i) => ({
      timestamp: Date.parse(`2026-09-05T06:${String(minute).padStart(2, '0')}:00Z`) / 1000,
      price: 10 * (i + 1),
    })),
  ])),
});

function transport(url: string, callback: Parameters<Transport['get']>[2], isPost = false) {
  const request = Object.assign(new EventEmitter(), {
    destroy(error?: Error) { if (error) request.emit('error', error); },
    write() {},
    end() { deliver(); },
  });
  function deliver() {
    queueMicrotask(() => {
      try {
        requests.push(url);
        const body = isPost ? post() : respond(url);
        const response = Object.assign(new EventEmitter(), { statusCode: 200, resume() {} });
        callback(response);
        queueMicrotask(() => {
          response.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
          response.emit('end');
        });
      } catch (error) { request.emit('error', error); }
    });
  }
  if (!isPost) deliver();
  return request;
}

async function call<T>(name: string, query: Record<string, unknown> = {}) {
  const handler: Handler = require(`../api/${name}/index.js`);
  const context: { res?: Response } = {};
  await handler(context, { query, headers: {} });
  if (!context.res) throw new Error('Handler did not respond');
  const body: T = JSON.parse(context.res.body);
  return { ...context.res, body };
}

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  requests = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-05T06:45:00Z'));
  respond = url => {
    if (url.includes('elering')) return prices();
    if (url.includes('ecb.europa')) return "<Cube time='2026-09-04'><Cube currency='USD' rate='1.17'/></Cube>";
    if (url.includes('open-meteo')) return { utc_offset_seconds: 0, current: {
      time: '2026-09-05T06:00', temperature_2m: 18, wind_speed_10m: 2,
      relative_humidity_2m: 50, weather_code: 0, pm2_5: 4, european_aqi: 12, nitrogen_dioxide: 3,
    } };
    return cube(['2026-06', '2026-07'], [7.2, 7.3], true);
  };
  post = () => cube(['2025M11', '2025M12'], [6.9, 7]);
  vi.spyOn(https, 'get').mockImplementation((url, _options, callback) => transport(url, callback));
  vi.spyOn(https, 'request').mockImplementation((options, callback) => transport(options.path, callback, true));
  vi.spyOn(es, 'httpJson').mockImplementation(async url => {
    requests.push(url);
    return respond(url);
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); cache.clear(); rateLimit.reset(); });

describe('delivery intervals, through the actual cached handlers', () => {
  it('selects the current quarter-hour in economy and insights', async () => {
    const economy = await call<{ electricityCurrent: number }>('economy-data', { country: 'ee' });
    const insights = await call<{ insights: { headline: string }[] }>('ai-insights', { country: 'ee' });
    expect(economy.body.electricityCurrent).toBe(40);
    expect(insights.body.insights.some(i => i.headline === 'Electricity €40.00/MWh')).toBe(true);
  });

  it.each(['economy-data', 'ai-insights', 'power-prices'])('expires %s at the next interval, including downstream caches', async name => {
    vi.setSystemTime(new Date('2026-09-05T06:14:00Z'));
    const first = await call<object>(name, { country: 'ee' });
    expect(Number(first.headers['Cache-Control'].match(/max-age=(\d+)/)?.[1])).toBeLessThanOrEqual(60);
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    const second = await call<{ electricityCurrent?: number; currentTime?: string; insights?: { headline: string }[] }>(name, { country: 'ee' });
    expect(second.headers['X-Cache']).toBe('miss');
    if (name === 'economy-data') expect(second.body.electricityCurrent).toBe(20);
    if (name === 'ai-insights') expect(second.body.insights?.some(i => i.headline === 'Electricity €20.00/MWh')).toBe(true);
    if (name === 'power-prices') expect(second.body.currentTime).toBe('2026-09-05T06:15:00.000Z');
  });

  it('does not present an expired delivery interval as current', async () => {
    vi.setSystemTime(new Date('2026-09-05T08:00:00Z'));
    const power = await call<{ currentTime: string | null }>('power-prices');
    expect(power.body.currentTime).toBeNull();
  });

  it('does not extend a delivery interval across a missing quarter-hour', async () => {
    vi.setSystemTime(new Date('2026-09-05T06:20:00Z'));
    respond = () => ({ success: true, data: Object.fromEntries(['ee', 'lv', 'lt'].map(zone => [
      zone, [0, 30].map(minute => ({
        timestamp: Date.parse(`2026-09-05T06:${String(minute).padStart(2, '0')}:00Z`) / 1000, price: 50,
      })),
    ])) });
    const economy = await call<{ electricityCurrent: number | null }>('economy-data', { country: 'ee' });
    const power = await call<{ currentTime: string | null }>('power-prices');
    expect(economy.body.electricityCurrent).toBeNull();
    expect(power.body.currentTime).toBeNull();
  });

  it.each(['economy-data', 'power-prices', 'ai-insights'])('reselects published prices through a boundary and upstream failure: %s', async name => {
    interface PriceBody {
      electricityCurrent?: number | null;
      electricityCurrentTime?: string | null;
      currentTime?: string | null;
      zones?: { id: string; current: number | null }[];
      insights?: { headline: string }[];
      priceSchedule: { retrievedAt: string; stale: boolean };
      fetchedAt?: string;
    }
    function expectCurrent(body: PriceBody, price: number, time: string) {
      if (name === 'economy-data') {
        expect(body.electricityCurrent).toBe(price);
        expect(body.electricityCurrentTime).toBe(time);
      }
      if (name === 'power-prices') {
        expect(body.currentTime).toBe(time);
        expect(body.zones?.find(zone => zone.id === 'ee')?.current).toBe(price);
      }
      if (name === 'ai-insights') expect(body.insights?.some(i => i.headline === `Electricity €${price.toFixed(2)}/MWh`)).toBe(true);
    }
    vi.setSystemTime(new Date('2026-09-05T06:14:00Z'));
    expect((await call(name, { country: 'ee' })).status).toBe(200);
    const goodResponder = respond;
    respond = url => {
      if (url.includes('elering')) throw Object.assign(new Error('HTTP 503'), { status: 503 });
      return goodResponder(url);
    };
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    const boundary = await call<PriceBody>(name, { country: 'ee' });
    expect(boundary.status).toBe(200);
    expectCurrent(boundary.body, 20, '2026-09-05T06:15:00.000Z');
    expect(boundary.body.priceSchedule.retrievedAt).toBe('2026-09-05T06:14:00.000Z');
    expect(boundary.body.priceSchedule.stale).toBe(false);
    expect(requests.filter(u => u.includes('elering'))).toHaveLength(1);

    // Past the raw schedule TTL: exercise failure grace, not just a fresh cache hit.
    vi.setSystemTime(new Date('2026-09-05T06:31:00Z'));
    const stale = await call<PriceBody>(name, { country: 'ee' });
    expect(stale.status).toBe(200);
    expectCurrent(stale.body, 30, '2026-09-05T06:30:00.000Z');
    expect(stale.body.priceSchedule).toEqual({ retrievedAt: '2026-09-05T06:14:00.000Z', stale: true });
    expect(requests.filter(u => u.includes('elering')).length).toBeGreaterThan(1);
    if (name !== 'ai-insights') expect(stale.body.fetchedAt).toBe('2026-09-05T06:14:00.000Z');

    vi.setSystemTime(new Date('2026-09-05T07:01:00Z'));
    const exhausted = await call<PriceBody>(name, { country: 'ee' });
    expect(exhausted.status).toBe(200);
    if (name === 'economy-data') expect(exhausted.body.electricityCurrent).toBeNull();
    if (name === 'power-prices') expect(exhausted.body.currentTime).toBeNull();
    if (name === 'ai-insights') expect(exhausted.body.insights?.some(i => i.headline === 'Electricity: day average €25/MWh')).toBe(true);

    vi.setSystemTime(new Date(name === 'economy-data' ? '2026-09-05T08:16:00Z' : '2026-09-05T07:16:00Z'));
    const expired = await call<PriceBody>(name, { country: 'ee' });
    if (name === 'power-prices') expect(expired.status).toBe(502);
    else expect(expired.body.priceSchedule).toBeNull();
  });

  it.each(['economy-data', 'power-prices', 'ai-insights'])('keeps already published next-day prices across midnight: %s', async name => {
    const goodResponder = respond;
    respond = url => url.includes('elering') ? {
      success: true,
      data: Object.fromEntries(['lv', 'ee', 'lt'].map(zone => [zone,
        ['2026-09-05T23:45:00Z', '2026-09-06T00:00:00Z'].map((time, i) => ({
          timestamp: Date.parse(time) / 1000, price: (i + 1) * 10,
        })),
      ])),
    } : goodResponder(url);
    vi.setSystemTime(new Date('2026-09-05T23:59:00Z'));
    await call(name, { country: 'ee' });
    respond = url => {
      if (url.includes('elering')) throw Object.assign(new Error('HTTP 503'), { status: 503 });
      return goodResponder(url);
    };
    vi.setSystemTime(new Date('2026-09-06T00:01:00Z'));
    const result = await call<{
      electricityCurrent?: number; currentTime?: string; insights?: { headline: string }[];
      series?: { day: string }[];
      priceSchedule: { retrievedAt: string };
    }>(name, { country: 'ee' });
    expect(result.status).toBe(200);
    if (name === 'economy-data') expect(result.body.electricityCurrent).toBe(20);
    if (name === 'power-prices') {
      expect(result.body.currentTime).toBe('2026-09-06T00:00:00.000Z');
      expect(result.body.series?.every(row => row.day === '2026-09-06' || row.day === '2026-09-07')).toBe(true);
    }
    if (name === 'ai-insights') expect(result.body.insights?.some(i => i.headline === 'Electricity €20.00/MWh')).toBe(true);
    expect(result.body.priceSchedule.retrievedAt).toBe('2026-09-05T23:59:00.000Z');
  });

  it('shares the two-day source schedule without aliasing the trailing insights window', async () => {
    await call('economy-data', { country: 'ee' });
    await call('power-prices');
    expect(requests.filter(url => url.includes('elering'))).toHaveLength(1);
    await call('ai-insights', { country: 'ee' });
    const urls = requests.filter(url => url.includes('elering')).map(url => new URL(url));
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get('start')).toBe('2026-09-05T00:00:00.000Z');
    expect(urls[1].searchParams.get('start')).toBe('2026-08-06T00:00:00.000Z');
  });

  it('does not replace a usable schedule with an upstream error payload', async () => {
    vi.setSystemTime(new Date('2026-09-05T06:14:00Z'));
    await call('power-prices');
    respond = () => ({ success: false, data: prices().data });
    vi.setSystemTime(new Date('2026-09-05T06:31:00Z'));
    const result = await call<{
      zones: { id: string; current: number }[];
      priceSchedule: { retrievedAt: string; stale: boolean };
    }>('power-prices');
    expect(result.status).toBe(200);
    expect(result.body.zones.find(zone => zone.id === 'ee')?.current).toBe(30);
    expect(result.body.priceSchedule).toEqual({ retrievedAt: '2026-09-05T06:14:00.000Z', stale: true });
  });

  it('excludes tomorrow from the insights historical comparison', async () => {
    const goodResponder = respond;
    respond = url => url.includes('elering') ? { data: { ee: [
      ...Array.from({ length: 14 }, (_, i) => ({
        timestamp: Date.parse('2026-09-04T06:45:00Z') / 1000 - i * 86400, price: 100,
      })),
      { timestamp: Date.parse('2026-09-05T06:45:00Z') / 1000, price: 200 },
      { timestamp: Date.parse('2026-09-06T06:45:00Z') / 1000, price: 10000 },
    ] } } : goodResponder(url);
    const result = await call<{ insights: { headline: string; description: string }[] }>('ai-insights', { country: 'ee' });
    const price = result.body.insights.find(i => i.headline === 'Electricity peak €200/MWh');
    expect(price?.description).toContain('last 14 preceding days');
  });
});

describe('historical observations', () => {
  it('keeps sparse JSON-stat indices attached to the correct period', async () => {
    post = () => cube(['2024', '2025', '2026'], { 2: 123 });
    const result = await call<{ series: { period: string; value: number | null }[] }>('historical-data', { indicator: 'population' });
    expect(result.body.series).toEqual([
      { period: '2024', value: null }, { period: '2025', value: null }, { period: '2026', value: 123 },
    ]);
  });

  it.each([
    { periods: ['2023', '2024', '2025', '2026'], expected: ['2026'] },
    { periods: ['2024S2', '2025S1', '2025S2', '2026S1'], expected: ['2025S2', '2026S1'] },
    { periods: ['2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4'], expected: ['2025Q1', '2025Q2', '2025Q3', '2025Q4'] },
  ])('bounds one year by period labels: $expected', async ({ periods, expected }) => {
    post = () => cube(periods, periods.map(() => 100));
    const result = await call<{ series: { period: string }[] }>('historical-data', { indicator: 'population', years: '1' });
    expect(result.body.series.map(p => p.period)).toEqual(expected);
  });

  it('retains good cached history when its refresh fails', async () => {
    post = () => cube(['2025', '2026'], [100, 110]);
    await call('historical-data', { indicator: 'population' });
    vi.setSystemTime(new Date(Date.now() + 3_601_000));
    post = () => { throw new Error('CSP unavailable'); };
    await call('historical-data', { indicator: 'population' });
    await new Promise<void>(resolve => setImmediate(resolve));
    const result = await call<{ series: { value: number }[] }>('historical-data', { indicator: 'population' });
    expect(result.body.series.map(p => p.value)).toEqual([100, 110]);
  });

  it('does not cache an upstream outage as an empty successful series', async () => {
    post = () => { throw new Error('CSP unavailable'); };
    const result = await call('historical-data', { indicator: 'population' });
    expect(result.status).toBe(502);
  });

  it('uses the same current unemployment source for economy and history', async () => {
    const registry = require('../api/shared/businessRegistry.js');
    vi.spyOn(registry, 'fetchActiveVatPayers').mockResolvedValue(100);
    vi.spyOn(registry, 'fetchSuspendedBusinesses').mockResolvedValue(1);
    const result = await call<{ indicators: { label: string; value: string; period: string; source: string }[] }>('economy-data');
    expect(result.body.indicators.find(i => i.label === 'Unemployment')).toMatchObject({
      value: '7.3%', period: '2026-07', source: 'Eurostat (une_rt_m)',
    });
    const history = await call<{ source: string; series: { period: string; value: number }[] }>('historical-data', { indicator: 'unemployment' });
    expect(history.body.source).toBe('Eurostat (une_rt_m)');
    expect(history.body.series.at(-1)).toEqual({ period: '2026-07', value: 7.3 });
  });
});

describe('CKAN-backed handlers', () => {
  const projectId = 'bfcae357-328c-423f-9835-215e7fd3db4e';
  const amendmentId = '47276bfd-21bb-4ba7-85cc-7ab4c278e3ca';

  it('counts the actual project list, aggregates all statuses and requests latest updates', async () => {
    respond = url => {
      const u = new URL(url);
      if (u.pathname.endsWith('package_show')) return { success: true, result: { resources: [
        { id: projectId, name: 'AF projektu saraksts', datastore_active: true },
        { id: amendmentId, name: 'AF projektu līgumu grozījumi', datastore_active: true },
      ] } };
      if (u.pathname.endsWith('datastore_search_sql')) return { success: true, result: {
        records: [{ status: 'Pabeigts', count: '337' }, { status: 'Līgums', count: '129' }],
      } };
      const correct = u.searchParams.get('resource_id') === projectId;
      return { success: true, result: {
        total: correct ? 466 : 1724,
        records: correct ? [{ ProjektaNumurs: 'P1', ProjektaStatuss: 'Pabeigts', PedejasDatuAtjauninasanasDatums: '2026-09-04' }]
          : [{ ProjektaNumurs: 'P1', Statuss: 'Apstiprināts', SpekaStasanasDatums: '2023-02-13' }],
      } };
    };
    const result = await call<{ total: number; projects: { date: string; status: string }[]; statusSummary: { count: number }[] }>('eu-funds');
    expect(result.body.total).toBe(466);
    expect(result.body.statusSummary.reduce((n, s) => n + s.count, 0)).toBe(466);
    expect(result.body.projects[0]).toMatchObject({ date: '2026-09-04', status: 'Pabeigts' });
    const search = requests.find(u => u.includes('/datastore_search?'));
    expect(new URL(search!).searchParams.get('sort')).toMatch(/PedejasDatuAtjauninasanasDatums desc/);
  });

  it.each(['business-search', 'address-search', 'eu-funds'])('does not report a CKAN action failure as no data: %s', async name => {
    respond = () => ({ success: false, error: { message: 'Action failed' } });
    const result = await call(name, { q: 'Example' });
    expect(result.status).toBeGreaterThanOrEqual(500);
  });

  it.each(['business-search', 'address-search'])('validates normalized search text in %s before any request', async name => {
    const result = await call(name, { q: '!!!' });
    expect(result.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('applies the active-address filter before pagination and counting', async () => {
    respond = url => {
      const filters = new URL(url).searchParams.get('filters');
      return { success: true, result: { total: filters ? 1 : 21, records: filters
        ? [{ STATUSS: 'EKS', KODS: 'active', STD: 'Riga' }]
        : [{ STATUSS: 'DEL', KODS: 'retired', STD: 'Riga' }],
      } };
    };
    const result = await call<{ total: number; addresses: { code: string }[] }>('address-search', { q: 'Riga' });
    expect(result.body.total).toBe(1);
    expect(result.body.addresses.map(a => a.code)).toEqual(['active']);
  });
});

it('keeps distinct decoded query values in distinct response-cache entries', async () => {
  await call('baltic-compare', { indicator: 'gdp', list: '&years=5', years: '10' });
  const result = await call<{ indicators?: unknown }>('baltic-compare', { indicator: 'gdp', list: '', years: '5&years=10' });
  expect(result.body.indicators).toBeUndefined();
  expect(result.headers['X-Cache']).not.toBe('hit');
});

it('preserves weather retrieval and observation times through stale inner caches', async () => {
  vi.setSystemTime(new Date('2026-09-05T06:00:00Z'));
  await call('environment-data');
  vi.setSystemTime(new Date('2026-09-05T06:20:00Z'));
  respond = () => { throw new Error('Open-Meteo unavailable'); };
  await call('environment-data');
  await new Promise<void>(resolve => setImmediate(resolve));
  const result = await call<{ fetchedAt: string; weather: { retrievedAt: string; observedAt: string; stale: boolean }[] }>('environment-data');
  expect(result.body.fetchedAt).toBe('2026-09-05T06:00:00.000Z');
  expect(result.body.weather[0]).toMatchObject({
    retrievedAt: '2026-09-05T06:00:00.000Z', observedAt: '2026-09-05T06:00:00.000Z', stale: true,
  });
});

it('constructs probe windows when a long-lived handler runs, not when its module loads', async () => {
  vi.setSystemTime(new Date('2026-09-05T06:00:00Z'));
  await call('system-status');
  requests = [];
  vi.setSystemTime(new Date('2026-09-06T14:00:00Z'));
  await call('system-status');
  const grid = requests.find(u => u.includes('/system/with-plan'));
  const power = requests.find(u => u.includes('/nps/price'));
  expect(new URL(grid!).searchParams.get('end')).toBe('2026-09-06T14:00:00.000Z');
  expect(new URL(power!).searchParams.get('start')).toBe('2026-09-06T00:00:00.000Z');
});

it('does not subtract imports from another month to invent a trade balance', async () => {
  const ckan = require('../api/shared/ckan.js');
  const trade: {
    selectNewestByData: (pkg: unknown, direction: string) => Promise<unknown>;
    runSql: (sql: string) => Promise<unknown>;
  } = require('../api/shared/tradeStats.js');
  vi.spyOn(ckan, 'ckan').mockResolvedValue({ resources: [] });
  vi.spyOn(trade, 'selectNewestByData').mockImplementation(async (_pkg: unknown, direction: string) => ({
    resource: { id: direction === 'exports' ? '10000000-0000-0000-0000-000000000000' : '20000000-0000-0000-0000-000000000000', name: direction },
    key: direction === 'exports' ? 202607 : 202606,
  }));
  vi.spyOn(trade, 'runSql').mockImplementation(async (sql: string) => sql.includes('COUNT(*)')
    ? [{ value_eur: sql.includes('10000000-') ? 100 : 80, lines: 10 }] : []);
  const result = await call<{ balanceEur: number | null; periodsDiffer: boolean }>('trade-partners');
  expect(result.body.periodsDiffer).toBe(true);
  expect(result.body.balanceEur).toBeNull();
});

it.each(['property-data', 'port-data', 'environment-data', 'power-prices'])('does not retain an all-source outage as successful data: %s', async name => {
  respond = () => { throw new Error('Source unavailable'); };
  const result = await call(name);
  expect(result.status).toBe(502);
});

it('keeps upstream cache keys distinct when decoded values contain separators', () => {
  const upstream = require('../api/shared/cache.js');
  expect(upstream.requestKey('test', 'https://example.test/?a=1%26b%3D2'))
    .not.toBe(upstream.requestKey('test', 'https://example.test/?a=1&b=2'));
});

it('rejects sparse cubes with an unpinned non-time dimension', async () => {
  post = () => ({
    id: ['SEX', 'TIME'], size: [2, 3],
    dimension: {
      SEX: { category: { index: { M: 0, F: 1 } } },
      TIME: { category: { index: { '2024': 0, '2025': 1, '2026': 2 } } },
    },
    value: { 2: 123 },
  });
  const result = await call('historical-data', { indicator: 'population' });
  expect(result.status).toBe(502);
});
