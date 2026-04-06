import { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import { useCountry } from '../CountryContext';

// Mapping: PxWeb indicator → Eurostat baltic-compare indicator (for EE/LT)
const EUROSTAT_FALLBACK: Record<string, string> = {
  gdp: 'gdp',
  unemployment: 'unemployment',
  cpi: 'inflation',
  house_prices: 'house_prices',
  salary: 'salary',
  retail_sales: 'retail',
  population: 'population',
  tourist_arrivals: 'tourism',
  hotel_occupancy: 'tourism',
  construction_output: 'construction',
  biz_confidence: 'consumer_confidence',
  industrial: 'industrial',
  ppi: 'ppi',
  gov_revenue: 'gov_revenue',
  gov_debt: 'gov_debt_gdp',
  exports: 'exports',
  imports: 'imports',
  new_vehicles: 'vehicles',
  renewable_share: 'renewables',
  wages_industry: 'wages_mfg',
  wages_it: 'wages_it',
  trade_balance: 'exports', // approximate with exports data
};

interface TimeSeriesPoint {
  period: string;
  value: number | null;
}

interface IndicatorSummary {
  latest: number | null;
  previous: number | null;
  change: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
}

interface IndicatorCardProps {
  id: string;
  title: string;
  unit: string;
  loading?: boolean;
}

interface IndicatorData {
  indicator: string;
  title: string;
  unit: string;
  source: string;
  series: TimeSeriesPoint[];
  summary: IndicatorSummary;
}

export function IndicatorCard({ id, title, unit, loading: externalLoading }: IndicatorCardProps) {
  const [data, setData] = useState<IndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { chartColors } = useTheme();
  const { country } = useCountry();

  function formatPeriod(p: string): string {
    const qMatch = p.match(/^(\d{4})Q(\d)$/);
    if (qMatch) return `Q${qMatch[2]} ${qMatch[1]}`;
    const mMatch = p.match(/^(\d{4})M(\d{1,2})$/);
    if (mMatch) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mMatch[2]) - 1] ?? mMatch[2]} ${mMatch[1]}`;
    }
    // Handle "2021-Q1" format from Eurostat
    const qMatch2 = p.match(/^(\d{4})-Q(\d)$/);
    if (qMatch2) return `Q${qMatch2[2]} ${qMatch2[1]}`;
    // Handle "2024-01" monthly format from Eurostat
    const mMatch2 = p.match(/^(\d{4})-(\d{2})$/);
    if (mMatch2) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mMatch2[2]) - 1] ?? mMatch2[2]} ${mMatch2[1]}`;
    }
    return p;
  }

  useEffect(() => {
    if (externalLoading) return;
    setLoading(true);

    // For EE/LT, try Eurostat baltic-compare data if available
    const eurostatId = EUROSTAT_FALLBACK[id];
    if (country !== 'LV' && eurostatId) {
      fetch(`/api/baltic-compare?indicator=${eurostatId}&years=5`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.countries?.[country]) {
            const cs = d.countries[country];
            const series = cs.series.filter((s: { value: number | null }) => s.value !== null);
            const values = series.map((s: { value: number }) => s.value);
            const latest = values.length > 0 ? values[values.length - 1] : null;
            const previous = values.length > 1 ? values[values.length - 2] : null;
            setData({
              indicator: id,
              title: d.title,
              unit: d.unit || unit,
              source: d.source || 'Eurostat',
              series: series,
              summary: {
                latest,
                previous,
                change: latest !== null && previous !== null ? +(latest - previous).toFixed(2) : null,
                min: values.length > 0 ? +Math.min(...values).toFixed(2) : null,
                max: values.length > 0 ? +Math.max(...values).toFixed(2) : null,
                avg: values.length > 0 ? +(values.reduce((a: number, b: number) => a + b, 0) / values.length).toFixed(2) : null,
                count: values.length,
              },
            });
          } else {
            setData(null);
          }
        })
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    } else {
      // Latvia: use PxWeb historical-data
      fetch(`/api/historical-data?indicator=${id}&years=5`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => setData(d))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [id, externalLoading, country]);

  if (loading || externalLoading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-slate-800/60 rounded w-1/3 mb-3" />
        <div className="h-6 bg-slate-800/60 rounded w-1/2 mb-2" />
        <div className="h-20 bg-slate-800/40 rounded" />
      </div>
    );
  }

  if (!data || data.series.length === 0) return null;

  const { summary } = data;
  const chartData = data.series.filter((p) => p.value !== null).slice(-20);
  const isPositiveChange = summary.change !== null && summary.change >= 0;
  const changeColor = isPositiveChange ? 'text-emerald-400' : 'text-red-400';
  const areaColor = isPositiveChange ? '#34d399' : '#f87171';

  function formatValue(v: number | null): string {
    if (v === null) return 'N/A';
    if (unit === 'EUR/month') return `€${Math.round(v).toLocaleString()}`;
    if (unit === 'persons') return v.toLocaleString();
    if (unit === 'M EUR') {
      if (Math.abs(v) >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
      return `€${Math.round(v).toLocaleString()}`;
    }
    if (unit === 'thousands') return Math.round(v).toLocaleString();
    if (unit === 'index') return v.toFixed(1);
    if (unit.startsWith('%')) return `${v.toFixed(1)}%`;
    // Fallback: format large numbers with separators
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
    return v.toFixed(1);
  }

  return (
    <button
      onClick={() => navigate(`/indicator/${id}`)}
      className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 text-left hover:border-slate-600/60 transition-all group w-full"
      aria-label={`View ${title} details`}
    >
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs text-slate-400 font-medium">{title}</p>
        <span className="text-xs text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-xl font-semibold text-white font-mono">
          {formatValue(summary.latest)}
        </span>
        {summary.change !== null && (
          <span className={`text-xs font-mono ${changeColor}`}>
            {isPositiveChange ? '▲' : '▼'}{formatValue(Math.abs(summary.change))}
          </span>
        )}
      </div>

      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={areaColor} stopOpacity={0.2} />
                <stop offset="100%" stopColor={areaColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="period" hide />
            <Area
              type="monotone"
              dataKey="value"
              stroke={areaColor}
              strokeWidth={1.5}
              fill={`url(#grad-${id})`}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{ background: chartColors.tooltipBg, border: '1px solid ' + chartColors.tooltipBorder, borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: chartColors.axis }}
              formatter={(v) => [formatValue(v as number), title]}
              labelFormatter={(l) => formatPeriod(String(l))}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-slate-600 font-mono">
          {formatPeriod(chartData[0]?.period ?? '')}
        </span>
        <span className="text-xs text-slate-600 font-mono">
          {formatPeriod(chartData[chartData.length - 1]?.period ?? '')}
        </span>
      </div>
    </button>
  );
}

