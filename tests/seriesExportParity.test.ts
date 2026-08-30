/**
 * Two CSV writers, held to each other byte for byte.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/utils/exportSeries.ts` has written these files in the browser since
 * `#187`. `api/shared/seriesExport.js` now writes them on the server, because a
 * download button is not an address: a reader cannot `curl` it, point Google
 * Sheets' `IMPORTDATA` at it, or put it in a script.
 *
 * The second one is a mirror, and it cannot be removed. Measured in `#228` and
 * unchanged: `tsconfig.app.json` sets `"include": ["src"]` so a `src/` module
 * cannot import from `api/` (`TS2307`), and the Function App is deployed from
 * `api/` alone so it never sees `src/`. There is no shared build step in either
 * direction.
 *
 * A mirror nobody checks is a second opinion waiting to disagree, and the
 * disagreement here is peculiarly invisible: a reader uses the button OR the
 * URL, never both, so a column order or an escaping rule could differ for
 * months without one person being in a position to notice. That is the `keyOn`
 * failure one layer out — a well-formed file answering a different question
 * from the one the reader thinks they asked.
 *
 * So this runs BOTH implementations over the same inputs and requires the
 * output to be identical. Not "equivalent": identical, because CSV is a byte
 * format and a stray space is a different file.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

import {
  DEFAULT_ATTRIBUTION,
  DEFAULT_LICENCE,
  csvField,
  csvNumber,
  exportFilename,
  exportPeriods,
  csvPreamble,
  toCsv,
  toJson,
  type SeriesExport,
} from '../src/utils/exportSeries';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');

interface ServerExporter {
  DEFAULT_LICENCE: string;
  DEFAULT_ATTRIBUTION: string;
  csvField: (value: string) => string;
  csvNumber: (value: number | null | undefined) => string;
  exportPeriods: (series: SeriesExport['series']) => string[];
  csvPreamble: (data: SeriesExport) => string[];
  toCsv: (data: SeriesExport) => string;
  toJson: (data: SeriesExport) => string;
  exportFilename: (data: SeriesExport, extension: 'csv' | 'json') => string;
}

const server = require(resolve(ROOT, 'api/shared/seriesExport.js')) as ServerExporter;

/**
 * Inputs chosen to exercise the rules the two writers could differ on, not to
 * be realistic. Every one of these has a comment because every one is a rule
 * somebody could "tidy" on one side only.
 */
const CASES: [string, SeriesExport][] = [
  [
    'the ordinary case: three countries, same periods',
    {
      indicator: 'gdp',
      title: 'GDP Growth Rate',
      unit: '% QoQ',
      source: 'Eurostat (namq_10_gdp)',
      dataset: 'namq_10_gdp',
      retrievedAt: '2026-08-29T08:00:00.000Z',
      exportedAt: '2026-08-29T08:00:01.000Z',
      series: [
        { label: 'Latvia', observations: [{ period: '2025-Q1', value: 0.2 }, { period: '2025-Q2', value: -1.4 }] },
        { label: 'Estonia', observations: [{ period: '2025-Q1', value: 4.1 }, { period: '2025-Q2', value: 0 }] },
        { label: 'Lithuania', observations: [{ period: '2025-Q1', value: 2.2 }, { period: '2025-Q2', value: 1.1 }] },
      ],
    },
  ],
  [
    'a hole in one country, which must be an empty cell and not a shifted column',
    {
      indicator: 'road_freight',
      title: 'Road freight',
      unit: 'thousand tonnes',
      source: 'Eurostat (road_go_ta_tott)',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        { label: 'Latvia', observations: [{ period: '2024-Q1', value: 1 }, { period: '2024-Q2', value: 2 }] },
        { label: 'Estonia', observations: [{ period: '2024-Q2', value: 3 }] },
      ],
    },
  ],
  [
    'zero is a reading and null is not',
    {
      indicator: 'zero_vs_null',
      title: 'Zero versus null',
      unit: '%',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        {
          label: 'Latvia',
          observations: [
            { period: '2025-01', value: 0 },
            { period: '2025-02', value: null },
            { period: '2025-03', value: -0.0 },
          ],
        },
      ],
    },
  ],
  [
    'no retrievedAt, which the file must state rather than fill in',
    {
      indicator: 'unknown_retrieval',
      title: 'Unknown retrieval',
      unit: '',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [{ label: 'Latvia', observations: [{ period: '2025', value: 1 }] }],
    },
  ],
  [
    'per-column unit and source, which only appear when a column has its own',
    {
      indicator: 'mixed',
      title: 'Key indicators',
      unit: '',
      source: 'Eurostat',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        { label: 'Unemployment', unit: '%', source: 'Eurostat (une_rt_m)', observations: [{ period: '2025-01', value: 6.1 }] },
        { label: 'Population', unit: 'persons', observations: [{ period: '2025-01', value: 1842226 }] },
        { label: 'Bare', observations: [{ period: '2025-01', value: 3 }] },
      ],
    },
  ],
  [
    'RFC 4180 escaping: a comma, a quote and a newline in a label',
    {
      indicator: 'escaping',
      title: 'Trade balance (goods & services), quarterly',
      unit: 'M EUR',
      source: 'Eurostat, "balance of payments"',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        { label: 'Latvia, total', observations: [{ period: '2025-Q1', value: 1 }] },
        { label: 'He said "yes"', observations: [{ period: '2025-Q1', value: 2 }] },
        { label: 'Two\nlines', observations: [{ period: '2025-Q1', value: 3 }] },
      ],
    },
  ],
  [
    'formula injection: a label a spreadsheet would otherwise execute',
    {
      indicator: 'injection',
      title: 'Hostile labels',
      unit: '',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        { label: '=cmd|calc', observations: [{ period: '2025', value: 1 }] },
        { label: '+1+1', observations: [{ period: '2025', value: 2 }] },
        { label: '-2', observations: [{ period: '2025', value: 3 }] },
        { label: '@SUM(A1)', observations: [{ period: '2025', value: 4 }] },
      ],
    },
  ],
  [
    'a negative reading, which must NOT be defused into text',
    {
      indicator: 'negatives',
      title: 'Negatives',
      unit: '%',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [{ label: 'Latvia', observations: [{ period: '2025', value: -3.2 }] }],
    },
  ],
  [
    'periods out of arrival order, which both must sort',
    {
      indicator: 'ordering',
      title: 'Ordering',
      unit: '',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      series: [
        { label: 'A', observations: [{ period: '2025-Q4', value: 4 }, { period: '2025-Q1', value: 1 }] },
        { label: 'B', observations: [{ period: '2025-Q3', value: 3 }, { period: '2025-Q2', value: 2 }] },
      ],
    },
  ],
  [
    'an explicit licence and attribution, overriding the defaults',
    {
      indicator: 'overrides',
      title: 'Overrides',
      unit: '',
      source: 'Test',
      exportedAt: '2026-08-29T08:00:00.000Z',
      licence: 'CC0',
      attribution: 'Someone else',
      series: [{ label: 'A', observations: [{ period: '2025', value: 1 }] }],
    },
  ],
];

