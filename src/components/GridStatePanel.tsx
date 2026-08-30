import { useEffect, useState } from 'react';
import { AreaChart, Area, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { useTheme } from '../ThemeContext';
import { fetchLiveGrid, type LiveGridData, type LiveGridPoint } from '../api';
import { chartTick, chartTooltip, CHART_TICK_SIZE } from '../utils/chartType';
import { describeComparison } from '../utils/chartAccessibility';
import { list } from '../utils/payload';
import { optionalString, type SeriesExport } from '../utils/exportSeries';
import { DownloadMenu } from './DownloadMenu';

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

/**
 * Age of an absolute instant, computed now rather than read from the payload.
 *
 * The API used to send `minutesBehind` and this panel used to print it. That
 * number is computed when the response body is BUILT, and the body then sits in
 * the server's cache for five minutes and in this client's for five more — so
 * it describes a moment that has passed by the time anyone reads it. Measured
 * on production, six requests inside one server TTL: the body reported 72
 * minutes behind and was still reporting 72 nine minutes later, while the truth
 * had moved to 81.
 *
 * `meteredTo` and `renewableLatest.time` are instants, and an instant does not
 * decay. Subtracting here costs nothing and cannot be stale.
 */
function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((now - at) / 60000));
}

/**
 * How long ago the server last reached Elering, and whether that is a problem.
 *
 * `fetchedAt` is stamped when the handler runs, so it survives every cache
 * between there and here: when `withCache` serves a body inside its
 * thirty-minute grace after an upstream failure, the handler did not run and
 * this instant stays at the last success. That is the whole signal, and it
 * needs no `Age` or `X-Cache` header — which is fortunate, because `cachedFetch`
 * discards headers and then caches the body again, so a header-derived age
 * would have gone stale one layer further out.
 *
 * The threshold is the server TTL plus this client's, plus a margin for a
 * revalidation in flight — `X-Cache: revalidating` was observed at Age 561s
 * during ordinary operation, so anything tighter would cry outage on a healthy
 * feed.
 */
const STALE_AFTER_MINUTES = 15;

