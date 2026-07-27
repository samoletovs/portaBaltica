import { useState, useEffect, useId } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import { useCountry } from '../CountryContext';
import { useFilter } from '../FilterContext';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare } from '../api';

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
  trade_balance: 'trade_balance',
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
  const gradientId = useId();
  const [data, setData] = useState<IndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { chartColors } = useTheme();
  const { country } = useCountry();
  const { years } = useFilter();

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

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // Use Eurostat for ALL countries (unified data source)
      const eurostatId = EUROSTAT_FALLBACK[id];
      if (eurostatId) {
        try {
          const d = await fetchBalticCompare(eurostatId, years);
          if (!cancelled) {
            if (d?.countries?.[country]) {
              const cs = d.countries[country];
              const series = cs.series.filter((s): s is { period: string; value: number } => s.value !== null);
              const values = series.map((s) => s.value);
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
          }
        } catch {
          if (!cancelled) {
            setData(null);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
        return;
      }

      // No Eurostat mapping — use Latvia PxWeb (only for LV, show null for EE/LT)
      if (country === 'LV') {
        try {
          const response = await fetch(`/api/historical-data?indicator=${id}&years=${years}`);
          const d = response.ok ? await response.json() : null;
          if (!cancelled) {
            setData(d);
          }
        } catch {
          if (!cancelled) {
            setData(null);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      } else if (!cancelled) {
        setData(null);
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, externalLoading, country, unit, years]);

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
  const displayUnit = data.unit || unit; // prefer API-returned unit
  const fmt = (v: number | null) => formatValue(v, displayUnit);

  return (
    <button
      onClick={() => navigate(`/indicator/${id}`)}
      className="rounded-xl p-4 text-left transition-all group w-full"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      aria-label={`View ${title} details`}
    >
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
        <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }}>→</span>
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-xl font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
          {fmt(summary.latest)}
        </span>
        {summary.change !== null && (
          <span className={`text-xs font-mono ${changeColor}`}>
            {isPositiveChange ? '▲' : '▼'}{fmt(Math.abs(summary.change))}
          </span>
        )}
      </div>

      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
              fill={`url(#${gradientId})`}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{ background: chartColors.tooltipBg, border: '1px solid ' + chartColors.tooltipBorder, borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: chartColors.axis }}
              formatter={(v) => [fmt(v as number), title]}
              labelFormatter={(l) => formatPeriod(String(l))}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {formatPeriod(chartData[0]?.period ?? '')}
        </span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
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
  const { country } = useCountry();

  function formatPeriod(p: string): string {
    const qMatch = p.match(/^(\d{4})Q(\d)$/);
    if (qMatch) return `Q${qMatch[2]} ${qMatch[1]}`;
    const mMatch = p.match(/^(\d{4})M(\d{1,2})$/);
    if (mMatch) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mMatch[2]) - 1] ?? mMatch[2]} ${mMatch[1]}`;
    }
    const qMatch2 = p.match(/^(\d{4})-Q(\d)$/);
    if (qMatch2) return `Q${qMatch2[2]} ${qMatch2[1]}`;
    const mMatch2 = p.match(/^(\d{4})-(\d{2})$/);
    if (mMatch2) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mMatch2[2]) - 1] ?? mMatch2[2]} ${mMatch2[1]}`;
    }
    return p;
  }

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // Try Eurostat first (works for all countries)
      const eurostatId = EUROSTAT_FALLBACK[id];
      if (eurostatId) {
        try {
          const d = await fetchBalticCompare(eurostatId, years);
          if (!cancelled) {
            if (d?.countries?.[country]) {
              const cs = d.countries[country];
              const series = cs.series.filter((s): s is { period: string; value: number } => s.value !== null);
              const values = series.map((s) => s.value);
              const latest = values.length > 0 ? values[values.length - 1] : null;
              const previous = values.length > 1 ? values[values.length - 2] : null;
              setData({
                indicator: id,
                title: d.title,
                unit: d.unit || '',
                source: d.source || 'Eurostat',
                series,
                summary: {
                  latest, previous,
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
          }
        } catch {
          if (!cancelled) {
            setData(null);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
        return;
      }

      if (country === 'LV') {
        // Latvia-only indicators via PxWeb
        try {
          const response = await fetch(`/api/historical-data?indicator=${id}&years=${years}`);
          const d = response.ok ? await response.json() : null;
          if (!cancelled) {
            setData(d);
          }
        } catch {
          if (!cancelled) {
            setData(null);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      } else if (!cancelled) {
        setData(null);
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, years, country]);

  if (loading) {
    return <div className="h-64 bg-slate-900/50 rounded-xl animate-pulse" />;
  }
  if (!data || data.series.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)' }}>
        {country !== 'LV'
          ? 'This indicator is only available for Latvia via PxWeb. See the Baltic Comparison chart below for cross-country data.'
          : 'No historical data available for this indicator.'}
      </p>
    );
  }

  const chartData = data.series.filter((p) => p.value !== null);
  const { summary } = data;
  const isUp = summary.change !== null && summary.change >= 0;
  const color = isUp ? '#34d399' : '#f87171';
  const fmt = (v: number | null) => formatValue(v, data.unit);

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
              tickFormatter={(v: number) => fmt(v)}
            />
            <Tooltip
              contentStyle={{ background: chartColors.tooltipBg, border: '1px solid ' + chartColors.tooltipBorder, borderRadius: '6px', fontSize: '12px' }}
              labelStyle={{ color: chartColors.axis, fontWeight: 500 }}
              formatter={(v) => [fmt(v as number), data?.title ?? '']}
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
        <StatBox label="Latest" value={fmt(summary.latest)} />
        <StatBox label="Previous" value={fmt(summary.previous)} />
        <StatBox label="Change" value={summary.change !== null ? `${summary.change >= 0 ? '+' : ''}${summary.change.toFixed(2)}` : 'N/A'} highlight={isUp ? 'green' : 'red'} />
        <StatBox label="Min" value={fmt(summary.min)} />
        <StatBox label="Max" value={fmt(summary.max)} />
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
