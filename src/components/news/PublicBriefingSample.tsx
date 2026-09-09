import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBalticCompare, type BalticCompareData } from '../../api';
import { finite } from '../../utils/payload';
import { formatValue } from '../../utils/formatValue';
import { type SeriesExport } from '../../utils/exportSeries';
import { freshnessOf, formatPeriod, periodCoverage } from '../../dataFreshness';
import { freshnessLabelColor } from '../freshnessStyle';
import { FreshnessNotice } from '../FreshnessNotice';
import { DownloadMenu } from '../DownloadMenu';

/**
 * A complete, source-linked public sample of the Baltic business briefing:
 * inflation, hourly labour cost and retail sales growth, each fetched
 * independently from `/api/baltic-compare` so one measure failing does not
 * take the other two with it.
 *
 * The rule every branch below serves: a reader must never be shown a
 * three-country range built from three different periods without being told
 * so. `latestCommonReading` finds the newest period all three countries
 * actually published a finite reading for; only then is a range ("from X to
 * Y") stated. Where the countries have not converged on one period, each
 * country's own latest reading is shown with its own period and no range is
 * computed across them.
 */

const YEARS = 3;

type CountryCode = 'LV' | 'EE' | 'LT';
const COUNTRY_CODES: readonly CountryCode[] = ['LV', 'EE', 'LT'];
const COUNTRY_NAMES: Record<CountryCode, string> = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

interface Measure {
  readonly id: string;
  readonly fallbackTitle: string;
  readonly context: string;
}

const MEASURES: readonly Measure[] = [
  {
    id: 'inflation',
    fallbackTitle: 'HICP Inflation',
    context:
      'This is the annual change in the whole consumer price basket: a headline inflation rate, not the price of any single good or service.',
  },
  {
    id: 'salary',
    fallbackTitle: 'Hourly labour cost',
    context:
      'This is average hourly employer labour cost within the statistical series, not take-home pay or a quote for a particular role.',
  },
  {
    id: 'retail',
    fallbackTitle: 'Retail sales growth',
    context:
      'This measures growth in overall retail trade activity as published by the statistical office. It is not a measure of profitability, and not a measure of any single business.',
  },
];

interface CountryReading {
  code: CountryCode;
  value: number;
  period: string;
}

/** This country's readings that are actually numbers, in the order the API sent them. A zero is a reading; only `null` is absent. */
function finiteReadings(data: BalticCompareData, code: CountryCode): { period: string; value: number }[] {
  const series = data.countries?.[code]?.series ?? [];
  const readings: { period: string; value: number }[] = [];
  for (const point of series) {
    const value = finite(point.value);
    if (value !== null) readings.push({ period: point.period, value });
  }
  return readings;
}

/** Each country's own newest reading, independent of what the others published. */
function latestOwnReadings(data: BalticCompareData): CountryReading[] {
  const rows: CountryReading[] = [];
  for (const code of COUNTRY_CODES) {
    const readings = finiteReadings(data, code).sort((a, b) => a.period.localeCompare(b.period));
    const last = readings[readings.length - 1];
    if (last) rows.push({ code, value: last.value, period: last.period });
  }
  return rows;
}

/**
 * The newest period at which every one of LV, EE and LT reported a finite
 * reading, together with each country's reading at that period — or `null`
 * if the three have never shared one inside the fetched window.
 */
function latestCommonReading(data: BalticCompareData): { period: string; rows: CountryReading[] } | null {
  const readingsByCode = new Map(COUNTRY_CODES.map((code) => [code, finiteReadings(data, code)] as const));
  const periods = new Set<string>();
  for (const readings of readingsByCode.values()) {
    for (const reading of readings) periods.add(reading.period);
  }

  for (const period of [...periods].sort().reverse()) {
    const rows: CountryReading[] = [];
    for (const code of COUNTRY_CODES) {
      const reading = readingsByCode.get(code)!.find((r) => r.period === period);
      if (reading) rows.push({ code, value: reading.value, period });
    }
    if (rows.length === COUNTRY_CODES.length) return { period, rows };
  }
  return null;
}

