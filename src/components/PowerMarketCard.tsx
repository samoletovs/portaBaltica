import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { fetchPowerPrices, type PowerPriceData } from '../api';
import { chartTick, chartTooltip } from '../utils/chartType';

/** Bidding zone → the shared series palette, so a zone is the same colour here
 *  as the country is on every comparison chart. */
const ZONE_SERIES = { ee: 'EE', lv: 'LV', lt: 'LT', fi: 'FI' } as const;
const ZONE_ORDER = ['ee', 'lv', 'lt', 'fi'] as const;

/** Same encoding rule as the comparison chart: hue plus a stroke pattern. */
const ZONE_DASH: Record<string, string | undefined> = {
  lv: undefined,
  ee: '6 3',
  lt: '2 3',
  fi: '8 2 2 2',
};

function formatHour(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Baltic day-ahead power market.
 *
 * Estonia, Latvia, Lithuania and Finland trade in one Nord Pool market, so
 * their prices are identical to the cent whenever the interconnectors have
 * spare capacity. A gap between them is congestion — the single most legible
 * real-time signal of Baltic grid stress, and one no statistical release
 * reports. Elering publishes all four zones in one response.
 */
export function PowerMarketCard() {
  const [data, setData] = useState<PowerPriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const { chartColors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    fetchPowerPrices()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl p-4 animate-pulse h-64" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/3 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-40 rounded" style={{ background: 'var(--border-card)' }} />
      </div>
    );
  }

  if (!data || data.series.length === 0) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center h-64" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>Power market data unavailable</p>
      </div>
    );
  }

  const decoupled = data.coupled === false;
  const decoupledShare = data.totalIntervals > 0
    ? Math.round((data.decoupledIntervals / data.totalIntervals) * 100)
    : 0;

  const chartData = data.series.map((p) => ({ ...p, label: formatHour(p.time) }));
  const zoneColor = (id: string) => chartColors.series[ZONE_SERIES[id as keyof typeof ZONE_SERIES]];

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>Baltic power market</p>
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>Day-ahead price by bidding zone · {data.unit}</p>
        </div>
        <div
          className={`px-2 py-1 rounded text-caption font-semibold whitespace-nowrap ${
            decoupled ? 'news-status-warning' : 'news-status-positive'
          }`}
          title={
            decoupled
              ? 'Zone prices differ, which means a cross-border link is congested'
              : 'All Baltic zones cleared at the same price'
          }
        >
          {decoupled ? `Decoupled · €${data.currentSpread?.toFixed(2)} gap` : 'Coupled'}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {data.zones.map((z) => (
          <div key={z.id} className="text-center">
            <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>{z.flag} {z.label}</p>
            <p className="text-ui font-mono font-semibold" style={{ color: zoneColor(z.id) }}>
              {z.current !== null ? `€${z.current.toFixed(2)}` : '—'}
            </p>
            <p className="text-caption font-mono" style={{ color: 'var(--text-tertiary)' }}>
              {z.min !== null && z.max !== null ? `${z.min.toFixed(0)}–${z.max.toFixed(0)}` : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis
              dataKey="label"
              tick={chartTick(chartColors.axis)}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={Math.max(0, Math.floor(chartData.length / 8))}
            />
            <YAxis
              tick={chartTick(chartColors.axis)}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              width={40}
              tickCount={6}
            />
            <Tooltip
              contentStyle={chartTooltip(chartColors.tooltipBg, chartColors.tooltipBorder)}
              labelStyle={{ color: chartColors.axis }}
              formatter={(v, name) => {
                const zone = data.zones.find((z) => z.id === name);
                return [v === null ? '—' : `€${(v as number).toFixed(2)}`, zone?.label ?? String(name)];
              }}
            />
            {data.currentTime && (
              <ReferenceLine x={formatHour(data.currentTime)} stroke={chartColors.reference} strokeDasharray="2 2" />
            )}
            {ZONE_ORDER.map((zone) => (
              <Line
                key={zone}
                type="stepAfter"
                dataKey={zone}
                stroke={zoneColor(zone)}
                strokeDasharray={ZONE_DASH[zone]}
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {decoupledShare}% of intervals decoupled today
        {data.widestSpread ? ` · widest €${data.widestSpread.spread.toFixed(2)} at ${formatHour(data.widestSpread.time)}` : ''}
        {' · '}Source: {data.source}
      </p>
    </div>
  );
}
