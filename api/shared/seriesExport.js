// ─── Writing a series as CSV or JSON, on the server ───
//
// WHY THIS IS A MIRROR OF `src/utils/exportSeries.ts`
// ---------------------------------------------------
// The browser has produced these files since #187, and it produces them well:
// RFC 4180 escaping, formula-injection defusing, `null` that never becomes a
// zero, and a provenance preamble. None of that should be reinvented.
//
// It also cannot be shared. Measured: `src/utils/exportSeries.ts` is TypeScript
// inside the `src` project, `tsconfig.app.json` sets `"include": ["src"]`, and
// the Function App is deployed from `api/` alone — a probe importing across the
// boundary fails with `TS2307` in one direction and has no file to import in
// the other. It is the same wall `api/shared/pageMeta.js` records.
//
// So this is a second implementation, and it gets the same treatment as that
// one: `tests/seriesExportParity.test.ts` runs BOTH over the same inputs and
// requires byte-identical output. Two CSV writers that disagree would hand a
// reader a file whose columns differ from the one the download button produces,
// and the disagreement would be invisible to anyone who only ever used one.
//
// Every comment explaining WHY a rule exists lives in the TypeScript original.
// Duplicating that prose here would create two explanations that can drift, so
// this file states the rule and points at the file that argues for it.

'use strict';

/** RFC 4180 §2: records are separated by CRLF. */
const CRLF = '\r\n';

const DEFAULT_LICENCE =
  'Source data is published by its statistical authority under CC0 or CC BY. Check the source before redistributing.';

const DEFAULT_ATTRIBUTION = 'portaBaltica (https://portabaltica.naurolabs.com)';

/** RFC 4180 §2 rules 6 and 7. See `csvField` in src/utils/exportSeries.ts. */
function csvField(value) {
  const text = String(value);
  return /["\r\n,]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/**
 * A text field, defused against spreadsheet formula injection.
 *
 * Text only — numbers are never routed through this, or every negative reading
 * on the site would export as `'-3.2`. See the original for the argument.
 */
function csvText(value) {
  const text = String(value);
  return csvField(/^[=+\-@\t\r]/.test(text) ? "'" + text : text);
}

/** `null` is empty, `0` is `0`, and a non-finite number is empty. */
function csvNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Every period across every series, sorted — which for these codes is chronological. */
function exportPeriods(series) {
  const periods = new Set();
  for (const one of series) {
    for (const observation of one.observations) periods.add(observation.period);
  }
  return [...periods].sort();
}

/** The `#`-prefixed preamble. Comments, so deliberately not run through csvField. */
function csvPreamble(data) {
  const lines = [
    'portaBaltica data export',
    'Indicator: ' + data.title,
    'Unit: ' + (data.unit || 'not stated'),
    'Source: ' + data.source,
  ];
  if (data.dataset) lines.push('Dataset: ' + data.dataset);
  lines.push('Retrieved from source: ' +
    (data.retrievedAt === undefined || data.retrievedAt === null
      ? 'not reported by the API'
      : data.retrievedAt));
  lines.push('Exported: ' + data.exportedAt);
  lines.push('Licence: ' + (data.licence == null ? DEFAULT_LICENCE : data.licence));
  lines.push('Attribution: ' + (data.attribution == null ? DEFAULT_ATTRIBUTION : data.attribution));
  for (const one of data.series) {
    if (!one.unit && !one.source) continue;
    const detail = [
      one.unit ? 'unit: ' + one.unit : null,
      one.source ? 'source: ' + one.source : null,
    ].filter(Boolean).join(' \u00b7 ');
    lines.push('Column "' + one.label + '" \u2013 ' + detail);
  }
  lines.push('An empty value is a period the source did not publish, not a zero.');

  return lines.map(function (line) { return '# ' + line.replace(/[\r\n]+/g, ' '); });
}

/** Wide CSV: one row per period, one column per series. */
function toCsv(data) {
  const periods = exportPeriods(data.series);
  const byPeriod = data.series.map(function (one) {
    return new Map(one.observations.map(function (o) { return [o.period, o.value]; }));
  });

  const header = ['period'].concat(data.series.map(function (one) { return one.label; }))
    .map(csvText).join(',');

  const rows = periods.map(function (period) {
    return [csvText(period)].concat(byPeriod.map(function (lookup) {
      const value = lookup.get(period);
      return csvNumber(value === undefined ? null : value);
    })).join(',');
  });

  return csvPreamble(data).concat([header], rows).join(CRLF) + CRLF;
}

/** The same facts as the preamble, in a shape a script can read. */
function toJson(data) {
  const payload = {
    portal: 'portaBaltica',
    indicator: data.indicator,
    title: data.title,
    unit: data.unit,
    source: data.source,
  };
  if (data.dataset) payload.dataset = data.dataset;
  if (data.retrievedAt) payload.retrievedAt = data.retrievedAt;
  payload.exportedAt = data.exportedAt;
  payload.licence = data.licence == null ? DEFAULT_LICENCE : data.licence;
  payload.attribution = data.attribution == null ? DEFAULT_ATTRIBUTION : data.attribution;
  payload.note = 'A null value is a period the source did not publish, not a zero.';
  payload.series = data.series.map(function (one) {
    const column = { label: one.label };
    if (one.unit) column.unit = one.unit;
    if (one.source) column.source = one.source;
    column.observations = one.observations.map(function (o) {
      return {
        period: o.period,
        value: typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null,
      };
    });
    return column;
  });

  return JSON.stringify(payload, null, 2);
}

/**
 * A filename that identifies the file a week later.
 *
 * Mirrors the original exactly, including its use of `indicator` alone and its
 * single-dash trim — the parity test compares the strings, so a "tidier" regex
 * here is a divergence rather than an improvement.
 */
function exportFilename(data, extension) {
  const slug = String(data.indicator)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'series';
  const day = data.exportedAt.slice(0, 10);
  return 'portabaltica-' + slug + '-' + day + '.' + extension;
}

module.exports = {
  CRLF,
  DEFAULT_LICENCE,
  DEFAULT_ATTRIBUTION,
  csvField,
  csvText,
  csvNumber,
  exportPeriods,
  csvPreamble,
  toCsv,
  toJson,
  exportFilename,
};
