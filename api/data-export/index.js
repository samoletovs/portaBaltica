const INDICATORS = require('../shared/indicators.js');
const es = require('../shared/eurostat.js');
const exporter = require('../shared/seriesExport.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

/**
 * GET /api/data-export?indicator=<id>&years=<n>&format=csv|json
 *
 * The same series the dashboard draws, as a file, over HTTP — so a reader can
 * `curl` it, point a spreadsheet at the URL, or put it in a script.
 *
 * WHY THIS EXISTS WHEN A DOWNLOAD BUTTON ALREADY DOES
 * ----------------------------------------------------
 * `#187` gave every indicator surface a CSV and JSON download, and it is good:
 * RFC 4180 escaping, formula-injection defusing, a provenance preamble, and
 * `null` that never becomes a zero. But it runs in the browser, after the page
 * has fetched and drawn the series. There is no address a reader can hand to
 * anything that is not a browser — no `curl`, no Google Sheets `IMPORTDATA`,
 * no cron job, and nothing to paste into a citation.
 *
 * The formatting is therefore NOT reimplemented here: `api/shared/seriesExport.js`
 * mirrors `src/utils/exportSeries.ts` function for function, and
 * `tests/seriesExportParity.test.ts` runs both over the same inputs and requires
 * byte-identical output. Two CSV writers that disagree would hand a reader a
 * file whose columns differ from the one the button produces, and nobody using
 * only one of them could ever see it.
 *
 * WHY IT BUILDS THE SERIES RATHER THAN CALLING /api/baltic-compare
 * ----------------------------------------------------------------
 * Calling that endpoint's exported handler was the obvious way to reuse its
 * cached response, and it is wrong for a measured reason: the handler is
 * wrapped in `withCache`, whose first act is to consult the shared rate
 * limiter — and consulting it RECORDS A HIT. One reader asking for one file
 * would spend two of their sixty requests a minute, halving the limit for the
 * one endpoint most likely to be scripted.
 *
 * (The identifier for that consultation is deliberately not written out here.
 * `tests/responseCache.test.ts` finds endpoints that both call it and are
 * wrapped, by scanning the source text — so a comment naming it reads as a
 * second call. Measured: the first draft of this paragraph turned that guard
 * red while describing why this endpoint does not do the thing it guards
 * against. The guard is right to exist and its scan cannot tell a mention from
 * a call; stripping comments before matching would fix it, and that file
 * belongs to another session this round.)
 *
 * Fetching our own origin over HTTP is worse: every managed function shares one
 * egress address, so every reader's export would count against a single bucket
 * and the sixtieth export in any minute would 429 for everybody.
 *
 * So it uses the same shared builders `baltic-compare` uses — `es.buildUrl` and
 * `es.parseJsonStat` over the same `INDICATORS` registry — which is what
 * AGENTS.md asks for anyway: ask the application for the URL rather than
 * restating it. A shared enumeration cannot drift; two enumerations always will.
 * Upstream is still hit once per indicator per hour, because this handler has a
 * `withCache` of its own with the same TTL.
 */

/** The three the dashboard compares. The EU reference is a chart concern. */
/**
 * The three, the benchmark, and the rules for when the benchmark is one.
 *
 * IMPORTED RATHER THAN MIRRORED, AND THAT WAS NOT THE FIRST ATTEMPT
 * ----------------------------------------------------------------
 * The first version of this file copied `GEOS`, `REFERENCE_GEO`,
 * `referenceIsComparable` and `buildReference` out of `api/baltic-compare`,
 * on the assumption that a Function directory exports only its handler — which
 * is true of most of them. It is not true of that one. It exports all four
 * deliberately, and says why at the export: "so the split between the three and
 * the denominator is assertable, rather than being a convention a future
 * refactor could quietly undo."
 *
 * So the mirror was unnecessary, and a mirror you do not need is worse than one
 * you do: it has all the drift risk and none of the justification. Importing
 * costs nothing — `require` does not invoke the handler, so no rate-limit hit
 * is recorded and no request is made — and it means the two endpoints cannot
 * disagree about which countries they are talking about.
 *
 * WHY THIS ENDPOINT NEEDS THE BENCHMARK AT ALL
 * --------------------------------------------
 * It was omitted, and that was a defect. `BalticCompareChart` writes the
 * reference into its download whenever the cube carries one, and its reason
 * applies here word for word: "withholding is a decision about the axis, not
 * about the fact, and a file has no axis." Measured, 47 of the 71 indicators
 * carry one, so this endpoint served a file two-thirds of the registry short of
 * what the button serves for the same indicator.
 *
 * Nothing would have reported it. `tests/seriesExportParity.test.ts` holds the
 * two CSV *writers* byte-identical and passed throughout — the writers agreed
 * perfectly about a payload one side had built differently. That is the `keyOn`
 * failure one layer out: the collision is in what you assemble, not in how you
 * format it, and it is invisible to any check that begins after assembly. The
 * suite now drives both paths end to end and compares the files.
 */
const compare = require('../baltic-compare/index.js');
const GEOS = compare.GEOS;
const REFERENCE_GEO = compare.REFERENCE_GEO;

const COUNTRY_LABEL = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

const FORMATS = { csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8' };

/** How many years of history a request may ask for. */
const DEFAULT_YEARS = 5;
const MAX_YEARS = 30;

function bad(context, message) {
  context.res = {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

const handler = async function (context, req) {
  const query = (req && req.query) || {};

  const format = String(query.format || 'csv').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FORMATS, format)) {
    return bad(context, 'Unknown format. Available: ' + Object.keys(FORMATS).join(', '));
  }

  const indicator = String(query.indicator || '');
  const def = Object.prototype.hasOwnProperty.call(INDICATORS, indicator)
    ? INDICATORS[indicator]
    : null;
  if (!def) {
    // Names the valid ids rather than echoing the invalid one, which is how
    // every other endpoint here answers and is why none of them reflect input.
    return bad(context, 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', '));
  }

  // Clamped rather than rejected: an out-of-range `years` is a reader asking
  // for everything, and the honest answer is everything we have.
  const requested = parseInt(query.years, 10);
  const years = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_YEARS)
    : DEFAULT_YEARS;

  try {
    // Ask for the benchmark in the same request when the cube carries one — it
    // rides on the same call, so it costs nothing extra upstream.
    const wantReference = compare.referenceIsComparable(def);
    const requestGeos = wantReference ? GEOS.concat([REFERENCE_GEO]) : GEOS.slice();

    const url = es.buildUrl(def, years, requestGeos);
    const raw = await es.httpJson(url, { deadlineMs: 20000 });
    const parsed = es.parseJsonStat(raw, requestGeos);

    const series = GEOS
      .filter(function (geo) { return parsed.countries[geo]; })
      .map(function (geo) {
        const country = parsed.countries[geo];
        return {
          label: COUNTRY_LABEL[geo] || geo,
          observations: (country.series || []).map(function (point) {
            return {
              period: point.period,
              // `null` is "the source did not publish this period". It must
              // survive to the file as an empty cell, never as a zero.
              value: typeof point.value === 'number' && Number.isFinite(point.value)
                ? point.value
                : null,
            };
          }),
        };
      });

    // The guard runs on the three Baltic columns, BEFORE the benchmark is
    // appended — structure rather than a label comparison, so nothing depends
    // on a string the parity test also owns.
    //
    // The order matters and is not stylistic. An EU27 series is populated for
    // almost every cube, so a guard applied after the append would be satisfied
    // by the one column the reader did not ask for: three empty countries
    // beside a full EU line, served as though it answered the question.
    if (!series.some(function (one) {
      return one.observations.some(function (o) { return o.value !== null; });
    })) {
      /**
       * Upstream answered, and answered with nothing for every country.
       *
       * The guard here was first written as `series.length === 0`, which is
       * UNREACHABLE: measured, `es.parseJsonStat` returns every requested geo
       * with a null-filled series whatever the payload contains, so the array
       * is never empty. It read as protection and could not fire — caught only
       * because a test expected it to and it did not.
       *
       * The condition that matters is that no country has a single reading. A
       * file of headers and empty cells is not an honest export: opened in a
       * spreadsheet it reads as three countries that reported nothing, when
       * what happened is that we asked the wrong question or the cube is empty.
       */
      context.res = {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicator: indicator,
          error: 'The source returned no observations for any Baltic country.',
          source: 'Eurostat (' + def.dataset + ')',
        }),
      };
      return;
    }

    // The benchmark, appended after the three and after the guard.
    //
    // Named "EU27 average" rather than "EU27" so a column header cannot be read
    // as a fourth country. That wording is the button's — `${reference.label}
    // average` in `BalticCompareChart` — and the parity test compares the two
    // files, so a tidier label here would be a divergence rather than an
    // improvement.
    //
    // `buildReference` is the shared gate rather than a local null check,
    // because a cube can list `EU27_2020` and populate none of it —
    // `rail_go_quartal` does. A benchmark column of nothing is worse than no
    // column: a spreadsheet renders it as a header with empty cells under it,
    // which reads as the EU having stopped reporting.
    const reference = wantReference
      ? compare.buildReference(parsed.countries[REFERENCE_GEO])
      : null;
    if (reference) {
      series.push({
        label: reference.label + ' average',
        observations: reference.series.map(function (point) {
          return {
            period: point.period,
            value: typeof point.value === 'number' && Number.isFinite(point.value)
              ? point.value
              : null,
          };
        }),
      });
    }

    // One stamp, read once. These are two different facts in general — the
    // browser exporter must distinguish them, because there the payload may be
    // minutes old by the time a reader clicks — but here they genuinely
    // coincide: this handler did the fetch a few milliseconds ago and is
    // writing the file from it. Two separate `new Date()` calls would let them
    // disagree by a millisecond for no reason and make the claim harder to
    // check.
    //
    // Both are the cache-fill instant rather than the request instant, and that
    // is the honest reading: `withCache` serves these exact bytes, so the file
    // a reader saves at 11:59 really was written at 11:00. It matters most in
    // the grace window, where an upstream outage means the file correctly says
    // it was retrieved hours ago instead of silently claiming to be current.
    const stampedAt = new Date().toISOString();

    const payload = {
      indicator: indicator,
      title: def.title,
      unit: def.unit,
      source: 'Eurostat (' + def.dataset + ')',
      dataset: def.dataset,
      retrievedAt: stampedAt,
      exportedAt: stampedAt,
      series: series,
    };

    const body = format === 'csv' ? exporter.toCsv(payload) : exporter.toJson(payload);

    context.res = {
      status: 200,
      headers: {
        'Content-Type': FORMATS[format],
        'Cache-Control': 'public, max-age=3600',
        // `attachment` so a browser saves it rather than rendering CSV as a
        // wall of text, and so the filename says what the file is a week later.
        'Content-Disposition':
          'attachment; filename="' + exporter.exportFilename(payload, format) + '"',
      },
      body: body,
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: indicator,
        error: error.message,
        source: 'Eurostat (' + def.dataset + ')',
      }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  // Every parameter the handler reads, named. A key that omitted `format` would
  // serve the CSV under the JSON content type to whoever asked second, and one
  // that omitted `years` would serve five years under a thirty-year heading —
  // correct figures, wrong question, and nothing malformed to notice.
  name: 'data-export',
  keyOn: ['indicator', 'years', 'format'],
  ttlMs: 3600000,
  graceMs: 21600000,
  staleWhileRevalidate: true,
}));