// Full chart for indicator detail pages
export function IndicatorChart({ id }: { id: string }) {
  const [data, setData] = useState<IndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState(10);
  const { chartColors } = useTheme();

  function formatPeriod(p: string): string {
    const qMatch = p.match(/^(\d{4})Q(\d)$/);
    if (qMatch) return `Q${qMatch[2]} ${qMatch[1]}`;
    const mMatch = p.match(/^(\d{4})M(\d{1,2})$/);
    if (mMatch) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mMatch[2]) - 1] ?? mMatch[2]} ${mMatch[1]}`;
    }
    return p;
  }

  useEffect(() => {
    setLoading(true);
    fetch(`/api/historical-data?indicator=${id}&years=${years}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, years]);

  if (loading) {
    return <div className="h-64 bg-slate-900/50 rounded-xl animate-pulse" />;
  }
  if (!data || data.series.length === 0) {
    return <p className="text-slate-400">No historical data available for this indicator.</p>;
  }

  const chartData = data.series.filter((p) => p.value !== null);
  const { summary } = data;
  const isUp = summary.change !== null && summary.change >= 0;
  const color = isUp ? '#34d399' : '#f87171';

  function formatValue(v: number | null): string {
    if (v === null || !data) return 'N/A';
    if (data.unit === 'EUR/month') return `€${Math.round(v).toLocaleString()}`;
    if (data.unit === 'persons') return v.toLocaleString();
    if (data.unit === 'M EUR') {
      if (Math.abs(v) >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
      return `€${Math.round(v).toLocaleString()}`;
    }
    if (data.unit === 'thousands') return Math.round(v).toLocaleString();
    if (data.unit === 'index') return v.toFixed(1);
    if (data.unit.startsWith('%')) return `${v.toFixed(1)}%`;
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
    return v.toFixed(1);
  }

  return (
    <div>
      {/* Time range selector */}
      <div className="flex items-center gap-2 mb-4">
        {[1, 3, 5, 10, 0].map((y) => (
          <button
            key={y}
            onClick={() => setYears(y)}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              years === y ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-800/40'
            }`}
          >
            {y === 0 ? 'MAX' : `${y}Y`}
          </button>
        ))}
      </div>

      {/* Main chart */}
      <div className="h-72 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`detail-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="period"
              tick={{ fill: chartColors.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={Math.max(0, Math.floor(chartData.length / 8))}
              tickFormatter={(v: string) => formatPeriod(v)}
            />
            <YAxis
              tick={{ fill: chartColors.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              width={60}
              tickFormatter={(v: number) => formatValue(v)}
            />
            <Tooltip
              contentStyle={{ background: chartColors.tooltipBg, border: '1px solid ' + chartColors.tooltipBorder, borderRadius: '6px', fontSize: '12px' }}
              labelStyle={{ color: chartColors.axis, fontWeight: 500 }}
              formatter={(v) => [formatValue(v as number), data?.title ?? '']}
              labelFormatter={(l) => formatPeriod(String(l))}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#detail-grad-${id})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Latest" value={formatValue(summary.latest)} />
        <StatBox label="Previous" value={formatValue(summary.previous)} />
        <StatBox label="Change" value={summary.change !== null ? `${summary.change >= 0 ? '+' : ''}${summary.change.toFixed(2)}` : 'N/A'} highlight={isUp ? 'green' : 'red'} />
        <StatBox label="Min" value={formatValue(summary.min)} />
        <StatBox label="Max" value={formatValue(summary.max)} />
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Source: {data.source} · {summary.count} data points
      </p>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const textColor = highlight === 'green' ? 'text-emerald-400' : highlight === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
      <p className={`text-sm font-bold font-mono ${textColor}`}>{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}
