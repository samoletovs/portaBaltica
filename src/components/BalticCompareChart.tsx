import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { useTheme } from '../ThemeContext';
import { useFilter } from '../FilterContext';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare, type BalticCompareData } from '../api';

const COUNTRY_COLORS: Record<string, { color: string; label: string; flag: string }> = {
  LV: { color: '#38bdf8', label: 'Latvia', flag: '🇱🇻' },
  EE: { color: '#34d399', label: 'Estonia', flag: '🇪🇪' },
  LT: { color: '#fbbf24', label: 'Lithuania', flag: '🇱🇹' },
};

interface BalticCompareChartProps {
  indicator: string;
  title?: string;
  years?: number;
  compact?: boolean;
}

export function BalticCompareChart({ indicator, title, years: yearsProp, compact = false }: BalticCompareChartProps) {
  const [data, setData] = useState<BalticCompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const { chartColors } = useTheme();
  const { years: filterYears } = useFilter();
  const years = yearsProp ?? filterYears;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchBalticCompare(indicator, years);
        if (!cancelled) {
          setData(payload);
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
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [indicator, years]);

  if (loading) {
    return (
      <div className={`bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 animate-pulse ${compact ? 'h-40' : 'h-64'}`}>
        <div className="h-3 bg-slate-700/30 rounded w-1/3 mb-4" />
        <div className="h-full bg-slate-800/20 rounded" />
      </div>
    );
  }

  if (!data || !data.countries || Object.keys(data.countries).length === 0) {
    return (
      <div className={`rounded-xl p-4 flex items-center justify-center ${compact ? 'h-40' : 'h-64'}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data available{title ? ` for ${title}` : ''}</p>
      </div>
    );
  }

  // Merge all country series into chart-friendly format
  const allPeriods = new Set<string>();
  for (const key of Object.keys(data.countries)) {
    for (const pt of data.countries[key].series) {
      allPeriods.add(pt.period);
    }
  }
  const sortedPeriods = Array.from(allPeriods).sort();

  const chartData = sortedPeriods.map((period) => {
    const point: Record<string, string | number | null> = { period };
    for (const [geo, cs] of Object.entries(data.countries)) {
      const match = cs.series.find((s) => s.period === period);
      point[geo] = match?.value ?? null;
    }
    return point;
  });

  // Latest values for legend
  const latestValues: Record<string, number | null> = {};
  for (const [geo, cs] of Object.entries(data.countries)) {
    const valid = cs.series.filter((s) => s.value !== null);
    latestValues[geo] = valid.length > 0 ? valid[valid.length - 1].value : null;
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-white">{title ?? data.title}</p>
          <p className="text-xs text-slate-500">LV vs EE vs LT · {data.unit}</p>
        </div>
        <div className="flex items-center gap-3">
          {Object.entries(COUNTRY_COLORS).map(([geo, info]) => (
            <div key={geo} className="flex items-center gap-1 text-xs">
              <span>{info.flag}</span>
              <span className="text-slate-300">{latestValues[geo] !== null && latestValues[geo] !== undefined ? formatValue(latestValues[geo], data.unit) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={compact ? 'h-32' : 'h-52'}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="period"
              tick={{ fill: chartColors.axis, fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            {!compact && (
              <YAxis
                tick={{ fill: chartColors.axis, fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: chartColors.grid }}
                width={40}
              />
            )}
            <Tooltip
              contentStyle={{ background: chartColors.tooltipBg, border: '1px solid ' + chartColors.tooltipBorder, borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: chartColors.axis, fontWeight: 500 }}
              formatter={(v, name) => {
                const info = COUNTRY_COLORS[name as string];
                const val = v as number | null;
                return [val !== null ? formatValue(val, data.unit) : '—', info?.label ?? name];
              }}
            />
            {!compact && <Legend formatter={(v: string) => COUNTRY_COLORS[v]?.label ?? v} />}
            {Object.keys(COUNTRY_COLORS).map((geo) => (
              <Line
                key={geo}
                type="monotone"
                dataKey={geo}
                stroke={COUNTRY_COLORS[geo].color}
                strokeWidth={compact ? 1.5 : 2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-slate-600 mt-2">Source: {data.source}</p>
    </div>
  );
}
