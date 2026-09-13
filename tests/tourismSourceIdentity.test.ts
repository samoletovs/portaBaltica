import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
interface ApiResponse { status: number; headers: Record<string, string>; body: string }
type Handler = (context: { res?: ApiResponse }, req: { query: Record<string, string>; headers: object }) => Promise<void>;
type Point = { period: string; value: number | null };
interface Comparison {
  title: string; unit: string; dataset: string; assumptions: unknown[];
  countries: Record<string, { series: Point[] }>;
}
const es: {
  httpJson: (url: string, options: { deadlineMs: number }) => Promise<unknown>;
  parseJsonStat: (payload: unknown) => { countries: Record<string, { series: Point[] }> };
} =
  require('../api/shared/eurostat.js');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const rateLimit: { reset: () => void } = require('../api/shared/rateLimit.js');
const https: {
  request: (options: { path: string }, callback: (res: EventEmitter & { statusCode: number; resume: () => void }) => void) => EventEmitter;
} = require('node:https');

// Subsets of the official responses read on 2026-09-11. The two cubes have the
// same pins and plausible magnitudes; only nights answer "Overnight stays".
function tourismCube(arrivals: boolean) {
  const periods = arrivals ? ['2026-04', '2026-05', '2026-06', '2026-07'] : ['2026-06', '2026-07'];
  return {
    id: ['freq', 'c_resid', 'unit', 'nace_r2', 'geo', 'time'],
    size: [1, 1, 1, 1, 3, periods.length],
    dimension: {
      freq: { category: { index: { M: 0 } } },
      c_resid: { category: { index: { TOTAL: 0 } } },
      unit: { category: { index: { NR: 0 } } },
      nace_r2: { category: { index: { 'I551-I553': 0 } } },
      geo: { category: { index: { EE: 0, LV: 1, LT: 2 } } },
      time: { category: { index: Object.fromEntries(periods.map((period, index) => [period, index])) } },
    },
    value: arrivals
      ? [264204, 320292, 395333, null, 193057, 243000, 313942, null, 292431, 360684, 410171, null]
      : [718385, null, 528988, null, 948906, null],
  };
}

const nationalArrivals = {
  id: ['ContentsCode', 'ACCOMMODATION', 'TIME'], size: [1, 1, 2],
  dimension: {
    ContentsCode: { category: { index: { EliminatedValue: 0 }, unit: { EliminatedValue: { base: 'Number' } } } },
    ACCOMMODATION: { category: { index: { 'I551-I553': 0 } } },
    TIME: { category: { index: { '2026Q1': 0, '2026Q2': 1 } } },
  },
  value: [447132, 749999],
};

async function call<T>(name: string, query: Record<string, string>) {
  const handler: Handler = require(`../api/${name}/index.js`);
  const context: { res?: ApiResponse } = {};
  await handler(context, { query, headers: {} });
  if (!context.res) throw new Error('Handler did not respond');
  return { ...context.res, data: JSON.parse(context.res.body) as T };
}

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:40:00Z'));
  vi.spyOn(es, 'httpJson').mockImplementation(async url => {
    const query = new URL(url);
    expect(query.searchParams.get('nace_r2')).toBe('I551-I553');
    expect(query.searchParams.get('unit')).toBe('NR');
    expect(query.searchParams.get('c_resid')).toBe('TOTAL');
    expect(query.searchParams.get('freq')).toBe('M');
    return tourismCube(query.pathname.endsWith('/tour_occ_arm'));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cache.clear();
  rateLimit.reset();
});

describe('overnight stays and arrivals remain different statistics', () => {
  it('returns guest nights through the single and bounded batch handlers', async () => {
    const single = await call<Comparison>('baltic-compare', { indicator: 'tourism', years: '5' });
    const batch = await call<{ results: { status: number; data: Comparison }[] }>('baltic-compare-batch', {
      indicators: 'tourism', years: '5',
    });
    expect(single.status).toBe(200);
    expect(single.data.dataset).toBe('tour_occ_nim');
    expect(single.data.title).toBe('Overnight stays');
    expect(single.data.unit).toBe('nights');
    expect(single.data.assumptions).toEqual([]);
    for (const [geo, value] of Object.entries({ LV: 528988, EE: 718385, LT: 948906 })) {
      expect(single.data.countries[geo].series.find(point => point.period === '2026-06')?.value).toBe(value);
      expect(single.data.countries[geo].series.at(-1)?.value).toBeNull();
    }
    expect(batch.data.results[0]).toMatchObject({ status: 200, data: single.data });
    expect(es.httpJson).toHaveBeenCalledOnce();
  });

  it('exports the same overnight-stay observations with their actual unit and source', async () => {
    const result = await call<{ dataset: string; unit: string; series: { label: string; observations: Point[] }[] }>(
      'data-export', { indicator: 'tourism', years: '5', format: 'json' },
    );
    expect(result.status).toBe(200);
    expect(result.data.dataset).toBe('tour_occ_nim');
    expect(result.data.unit).toBe('nights');
    expect(result.data.series.find(country => country.label === 'Latvia')?.observations)
      .toContainEqual({ period: '2026-06', value: 528988 });
  });

  it('keeps the national quarterly count in persons and equal to the same-period monthly arrivals', async () => {
    let submitted = '';
    vi.spyOn(https, 'request').mockImplementation((options, callback) => {
      expect(options.path).toBe('/api/v1/en/OSP_PUB/NOZ/TU/TUV/TUV020c');
      const request = Object.assign(new EventEmitter(), {
        write(body: string) { submitted += body; },
        destroy() {},
        end() {
          const response = Object.assign(new EventEmitter(), { statusCode: 200, resume() {} });
          callback(response);
          queueMicrotask(() => {
            response.emit('data', JSON.stringify(nationalArrivals));
            response.emit('end');
          });
        },
      });
      return request;
    });
    const national = await call<{ unit: string; series: Point[] }>('historical-data', {
      indicator: 'tourist_arrivals', years: '5',
    });
    expect(national.status).toBe(200);
    expect(national.data.unit).toBe('persons');
    expect(JSON.parse(submitted).query).toEqual(expect.arrayContaining([
      { code: 'C_RESID', selection: { filter: 'item', values: ['TOTAL'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['TUV020c'] } },
    ]));
    const quarter = national.data.series.find(point => point.period === '2026Q2')?.value;
    const months = es.parseJsonStat(tourismCube(true)).countries.LV.series
      .filter(point => ['2026-04', '2026-05', '2026-06'].includes(point.period));
    expect(months).toHaveLength(3);
    expect(quarter).toBe(749999);
    expect(months.reduce((sum, point) => sum + point.value!, 0)).toBe(quarter);
  });
});
