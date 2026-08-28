import { useEffect, useState } from 'react';
import { AreaChart, Area, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { fetchLiveGrid, type LiveGridData, type LiveGridPoint } from '../api';
import { chartTick, chartTooltip, CHART_TICK_SIZE } from '../utils/chartType';
import { describeComparison } from '../utils/chartAccessibility';

/**
 * What the Estonian grid is physically doing, and what its operator expects
 * next.
 *
 * The dashboard plots a day-ahead electricity price without ever showing the
 * situation that sets it. This is the other half: how much is being generated,
 * how much drawn, how much of it renewable, and whether the country is short.
 * It sits beside the price card for that reason rather than as another entry in
 * a grid of line charts.
 *
 * **Labelled Estonia everywhere, because it is Estonia.** Elering is the
 * Estonian TSO and this is its own system: consumption runs 670–870 MW where
 * the three Baltic states together draw three to four gigawatts. The zones are
 * price-coupled, so Estonian scarcity is one of the things that moves a Latvian
 * price — but that is a connection worth stating, not a licence to call this a
 * Baltic figure.
 *
 * Two honesty constraints shape what is on screen:
 *
 *   - **It is not "now".** Metering lags by well over an hour, so the panel
 *     dates the reading and says how far behind it is rather than implying a
 *     live feed. "Freshest thing on the site" and "current" are different
 *     claims, and only the first is true.
 *   - **The forecast is drawn as a forecast.** Dashed, past a marked boundary,
 *     and never merged into the metered line. The operator's plan for 15:00 is
 *     not a measurement of 15:00.
 *
 * `frequency` is deliberately absent. Elering returns exactly 50 in every row
 * of every sample taken, so it is a nominal constant rather than telemetry, and
 * a dial that never moves would imply a liveness the number does not carry.
 */

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

function describeLag(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 90) return `${minutes} min behind`;
  return `${(minutes / 60).toFixed(1)} h behind`;
}

