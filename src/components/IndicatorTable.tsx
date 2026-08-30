import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useCountry } from '../CountryContext';
import { useFilter } from '../FilterContext';
import { useTheme } from '../ThemeContext';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare } from '../api';
import { changeDescription, polarityOf, sentimentColor, sentimentOf, signed } from '../utils/polarity';
import { optionalString, type SeriesExport } from '../utils/exportSeries';
import { freshnessOf, formatPeriod } from '../dataFreshness';
import { freshnessLabelColor, judgementWithheld } from './freshnessStyle';
import { DownloadMenu } from './DownloadMenu';

const EUROSTAT_MAP: Record<string, string> = {
  gdp: 'gdp', unemployment: 'unemployment', cpi: 'inflation', house_prices: 'house_prices',
  salary: 'salary', retail_sales: 'retail', population: 'population',
  industrial: 'industrial',
};

interface IndicatorRow {
  id: string;
  title: string;
  unit: string;
  /** Where this row's numbers came from, carried through to the export. */
  source?: string;
  series: { period: string; value: number | null }[];
  summary: { latest: number | null; previous: number | null; change: number | null };
}

/**
 * How old this row's newest reading is.
 *
 * Computed where the row is rendered rather than where it is fetched, because
 * there are two fetch branches — Eurostat and Latvian PxWeb — and a field set
 * in one of them is a field the other silently omits. One code path cannot be
 * half-applied.
 *
 * Judged per row rather than per table: these eight indicators run at three
 * cadences, quarterly, monthly and annual, so a single table-level "as of"
 * would date seven of them to a period they never reached.
 */
function rowFreshness(series: { period: string; value: number | null }[]) {
  const periods = (series ?? []).filter((s) => s && s.value !== null).map((s) => s.period);
  return periods.length > 0 ? freshnessOf(periods[periods.length - 1]) : null;
}

const INDICATORS = ['gdp', 'salary', 'cpi', 'unemployment', 'house_prices', 'retail_sales', 'industrial', 'population'];