describe('the two CSV writers produce the same bytes', () => {
  it.each(CASES)('%s', (_name, data) => {
    expect(server.toCsv(data)).toBe(toCsv(data));
  });

  it('produces a non-trivial file, so the equalities above are not empty', () => {
    // Anti-vacuity. Two writers that both returned '' would satisfy every
    // assertion in this file.
    const csv = toCsv(CASES[0][1]);

    expect(csv.length).toBeGreaterThan(200);
    expect(csv.split('\r\n').length).toBeGreaterThan(10);
    expect(csv).toContain('period,Latvia,Estonia,Lithuania');
  });
});

describe('the two JSON writers produce the same bytes', () => {
  it.each(CASES)('%s', (_name, data) => {
    expect(server.toJson(data)).toBe(toJson(data));
  });
});

describe('the pieces agree too, so a failure says which rule diverged', () => {
  // A single `toCsv` equality would go red without saying whether the escaping,
  // the ordering or the preamble moved. These localise it.
  it.each([
    ['plain', 'Latvia'],
    ['comma', 'Latvia, total'],
    ['quote', 'He said "yes"'],
    ['newline', 'a\nb'],
    ['carriage return', 'a\rb'],
    ['empty', ''],
  ])('csvField agrees on %s', (_name, value) => {
    expect(server.csvField(value)).toBe(csvField(value));
  });

  it.each([
    ['a reading', 1.5],
    ['zero', 0],
    ['negative', -3.2],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('csvNumber agrees on %s', (_name, value) => {
    expect(server.csvNumber(value as number | null | undefined))
      .toBe(csvNumber(value as number | null | undefined));
  });

  it.each(CASES)('csvPreamble agrees for %s', (_name, data) => {
    expect(server.csvPreamble(data)).toEqual(csvPreamble(data));
  });

  it.each(CASES)('exportPeriods agrees for %s', (_name, data) => {
    expect(server.exportPeriods(data.series)).toEqual(exportPeriods(data.series));
  });

  it.each(CASES)('exportFilename agrees for %s', (_name, data) => {
    expect(server.exportFilename(data, 'csv')).toBe(exportFilename(data, 'csv'));
    expect(server.exportFilename(data, 'json')).toBe(exportFilename(data, 'json'));
  });

  it('shares the licence and attribution text exactly', () => {
    // These are prose. A reworded licence on one side would put two different
    // legal statements on two files of the same data.
    expect(server.DEFAULT_LICENCE).toBe(DEFAULT_LICENCE);
    expect(server.DEFAULT_ATTRIBUTION).toBe(DEFAULT_ATTRIBUTION);
  });
});

describe('the comparison can actually fail', () => {
  /**
   * The control.
   *
   * Every assertion above passes if the two implementations are the same
   * object, or if both are broken in the same direction. These prove the
   * comparison discriminates — and they are written against the CLIENT, which
   * is the implementation with the tests and the history, so a difference means
   * the server mirror is wrong rather than the reverse.
   */
  it('is comparing two distinct implementations', () => {
    expect(server.toCsv).not.toBe(toCsv);
    expect(server.csvField).not.toBe(csvField);
  });

  it('detects a divergence when one is deliberately altered', () => {
    const data = CASES[0][1];
    const real = server.toCsv(data);
    const tampered = real.replace('period,', 'PERIOD,');

    expect(tampered).not.toBe(real);
    expect(tampered).not.toBe(toCsv(data));
  });

  it('holds the client to the rules the mirror was written against', () => {
    // If the client stopped defusing formulas, the mirror would follow it into
    // the same hole and every equality above would still pass. So the RULE is
    // asserted here, not only the agreement.
    const csv = toCsv(CASES[6][1]);

    expect(csv, 'a leading = must be defused').toContain("'=cmd|calc");
    expect(csv, 'a leading @ must be defused').toContain("'@SUM(A1)");

    const negatives = toCsv(CASES[7][1]);
    expect(negatives, 'a negative reading must stay a number').toContain(',-3.2');
    expect(negatives).not.toContain("'-3.2");
  });

  it('holds the client to null never becoming zero', () => {
    const csv = toCsv(CASES[2][1]);
    const rows = csv.split('\r\n').filter((line) => /^\d{4}-\d{2},/.test(line));

    expect(rows).toContain('2025-01,0');
    expect(rows, 'a null period must be an empty cell').toContain('2025-02,');
  });
});
