import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { useFilter } from '../FilterContext';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { chartTick, chartTooltip } from '../utils/chartType';
import { describeComparison } from '../utils/chartAccessibility';

/**
 * Each country's identity in a chart: its flag colour, a stroke pattern and a
 * label.
 *
 * Latvia carmine, Estonia blue, Lithuania yellow — a reader who knows the
 * flags never has to consult a legend. The exact values, and why Lithuania is
 * yellow rather than green, are worked out in `ThemeContext`.
 *
 * The stroke patterns stay even though the hues are now well separated, and
 * that is a measured decision rather than caution. Between-series *luminance*
 * contrast is only 1.19–1.76:1, well under the 3:1 at which WCAG 2.2's note on
 * SC 1.4.1 lets a difference in lightness count as a second distinction. So
 * hue is the only other channel, and hue alone is what the criterion forbids.
 * The dash is the second channel; it also survives greyscale printing.
 *
 * They are quieter than they were. Lithuania used to be `2 4` — two on, four
 * off — which at a 2px stroke is not a dashed line but a row of dots, and over
 * a dense multi-year series it read as noise rather than as a series. Both
 * patterns are now long enough to read as line first and pattern second, and
 * they differ by more than 2× in mark length so they stay distinguishable at
 * the compact size, where a panel is barely 250px wide.
 */
const COUNTRY_META: Record<string, { dash?: string; label: string; flag: string }> = {
  LV: { label: 'Latvia', flag: '🇱🇻' },
  EE: { dash: '9 4', label: 'Estonia', flag: '🇪🇪' },
  LT: { dash: '18 6', label: 'Lithuania', flag: '🇱🇹' },
};

const COUNTRY_ORDER = ['LV', 'EE', 'LT'] as const;

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
      <div className={`rounded-xl p-4 animate-pulse ${compact ? 'h-40' : 'h-64'}`}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/3 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-full rounded" style={{ background: 'var(--bg-raised)' }} />
      </div>
    );
  }

  if (!data || !data.countries || Object.keys(data.countries).length === 0) {
    return (
      <div className={`rounded-xl p-4 flex items-center justify-center ${compact ? 'h-40' : 'h-64'}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>No data available{title ? ` for ${title}` : ''}</p>
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

  // Latest values for the direct labels in the header.
  const latestValues: Record<string, number | null> = {};
  for (const [geo, cs] of Object.entries(data.countries)) {
    const valid = cs.series.filter((s) => s.value !== null);
    latestValues[geo] = valid.length > 0 ? valid[valid.length - 1].value : null;
  }

  // Zero is the most important value on a percentage-change series, and it was
  // previously unmarked. Only drawn where the data actually straddles it.
  const allValues = chartData.flatMap((point) =>
    COUNTRY_ORDER.map((geo) => point[geo]).filter((v): v is number => typeof v === 'number'),
  );
  const crossesZero = allValues.some((v) => v < 0) && allValues.some((v) => v > 0);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>{title ?? data.title}</p>
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>LV vs EE vs LT · {data.unit}</p>
        </div>
        {/* Direct labelling: the latest reading for each country, in its own
            colour, so the chart can be read without consulting a legend. */}
        <div className="flex items-center gap-3">
          {COUNTRY_ORDER.map((geo) => (
            <div key={geo} className="flex items-center gap-1 text-caption font-mono">
              <span aria-hidden="true">{COUNTRY_META[geo].flag}</span>
              <span className="sr-only">{COUNTRY_META[geo].label}: </span>
              <span style={{ color: chartColors.series[geo] }}>
                {latestValues[geo] !== null && latestValues[geo] !== undefined ? formatValue(latestValues[geo], data.unit) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className={compact ? 'h-32' : 'h-52'}
        role="img"
        aria-label={describeComparison(
          title ?? data.title,
          COUNTRY_ORDER.map((geo) => ({
            label: COUNTRY_META[geo].label,
            points: (data.countries[geo]?.series ?? []) as { period: string; value: number | null }[],
          })),
          (v) => formatValue(v, data.unit),
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis
              dataKey="period"
              tick={chartTick(chartColors.axis)}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            {!compact && (
              <YAxis
                tick={chartTick(chartColors.axis)}
                tickLine={false}
                axisLine={{ stroke: chartColors.grid }}
                width={40}
                tickCount={6}
              />
            )}
            {crossesZero && <ReferenceLine y={0} stroke={chartColors.axis} strokeWidth={1} />}
            <Tooltip
              contentStyle={chartTooltip(chartColors.tooltipBg, chartColors.tooltipBorder)}
              labelStyle={{ color: chartColors.axis }}
              formatter={(v, name) => {
                const val = v as number | null;
                return [val !== null ? formatValue(val, data.unit) : '—', COUNTRY_META[name as string]?.label ?? name];
              }}
            />
            {!compact && <Legend formatter={(v: string) => COUNTRY_META[v]?.label ?? v} />}
            {/* Gaps stay gaps. Carbon: "never interpolate between periods when
                data is unavailable" — a straight line across a hole invents
                readings that were never published, which on a site whose whole
                claim is traceability is the one thing a chart may not do. */}
            {COUNTRY_ORDER.map((geo) => (
              <Line
                key={geo}
                type="monotone"
                dataKey={geo}
                stroke={chartColors.series[geo]}
                strokeDasharray={COUNTRY_META[geo].dash}
                strokeWidth={compact ? 2 : 2.5}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>Source: {data.source}</p>
    </div>
  );
}
