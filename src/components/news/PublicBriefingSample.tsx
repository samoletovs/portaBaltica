import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchBalticCompare, type BalticCompareData } from '../../api';
import { finite } from '../../utils/payload';
import { formatValue } from '../../utils/formatValue';
import { type SeriesExport } from '../../utils/exportSeries';
import { freshnessOf, formatPeriod, periodCoverage } from '../../dataFreshness';
import { freshnessLabelColor } from '../freshnessStyle';
import { FreshnessNotice } from '../FreshnessNotice';
import { DownloadMenu } from '../DownloadMenu';
import { briefingChange, briefingNextCheck } from './briefingPlanning';
import './BriefingExperience.css';

/**
 * A complete, source-linked public sample of the Baltic business briefing:
 * inflation, hourly labour cost and retail sales growth. Each has independent
 * request state through `fetchBalticCompare`, so one measure failing does not
 * take the other two with it, even when their reads travel in one batch.
 *
 * The rule every branch below serves: a reader must never be shown a
 * three-country range built from three different periods without being told
 * so. `latestCommonReading` finds the newest period all three countries
 * actually published a finite reading for; only then is a range ("from X to
 * Y") stated. Where the countries have not converged on one period, each
 * country's own latest reading is shown with its own period and no range is
 * computed across them.
 *
 * The selected country's planning note uses its own latest observation and
 * only the immediately preceding calendar period. Questions and monitoring
 * conditions are framing, not forecasts or evidence of a business outcome.
 */

const YEARS = 3;

type CountryCode = 'LV' | 'EE' | 'LT';
const COUNTRY_CODES: readonly CountryCode[] = ['LV', 'EE', 'LT'];
const COUNTRY_NAMES: Record<CountryCode, string> = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

interface Measure {
  readonly id: string;
  readonly navigationLabel: string;
  readonly fallbackTitle: string;
  readonly context: string;
  readonly question: string;
  readonly whyMonitor: string;
  readonly nextCondition: string;
}

