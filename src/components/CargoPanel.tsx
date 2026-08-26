import { useState } from 'react';
import type { PortMeasure, CargoMix } from '../types';
import { formatPeriod } from '../dataFreshness';
import { formatMeasure } from '../portStats';
import { PanelEmpty, MeasureHeadline, PortBars, PanelNote } from './PortPanelParts';

/**
 * Gross weight of goods handled, by port and by cargo type.
 *
 * The type breakdown reads only the six categories that partition the total.
 * Eurostat's `cargo` dimension interleaves levels — `LBK` is liquid bulk and
 * `LBK_ROIL` is refined oil *inside* it — so charting the dimension as
 * delivered double-counts every tonne. Estonia publishes no breakdown at all,
 * only a total, so the toggle is hidden rather than offering a view that would
 * render empty.
 */
export function CargoPanel({ measure, mix }: { measure: PortMeasure; mix: CargoMix }) {
  const [view, setView] = useState<'port' | 'type'>('port');
  const title = 'Port Cargo';

  const hasPorts = measure.ports.length > 0 && measure.latest !== null;
  const hasMix = mix.categories.length > 0;

  if (!hasPorts && !hasMix) {
    return <PanelEmpty title={title} reason="No cargo volumes reported for these ports." />;
  }

  const showing = !hasMix ? 'port' : !hasPorts ? 'type' : view;

  return (
    <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-callout font-semibold text-white">{title}</h3>
        {hasPorts && hasMix && (
          <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5">
            <ViewButton label="By port" active={showing === 'port'} onClick={() => setView('port')} />
            <ViewButton label="By type" active={showing === 'type'} onClick={() => setView('type')} />
          </div>
        )}
      </div>

      {showing === 'port' ? (
        <>
          <MeasureHeadline measure={measure} />
          <PortBars measure={measure} />
        </>
      ) : (
        <CargoMixView mix={mix} />
      )}

      <PanelNote measure={measure} table="mar_go_qm" />
    </section>
  );
}

function ViewButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-caption rounded-lg transition-colors ${
        active ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

const MIX_COLORS = ['bg-cyan-500', 'bg-teal-500', 'bg-emerald-600', 'bg-slate-400', 'bg-slate-500', 'bg-slate-600'];

function CargoMixView({ mix }: { mix: CargoMix }) {
  const total = mix.categories.reduce((s, c) => s + c.weight, 0);
  const max = Math.max(...mix.categories.map(c => c.weight), 1);

  return (
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-title font-semibold text-white font-mono">
          {mix.total !== null ? formatMeasure(mix.total, 'THS_T') : formatMeasure(total, 'THS_T')}
        </span>
        <span className="text-caption text-slate-500">across {mix.categories.length} cargo types</span>
      </div>
      <p className="text-caption text-slate-500 mb-3">
        national total{mix.period ? ` · ${formatPeriod(mix.period)}` : ''}
      </p>

      <div className="space-y-2">
        {mix.categories.map((c, idx) => {
          const share = total > 0 ? ((c.weight / total) * 100).toFixed(1) : '0.0';
          return (
            <div key={c.code}>
              <div className="flex items-center justify-between text-caption mb-0.5">
                <span className="text-slate-200 truncate max-w-[55%]" title={c.name}>{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{share}%</span>
                  <span className="text-white font-mono w-16 text-right">
                    {formatMeasure(c.weight, 'THS_T')}
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-slate-800/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${MIX_COLORS[Math.min(idx, MIX_COLORS.length - 1)]}`}
                  style={{ width: `${Math.max((c.weight / max) * 100, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
