/**
 * The two export paths, driven end to end and compared as files.
 *
 * WHY THE WRITER PARITY TEST WAS NOT ENOUGH
 * -----------------------------------------
 * `tests/seriesExportParity.test.ts` holds `src/utils/exportSeries.ts` and
 * `api/shared/seriesExport.js` byte-identical over a shared corpus. It passed
 * throughout the change that produced this file — and the endpoint was still
 * serving a different spreadsheet from the button for 47 of the 71 indicators,
 * because `BalticCompareChart` writes the EU27 benchmark into its download and
 * the endpoint was not fetching one.
 *
 * The writers agreed perfectly about a payload one side had built differently.
 * That is the `keyOn` failure one layer out: the divergence is in what you
 * assemble, not in how you format it, and it is invisible to any check that
 * begins after assembly.
 *
 * WHY IT RENDERS THE COMPONENT RATHER THAN COPYING ITS MAPPING
 * -----------------------------------------------------------
 * Because a third hand-written copy of "what the client exports" is the defect
 * this file exists to catch, one level up. `BalticCompareChart` builds its
 * payload inline and hands it to `<DownloadMenu data={...} />`, so the honest
 * way to read it is to render the real component and capture the real prop —
 * the same reason `tests/pageMetaParity.test.tsx` renders pages instead of
 * parsing them, and the reason that suite caught a divergence a parse could
 * not have seen.
 *
 * Both sides are fed from ONE stubbed Eurostat payload through the REAL
 * `api/baltic-compare` handler, so the fixture cannot flatter either path.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { toCsv, type SeriesExport } from '../src/utils/exportSeries';
import { BalticCompareChart } from '../src/components/BalticCompareChart';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');

const https = require('node:https') as { get: unknown };
const realGet = https.get;
afterAll(() => { https.get = realGet; });

/**
 * What the client component hands the download control.
 *
 * Captured from the real prop rather than reconstructed. `DownloadMenu` renders
 * nothing here — this suite is about the payload, and rendering the real menu
 * would drag in the file-saving path for no gain.
 */
const captured: SeriesExport[] = [];
vi.mock('../src/components/DownloadMenu', () => ({
  DownloadMenu: ({ data }: { data: SeriesExport | null }) => {
    if (data) captured.push(data);
    return null;
  },
}));

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

/**
 * A JSON-stat cube carrying the three and the benchmark.
 *
 * Shaped from what Eurostat actually returns: `geo` × `time` with a sparse
 * `value` map keyed by flat index, so a period a country did not publish is
 * absent rather than null — which is the case that distinguishes an honest
 * empty cell from a fabricated zero.
 */
function jsonStat(values: Record<string, number>, geos: string[]) {
  const times = ['2025-Q1', '2025-Q2', '2025-Q3'];
  const value: Record<string, number> = {};
  geos.forEach((geo, g) => {
    times.forEach((time, t) => {
      const v = values[`${geo}:${time}`];
      if (typeof v === 'number') value[String(g * times.length + t)] = v;
    });
  });
  return {
    id: ['geo', 'time'],
    size: [geos.length, times.length],
    dimension: {
      geo: { category: { index: Object.fromEntries(geos.map((g, i) => [g, i])) } },
      time: { category: { index: Object.fromEntries(times.map((t, i) => [t, i])) } },
    },
    value,
  };
}

/** Readings for the three plus EU27, with one deliberate hole in Lithuania. */
const READINGS: Record<string, number> = {
  'LV:2025-Q1': 1.4, 'LV:2025-Q2': -0.6, 'LV:2025-Q3': 2.1,
  'EE:2025-Q1': 0.9, 'EE:2025-Q2': 1.1, 'EE:2025-Q3': 0.4,
  'LT:2025-Q1': 2.2, 'LT:2025-Q3': 1.8,
  'EU27_2020:2025-Q1': 1.0, 'EU27_2020:2025-Q2': 0.8, 'EU27_2020:2025-Q3': 1.2,
};

let served: unknown = null;
function stubNetwork() {
  https.get = ((_url: string, _options: unknown, callback: (res: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: () => void };
    request.destroy = () => {};
    process.nextTick(() => {
      const response = Readable.from([JSON.stringify(served)]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = {};
      callback(response);
    });
    return request;
  }) as unknown;
}

/** Handlers with every `api/` module reloaded, so no cache carries across. */
function freshApi() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(API_DIR)) delete require.cache[key];
  }
  return {
    exportHandler: require(resolve(ROOT, 'api/data-export/index.js')) as Handler,
    compareHandler: require(resolve(ROOT, 'api/baltic-compare/index.js')) as Handler,
  };
}

type Handler = (context: unknown, req: unknown) => Promise<void>;
interface Res { status: number; headers: Record<string, string>; body: string }

let ip = 0;
const log = Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} });

async function invoke(handler: Handler, query: Record<string, string>): Promise<Res> {
  const context: { res?: Res; log: typeof log } = { log };
  await handler(context, {
    headers: { 'x-forwarded-for': `10.11.0.${(++ip % 240) + 1}` },
    query,
  });
  return context.res!;
}

/**
 * Bounded by turn count, not by a wall clock — `tests/suiteDeterminism.test.ts`
 * refuses a new timed wait, because a polling budget measures how busy the
 * machine is rather than whether the code works.
 */
async function settle(until: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (until()) return;
    await act(async () => { await new Promise<void>((r) => { setImmediate(r); }); });
  }
  throw new Error(`nothing settled after ${turns} turns`);
}

