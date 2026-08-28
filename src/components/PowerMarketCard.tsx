import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { useCountry } from '../CountryContext';
import { fetchPowerPrices, type PowerPriceData, type PowerPricePoint, type PowerPriceZone } from '../api';
import { chartTick, chartTooltip, tickInterval, CHART_TICK_SIZE } from '../utils/chartType';
import { list } from '../utils/payload';
import { hourFormatter, dayFormatter, firstDayChange } from '../utils/marketClock';
import { SeriesSwatch } from './SeriesSwatch';

/** Bidding zone → the shared series palette, so a zone is the same colour here
 *  as the country is on every comparison chart. */
const ZONE_SERIES = { ee: 'EE', lv: 'LV', lt: 'LT', fi: 'FI' } as const;
const ZONE_ORDER = ['ee', 'lv', 'lt', 'fi'] as const;

/** Same encoding rule as the comparison chart: hue plus a stroke pattern, and
 *  the same correction — `2 3` rendered as a row of dots and `8 2 2 2` as
 *  morse code, which on four overlapping step lines was unreadable. Four marks
 *  of increasing length instead, Latvia solid as the reference, every mark long
 *  enough to read as a line and never shorter than the gap after it. */
const ZONE_DASH: Record<string, string | undefined> = {
  lv: undefined,
  ee: '9 4',
  lt: '18 6',
  fi: '30 9',
};

