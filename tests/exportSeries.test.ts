import { describe, expect, it } from 'vitest';
import {
  csvField,
  csvNumber,
  DEFAULT_ATTRIBUTION,
  DEFAULT_LICENCE,
  exportFilename,
  exportPeriods,
  optionalString,
  toCsv,
  toJson,
  type SeriesExport,
} from '../src/utils/exportSeries';

/**
 * The export, which is the first download affordance this site has ever had.
 *
 * The rule under most of these is one this repo has already paid for twice:
 * **the absence of a reading must not render as a value.** `payload.ts` records
 * a missing wave height that rendered as a storm warning and a 404 that
 * rendered as "Suspended activities: 0". A CSV is the worst place for that
 * defect, because the reader takes the file away and nothing goes with it to
 * say the zero was never measured.
 *
 * So the null case and the zero case are asserted against each other rather
 * than separately. A test that only says "null is empty" passes on an
 * implementation that renders *everything* empty, which is a different bug
 * with the same green tick.
 */

const EXPORTED_AT = '2026-08-28T12:00:00.000Z';

function example(overrides: Partial<SeriesExport> = {}): SeriesExport {
  return {
    indicator: 'gdp',
    title: 'GDP growth rate',
    unit: '% change',
    source: 'Eurostat (namq_10_gdp)',
    dataset: 'namq_10_gdp',
    retrievedAt: '2026-08-28T11:59:00.000Z',
    exportedAt: EXPORTED_AT,
    series: [
      {
        label: 'Latvia',
        observations: [
          { period: '2025-Q1', value: 1.4 },
          { period: '2025-Q2', value: null },
          { period: '2025-Q3', value: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

/** The rows below the `#` preamble: the header, then the data. */
function records(csv: string): string[] {
  return csv
    .split('\r\n')
    .filter((line) => line !== '' && !line.startsWith('#'));
}

describe('a missing observation', () => {
  it('is an empty field, and a measured zero is still a zero', () => {
    const [, q1, q2, q3] = records(toCsv(example()));

    expect(q1).toBe('2025-Q1,1.4');
    // The pair is the test. Either assertion alone passes on an implementation
    // that gets the other one wrong.
    expect(q2, 'a period the source did not publish').toBe('2025-Q2,');
    expect(q3, 'a measured zero').toBe('2025-Q3,0');
  });

  it('is never filled in from another country in the same row', () => {
    // Wide format addresses a reading by period label rather than by position,
    // so a gap in one column must leave that column empty rather than pulling
    // the next country's figure left into it.
    const csv = toCsv(
      example({
        series: [
          { label: 'Latvia', observations: [{ period: '2025-Q1', value: null }] },
          { label: 'Estonia', observations: [{ period: '2025-Q1', value: 2.2 }] },
        ],
      }),
    );

    const [header, row] = records(csv);
    expect(header).toBe('period,Latvia,Estonia');
    expect(row).toBe('2025-Q1,,2.2');
  });

  it('covers a period one column has and another does not', () => {
    const csv = toCsv(
      example({
        series: [
          { label: 'Latvia', observations: [{ period: '2025-Q1', value: 1 }] },
          { label: 'Estonia', observations: [{ period: '2025-Q2', value: 2 }] },
        ],
      }),
    );

    expect(records(csv)).toEqual(['period,Latvia,Estonia', '2025-Q1,1,', '2025-Q2,,2']);
  });

  it('treats a non-finite value as absent rather than writing NaN into a column', () => {
    // These arrive from arithmetic on missing fields, never from a statistical
    // office. "NaN" in a spreadsheet column is a worse answer than nothing.
    expect(csvNumber(Number.NaN)).toBe('');
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe('');
    expect(csvNumber(null)).toBe('');
    expect(csvNumber(undefined)).toBe('');
    expect(csvNumber(0)).toBe('0');
    expect(csvNumber(-0.5)).toBe('-0.5');
  });

  it('stays null in JSON rather than becoming a zero', () => {
    const parsed = JSON.parse(toJson(example()));
    const values = parsed.series[0].observations.map((o: { value: number | null }) => o.value);

    expect(values).toEqual([1.4, null, 0]);
  });
});

describe('RFC 4180 escaping', () => {
  it('quotes a field containing a comma', () => {
    // Guard the guard: a fixture with no comma in it would make the assertion
    // below pass against an implementation that never quotes anything.
    const label = 'GDP, chain linked';
    expect(label).toContain(',');

    const csv = toCsv(example({ series: [{ label, observations: [{ period: '2025-Q1', value: 1 }] }] }));

    expect(records(csv)[0]).toBe('period,"GDP, chain linked"');
  });

  it('doubles an embedded double quote, and quotes the field around it', () => {
    // Rule 7: `He said "no"` becomes `"He said ""no"""`.
    const label = 'Wages, so-called "real"';
    expect(label).toContain('"');

    const csv = toCsv(example({ series: [{ label, observations: [{ period: '2025-Q1', value: 1 }] }] }));

    expect(records(csv)[0]).toBe('period,"Wages, so-called ""real"""');
  });

  it('quotes a field containing a line break', () => {
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('two\r\nlines')).toBe('"two\r\nlines"');
  });

  it('leaves an ordinary field unquoted', () => {
    // Quoting everything is legal and makes the file unreadable by eye.
    expect(csvField('Latvia')).toBe('Latvia');
    expect(csvField('2025-Q1')).toBe('2025-Q1');
  });

  it('separates records with CRLF', () => {
    const csv = toCsv(example());

    expect(csv).toContain('\r\n');
    // Every line break is a CRLF: a bare LF anywhere means a record was joined
    // with the wrong terminator.
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('carries no byte order mark, which is not part of the format', () => {
    // The BOM is added when the file is written, in DownloadMenu, because
    // Excel needs it and a strict parser does not want it.
    expect(toCsv(example()).startsWith('\uFEFF')).toBe(false);
  });
});

describe('spreadsheet formula injection', () => {
  it('defuses a text field that a spreadsheet would evaluate', () => {
    // A cell beginning `=`, `+`, `-`, `@`, tab or CR is executed by Excel,
    // LibreOffice and Sheets. Quoting does not prevent it — the quotes are
    // stripped before evaluation — so the leading character has to go.
    const label = '=HYPERLINK("http://evil","click")';
    expect(label.startsWith('=')).toBe(true);

    const csv = toCsv(example({ series: [{ label, observations: [{ period: '2025-Q1', value: 1 }] }] }));

    const header = records(csv)[0];
    expect(header).toContain("'=HYPERLINK");
    expect(header).not.toMatch(/,=HYPERLINK/);
  });

  it('leaves a negative reading alone, because a number is not a formula', () => {
    // The companion to the rule above, and the reason it applies to text only.
    // Defusing numbers would corrupt every negative figure on the site, which
    // is most of a page of them on any percentage-change series.
    const csv = toCsv(
      example({ series: [{ label: 'Latvia', observations: [{ period: '2025-Q1', value: -3.2 }] }] }),
    );

    expect(records(csv)[1]).toBe('2025-Q1,-3.2');
    expect(csv).not.toContain("'-3.2");
  });
});

describe('the metadata', () => {
  it('names the source and the retrieval instant in the CSV preamble', () => {
    const csv = toCsv(example());
    const preamble = csv.split('\r\n').filter((line) => line.startsWith('#'));

    expect(preamble.join('\n')).toContain('Source: Eurostat (namq_10_gdp)');
    expect(preamble.join('\n')).toContain('Dataset: namq_10_gdp');
    expect(preamble.join('\n')).toContain('Retrieved from source: 2026-08-28T11:59:00.000Z');
    expect(preamble.join('\n')).toContain(`Exported: ${EXPORTED_AT}`);
    expect(preamble.join('\n')).toContain('Unit: % change');
    expect(preamble.join('\n')).toContain(DEFAULT_LICENCE);
    expect(preamble.join('\n')).toContain(DEFAULT_ATTRIBUTION);
    // A reader who strips the comments must be left with a conforming file.
    expect(preamble.every((line) => line.startsWith('# '))).toBe(true);
  });

  it('folds a line break in a title rather than letting it end the comment', () => {
    // A comment line is not escaped, because quoting one turns a line a human
    // is meant to read into `# "Column ""Population"" ..."`. A line break is
    // the one character that cannot be left alone: it would end the comment and
    // drop the rest of the title into the file as data.
    const title = 'GDP\ngrowth';
    expect(title).toContain('\n');

    const csv = toCsv(example({ title }));
    const lines = csv.split('\r\n').filter((line) => line !== '');
    const preamble = lines.filter((line) => line.startsWith('#'));

    expect(preamble.join('\n')).toContain('Indicator: GDP growth');
    // Nothing escaped into data: the header row is the first non-comment line,
    // and every comment line is still one line.
    expect(lines[preamble.length]).toBe('period,Latvia');
    expect(preamble.every((line) => line.startsWith('# '))).toBe(true);
  });

  it('says the retrieval instant is unknown rather than substituting the export clock', () => {
    // Two different facts, and only one of them is always knowable. Filling the
    // first in from the second would produce a plausible provenance stamp for
    // an event nobody observed.
    const csv = toCsv(example({ retrievedAt: undefined }));

    expect(csv).toContain('Retrieved from source: not reported by the API');
    expect(csv).not.toContain(`Retrieved from source: ${EXPORTED_AT}`);

    const parsed = JSON.parse(toJson(example({ retrievedAt: undefined })));
    expect('retrievedAt' in parsed, 'an unknown fact is omitted, not nulled').toBe(false);
    expect(parsed.exportedAt).toBe(EXPORTED_AT);
  });

  it('carries the unit and the source in the JSON, because a bare column is not open data', () => {
    const parsed = JSON.parse(toJson(example()));

    expect(parsed.unit).toBe('% change');
    expect(parsed.source).toBe('Eurostat (namq_10_gdp)');
    expect(parsed.dataset).toBe('namq_10_gdp');
    expect(parsed.title).toBe('GDP growth rate');
    expect(parsed.indicator).toBe('gdp');
    expect(parsed.retrievedAt).toBe('2026-08-28T11:59:00.000Z');
    expect(parsed.licence).toBe(DEFAULT_LICENCE);
    expect(parsed.attribution).toBe(DEFAULT_ATTRIBUTION);
    expect(parsed.note).toMatch(/not a zero/);
  });

  it('states a unit and a source per column when the columns do not share one', () => {
    // The key-indicators table is eight indicators side by side: a percentage
    // beside a headcount beside an index, each from its own cube. One `Unit:`
    // line over that would be a confident wrong answer about seven of them.
    const data = example({
      unit: 'varies by indicator',
      series: [
        {
          label: 'Unemployment rate',
          unit: '%',
          source: 'Eurostat (une_rt_m)',
          observations: [{ period: '2025-Q1', value: 6.1 }],
        },
        {
          label: 'Population',
          unit: 'persons',
          source: 'Eurostat (demo_pjan)',
          observations: [{ period: '2025-Q1', value: 1842226 }],
        },
      ],
    });

    const csv = toCsv(data);
    expect(csv).toContain('Column "Unemployment rate" – unit: % · source: Eurostat (une_rt_m)');
    expect(csv).toContain('Column "Population" – unit: persons · source: Eurostat (demo_pjan)');

    const parsed = JSON.parse(toJson(data));
    expect(parsed.series[0].unit).toBe('%');
    expect(parsed.series[1].source).toBe('Eurostat (demo_pjan)');
  });

  it('omits the per-column lines entirely when every column shares the header', () => {
    // The absence has to be asserted against a case that proves it could have
    // been present, which the test above is.
    expect(toCsv(example())).not.toContain('Column "');
  });
});

describe('period ordering', () => {
  it('sorts across columns rather than trusting the first one', () => {
    // The three countries do not publish on the same schedule, so taking the
    // first series' order and appending the rest puts an earlier quarter below
    // a later one. This is why BalticCompareChart sorts its merged periods too.
    const periods = exportPeriods([
      { label: 'Latvia', observations: [{ period: '2025-Q2', value: 1 }, { period: '2025-Q3', value: 2 }] },
      { label: 'Estonia', observations: [{ period: '2025-Q1', value: 3 }] },
    ]);

    expect(periods).toEqual(['2025-Q1', '2025-Q2', '2025-Q3']);
  });

  it('lists a period once however many columns carry it', () => {
    const periods = exportPeriods([
      { label: 'Latvia', observations: [{ period: '2025-Q1', value: 1 }] },
      { label: 'Estonia', observations: [{ period: '2025-Q1', value: 2 }] },
    ]);

    expect(periods).toEqual(['2025-Q1']);
  });
});

describe('the filename', () => {
  it('says what the file is, so it survives a downloads folder', () => {
    expect(exportFilename(example(), 'csv')).toBe('portabaltica-gdp-2026-08-28.csv');
    expect(exportFilename(example(), 'json')).toBe('portabaltica-gdp-2026-08-28.json');
  });

  it('never produces a name made only of separators', () => {
    expect(exportFilename(example({ indicator: '///' }), 'csv')).toBe(
      'portabaltica-series-2026-08-28.csv',
    );
    expect(exportFilename(example({ indicator: 'key-indicators-lv' }), 'csv')).toBe(
      'portabaltica-key-indicators-lv-2026-08-28.csv',
    );
  });
});

describe('optionalString', () => {
  it('reads a field the client-side type does not declare', () => {
    // `/api/baltic-compare` returns `dataset` and `fetchedAt`; the interface in
    // `src/api.ts` declares neither, and that file belongs to another session.
    expect(optionalString({ dataset: 'namq_10_gdp' }, 'dataset')).toBe('namq_10_gdp');
  });

  it('reports absence as absence rather than as an empty string', () => {
    expect(optionalString({}, 'dataset')).toBeUndefined();
    expect(optionalString({ dataset: '  ' }, 'dataset')).toBeUndefined();
    expect(optionalString({ dataset: 7 }, 'dataset')).toBeUndefined();
    expect(optionalString(null, 'dataset')).toBeUndefined();
    expect(optionalString(undefined, 'dataset')).toBeUndefined();
  });
});
