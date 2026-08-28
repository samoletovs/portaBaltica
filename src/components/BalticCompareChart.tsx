import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { useFilter } from '../FilterContext';
import { SeriesSwatch } from './SeriesSwatch';
import { formatValue } from '../utils/formatValue';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { chartTick, chartTooltip } from '../utils/chartType';
import { referenceSharesAxis } from '../utils/referenceScale';
import { describeComparison } from '../utils/chartAccessibility';
import { optionalString, type SeriesExport } from '../utils/exportSeries';
import { DownloadMenu } from './DownloadMenu';

/**
 * Each country's identity in a chart: its flag colour, a stroke pattern, an
 * end-of-line marker shape, and a label.
 *
 * Latvia carmine, Estonia blue, Lithuania gold — a reader who knows the flags
 * never has to consult a legend. The exact values, why they are much less
 * saturated than they were, and why Lithuania is gold rather than green, are
 * worked out in `ThemeContext`.
 *
 * **A second, non-colour encoding is mandatory, and that is measured rather
 * than cautious.** Between-series *luminance* contrast is only 1.19–1.76:1,
 * well under the 3:1 at which WCAG 2.2's note on SC 1.4.1 lets a difference in
 * lightness count as a second distinction. So hue is the only other channel,
 * and hue alone is what the criterion forbids.
 *
 * There are two ways to supply it and a reader may now choose (see
 * `StrokeStyle` in `FilterContext`), because they trade against each other and
 * neither is right for everyone:
 *
 *   - `dash` — survives greyscale printing, which a marker does not, but over a
 *     dense multi-year series a dashed line reads as texture. The patterns are
 *     deliberately long: Lithuania used to be `2 4`, which at a 2px stroke is
 *     not a dashed line but a row of dots. Both are now at least 6px on and
 *     never shorter than the gap after them, and they differ by more than 2× in
 *     mark length so they stay apart at the compact size.
 *   - `marker` — a distinct shape at the last point. Highcharts' accessibility
 *     guidance prefers shape over dashing for line charts for exactly the
 *     density reason above. It is drawn only at the end rather than at every
 *     point, because 62 monthly markers on three series is 186 shapes on a
 *     250px panel, which is worse than either problem it solves.
 */
