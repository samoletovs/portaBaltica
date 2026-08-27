import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { useFilter } from '../FilterContext';
import { SeriesSwatch } from './SeriesSwatch';
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

/**
 * The data key the benchmark is plotted under.
 *
 * Deliberately not a geo code. `COUNTRY_ORDER` and `COUNTRY_META` are the three
 * Baltic states and nothing else, and every consumer of `data.countries`
 * assumes that — so the reference is carried on its own key and never appears
 * in either structure. EU27 is a denominator, not a subject.
 */
const REFERENCE_KEY = 'EU27';

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
  // The reference series has to be summed into the periods too, or a benchmark
  // that runs past the Baltic series would be clipped at the last national
  // observation rather than drawn.
  const allPeriods = new Set<string>();
  for (const key of Object.keys(data.countries)) {
    for (const pt of data.countries[key].series) {
      allPeriods.add(pt.period);
    }
  }
  const sortedPeriods = Array.from(allPeriods).sort();

  // The European denominator, drawn only when the cube actually carries one.
  // `reference` is null for 12 of the 65 indicators — ten of them balance-of-
  // payments series, where an EU aggregate against itself means little — and a
  // chart without it has to look intentional rather than broken, which is why
  // nothing about the benchmark renders at all in that case.
  const reference = data.reference ?? null;

  const chartData = sortedPeriods.map((period) => {
    const point: Record<string, string | number | null> = { period };
    for (const [geo, cs] of Object.entries(data.countries)) {
      const match = cs.series.find((s) => s.period === period);
      point[geo] = match?.value ?? null;
    }
    if (reference) {
      const match = reference.series.find((s) => s.period === period);
      point[REFERENCE_KEY] = match?.value ?? null;
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
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            LV vs EE vs LT{reference ? ' vs EU27' : ''} · {data.unit}
          </p>
        </div>
        {/* Direct labelling: the latest reading for each country, beside a
            swatch in that country's line colour, so the chart can be read
            without consulting a legend.

            The reading itself is `--text-primary`. It used to be the series
            colour, which put a 12px figure on a hue tuned to clear 3:1 as a
            line — 3.90:1 for Latvia in dark, 3.24:1 for Lithuania in light,
            both under the 4.5:1 that SC 1.4.3 asks of text this size. The
            swatch carries the same mapping at the floor it was built for. */}
        <div className="flex items-center gap-3">
          {COUNTRY_ORDER.map((geo) => (
            <div key={geo} className="flex items-center gap-1 text-caption font-mono">
              <SeriesSwatch color={chartColors.series[geo]} />
              <span aria-hidden="true">{COUNTRY_META[geo].flag}</span>
              <span className="sr-only">{COUNTRY_META[geo].label}: </span>
              <span style={{ color: 'var(--text-primary)' }}>
                {latestValues[geo] !== null && latestValues[geo] !== undefined ? formatValue(latestValues[geo], data.unit) : '—'}
              </span>
            </div>
          ))}
          {reference && (
            // The benchmark, and deliberately not in the same visual grammar as
            // the three: no flag, no series swatch, a dashed rule instead. It
            // answers "is this good or bad", which is a different question from
            // "who is ahead", and it must not read as a fourth competitor.
            <div className="flex items-center gap-1 text-caption font-mono"
              title={reference.fullLabel}>
              <span aria-hidden="true" className="inline-block w-3 border-t border-dashed"
                style={{ borderColor: 'var(--text-tertiary)' }} />
              <span className="sr-only">{reference.fullLabel} average: </span>
              <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>EU27</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {formatValue(reference.latest, data.unit)}
              </span>
            </div>
          )}
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
                if (name === REFERENCE_KEY) {
                  return [val !== null ? formatValue(val, data.unit) : '—', 'EU27 average'];
                }
                return [val !== null ? formatValue(val, data.unit) : '—', COUNTRY_META[name as string]?.label ?? name];
              }}
            />
            {/* The legend text is neutral; its swatch, which recharts draws
                beside each entry, carries the colour. Left to itself recharts
                paints the label in the series colour, which is how "Latvia"
                came to be a 16px word at 3.90:1. */}
            {!compact && (
              <Legend
                formatter={(v: string) => (
                  <span style={{ color: v === REFERENCE_KEY ? 'var(--text-tertiary)' : 'var(--text-body)' }}>
                    {v === REFERENCE_KEY ? 'EU27 average' : COUNTRY_META[v]?.label ?? v}
                  </span>
                )}
              />
            )}
            {/* The benchmark is drawn first, so the three countries paint over
                it rather than under it. It is a denominator, not a competitor:
                no country colour (DESIGN.md §3.6 reserves the palette for the
                flags, and the EU is not a Baltic state), a thinner stroke, and
                a long dash that reads as a rule rather than as a series. */}
            {reference && (
              <Line
                type="monotone"
                dataKey={REFERENCE_KEY}
                stroke={chartColors.axis}
                strokeDasharray="6 4"
                strokeWidth={compact ? 1 : 1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
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
