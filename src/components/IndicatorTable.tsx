import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';

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

  useEffect(() => {
    setLoading(true);
    Promise.all(
      INDICATORS.map((id) =>
        fetch(`/api/historical-data?indicator=${id}&years=3`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => d ? { id, title: d.title, unit: d.unit, series: d.series, summary: d.summary } as IndicatorRow : null)
          .catch(() => null)
      )
    ).then((results) => {
      setRows(results.filter((r): r is IndicatorRow => r !== null));
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="bg-ocean-900/40 border border-ocean-700/30 rounded-2xl p-4 animate-pulse">
        <div className="h-4 bg-ocean-700/40 rounded w-1/4 mb-4" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 bg-ocean-700/20 rounded mb-2" />
        ))}
      </div>
    );
  }

  function formatValue(v: number | null, unit: string): string {
    if (v === null) return '—';
    if (unit === 'EUR/month') return `€${Math.round(v).toLocaleString()}`;
    if (unit === 'persons') return (v / 1_000_000).toFixed(2) + 'M';
    return v.toFixed(1) + (unit.startsWith('%') ? '%' : '');
  }

  return (
    <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-ocean-700/30">
        <h3 className="text-sm font-bold text-white">Latvia Key Indicators</h3>
        <p className="text-xs text-ocean-400">Click any row for full analysis</p>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 text-xs text-ocean-400 border-b border-ocean-800/30">
        <span>Indicator</span>
        <span className="text-right">Latest</span>
        <span className="text-right">Previous</span>
        <span className="text-right">Change</span>
        <span className="text-right">Trend (3Y)</span>
      </div>

      {/* Data rows */}
      {rows.map((row) => {
        const chartData = row.series.filter((s) => s.value !== null).slice(-12);
        const isUp = row.summary.change !== null && row.summary.change >= 0;
        const changeColor = row.summary.change === null ? 'text-ocean-400' : isUp ? 'text-emerald-400' : 'text-red-400';
        const lineColor = isUp ? '#34d399' : '#f87171';

        return (
          <button
            key={row.id}
            onClick={() => navigate(`/indicator/${row.id}`)}
            className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2.5 w-full text-left hover:bg-ocean-800/30 transition-colors border-b border-ocean-800/20 last:border-0 group"
            aria-label={`View ${row.title} details`}
          >
            <div>
              <span className="text-sm text-white group-hover:text-ocean-200 transition-colors">{row.title}</span>
              <span className="text-xs text-ocean-500 ml-2">{row.unit}</span>
            </div>
            <span className="text-sm text-right text-white font-mono">
              {formatValue(row.summary.latest, row.unit)}
            </span>
            <span className="text-sm text-right text-ocean-400 font-mono">
              {formatValue(row.summary.previous, row.unit)}
            </span>
            <span className={`text-sm text-right font-mono ${changeColor}`}>
              {row.summary.change !== null
                ? `${isUp ? '▲' : '▼'} ${Math.abs(row.summary.change).toFixed(1)}`
                : '—'}
            </span>
            <div className="h-6 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id={`tbl-${row.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
