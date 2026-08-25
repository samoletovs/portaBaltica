import type { ReactNode } from 'react';
import type { PortMeasure } from '../types';
import { formatPeriod } from '../dataFreshness';
import { formatMeasure, formatPct, totalAt, unitLabel, valueAt, yearOnYear, type PortUnit } from '../portStats';

/**
 * Shared chrome for the three maritime panels.
 *
 * They render three different measures — tonnes, passengers, vessels — from
 * one Eurostat shape, so the layout, the empty state and the "which quarter is
 * this" line are defined once. Three panels that each invented their own way
 * of saying "no data" was how the old maritime tile ended up telling readers
 * that ferry figures were "published biweekly by the Ministry of Transport"
 * long after the ministry had stopped publishing them at all.
 */

export function PanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
      <h3 className="text-callout font-semibold text-white mb-2">{title}</h3>
      {children}
    </section>
  );
}

export function PanelEmpty({ title, reason }: { title: string; reason: string }) {
  return (
    <PanelShell title={title}>
      <p className="text-slate-400 text-ui">{reason}</p>
    </PanelShell>
  );
}

/** Headline figure for a quarter, with the year-on-year move beside it. */
export function MeasureHeadline({ measure }: { measure: PortMeasure }) {
  const yoy = yearOnYear(measure);
  const unit = measure.unit as PortUnit;
  // The headline is the quarter's total, which is known whenever anything
  // reported. The comparison is a separate question: a series with no
  // year-earlier quarter to compare against must still show its figure rather
  // than collapse the whole panel to a dash.
  const total = totalAt(measure, measure.latest);

  return (
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-title font-semibold text-white font-mono">
          {total !== null ? formatMeasure(total, unit) : '—'}
        </span>
        {yoy ? (
          <>
            <span className={`text-ui font-medium ${yoy.pct >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {formatPct(yoy.pct)}
            </span>
            <span className="text-caption text-slate-500">year on year</span>
          </>
        ) : (
          <span className="text-caption text-slate-500">no year-earlier quarter to compare</span>
        )}
      </div>
      <p className="text-caption text-slate-500 mb-3">
        {unitLabel(unit)}
        {measure.latest ? ` · ${formatPeriod(measure.latest)}` : ''}
      </p>
    </>
  );
}

const BAR_COLORS = [
  'bg-cyan-500', 'bg-teal-500', 'bg-emerald-600', 'bg-slate-400', 'bg-slate-500',
];

/** One bar per port, sized against the largest, with its share of the total. */
export function PortBars({ measure }: { measure: PortMeasure }) {
  const period = measure.latest;
  const rows = measure.ports
    .map(p => ({ name: p.name, value: valueAt(p, period) }))
    .filter((r): r is { name: string; value: number } => r.value !== null);

  if (rows.length === 0) return null;

  const max = Math.max(...rows.map(r => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const unit = measure.unit as PortUnit;

  return (
    <div className="space-y-1.5">
      {rows.map((row, idx) => {
        // A port reporting a true zero still gets a hairline, so "reported
        // nothing" is visibly different from "not in the table at all".
        const width = Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0);
        const share = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0';
        return (
          <div key={row.name}>
            <div className="flex items-center justify-between text-caption mb-0.5">
              <span className="text-slate-200 truncate max-w-[55%]" title={row.name}>{row.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{share}%</span>
                <span className="text-white font-mono font-medium w-16 text-right">
                  {formatMeasure(row.value, unit)}
                </span>
              </div>
            </div>
            <div className="h-2.5 bg-slate-800/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[Math.min(idx, BAR_COLORS.length - 1)]}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Footnote naming the source and, when relevant, warning that the figure is a
 * national total rather than a port.
 */
export function PanelNote({ measure, table }: { measure: PortMeasure; table: string }) {
  return (
    <p className="text-caption text-slate-600 mt-3">
      {measure.countryOnly && (
        <span className="text-amber-400/80">
          Eurostat publishes no port breakdown for this country; the figure is a national total.{' '}
        </span>
      )}
      Source: Eurostat {table}, quarterly.
    </p>
  );
}
