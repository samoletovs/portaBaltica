import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

interface CountrySeries {
  label: string;
  series: { period: string; value: number | null }[];
}

interface ComparisonData {
  indicator: string;
  title: string;
  unit: string;
  countries: Record<string, CountrySeries>;
  source: string;
}

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

export function BalticCompareChart({ indicator, title, years = 5, compact = false }: BalticCompareChartProps) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/baltic-compare?indicator=${indicator}&years=${years}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
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
    return null;
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
              <span className="text-slate-300">{latestValues[geo] !== null ? latestValues[geo]?.toFixed(1) : '—'}</span>
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
              tick={{ fill: '#94a3b8', fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: '#1e293b' }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            {!compact && (
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
                width={40}
              />
            )}
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: '#e2e8f0', fontWeight: 500 }}
              formatter={(v, name) => {
                const info = COUNTRY_COLORS[name as string];
                const val = v as number | null;
                return [val !== null ? val.toFixed(1) + (data.unit.startsWith('%') ? '%' : '') : '—', info?.label ?? name];
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
