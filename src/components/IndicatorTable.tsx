import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useCountry } from '../CountryContext';
import { useFilter } from '../FilterContext';
import { useTheme } from '../ThemeContext';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare } from '../api';
import { changeDescription, sentimentColor, sentimentOf, signed } from '../utils/polarity';

const EUROSTAT_MAP: Record<string, string> = {
  gdp: 'gdp', unemployment: 'unemployment', cpi: 'inflation', house_prices: 'house_prices',
  salary: 'salary', retail_sales: 'retail', population: 'population',
  industrial: 'industrial',
};

interface IndicatorRow {
  id: string;
  title: string;
  unit: string;
  series: { period: string; value: number | null }[];
  summary: { latest: number | null; previous: number | null; change: number | null };
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
                return { id, title: d.title, unit: d.unit || '', series, summary: { latest, previous, change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null } } as IndicatorRow;
              })
              .catch(() => null);
          }
          if (country === 'LV') {
            return fetch(`/api/historical-data?indicator=${id}&years=${years}`)
              .then((r) => r.ok ? r.json() : null)
              .then((d) => d ? { id, title: d.title, unit: d.unit, series: d.series, summary: d.summary } as IndicatorRow : null)
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

  return (
    <div className="dash-card border dash-edge rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b dash-edge">
        <h3 className="text-callout font-semibold dash-fg">{countryLabel} key indicators</h3>
        <p className="text-caption dash-subtle">Click any row for analysis</p>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_70px_70px_72px] sm:grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 text-caption dash-muted border-b dash-edge">
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
        // The trend line follows the same rule as the delta beside it, so a
        // row reads as one statement. It used to be coloured by raw direction,
        // which drew a decade of falling unemployment in red.
        const lineColor =
          sentiment === 'none'
            ? chartColors.seriesDefault
            : sentiment === 'positive'
              ? chartColors.positive
              : chartColors.negative;

        return (
          <button
            key={row.id}
            onClick={() => navigate(`/indicator/${row.id}`)}
            className="grid grid-cols-[1fr_70px_70px_72px] sm:grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 w-full text-left dash-hover-raised transition-colors border-b dash-edge last:border-0 group"
            aria-label={`View ${row.title} details`}
          >
            <div className="min-w-0 flex items-baseline gap-2 overflow-hidden">
              <span className="text-ui dash-fg dash-hover-fg transition-colors truncate shrink">{row.title}</span>
              <span className="text-caption dash-subtle shrink-0">{row.unit}</span>
            </div>
            <span className="text-caption sm:text-ui text-right dash-fg font-mono self-center">
              {formatValue(row.summary.latest, row.unit)}
            </span>
            <span className="hidden sm:block text-ui text-right dash-muted font-mono self-center">
              {formatValue(row.summary.previous, row.unit)}
            </span>
            <span
              className="text-caption sm:text-ui text-right font-mono self-center"
              style={{ color: change === null || change === 0 ? 'var(--text-secondary)' : sentimentColor(sentiment) }}
            >
              {change !== null && change !== 0 ? (
                <>
                  <span aria-hidden="true">{isRise ? '▲' : '▼'} </span>
                  {signed(formatValue(Math.abs(change), row.unit), change)}
                  <span className="sr-only"> {changeDescription(row.id, change)}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <div className="hidden sm:block h-6 w-full self-center">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
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