const COUNTRY_META: Record<string, { dash?: string; marker: 'circle' | 'square' | 'triangle'; label: string; flag: string }> = {
  LV: { marker: 'circle', label: 'Latvia', flag: '🇱🇻' },
  EE: { dash: '9 4', marker: 'square', label: 'Estonia', flag: '🇪🇪' },
  LT: { dash: '18 6', marker: 'triangle', label: 'Lithuania', flag: '🇱🇹' },
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

/**
 * The shape drawn at the last observation of a series, in `plain` mode.
 *
 * Rendered as an SVG primitive rather than a recharts `dot` preset because the
 * shape has to differ *per series* — a circle for everyone is decoration, and
 * the whole reason this exists is to be the second encoding once the dash is
 * gone. Filled with the series colour and ringed in the card surface so it
 * stays readable where two lines end on top of each other.
 */
function EndMarker({
  cx,
  cy,
  shape,
  colour,
  size,
}: {
  cx: number;
  cy: number;
  shape: 'circle' | 'square' | 'triangle';
  colour: string;
  size: number;
}) {
  const common = { fill: colour, stroke: 'var(--bg-card)', strokeWidth: 1.5 };
  if (shape === 'circle') return <circle cx={cx} cy={cy} r={size} {...common} />;
  if (shape === 'square') {
    return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} rx={1} {...common} />;
  }
  const h = size * 1.15;
  return <polygon points={`${cx},${cy - h} ${cx + h},${cy + h * 0.75} ${cx - h},${cy + h * 0.75}`} {...common} />;
}

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
  const { years: filterYears, strokeStyle } = useFilter();
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

  // Every reading the three publish, which is both what the axis is built from
  // and what decides whether the benchmark may join it.
  const balticValues = COUNTRY_ORDER.flatMap((geo) =>
    (data.countries[geo]?.series ?? []).map((point) => point.value),
  ).filter((value): value is number => typeof value === 'number');

  // The benchmark is drawn only where it fits.
  //
  // `/api/baltic-compare` already refuses to fetch it for an extensive total,
  // and that gate catches every case measured today. It is a hand-written
  // classification of sixty-six indicators, though, and nothing upstream checks
  // that a classification is true — so the axis is measured here as well,
  // against the data actually returned. A benchmark that would flatten the
  // three is withheld from the chart and kept in the header, where it still
  // answers "is this good or bad" without pricing the axis in EU units.
  const plotReference = reference !== null && referenceSharesAxis(balticValues, reference.series.map((p) => p.value));

  const chartData = sortedPeriods.map((period) => {
    const point: Record<string, string | number | null> = { period };
    for (const [geo, cs] of Object.entries(data.countries)) {
      const match = cs.series.find((s) => s.period === period);
      point[geo] = match?.value ?? null;
    }
    if (plotReference && reference) {
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

  // Where each country's line actually ends, which is not always the last
  // period on the chart: the three do not publish on the same schedule, and in
  // `plain` mode the marker has to sit on the last *observation* rather than on
  // the last column, or it would be drawn floating over a gap.
  const lastIndex: Record<string, number> = {};
  for (const geo of COUNTRY_ORDER) {
    lastIndex[geo] = chartData.reduce(
      (found, point, index) => (typeof point[geo] === 'number' ? index : found),
      -1,
    );
  }

  // Zero is the most important value on a percentage-change series, and it was
  // previously unmarked. Only drawn where the data actually straddles it.
  const crossesZero = balticValues.some((v) => v < 0) && balticValues.some((v) => v > 0);

  // What the download writes out. The EU27 benchmark is included whenever the
  // cube carries one, including where the chart withholds the line: withholding
  // is a decision about the axis, not about the fact, and a file has no axis.
  // It is labelled as an average rather than given a flag, so it cannot be read
  // as a fourth country in the column headers.
  const exportPayload: SeriesExport = {
    indicator: indicator,
    title: title ?? data.title,
    unit: data.unit,
    source: data.source,
    dataset: optionalString(data, 'dataset'),
    retrievedAt: optionalString(data, 'fetchedAt'),
    exportedAt: new Date().toISOString(),
    series: [
      ...COUNTRY_ORDER.filter((geo) => data.countries[geo]).map((geo) => ({
        label: COUNTRY_META[geo].label,
        observations: data.countries[geo].series,
      })),
      ...(reference ? [{ label: `${reference.label} average`, observations: reference.series }] : []),
    ],
  };

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      {/* The header is two blocks — a title and a direct-labelling legend —
          and both must be able to give way.

          They could not. Neither was `min-w-0`, so as flex items both took the
          default `min-width: auto`, which is their *min-content*: the legend's
          four entries plus their gaps came to 377px and simply refused to be
          narrower. When #132 added the EU27 reference the row gained a fourth
          entry, and on a card halved by `md:grid-cols-2` it stopped fitting —
          overflowing the card, then the page, so `/data` scrolled sideways
          into blank space.

          Measured on master in 4px steps, the page overflowed at **98 of 177
          widths between 320 and 1024**, in two bands: 768–960 (the two-column
          grid) and 320–512 (where the viewport itself is narrower than the
          legend). Both are wider than they look, and the second exists at
          every phone size.

          So the row wraps rather than truncates. Truncation would hide the
          figure the legend exists to show, and dropping the fourth entry at
          tablet width would remove the EU27 denominator exactly where a small
          chart is hardest to read (#125). Wrapping costs a line and keeps
          every number. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
        <div className="min-w-0">
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
            line — 3.74:1 for Latvia in dark, 3.59:1 in light — under the 4.5:1
            SC 1.4.3 asks of text this size. Lowering the palette's chroma
            improved every one of those ratios and changed nothing here, which
            is the point: the two floors are not satisfiable in one value at
            these hues, so the colour has to move rather than change. The
            swatch carries the same mapping at the floor it was built for. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {COUNTRY_ORDER.map((geo) => (
            <div key={geo} className="flex items-center gap-1 text-caption font-mono">
              <SeriesSwatch
                color={chartColors.series[geo]}
                marker={strokeStyle === 'plain' ? COUNTRY_META[geo].marker : undefined}
              />
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
            //
            // It stays here even when the chart cannot carry the line, because
            // withholding the line is about the axis and not about the fact.
            // The dashed rule is a key to a line, so it is dropped with the
            // line rather than left pointing at nothing.
            <div className="flex items-center gap-1 text-caption font-mono"
              title={reference.fullLabel}>
              {plotReference && (
                <span aria-hidden="true" className="inline-block w-3 border-t border-dashed"
                  style={{ borderColor: 'var(--text-tertiary)' }} />
              )}
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
            {reference && plotReference && (
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
                strokeDasharray={strokeStyle === 'patterned' ? COUNTRY_META[geo].dash : undefined}
                strokeWidth={compact ? 2 : 2.5}
                // In `plain` mode the dash is gone, so the shape at the end of
                // the line is the only thing left besides hue — and hue alone
                // is what SC 1.4.1 forbids. `dot` is false either way: a marker
                // at every one of 60-odd monthly points is texture, not a cue.
                dot={
                  strokeStyle === 'plain'
                    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (props: any) =>
                        props.index === lastIndex[geo] ? (
                          <EndMarker
                            key={`${geo}-end`}
                            cx={props.cx}
                            cy={props.cy}
                            shape={COUNTRY_META[geo].marker}
                            colour={chartColors.series[geo]}
                            size={compact ? 3 : 4}
                          />
                        ) : (
                          <g key={`${geo}-${props.index}`} />
                        )
                    : false
                }
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* An undisclosed omission is the same fault as an undisclosed crop:
          DESIGN.md §3.3 asks for the axis decision to be stated on the card, so
          a reader can tell a withheld benchmark from a missing one. */}
      {reference && !plotReference && (
        <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
          EU27 is off this chart&rsquo;s scale, so it is shown above but not drawn — plotting it would
          flatten the three into one line.
        </p>
      )}
      {/* The source line and the export, on one row. A download belongs beside
          the attribution rather than beside the title: it is the last thing a
          reader wants, not the first, and the file it produces carries this
          same source line in its preamble. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2">
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>Source: {data.source}</p>
        {!compact && <DownloadMenu data={exportPayload} />}
      </div>
    </div>
  );
}