function spreadOf(rows: CountryReading[]): { min: CountryReading; max: CountryReading } {
  let min = rows[0];
  let max = rows[0];
  for (const row of rows) {
    if (row.value < min.value) min = row;
    if (row.value > max.value) max = row;
  }
  return { min, max };
}

function retrievedAtLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A link to the upstream Eurostat table, built from the dataset code the payload actually reported — never a guessed code. */
function datasetHref(dataset?: string): string | null {
  return dataset
    ? `https://ec.europa.eu/eurostat/databrowser/view/${encodeURIComponent(dataset)}/default/table?lang=en`
    : null;
}

type Phase = 'loading' | 'error' | 'ready';

function MeasureSection({ measure }: { measure: Measure }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; data: BalticCompareData | null; failed: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    fetchBalticCompare(measure.id, YEARS)
      .then((payload) => {
        if (!active) return;
        // A payload answering for a different indicator is a cache collision,
        // not a reading (AGENTS.md: never let two definitions share a cache
        // key). Report a failed read, not an allegedly empty source.
        const data = payload && payload.indicator === measure.id ? payload : null;
        setResult({ attempt, data, failed: !data });
      })
      .catch(() => {
        if (active) setResult({ attempt, data: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [measure.id, attempt]);

  // Ignores a response from an attempt that is no longer current — a retry
  // that supersedes an in-flight request, or a request that resolves after
  // this section unmounted.
  const current = result && result.attempt === attempt ? result : null;
  const phase: Phase = current === null ? 'loading' : current.failed ? 'error' : 'ready';
  const data = current && !current.failed ? current.data : null;

  const title = data?.title ?? measure.fallbackTitle;
  const unit = data?.unit ?? '';

  const ownRows = data ? latestOwnReadings(data) : [];
  const common = data ? latestCommonReading(data) : null;
  const displayRows = common?.rows ?? ownRows;
  const rowByCode = new Map(displayRows.map((row) => [row.code, row] as const));
  const missing = COUNTRY_CODES.filter((code) => !rowByCode.has(code));
  const empty = phase === 'ready' && displayRows.length === 0;

  // Freshness is judged on whatever is actually displayed: the single common
  // period when there is one, or the oldest of the three own-latest readings
  // when there is not — the same "judge on the laggard" rule as the ranked
  // comparisons elsewhere on the dashboard.
  const periods = [...displayRows.map((row) => row.period)].sort();
  const coverage = periods.length > 0 ? periodCoverage(periods[0], periods[periods.length - 1]) : null;
  const freshness = periods.length > 0 ? freshnessOf(periods[0]) : null;

  let summary = '';
  if (common) {
    const { min, max } = spreadOf(common.rows);
    summary = min.value === max.value
      ? `In ${formatPeriod(common.period)}, Latvia, Estonia and Lithuania all reported the same figure: ${formatValue(min.value, unit)}.`
      : `In ${formatPeriod(common.period)}, the reading ranged from ${formatValue(min.value, unit)} in ${COUNTRY_NAMES[min.code]} to ${formatValue(max.value, unit)} in ${COUNTRY_NAMES[max.code]}.`;
  } else if (ownRows.length > 0) {
    summary = missing.length > 0
      ? 'The retrieved window does not contain readings for all three countries. Available readings are shown below; no three-country range is stated.'
      : 'Latvia, Estonia and Lithuania last published this measure for different periods, so their latest readings are shown separately below rather than compared.';
  }

  const exportData: SeriesExport | null = data
    ? {
        indicator: measure.id,
        title,
        unit,
        source: data.source || 'Eurostat',
        dataset: data.dataset,
        retrievedAt: data.fetchedAt,
        exportedAt: new Date().toISOString(),
        series: COUNTRY_CODES.map((code) => ({
          label: COUNTRY_NAMES[code],
          observations: data.countries?.[code]?.series ?? [],
        })),
      }
    : null;

  const headingId = `public-briefing-${measure.id}`;
  const href = datasetHref(data?.dataset);

  return (
    <section aria-labelledby={headingId} className="public-briefing-measure">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 id={headingId} className="text-title font-semibold news-fg">{title}</h2>
        {coverage && (
          <span className="text-caption font-mono" style={{ color: freshnessLabelColor(freshness) }}>
            {coverage.label}
          </span>
        )}
      </div>

      <p className="text-ui news-subtle mt-1">{measure.context}</p>

      {phase === 'loading' && (
        <div role="status" aria-busy="true" aria-label={`Loading ${title}`} className="mt-4 space-y-2">
          <div className="h-4 news-skeleton rounded w-1/2 animate-pulse" />
          <div className="h-20 news-skeleton rounded animate-pulse" />
        </div>
      )}

      {phase === 'error' && (
        <div role="status" className="mt-4">
          <p className="text-ui news-warning">This measure could not be loaded right now.</p>
          <button type="button" className="news-link text-ui font-semibold" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {phase === 'ready' && empty && (
        <div role="status" className="mt-4">
          <p className="text-ui news-subtle">No published reading is available for this measure in the last {YEARS} years.</p>
          <button type="button" className="news-link text-ui font-semibold" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {phase === 'ready' && !empty && (
        <>
          <FreshnessNotice freshness={freshness} spans={coverage?.spans} className="mt-2" />
          <p className="text-callout news-fg mt-2">{summary}</p>
          {missing.length > 0 && (
            <p className="text-caption news-subtle mt-1">
              No reading available for {missing.map((code) => COUNTRY_NAMES[code]).join(' or ')} in the retrieved {YEARS}-year window.
            </p>
          )}

          <div className="overflow-x-auto mt-3" role="region" aria-label={`${title} by country`} tabIndex={0}>
            <table className="w-full border-collapse text-ui">
              <caption className="text-caption news-subtle text-left mb-2">
                {common
                  ? `${title} by country, ${formatPeriod(common.period)}${unit ? ` (${unit})` : ''}. An em dash means no published reading, not zero.`
                  : `${title}, each country's own latest available reading${unit ? ` (${unit})` : ''}. No period has readings from all three countries in this window. An em dash means no available reading, not zero.`}
              </caption>
              <thead>
                <tr className="news-border border-b">
                  <th scope="col" className="text-left py-2 pr-2">Country</th>
                  <th scope="col" className="text-right py-2 pr-2">Value</th>
                  <th scope="col" className="text-right py-2 pr-2">Period</th>
                  <th scope="col" className="text-right py-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {COUNTRY_CODES.map((code) => {
                  const row = rowByCode.get(code);
                  const rowFreshness = row ? freshnessOf(row.period) : null;
                  return (
                    <tr key={code} className="news-border border-b">
                      <th scope="row" className="text-left py-2 pr-2 font-semibold news-fg">{COUNTRY_NAMES[code]}</th>
                      <td className="text-right py-2 pr-2 text-lead tabular-nums news-fg">
                        {row ? formatValue(row.value, unit) : <span aria-label={`No published reading for ${COUNTRY_NAMES[code]}`}>—</span>}
                      </td>
                      <td className="text-right py-2 pr-2 font-mono" style={{ color: freshnessLabelColor(rowFreshness) }}>
                        {row ? formatPeriod(row.period) : '—'}
                      </td>
                      <td className="text-right py-2">
                        <Link
                          to={`/indicator/${measure.id}?country=${code}`}
                          className="news-link inline-flex min-h-11 items-center text-ui"
                        >
                          View <span aria-hidden="true">→</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <p className="text-caption news-subtle">
              Source: {data?.source ?? 'Eurostat'}
              {href && data?.dataset && (
                <>
                  {' '}·{' '}
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="news-link inline-flex min-h-11 items-center"
                  >
                    View dataset {data.dataset} <span aria-hidden="true">↗</span>
                  </a>
                </>
              )}
              {data?.fetchedAt && (
                <>
                  {' '}· Retrieved <time dateTime={data.fetchedAt}>{retrievedAtLabel(data.fetchedAt)}</time>
                </>
              )}
            </p>
            <DownloadMenu data={exportData} className="public-briefing-download" />
          </div>
        </>
      )}
    </section>
  );
}

export function PublicBriefingSample() {
  return (
    <div className="public-briefing-sample space-y-8">
      {MEASURES.map((measure) => (
        <MeasureSection key={measure.id} measure={measure} />
      ))}
    </div>
  );
}