export function GridStatePanel() {
  const { chartColors } = useTheme();
  const [data, setData] = useState<LiveGridData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLiveGrid()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl p-4 animate-pulse h-64"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/3 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-40 rounded" style={{ background: 'var(--border-card)' }} />
      </div>
    );
  }

  if (!data || !data.latest) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center h-64"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Estonian grid data unavailable
        </p>
      </div>
    );
  }

  const latest = data.latest;
  const importing = latest.balance !== null && latest.balance < 0;
  const shortfall = latest.balance === null ? null : Math.abs(latest.balance);

  // Metered and forecast in one series, but in separate keys, so recharts draws
  // two lines that meet at the boundary rather than one line that lies across
  // it.
  const boundary = data.meteredTo;
  const rows = [...data.actual, ...data.forecast].map((p: LiveGridPoint) => ({
    label: formatClock(p.time),
    metered: p.kind === 'actual' ? p.consumption : null,
    planned: p.kind === 'forecast' ? p.consumption : null,
    generated: p.kind === 'actual' ? p.production : null,
  }));

  // Join the two lines at the boundary by starting the forecast from the last
  // *metered* value, rather than extending the metered line into the future.
  // Both make the lines meet; only this one is true, because a forecast really
  // does begin at the last measurement.
  const firstForecast = rows.findIndex((r) => r.planned !== null);
  if (firstForecast > 0) rows[firstForecast - 1].planned = rows[firstForecast - 1].metered;

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>
            Estonian grid
          </p>
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            Generation and demand · MW
          </p>
        </div>
        <div className="text-right">
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            metered to {formatClock(latest.time)} UTC
          </p>
          <p className="text-caption" style={{ color: 'var(--data-warning)' }}>
            {describeLag(data.minutesBehind)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>
            {importing ? 'Net import' : 'Net export'}
          </p>
          <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
            {shortfall === null ? '—' : `${Math.round(shortfall)}`}
            <span className="text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}> MW</span>
          </p>
        </div>
        <div>
          <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>Renewable</p>
          <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
            {latest.renewableShare === null ? '—' : `${latest.renewableShare}`}
            <span className="text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}>%</span>
          </p>
        </div>
        <div>
          <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>Demand</p>
          <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
            {latest.consumption === null ? '—' : Math.round(latest.consumption)}
            <span className="text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}> MW</span>
          </p>
        </div>
      </div>

      {/* Described through `chartAccessibility`, like every other chart.
          
          This carried a hand-written label, and the reason to replace it is
          not consistency for its own sake — the label was describing the wrong
          object. It recited generation, demand, net flow and **renewable
          share**, and renewable share is not plotted here at all: the chart's
          three `dataKey`s are `generated`, `metered` and `planned`. Every one
          of those four figures is also already on screen as text, in the three
          stat boxes immediately above, so a screen-reader user heard them
          once as content and again as the chart — while the thing a sighted
          reader actually takes from the chart, the shape over time and where
          measurement stops and forecast begins, was never stated.
          
          So the series go through the shared vocabulary, and the one fact that
          vocabulary cannot express — that the trace is part measurement and
          part forecast, which is what the dashed segment means — is appended.
          A per-series description cannot say that, because it is a fact about
          the boundary between two series rather than about either. */}
      <div
        className="h-40"
        role="img"
        aria-label={
          describeComparison(
            'Estonian grid, generation against demand',
            [
              { label: 'Generation', points: rows.map((r) => ({ period: r.label, value: r.generated })) },
              { label: 'Demand, metered', points: rows.map((r) => ({ period: r.label, value: r.metered })) },
              { label: 'Demand, forecast', points: rows.map((r) => ({ period: r.label, value: r.planned })) },
            ],
            (v: number | null) => (v === null ? 'no reading' : `${Math.round(v)} megawatts`),
            // `describeComparison` reports each series' last observation and
            // calls it a latest reading. Two of the three series here run
            // past `meteredTo` into the operator's forecast, so without this
            // the label announced a *predicted* demand as a reading — the
            // same fault that gave a screen reader Finland at EUR 1.83
            // against an actual EUR 27.45 on the price chart.
            //
            // The labels are unique here (a clock over one boundary, not a
            // wrapping day-ahead curve), so the helper's structural refusal
            // does not fire and only naming the period closes it. `asAt` is
            // indexed on the series' own labels, and these are built by the
            // same `formatClock`, so the boundary resolves exactly.
            (p) => p,
            boundary ? { asAt: formatClock(boundary) } : {},
          ) +
          (boundary
            ? ` Measured to ${formatClock(boundary)} UTC; the dashed trace after that is ${data.operator}'s own forecast.`
            : '')
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis dataKey="label" tick={chartTick(chartColors.axis)} tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              interval={Math.max(0, Math.floor(rows.length / 6))} />
            <YAxis tick={chartTick(chartColors.axis)} tickLine={false}
              axisLine={{ stroke: chartColors.grid }} width={44} tickCount={5} />
            <Tooltip
              contentStyle={chartTooltip(chartColors.tooltipBg, chartColors.tooltipBorder)}
              labelStyle={{ color: chartColors.axis }}
              formatter={(v, name) => [
                v === null ? '—' : `${Math.round(v as number)} MW`,
                name === 'generated' ? 'Generated' : name === 'planned' ? 'Demand (forecast)' : 'Demand',
              ]}
            />
            {boundary && (
              <ReferenceLine x={formatClock(boundary)} stroke={chartColors.reference}
                strokeDasharray="2 2"
                label={{ value: 'forecast', position: 'insideTopRight', fill: chartColors.axis, fontSize: CHART_TICK_SIZE }} />
            )}
            <Area type="monotone" dataKey="generated" stroke={chartColors.series.EE}
              fill={chartColors.series.EE} fillOpacity={0.15} strokeWidth={2}
              dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="metered" stroke={chartColors.seriesDefault}
              strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="planned" stroke={chartColors.seriesDefault}
              strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false}
              />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
        Shaded area is generation, line is demand; dashed past the marker is Elering&apos;s own
        forecast. Estonia only, not the Baltics. Source: {data.operator}
      </p>
    </div>
  );
}