/**
 * The two timestamp lines, which cannot agree and should not.
 *
 * The server writes the instant it read Eurostat; the browser writes the
 * instant the reader clicked, which is later by however long the page was open.
 * Everything else in the file is a claim about the data and must match exactly.
 */
function withoutTimestamps(csv: string): string {
  return csv
    .split(/\r?\n/)
    .filter((line) => !/^# (Retrieved from source|Exported):/.test(line))
    .join('\n');
}

/** The file the browser would write, read off the real component's prop. */
async function clientFile(indicator: string): Promise<string> {
  const { compareHandler } = freshApi();
  const response = await invoke(compareHandler, { indicator });
  expect(response.status, 'the fixture must reach the client path too').toBe(200);

  captured.length = 0;
  fetchBalticCompare.mockResolvedValue(JSON.parse(response.body));
  render(<BalticCompareChart indicator={indicator} />);
  await settle(() => captured.length > 0);

  return toCsv(captured[captured.length - 1]);
}

/** The file the endpoint serves. */
async function serverFile(indicator: string): Promise<string> {
  const { exportHandler } = freshApi();
  const response = await invoke(exportHandler, { indicator, format: 'csv' });
  expect(response.status, 'the endpoint must answer for the fixture').toBe(200);
  return response.body;
}

describe('the button and the URL write the same file', () => {
  beforeEach(() => {
    stubNetwork();
    fetchBalticCompare.mockReset();
    captured.length = 0;
  });

  it('agrees column for column on an indicator that carries a benchmark', async () => {
    // `gdp` is `euAggregation: 'average'`, so both paths must carry EU27.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);

    const server = await serverFile('gdp');
    const client = await clientFile('gdp');

    expect(withoutTimestamps(server)).toBe(withoutTimestamps(client));
  });

  it('carries the benchmark, which is the divergence this suite was built for', async () => {
    // The control for the assertion above: it would pass on two files that both
    // omitted EU27, which is precisely the state this change fixed. So assert
    // the column is present in BOTH, not merely that they match.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);

    const server = await serverFile('gdp');
    const client = await clientFile('gdp');

    for (const [name, file] of [['server', server], ['client', client]] as const) {
      const header = file.split(/\r?\n/).find((l) => l.startsWith('period,'))!;
      expect(header, `${name} header`).toBe('period,Latvia,Estonia,Lithuania,EU27 average');
    }
  });

  it('agrees on an indicator where a benchmark would be a sum, not an average', async () => {
    // `road_freight` is `euAggregation: 'sum'`. The EU figure there contains
    // the three rather than averaging them, so neither path may carry it — and
    // the two must still agree.
    //
    // The fixture DELIBERATELY contains EU27 readings. An earlier version served
    // a three-country payload here, and a planted fault that made the endpoint
    // request the benchmark for every indicator went GREEN: with no EU27 in the
    // fixture there was nothing to find, so a handler asking the wrong question
    // and a handler asking the right one produced identical files. The test was
    // correct about everything it looked at and blind to the case it named —
    // the population failure this repo keeps rediscovering. Now the benchmark is
    // there to be picked up, and not picking it up is the assertion.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);

    const server = await serverFile('road_freight');
    const client = await clientFile('road_freight');

    expect(withoutTimestamps(server)).toBe(withoutTimestamps(client));
    expect(server, 'the endpoint must not fetch a benchmark for an extensive total')
      .not.toContain('EU27');
    expect(client, 'nor may the button').not.toContain('EU27');
  });

  it('agrees about a period one country did not publish', async () => {
    // Lithuania has no 2025-Q2 reading in the fixture. Both files must show an
    // empty cell there — not a zero, and not a shortened column.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);

    const server = await serverFile('gdp');
    const client = await clientFile('gdp');

    const row = (file: string) => file.split(/\r?\n/).find((l) => l.startsWith('2025-Q2,'));
    expect(row(server)).toBe('2025-Q2,-0.6,1.1,,0.8');
    expect(row(client)).toBe(row(server));
  });

  it('can tell the two files apart, so agreement above is a result', async () => {
    // The control that matters most. Every assertion here compares two strings,
    // and two strings can match because nothing was produced. This proves the
    // comparison distinguishes: the same reader, the same indicator, different
    // history depths — which is a real difference a reader would notice.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);

    const server = await serverFile('gdp');
    const { exportHandler } = freshApi();
    served = jsonStat(
      { 'LV:2025-Q1': 9.9, 'EE:2025-Q1': 9.9, 'LT:2025-Q1': 9.9 },
      ['LV', 'EE', 'LT'],
    );
    const different = (await invoke(exportHandler, { indicator: 'gdp', format: 'csv' })).body;

    expect(withoutTimestamps(server)).not.toBe(withoutTimestamps(different));
    expect(server.length).toBeGreaterThan(0);
    expect(different.length).toBeGreaterThan(0);
  });

  it('strips only the two lines that are allowed to differ', async () => {
    // A comparison that stripped too much would pass on files that disagree
    // about the data. Asserted rather than assumed: exactly two lines go.
    served = jsonStat(READINGS, ['LV', 'EE', 'LT', 'EU27_2020']);
    const server = await serverFile('gdp');

    const before = server.split(/\r?\n/).length;
    const after = withoutTimestamps(server).split('\n').length;
    expect(before - after).toBe(2);
    expect(withoutTimestamps(server)).toContain('# Source: Eurostat');
    expect(withoutTimestamps(server)).toContain('# Licence:');
  });
});
