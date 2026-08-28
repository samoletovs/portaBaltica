/**
 * Turning a series on this dashboard into a file a reader can keep.
 *
 * Until now there was no download affordance anywhere on the site — a grep for
 * `download|csv|blob:|createObjectURL` across `src/` returned two hits, one of
 * them `ApiDocsPage` advertising "CSV data export" as a feature that did not
 * exist. On an open-data portal that is the most conspicuous possible absence.
 *
 * Two rules govern everything here, and both are inherited rather than invented.
 *
 * **A missing observation is an empty field, never a zero.** `payload.ts`
 * already argues this at length: on this dashboard the absence of a reading has
 * twice rendered as a confident value, once saying the air was clean and once
 * saying the sea was dangerous. A CSV is worse than a panel for it, because the
 * reader takes the file away and nothing travels with it to say the zero was
 * never measured. So `null` is an empty field and `0` is `0`, and the two are
 * tested against each other rather than separately — a check that only asserts
 * "null is empty" passes happily on an implementation that renders everything
 * empty.
 *
 * **A number with no unit is not open data.** A bare column of figures is a
 * table; what makes it reusable is knowing what was measured, in what units,
 * from which cube, and when it was read. That metadata is not decoration on the
 * export, it is the export — which is why both formats carry it and why the
 * absent case is stated rather than filled in.
 *
 * Nothing here touches the DOM. The Blob and the object URL live in
 * `DownloadMenu`, so the formatting is testable without a browser and the
 * browser code has nothing in it worth testing.
 */

/** One reading. `null` is "not published", and never becomes a zero. */
export interface ExportObservation {
  period: string;
  value: number | null;
}

/** One column of the export: a country, or a single indicator's own series. */
export interface ExportSeries {
  /** The column header, and the JSON label. "Latvia", or the indicator title. */
  label: string;
  /**
   * This column's own unit and source, where they differ column to column.
   *
   * The key-indicators table puts eight indicators side by side — a percentage
   * beside a headcount beside an index — each from its own Eurostat cube. One
   * `Unit:` line over that file would be a confident wrong answer about seven
   * of the columns, so a column that has its own says so.
   */
  unit?: string;
  source?: string;
  observations: ExportObservation[];
}

/**
 * Everything a reader needs to reuse the numbers honestly.
 *
 * `retrievedAt` is optional and `exportedAt` is not, because they are different
 * facts and only one of them is always knowable. `retrievedAt` is the upstream
 * fetch instant the API reports; where the payload does not carry one, it is
 * omitted and the file says so. Substituting the browser's clock would produce
 * a plausible provenance stamp for an event that was never observed, which is
 * the same defect as a zero standing in for a missing reading.
 */
export interface SeriesExport {
  /** The dashboard's own id, e.g. `gdp`. */
  indicator: string;
  title: string;
  /** What the numbers are in. Empty only where the statistic genuinely is a count. */
  unit: string;
  /** Human-readable origin, e.g. `Eurostat (namq_10_gdp)`. */
  source: string;
  /** The upstream table code on its own, where the payload reports one. */
  dataset?: string;
  /** When portaBaltica read it from the source, as reported by the API. */
  retrievedAt?: string;
  /** When this file was written. */
  exportedAt: string;
  licence?: string;
  attribution?: string;
  series: ExportSeries[];
}

export const DEFAULT_LICENCE =
  'Source data is published by its statistical authority under CC0 or CC BY. Check the source before redistributing.';

export const DEFAULT_ATTRIBUTION = 'portaBaltica (https://portabaltica.naurolabs.com)';

/** RFC 4180 §2: records are separated by CRLF. */
const CRLF = '\r\n';

/**
 * A field, escaped per RFC 4180 §2.
 *
 * Rules 6 and 7: a field containing a comma, a double quote or a line break is
 * enclosed in double quotes, and an embedded double quote is escaped by
 * doubling it. A field with none of those is written bare, because quoting
 * everything is legal but makes the file harder to read by eye.
 */
export function csvField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A text field, neutralised against spreadsheet formula injection.
 *
 * A CSV cell beginning `=`, `+`, `-`, `@`, tab or carriage return is evaluated
 * as a formula by Excel, LibreOffice and Google Sheets, so a hostile label in
 * an upstream payload becomes code in the reader's spreadsheet. Quoting does
 * not prevent this — the quotes are stripped before evaluation — so the leading
 * character has to be defused, which OWASP does with a single quote.
 *
 * This applies to *text* only. Numbers are never routed through it: they are
 * produced by `csvNumber` from a JS number and can only ever be a numeric
 * literal, so a negative reading exports as `-3.2` and not as `'-3.2`. Defusing
 * numbers too would corrupt every negative figure on the site, which is most of
 * a page of them on any percentage-change series.
 */