export function IndicatorTable() {
  const [rows, setRows] = useState<IndicatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { country, countryLabel } = useCountry();
  const { years } = useFilter();
  const { chartColors } = useTheme();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const results = await Promise.all(
        INDICATORS.map((id) => {
          const eurostatId = EUROSTAT_MAP[id];
          if (eurostatId) {
            return fetchBalticCompare(eurostatId, years)
              .then((d) => {
                if (!d?.countries?.[country]) return null;
                const cs = d.countries[country];
                const series = cs.series.filter((s): s is { period: string; value: number } => s.value !== null);
                const values = series.map((s) => s.value);
                const latest = values.length > 0 ? values[values.length - 1] : null;
                const previous = values.length > 1 ? values[values.length - 2] : null;
                return { id, title: d.title, unit: d.unit || '', source: optionalString(d, 'source'), series, summary: { latest, previous, change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null } } as IndicatorRow;
              })
              .catch(() => null);
          }
          if (country === 'LV') {
            return fetch(`/api/historical-data?indicator=${id}&years=${years}`)
              .then((r) => r.ok ? r.json() : null)
              .then((d) => d ? { id, title: d.title, unit: d.unit, source: optionalString(d, 'source'), series: d.series, summary: d.summary } as IndicatorRow : null)
              .catch(() => null);
          }
          return Promise.resolve(null);
        })
      );

      if (!cancelled) {
        setRows(results.filter((r): r is IndicatorRow => r !== null));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [country, years]);

  if (loading) {
    return (
      <div className="dash-card border dash-edge rounded-xl p-4 animate-pulse">
        <div className="h-4 dash-skeleton rounded w-1/4 mb-4" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 dash-raised rounded mb-2" />
        ))}
      </div>
    );
  }

  // Eight indicators side by side, each in its own unit and from its own cube.
  // The header's `unit` and `source` say that plainly rather than picking one
  // column's answer and applying it to the other seven; the detail travels per
  // column, which is what `ExportSeries.unit` and `.source` are for.
  const exportPayload: SeriesExport = {
    indicator: `key-indicators-${country.toLowerCase()}`,
    title: `${countryLabel} key indicators`,
    unit: 'varies by indicator',
    source: 'Eurostat and CSP Latvia, via portaBaltica',
    exportedAt: new Date().toISOString(),
    series: rows.map((row) => ({
      label: row.title,
      unit: row.unit || undefined,
      source: row.source,
      observations: row.series,
    })),
  };

  return (
    <div className="dash-card border dash-edge rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b dash-edge flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-callout font-semibold dash-fg">{countryLabel} key indicators</h3>
          <p className="text-caption dash-subtle">Click any row for analysis</p>
        </div>
        <DownloadMenu data={exportPayload} />
      </div>

      {/* Header row. Its template must match the data rows below exactly, or
          the columns stop lining up — so the three-track base applies here for
          the same reason and with the same arithmetic. */}
      <div className="grid grid-cols-[1fr_70px_70px] sm:grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 text-caption dash-muted border-b dash-edge">
        <span>Indicator</span>
        <span className="text-right">Latest</span>
        <span className="hidden sm:block text-right">Previous</span>
        <span className="text-right">Change</span>
        <span className="hidden sm:block text-right">Trend (3Y)</span>
      </div>

      {/* Data rows */}
      {rows.map((row) => {
        const chartData = row.series.filter((s) => s.value !== null).slice(-12);
        const change = row.summary.change;
        const isRise = change !== null && change > 0;
        const sentiment = sentimentOf(row.id, change);
        const freshness = rowFreshness(row.series);
        // The trend line follows the same rule as the delta beside it, so a
        // row reads as one statement. It used to be coloured by raw direction,
        // which drew a decade of falling unemployment in red.
        //
        // A stale row drops to neutral: the change is still true of the last
        // two readings, but "favourable" is a present-tense claim and the
        // series has stopped.
        const lineColor =
          sentiment === 'none' || judgementWithheld(freshness)
            ? chartColors.seriesDefault
            : sentiment === 'positive'
              ? chartColors.positive
              : chartColors.negative;

        // Three tracks on a phone, five from `sm`.
        //
        // Both the "previous" column and the sparkline are `hidden sm:block`,
        // so below `sm` they are not grid items at all — but the base template
        // declared four tracks regardless, and an explicitly-declared track
        // occupies its width whether or not anything is in it. Measured in
        // Chromium at 320px: the row has 254px inside its padding, the phantom
        // fourth track and its gap took **80** of them, and the title column
        // resolved to `18px` against 46px of content. So every row's title was
        // truncated to nothing and its unit label overflowed the row — on the
        // most prominent table on the site, at the width where it is least
        // able to spare the room. With three tracks the title column resolves
        // to 98px.
        return (
          <button
            key={row.id}
            onClick={() => navigate(`/indicator/${row.id}`)}
            className="grid grid-cols-[1fr_70px_70px] sm:grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 w-full text-left dash-hover-raised transition-colors border-b dash-edge last:border-0 group"
            aria-label={`View ${row.title} details`}
          >
            <div className="min-w-0 flex items-baseline gap-2 overflow-hidden">
              <span className="text-ui dash-fg dash-hover-fg transition-colors truncate shrink">{row.title}</span>
              <span className="text-caption dash-subtle shrink-0">{row.unit}</span>
              {/* The same ambiguity as on the cards, in a row that has no space
                  for the full sentence: a green ▼ here and a red ▼ two rows
                  down are both correct and, without this, indistinguishable in
                  meaning. Abbreviated rather than omitted — the spoken
                  description on the delta still says it in full. */}
              {/* Tested on the polarity, not on the note.
                  This read `polarityNote(row.id) &&` — using the note's
                  *existence* as a proxy for `lower-better`. That held only
                  while the two coincided, and stopped the moment the note was
                  widened to explain abstentions: measured on master, two of
                  the eight rows here are declined, so `house_prices` and
                  `population` each printed "↓ better" — a falling population
                  captioned as an improvement, on the series the map declines
                  precisely because that story is not ours to grade. */}
              {polarityOf(row.id) === 'lower-better' && (
                <span className="text-caption dash-subtle shrink-0 hidden sm:inline" aria-hidden="true">
                  ↓ better
                </span>
              )}
            </div>
            <span className="text-caption sm:text-ui text-right dash-fg font-mono self-center">
              {formatValue(row.summary.latest, row.unit)}
              {/* The period, under the value rather than in a column of its own.
                  A fourth track is not available: the row has 254px inside its
                  padding at 320px, three tracks already resolve the title column
                  to 98px, and an explicitly-declared track occupies its width
                  whether or not anything is in it — which is the measured defect
                  the three-track base exists to fix.

                  A single date in the panel header was the other candidate and
                  it would be a lie: these eight indicators run at three
                  different cadences (Q, A and M, read from
                  `api/shared/indicators.js`), so one "as of" would date seven
                  rows to a period they never reached. `periodCoverage` exists
                  for exactly that trap, one level up.

                  Warning-coloured when the series has stopped, which is the
                  whole notice a row has room for. The sentence itself is spoken
                  rather than printed. */}
              {freshness && (
                <span
                  className="block text-caption font-mono"
                  style={{ color: freshnessLabelColor(freshness) }}
                >
                  {formatPeriod(freshness.period)}
                  {freshness.late && (
                    <span className="sr-only">
                      {' '}
                      {freshness.stale
                        ? '— this series has published nothing newer.'
                        : '— later than usual for this series.'}
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="hidden sm:block text-ui text-right dash-muted font-mono self-center">
              {formatValue(row.summary.previous, row.unit)}
            </span>
            <span
              className="text-caption sm:text-ui text-right font-mono self-center"
              style={{ color: change === null || change === 0 || judgementWithheld(freshness) ? 'var(--text-secondary)' : sentimentColor(sentiment) }}
            >
              {change !== null && change !== 0 ? (
                <>
                  <span aria-hidden="true">{isRise ? '▲' : '▼'} </span>
                  {signed(formatValue(Math.abs(change), row.unit), change)}
                  <span className="sr-only">
                    {' '}
                    {judgementWithheld(freshness)
                      ? `${isRise ? 'up' : 'down'} as of ${formatPeriod(freshness.period)}, the last reading published`
                      : changeDescription(row.id, change)}
                  </span>
                </>
              ) : (
                '—'
              )}
            </span>
            {/* Decorative, and both halves of that are load-bearing.
                
                **Hidden**, because the row already says everything the
                sparkline could. Read out of the accessibility tree, one row
                announces: *"GDP Growth Rate % QoQ 0.6% Q1 2026 0.7% ▼ −0.1%
                down, which is unfavourable for this indicator"* — name, unit,
                latest value, **its period** (added in #215), previous, change
                and the spoken polarity. Describing a 24px trace of that same
                series would make a screen reader read the same figures twice,
                and WAI-ARIA calls a graphic duplicating adjacent text
                decorative. The one thing a description would add — the span
                and the extremes — belongs on the indicator's own page, which
                this row is a link to and which carries a full `role="img"`
                description already.
                
                **Not focusable**, because `aria-hidden` over a focusable
                element is an ARIA violation, not a style preference: it hides
                a node a keyboard can still land on, which is the worst of both.
                Recharts 3 turns `accessibilityLayer` on by default, which
                gives every chart `role="application"` and `tabIndex={0}` —
                measured on `/data/economy`, **27 of 80 tab stops were chart
                surfaces announcing as an unnamed "application"**, and each of
                these eight sat *inside* this row's `<button>`, so a keyboard
                user hit the row and then a nested control within it. */}
            <div className="hidden sm:block h-6 w-full self-center" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} accessibilityLayer={false}>
                  <defs>
                    <linearGradient id={`tbl-${row.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="period" hide />
                  <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={1} fill={`url(#tbl-${row.id})`} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </button>
        );
      })}
    </div>
  );
}