const MEASURES: readonly Measure[] = [
  {
    id: 'inflation',
    navigationLabel: 'Prices',
    fallbackTitle: 'HICP Inflation',
    question: 'Is annual consumer-price pressure changing?',
    whyMonitor: 'Use this as background for consumer-price assumptions, then check the prices and product mix relevant to your business.',
    nextCondition: 'A lower positive rate means slower annual price growth, not prices below a year earlier.',
    context:
      'This is the annual change in the whole consumer price basket: a headline inflation rate, not the price of any single good or service.',
  },
  {
    id: 'salary',
    navigationLabel: 'Labour costs',
    fallbackTitle: 'Hourly labour cost',
    question: 'Has the hourly labour-cost benchmark changed?',
    whyMonitor: 'Use the national benchmark to frame a labour-budget discussion, alongside current role-specific quotes.',
    nextCondition: 'An estimate above or below this level changes the national cost benchmark; it does not establish recruitment costs or worker availability.',
    context:
      'This is average hourly employer labour cost within the statistical series, not take-home pay or a quote for a particular role.',
  },
  {
    id: 'retail',
    navigationLabel: 'Retail activity',
    fallbackTitle: 'Retail sales growth',
    question: 'Is retail volume growing relative to a year earlier?',
    whyMonitor: 'Check whether a sales-planning assumption fits the broad retail backdrop, then compare with your own category and orders.',
    nextCondition: 'Crossing zero separates growth from contraction relative to the same month a year earlier, not a change in your company revenue.',
    context:
      'This is annual growth in calendar-adjusted retail sales volume, not nominal turnover, profit or any one business’s sales.',
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

function MeasureSection({ measure, country }: { measure: Measure; country: CountryCode }) {
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
  const focusedReading = ownRows.find(row => row.code === country);
  const change = data && focusedReading
    ? briefingChange(finiteReadings(data, country), focusedReading, COUNTRY_NAMES[country], unit)
    : null;
  const newerCountries = common ? ownRows.filter(row => row.period > common.period) : [];

  // The table dates its shared comparison; the focus separately dates this
  // country's latest reading. An old shared period is not a source freeze.
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
    <section id={`briefing-${measure.id}`} aria-labelledby={headingId} className="public-briefing-measure" tabIndex={-1}>
      <div className="public-briefing-reading">
        <div className="public-briefing-heading">
          <h2 id={headingId} className="site-section-title text-title font-semibold news-fg">{title}</h2>
          {coverage && (
            <span className="text-caption font-mono" style={{ color: freshnessLabelColor(freshness) }}>
              {common ? 'Baltic comparison' : 'Available periods'} · {coverage.label}
            </span>
          )}
        </div>

        <p className="public-briefing-question text-callout font-semibold news-fg mt-3">{measure.question}</p>

        {phase === 'ready' && !empty && (
          <>
            {change && focusedReading ? (
              <div className="public-briefing-focus-reading">
                <p className="text-callout news-fg">{change.statement}</p>
                {change.missingBasis && <p className="text-ui news-subtle mt-2">{change.missingBasis}</p>}
                <FreshnessNotice freshness={freshnessOf(focusedReading.period)} className="mt-3" />
              </div>
            ) : (
              <p className="text-ui news-subtle mt-3">
                No planning reading is available for {COUNTRY_NAMES[country]} in this window.
              </p>
            )}
          </>
        )}
        <dl className="public-briefing-planning text-ui">
          <div><dt className="font-semibold news-fg">Why monitor</dt><dd className="news-muted">{measure.whyMonitor}</dd></div>
          <div><dt className="font-semibold news-fg">Not established</dt><dd className="news-muted">{measure.context}</dd></div>
          {focusedReading && (
            <div><dt className="font-semibold news-fg">Next check</dt><dd className="news-muted">
              {briefingNextCheck(focusedReading, unit, measure.nextCondition)}
            </dd></div>
          )}
        </dl>
      </div>

      <div className="public-briefing-evidence">
        {phase === 'loading' && (
          <div role="status" aria-busy="true" aria-label={`Loading ${title}`} className="public-briefing-loading space-y-2">
            <div className="h-4 news-skeleton rounded w-1/2 animate-pulse" />
            <div className="h-20 news-skeleton rounded animate-pulse" />
            <p className="public-briefing-print-only text-ui">Loading {title}; observations are not included in this printout.</p>
          </div>
        )}

        {phase === 'error' && (
          <div role="status" className="mt-4">
            <p className="text-ui news-warning">This measure could not be loaded right now.</p>
            <button type="button" className="site-action text-ui" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}

        {phase === 'ready' && empty && (
          <div role="status" className="mt-4">
            <p className="text-ui news-subtle">No published reading is available for this measure in the retrieved window.</p>
            <button type="button" className="site-action text-ui" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}

        {phase === 'ready' && !empty && (
          <>
            <p className="public-briefing-summary text-callout news-fg mb-3">{summary}</p>
            {newerCountries.length > 0 && common && (
              <p className="text-ui news-subtle mb-3">
                The shared comparison is {formatPeriod(common.period)}. Newer own-country readings are available for{' '}
                {newerCountries.map(row => COUNTRY_NAMES[row.code]).join(', ')}; the planning focus uses its own latest reading.
              </p>
            )}
            {missing.length > 0 && (
              <p className="text-caption news-subtle mb-3">
                No reading available for {missing.map((code) => COUNTRY_NAMES[code]).join(' or ')} in the retrieved window.
              </p>
            )}
            <div className="overflow-x-auto" role="region" aria-label={`${title} by country`} tabIndex={0}>
              <table className="site-table text-ui">
                <caption className="text-caption news-subtle text-left mb-2">
                  {common
                    ? `${title} by country, ${formatPeriod(common.period)}${unit ? ` (${unit})` : ''}. An em dash means no published reading, not zero.`
                    : `${title}, each country's own latest available reading${unit ? ` (${unit})` : ''}. No period has readings from all three countries in this window. An em dash means no available reading, not zero.`}
                </caption>
                <thead>
                  <tr className="news-border border-b">
                    <th scope="col" className="text-left py-2 pr-2">Country</th>
                    <th scope="col" className="text-right py-2 pr-2">Value</th>
                    <th scope="col" className="text-right py-2">Period</th>
                  </tr>
                </thead>
                <tbody>
                  {COUNTRY_CODES.map((code) => {
                    const row = rowByCode.get(code);
                    const rowFreshness = row ? freshnessOf(row.period) : null;
                    return (
                      <tr key={code} className="news-border border-b">
                        <th scope="row" className="text-left py-2 pr-2 font-semibold">
                          <Link
                            to={`/indicator/${measure.id}?country=${code}`}
                            aria-label={`View ${title} for ${COUNTRY_NAMES[code]} in Data explorer`}
                            className="public-briefing-country news-link inline-flex min-h-11 items-center gap-1 text-ui"
                          >
                            {COUNTRY_NAMES[code]} <span aria-hidden="true">→</span>
                          </Link>
                        </th>
                        <td className="text-right py-2 pr-2 text-lead tabular-nums news-fg">
                          {row ? formatValue(row.value, unit) : <span aria-label={`No published reading for ${COUNTRY_NAMES[code]}`}>—</span>}
                        </td>
                        <td className="text-right py-2 text-caption font-mono" style={{ color: freshnessLabelColor(rowFreshness) }}>
                          {row ? formatPeriod(row.period) : '—'}
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
            <p className="public-briefing-export-scope text-caption news-subtle mt-2">
              CSV and JSON include all three countries and the full retrieved window, not just the displayed readings.
            </p>
            <p className="public-briefing-print-only text-caption">
              Source table: {href ?? 'Dataset URL not supplied by the API.'}
              {data?.fetchedAt
                ? ` Retrieved from source: ${data.fetchedAt}.`
                : ' Source retrieval time was not reported by the API.'}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function PublicBriefingSample() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const selected = params.get('country')?.toUpperCase();
  const country = COUNTRY_CODES.find(code => code === selected) ?? 'LV';
  const [copyResult, setCopyResult] = useState<{ url: string; message: string } | null>(null);
  const shareParams = new URLSearchParams(location.search);
  shareParams.set('country', country);
  const sharePath = `${location.pathname}?${shareParams}${location.hash}`;
  const shareUrl = new URL(sharePath, window.location.origin).href;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyResult({ url: shareUrl, message: 'Briefing link copied. Readings may change when it is reopened.' });
    } catch {
      setCopyResult({ url: shareUrl, message: 'Copy is unavailable. Use the briefing link to copy its address.' });
    }
  }

  return (
    <div className="public-briefing-sample">
      <div className="public-briefing-focus">
        <div className="public-briefing-focus-controls">
          <label htmlFor="briefing-focus-country" className="text-ui font-semibold news-fg">Planning focus</label>
          <select id="briefing-focus-country" value={country} className="site-input text-ui px-3 py-2"
            onChange={event => {
              const next = new URLSearchParams(location.search);
              next.set('country', event.target.value);
              navigate({ search: `?${next}`, hash: location.hash }, { preventScrollReset: true });
            }}>
            {COUNTRY_CODES.map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}
          </select>
          <button type="button" className="site-action briefing-print text-ui" onClick={copyLink}>Copy briefing link</button>
          <a href={sharePath} className="news-link text-ui public-briefing-share-link">Briefing link <span aria-hidden="true">↗</span></a>
        </div>
        <p role="status" className="text-ui news-muted">{copyResult?.url === shareUrl ? copyResult.message : ''}</p>
        <p className="text-ui news-subtle">
          The focus uses each country’s own latest reading; the table keeps the Baltic comparison on a shared period when available.
          {' '}Release dates are not supplied: next checks are conditions to revisit, not a delivery schedule.
          {' '}A link retains the country and section, not a frozen snapshot. Print to keep this view.
        </p>
        <p className="public-briefing-print-only text-ui">Planning focus: {COUNTRY_NAMES[country]} · Briefing link: {shareUrl}</p>
      </div>
      <nav className="public-briefing-contents text-ui" aria-label="Briefing contents">
        {MEASURES.map((measure) => (
          <Link key={measure.id} to={`${location.pathname}${location.search}#briefing-${measure.id}`} className="news-link">
            {measure.navigationLabel} <span aria-hidden="true">↓</span>
          </Link>
        ))}
      </nav>
      {MEASURES.map((measure) => (
        <MeasureSection key={measure.id} measure={measure} country={country} />
      ))}
    </div>
  );
}