function csvText(value: string): string {
  return csvField(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/**
 * A reading, as a CSV field.
 *
 * The whole point of this module in one line: `null` is empty, `0` is `0`.
 * Non-finite values are empty too — `NaN` and `Infinity` arrive from arithmetic
 * on absent fields rather than from a statistical office, and writing "NaN"
 * into a spreadsheet column is a worse answer than writing nothing.
 */
export function csvNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * Every period across every series, in order.
 *
 * Sorted rather than kept in arrival order, and sorted for the same reason
 * `BalticCompareChart` sorts its merged periods: the three countries do not
 * publish on the same schedule, so taking the first series' order and appending
 * the rest puts an earlier quarter below a later one. Eurostat period codes are
 * zero-padded and fixed-width within a frequency (`2024-Q1`, `2024-01`, `2024`),
 * so a lexical sort is a chronological one.
 */
export function exportPeriods(series: ExportSeries[]): string[] {
  const periods = new Set<string>();
  for (const one of series) {
    for (const observation of one.observations) periods.add(observation.period);
  }
  return [...periods].sort();
}

/**
 * The preamble, as `#`-prefixed lines.
 *
 * RFC 4180 has no comment convention, which is a real tension with carrying
 * metadata: a metadata row of a different width makes the file ragged and some
 * strict parsers reject it. `#` is the escape hatch every practical tool
 * understands — pandas `comment='#'`, R `comment.char='#'`, csvkit — and a
 * reader stripping lines that start with `#` is left with a strictly conforming
 * file.
 *
 * These lines are deliberately *not* run through `csvField`. They are comments
 * rather than records, so a comma or a quote inside one is harmless, and
 * quoting them turns a line a human is meant to read into
 * `# "Column ""Population"" – unit: persons"`. What is not harmless is a line
 * break, because it would end the comment and leave the remainder of a title
 * sitting in the file as an unprefixed line that a parser would read as data.
 * So breaks are folded to spaces and nothing else is touched.
 */
export function csvPreamble(data: SeriesExport): string[] {
  const lines = [
    'portaBaltica data export',
    `Indicator: ${data.title}`,
    `Unit: ${data.unit || 'not stated'}`,
    `Source: ${data.source}`,
  ];
  if (data.dataset) lines.push(`Dataset: ${data.dataset}`);
  // Stated as unknown rather than filled in with the exporting clock: see the
  // note on `retrievedAt` above.
  lines.push(`Retrieved from source: ${data.retrievedAt ?? 'not reported by the API'}`);
  lines.push(`Exported: ${data.exportedAt}`);
  lines.push(`Licence: ${data.licence ?? DEFAULT_LICENCE}`);
  lines.push(`Attribution: ${data.attribution ?? DEFAULT_ATTRIBUTION}`);
  // Where the columns do not share a unit or a source, each one states its
  // own. Omitted entirely when they do, rather than repeating the header.
  for (const one of data.series) {
    if (!one.unit && !one.source) continue;
    const detail = [one.unit && `unit: ${one.unit}`, one.source && `source: ${one.source}`]
      .filter(Boolean)
      .join(' · ');
    lines.push(`Column "${one.label}" – ${detail}`);
  }
  // An empty cell in the table below is a period the source did not publish.
  // Saying so in the file is the only place it can be said, because the file
  // outlives the page that explained it.
  lines.push('An empty value is a period the source did not publish, not a zero.');

  return lines.map((line) => `# ${line.replace(/[\r\n]+/g, ' ')}`);
}

/**
 * The series as RFC 4180 CSV, wide: one row per period, one column per series.
 *
 * Wide rather than long because the common case is three Baltic countries over
 * the same periods, and a reader opening that in a spreadsheet wants to compare
 * across a row. It also degrades correctly to a single indicator, which is a
 * one-column table rather than a special case.
 */
export function toCsv(data: SeriesExport): string {
  const periods = exportPeriods(data.series);

  // A lookup per series, so a period missing from one country costs nothing to
  // detect and renders as an absent field rather than as a shifted column.
  const byPeriod = data.series.map(
    (one) => new Map(one.observations.map((o) => [o.period, o.value])),
  );

  const header = ['period', ...data.series.map((one) => one.label)].map(csvText).join(',');

  const rows = periods.map((period) =>
    [csvText(period), ...byPeriod.map((lookup) => csvNumber(lookup.get(period) ?? null))].join(','),
  );

  return [...csvPreamble(data), header, ...rows].join(CRLF) + CRLF;
}

/**
 * The series as JSON, metadata first.
 *
 * The same facts as the CSV preamble, in a shape a script can read without
 * parsing comments. `null` survives as `null` — JSON has a way of saying "no
 * reading" that CSV does not, and it would be perverse to throw it away.
 *
 * A key is omitted where the fact is unknown rather than emitted as `null`,
 * which keeps "the API did not report this" distinguishable from "the API
 * reported nothing for it".
 */
export function toJson(data: SeriesExport): string {
  return JSON.stringify(
    {
      portal: 'portaBaltica',
      indicator: data.indicator,
      title: data.title,
      unit: data.unit,
      source: data.source,
      ...(data.dataset ? { dataset: data.dataset } : {}),
      ...(data.retrievedAt ? { retrievedAt: data.retrievedAt } : {}),
      exportedAt: data.exportedAt,
      licence: data.licence ?? DEFAULT_LICENCE,
      attribution: data.attribution ?? DEFAULT_ATTRIBUTION,
      note: 'A null value is a period the source did not publish, not a zero.',
      series: data.series.map((one) => ({
        label: one.label,
        ...(one.unit ? { unit: one.unit } : {}),
        ...(one.source ? { source: one.source } : {}),
        observations: one.observations.map((o) => ({
          period: o.period,
          value: typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null,
        })),
      })),
    },
    null,
    2,
  );
}

/**
 * A filename that says what the file is without needing the page it came from.
 *
 * Downloads land in one folder with everything else a reader has ever saved, so
 * `export.csv` is a file they cannot identify a week later.
 */
export function exportFilename(data: SeriesExport, extension: 'csv' | 'json'): string {
  const slug =
    data.indicator
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'series';
  const day = data.exportedAt.slice(0, 10);
  return `portabaltica-${slug}-${day}.${extension}`;
}

/**
 * A string field off a payload whose client-side type does not declare it.
 *
 * `/api/baltic-compare` returns `dataset` and `fetchedAt`; `BalticCompareData`
 * in `src/api.ts` declares neither, and that file is owned by another session
 * in this programme, so it cannot be widened here. Reading defensively is the
 * honest interim: where the field is genuinely absent the export says so rather
 * than inventing a value.
 */
export function optionalString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