function retrievalState(fetchedAt: string | null | undefined, now: number):
  { minutes: number; stale: boolean } | null {
  const minutes = minutesSince(fetchedAt, now);
  if (minutes === null) return null;
  return { minutes, stale: minutes > STALE_AFTER_MINUTES };
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

  /**
   * The three traces as a file, and the measured-versus-forecast distinction
   * kept rather than flattened.
   *
   * `/api-docs` sells "CSV and JSON export on every series", which was true of
   * the indicator surfaces and false of every charted series that is not an
   * indicator. This is one of three.
   *
   * Demand is **two columns, not one**, for the same reason the chart draws two
   * lines: past `meteredTo` the figures are Elering's own forecast. A single
   * "demand" column would hand a reader a file in which a prediction is
   * indistinguishable from a measurement, which is the export equivalent of the
   * label defect this panel already carries a comment about — and worse, because
   * the file travels and nothing travels with it to say which half was observed.
   *
   * The period is the ISO instant rather than the clock label the chart uses:
   * `formatClock` renders `HH:mm`, which repeats across a day boundary.
   */
  const exportPayload: SeriesExport = {
    indicator: 'live-grid',
    title: `${data.areaLabel ?? 'Estonian'} grid, generation against demand`,
    unit: data.unit,
    source: data.operator,
    retrievedAt: optionalString(data, 'fetchedAt'),
    exportedAt: new Date().toISOString(),
    series: [
      {
        label: 'Generation',
        observations: list<LiveGridPoint>(data.actual).map((p) => ({
          period: String(p.time), value: typeof p.production === 'number' ? p.production : null,
        })),
      },
      {
        label: 'Demand, metered',
        observations: list<LiveGridPoint>(data.actual).map((p) => ({
          period: String(p.time), value: typeof p.consumption === 'number' ? p.consumption : null,
        })),
      },
      {
        label: 'Demand, forecast',
        observations: list<LiveGridPoint>(data.forecast).map((p) => ({
          period: String(p.time), value: typeof p.consumption === 'number' ? p.consumption : null,
        })),
      },
    ],
  };

  // Join the two lines at the boundary by starting the forecast from the last
  // *metered* value, rather than extending the metered line into the future.
  // Both make the lines meet; only this one is true, because a forecast really
  // does begin at the last measurement.
  const firstForecast = rows.findIndex((r) => r.planned !== null);
  if (firstForecast > 0) rows[firstForecast - 1].planned = rows[firstForecast - 1].metered;

  /**
   * The renewable share the panel can actually stand behind.
   *
   * Guarded on the share being a number rather than on the object existing:
   * `renewableLatest` is absent when no interval in the window carries a share
   * at all, and null when the API found none — two states the UI treats the
   * same way, but only because both mean "nothing to show", not because they
   * are the same fact.
   */
  const renewable =
    typeof data.renewableLatest?.share === 'number' ? data.renewableLatest : null;

  // One clock for the whole render, so the two ages and the banner cannot
  // disagree by the milliseconds between three separate calls.
  const now = Date.now();
  const retrieval = retrievalState(data.fetchedAt, now);

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
            {describeLag(minutesSince(latest.time, now))}
          </p>
        </div>
      </div>

      {/* The third state. Two things can be old here and they are not the same
          fact: the grid data can lag because metering lags, which is normal and
          the line above already says; or the whole response can be old because
          the server could not reach Elering and `withCache` is serving inside
          its grace, which is a failure and nothing said so.

          A reader could not tell those apart, and neither could they tell
          either from a renewable share that is simply not filed yet — the
          panel showed the same calm figures in all three. This says when we
          last got through, and only when that is longer ago than it should be,
          so an ordinary render carries no extra furniture. */}
      {retrieval?.stale && (
        <p
          className="text-caption mb-3"
          style={{ color: 'var(--data-warning)' }}
          role="status"
        >
          Elering last reached {formatClock(data.fetchedAt)} UTC ·{' '}
          {describeLag(retrieval.minutes)} — showing the last data we received
        </p>
      )}

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
          {/* Reads `renewableLatest`, not `latest.renewableShare`, and states
              its own age — the two are on different clocks and the panel has to
              say which.

              `latest.renewableShare` is the share AT `meteredTo`, and solar is
              filed a day at a time, so it is null for almost every interval
              served: measured 2026-08-30, **1 of 45**, one unbroken trailing
              run, zero interior holes. The API measured the same shape over 763
              readings across eight days. So this box rendered a bare em-dash
              essentially always, while a real 53.9% sat one field away.

              But the fix is not "read the other field". That figure was 715
              minutes old beside three stats 55 minutes old, and printing it
              under the header's "metered to 07:45" would be a 12-hour-old
              number wearing a 55-minute-old timestamp — the same fault as
              reading a forecast as a reading, which is why the API separated
              them in the first place.

              So the age travels with the figure. `describeLag` is the panel's
              own vocabulary, already used for the metered clock above, rather
              than a second way of saying how old something is.

              And the empty case says which emptiness it is. A bare dash is two
              states wearing one symbol — "no reading" and "no renewables" — and
              on a grid panel the second is a real possibility a reader could
              believe. */}
          <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>Renewable</p>
          {renewable ? (
            <>
              <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                {renewable.share}
                <span className="text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}>%</span>
              </p>
              <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
                {formatClock(renewable.time)} · {describeLag(minutesSince(renewable.time, now))}
              </p>
            </>
          ) : (
            <>
              <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-tertiary)' }}>
                —
              </p>
              <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
                not yet filed
              </p>
            </>
          )}
        </div>
        <div>
          <p className="text-caption" style={{ color: 'var(--text-secondary)' }}>Demand</p>
          <p className="text-lead font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
            {latest.consumption === null ? '—' : Math.round(latest.consumption)}
            <span className="text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}> MW</span>
          </p>
        </div>
      </div>

      {/* Described through `chartAccessibility`, like every other chart, and the
          name goes on the surface rather than a wrapper. Recharts'
          `accessibilityLayer` makes the surface a focusable
          `role="application"`, so it is the node focus lands on; a named wrapper
          around it announces the description to a browsing reader and nothing at
          all to a tabbing one.

          This carried a hand-written label, and the reason to replace it is
          not consistency for its own sake — the label was describing the wrong
          object. It recited generation, demand, net flow and **renewable
          share**, and renewable share is not plotted here at all: the chart's
          three `dataKey`s are `generated`, `metered` and `planned`. Three of
          those four figures are also already on screen as text in the stat
          boxes above, so a screen-reader user heard them once as content and
          again as the chart — while the thing a sighted reader actually takes
          from the chart, the shape over time and where measurement stops and
          forecast begins, was never stated.

          The renewable share is the exception and always was: it is neither
          plotted nor on the same clock as the rest of the row, which is exactly
          why reciting it here was wrong and why the box beside it now carries
          its own timestamp.

          So the series go through the shared vocabulary, and the one fact that
          vocabulary cannot express — that the trace is part measurement and
          part forecast, which is what the dashed segment means — is appended.
          A per-series description cannot say that, because it is a fact about
          the boundary between two series rather than about either. */}
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
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

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2">
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Shaded area is generation, line is demand; dashed past the marker is Elering&apos;s own
          forecast. Estonia only, not the Baltics. Source: {data.operator}
        </p>
        <DownloadMenu data={exportPayload} />
      </div>
    </div>
  );
}