/**
 * The hours this chart labels and the day boundary it marks come from the same
 * clock, and the rule for that lives in `utils/marketClock`.
 *
 * They did not agree. `formatHour` read `d.getHours()` — the *browser's* local
 * hour — while `data.day` is grouped by the API in **UTC**, and the "tomorrow"
 * marker was placed at the first point whose UTC day was tomorrow. Measured
 * against production from a UTC+3 machine, that marker was drawn at **03:00**,
 * twelve quarter-hour points and 180 minutes after the local midnight the axis
 * itself had just labelled `00:00`.
 *
 * This is #81's defect in a second component. That fix taught the rule and
 * repaired `EconomyTile`; nobody grepped for the mechanism, so this instance
 * stayed.
 */

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
  const { timezone, tzAbbr } = useCountry();
  const formatHour = hourFormatter(timezone);
  const dayOf = dayFormatter(timezone);

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

  if (!data || list(data.series).length === 0) {
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

  // The axis keys on the instant, not on its label. Two days of quarter-hours
  // produce 184 points carrying only 96 distinct `HH:mm` strings — every label
  // appears exactly twice — and a `ReferenceLine` resolves its `x` against the
  // category domain. A duplicated domain cannot be resolved, so recharts drew
  // neither marker and reported nothing.
  //
  // That is the same repetition the boundary marker exists to explain, which
  // means the remedy was disabled by the condition it was introduced for.
  // Formatting at the tick instead of in the data keeps the axis reading
  // `03:00` while leaving the domain unique, and it removes the same ambiguity
  // from the tooltip, which could not say which `17:30` a reader was hovering.
  const chartData = list<PowerPricePoint>(data.series);
  const zoneColor = (id: string) => chartColors.series[ZONE_SERIES[id as keyof typeof ZONE_SERIES]];

  // The window is two days on purpose — "day-ahead" means tomorrow — but
  // Elering moved to 15-minute resolution, so the series carries roughly 184
  // quarter-hours whose `HH:mm` labels repeat: 00:00 appears twice with nothing
  // to say which is which. The boundary is marked rather than every label
  // lengthened, which would fight the axis for room.
  //
  // The boundary is found by re-reading each point's day **in the zone the
  // axis is labelled in**, not by trusting `p.day`. The API groups by UTC day,
  // so `p.day === data.tomorrow` selects the first point after *UTC* midnight
  // — measured at 03:00 on a UTC+3 machine, three hours and twelve points
  // past the `00:00` the axis had just drawn. The marker has to land on the
  // midnight a reader can see.
  const firstTomorrow = firstDayChange(list<PowerPricePoint>(data.series), dayOf);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>Baltic power market</p>
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>Day-ahead price by bidding zone · {data.unit} · times {tzAbbr}</p>
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

      {/* Two columns on a phone, four from `sm`.
          Four `text-center` columns inside a 320px card leave about 57px each,
          and the widest label is a swatch, a flag and the word "Lithuania" —
          which cannot shrink below its own min-content. Measured in Chromium
          at 320px: the zone column and the label inside it each overflowed by
          **4px**, so the flag was clipped against its neighbour. It did not
          push the document, which is why nothing caught it; DESIGN.md §4.4 is
          about exactly this class of defect, existing only at widths nothing
          measured. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {list<PowerPriceZone>(data.zones).map((z) => (
          <div key={z.id} className="text-center">
            <p className="text-caption flex items-center justify-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <SeriesSwatch color={zoneColor(z.id)} />
              {z.flag} {z.label}
            </p>
            {/* The price is `--text-primary`, not the zone colour. As the zone
                colour it was a 14px figure at 3.90:1 (Latvia, dark) and 3.24:1
                (Lithuania, light) — a line hue asked to meet a text floor. The
                swatch above carries the mapping to the chart instead. */}
            <p className="text-ui font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
              {z.current !== null ? `€${z.current.toFixed(2)}` : '—'}
            </p>
            <p className="text-caption font-mono" style={{ color: 'var(--text-tertiary)' }}>
              {z.min !== null && z.max !== null ? `${z.min.toFixed(0)}–${z.max.toFixed(0)}` : ''}
            </p>
          </div>
        ))}
      </div>
      {/* The range above is today's. It used to span both days while the
          footnote called it today, so a quiet day beside a volatile tomorrow
          reported a range neither of them had. */}
      <p className="text-caption mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Range is today&apos;s low to high
      </p>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            {/* Eight labels rather than the shared default of six: this axis has
                a 40px YAxis beside it and was measured clean at 402px with
                eight, so the count is kept and only the arithmetic is shared.
                `tickInterval` computes exactly what the inline expression here
                used to — the point of routing through it is that `EconomyTile`
                cannot drift away from it again. */}
            <XAxis
              dataKey="time"
              tickFormatter={formatHour}
              tick={chartTick(chartColors.axis)}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={tickInterval(chartData.length, 8)}
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
              labelFormatter={(v) => formatHour(String(v))}
              formatter={(v, name) => {
                const zone = list<PowerPriceZone>(data.zones).find((z) => z.id === name);
                return [v === null ? '—' : `€${(v as number).toFixed(2)}`, zone?.label ?? String(name)];
              }}
            />
            {data.currentTime && (
              <ReferenceLine x={data.currentTime} stroke={chartColors.reference} strokeDasharray="2 2" />
            )}
            {firstTomorrow && (
              <ReferenceLine
                x={firstTomorrow.time}
                stroke={chartColors.reference}
                label={{ value: 'tomorrow', position: 'insideTopRight', fill: chartColors.axis, fontSize: CHART_TICK_SIZE }}
              />
            )}
            {ZONE_ORDER.map((zone) => (
              <Line
                key={zone}
                type="stepAfter"
                dataKey={zone}
                stroke={zoneColor(zone)}
                strokeDasharray={ZONE_DASH[zone]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {decoupledShare}% of today&apos;s {data.totalIntervals} intervals decoupled
        {data.widestSpread ? ` · widest €${data.widestSpread.spread.toFixed(2)} at ${formatHour(data.widestSpread.time)}` : ''}
        {data.tomorrowOutlook
          ? ` · tomorrow published, ${data.tomorrowOutlook.totalIntervals} intervals`
          : ' · tomorrow not published yet'}
        {' · '}Source: {data.source}
      </p>
    </div>
  );
}
