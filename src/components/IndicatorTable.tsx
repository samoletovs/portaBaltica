import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useCountry } from '../CountryContext';

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
  const { country } = useCountry();

  useEffect(() => {
    setLoading(true);
    Promise.all(
      INDICATORS.map((id) => {
        const eurostatId = EUROSTAT_MAP[id];
        if (country !== 'LV' && eurostatId) {
          return fetch(`/api/baltic-compare?indicator=${eurostatId}&years=3`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              if (!d?.countries?.[country]) return null;
              const cs = d.countries[country];
              const series = cs.series.filter((s: { value: number | null }) => s.value !== null);
              const values = series.map((s: { value: number }) => s.value);
              const latest = values.length > 0 ? values[values.length - 1] : null;
              const previous = values.length > 1 ? values[values.length - 2] : null;
              return { id, title: d.title, unit: d.unit || '', series, summary: { latest, previous, change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null } } as IndicatorRow;
            })
            .catch(() => null);
        }
        return fetch(`/api/historical-data?indicator=${id}&years=3`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => d ? { id, title: d.title, unit: d.unit, series: d.series, summary: d.summary } as IndicatorRow : null)
          .catch(() => null);
      })
    ).then((results) => {
      setRows(results.filter((r): r is IndicatorRow => r !== null));
      setLoading(false);
    });
  }, [country]);

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-slate-700/30 rounded w-1/4 mb-4" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 bg-slate-800/20 rounded mb-2" />
        ))}
      </div>
    );
  }

  function formatValue(v: number | null, unit: string): string {
    if (v === null) return '—';
    if (unit === 'EUR/month') return `€${Math.round(v).toLocaleString()}`;
    if (unit === 'persons') return (v / 1_000_000).toFixed(2) + 'M';
    if (unit === 'M EUR') {
      if (Math.abs(v) >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
      return `€${Math.round(v).toLocaleString()}`;
    }
    if (unit === 'thousands') return Math.round(v).toLocaleString();
    if (unit === 'index') return v.toFixed(1);
    if (unit.startsWith('%')) return `${v.toFixed(1)}%`;
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
    return v.toFixed(1);
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800/40">
        <h3 className="text-sm font-medium text-white">Latvia key indicators</h3>
        <p className="text-xs text-slate-500">Click any row for analysis</p>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2 text-xs text-slate-400 border-b border-slate-800/30">
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
        const changeColor = row.summary.change === null ? 'text-slate-400' : isUp ? 'text-emerald-400' : 'text-red-400';
        const lineColor = isUp ? '#34d399' : '#f87171';

        return (
          <button
            key={row.id}
            onClick={() => navigate(`/indicator/${row.id}`)}
            className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-4 py-2.5 w-full text-left hover:bg-slate-800/30 transition-colors border-b border-slate-800/20 last:border-0 group"
            aria-label={`View ${row.title} details`}
          >
            <div>
              <span className="text-sm text-white group-hover:text-slate-200 transition-colors">{row.title}</span>
              <span className="text-xs text-slate-500 ml-2">{row.unit}</span>
            </div>
            <span className="text-sm text-right text-white font-mono">
              {formatValue(row.summary.latest, row.unit)}
            </span>
            <span className="text-sm text-right text-slate-400 font-mono">
              {formatValue(row.summary.previous, row.unit)}
            </span>
            <span className={`text-sm text-right font-mono ${changeColor}`}>
              {row.summary.change !== null
                ? `${isUp ? '▲' : '▼'} ${formatValue(Math.abs(row.summary.change), row.unit)}`
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
