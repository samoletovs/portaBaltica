import { useState } from 'react';
import type { PortMeasure, CargoMix } from '../types';
import { formatPeriod } from '../dataFreshness';
import { formatMeasure } from '../portStats';
import { PanelEmpty, MeasureHeadline, PortBars, PanelNote, DormantPorts } from './PortPanelParts';
import { list } from '../utils/payload';

/**
 * Gross weight of goods handled, by port and by cargo type.
 *
 * The type breakdown reads only the six categories that partition the total.
 * Eurostat's `cargo` dimension interleaves levels — `LBK` is liquid bulk and
 * `LBK_ROIL` is refined oil *inside* it — so charting the dimension as
 * delivered double-counts every tonne.
 *
 * Estonia publishes no breakdown at all. `mar_go_qm_ee` carries exactly one
 * cargo code, `TOTAL`, against Latvia's 36 and Lithuania's 38: Estonia reports
 * only aggregate tonnage under the EU maritime statistics regulation. The
 * toggle is therefore hidden — offering a view that renders empty is worse than
 * not offering it — but hiding it *silently* was its own small dishonesty, and
 * one the design book already had on its list: an Estonian reader saw a panel
 * that simply lacked a control their Latvian counterpart had, with no way to
 * tell a settled fact about the source from a chart that had broken. So the
 * absence is now stated, and stated differently from a fetch that failed.
 */
export function CargoPanel({ measure, mix }: { measure: PortMeasure; mix: CargoMix }) {
  const [view, setView] = useState<'port' | 'type'>('port');
  const title = 'Port Cargo';

  const hasPorts = list(measure?.ports).length > 0 && measure.latest !== null;
  const categories = list<CargoMix['categories'][number]>(mix?.categories);
  const hasMix = categories.length > 0;
  // Older cached responses predate the field; an empty mix without one is the
  // case this used to conflate, so treat it as unknown rather than assert.
  const breakdown = mix?.breakdown ?? (hasMix ? 'published' : undefined);

  if (!hasPorts && !hasMix) {
    return (
      <PanelEmpty
        title={title}
        reason={
          breakdown === 'unavailable'
            ? 'Cargo volumes could not be loaded from Eurostat just now.'
            : 'No cargo volumes reported for these ports.'
        }
      />
    );
  }

  const showing = !hasMix ? 'port' : !hasPorts ? 'type' : view;

  return (
    <section className="dash-card border dash-edge rounded-xl p-6">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-callout font-semibold dash-fg">{title}</h3>
        {hasPorts && hasMix && (
          <div className="flex gap-1 dash-raised rounded-lg p-0.5">
            <ViewButton label="By port" active={showing === 'port'} onClick={() => setView('port')} />
            <ViewButton label="By type" active={showing === 'type'} onClick={() => setView('type')} />
          </div>
        )}
      </div>

      {showing === 'port' ? (
        <>
          <MeasureHeadline measure={measure} />
          <PortBars measure={measure} />
          <DormantPorts measure={measure} />
        </>
      ) : (
        <CargoMixView mix={mix} categories={categories} />
      )}

      {breakdown === 'unpublished' && (
        <p className="text-caption mt-2" style={{ color: 'var(--data-warning)' }}>
          Eurostat publishes no cargo-type breakdown for this country — its table reports a single
          total and no categories — so there is no split by cargo type to show.
        </p>
      )}
      {breakdown === 'unavailable' && hasPorts && (
        <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
          The cargo-type breakdown could not be loaded just now.
        </p>
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
        active ? 'dash-input dash-fg' : 'dash-muted dash-hover-fg'
      }`}
    >
      {label}
    </button>
  );
}

/** Cargo types take the same ranked ramp as the port bars. */
const MIX_TOKENS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5'];

/**
 * The cargo-type breakdown.
 *
 * It takes the validated categories as a prop rather than re-reading
 * `mix.categories`. The caller has already established the array is real and
 * non-empty, and re-deriving it here meant a reader — and any tooling — had to
 * find a guard several lines away in another component to know this was safe.
 * Passing it in makes the safety local.
 */
function CargoMixView({ mix, categories }: { mix: CargoMix; categories: CargoMix['categories'] }) {
  const total = categories.reduce((s, c) => s + c.weight, 0);
  const max = Math.max(...categories.map(c => c.weight), 1);

  return (
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-title font-semibold dash-fg font-mono">
          {mix.total !== null ? formatMeasure(mix.total, 'THS_T') : formatMeasure(total, 'THS_T')}
        </span>
        <span className="text-caption dash-subtle">across {categories.length} cargo types</span>
      </div>
      <p className="text-caption dash-subtle mb-3">
        national total{mix.period ? ` · ${formatPeriod(mix.period)}` : ''}
      </p>

      <div className="space-y-2">
        {categories.map((c, idx) => {
          const share = total > 0 ? ((c.weight / total) * 100).toFixed(1) : '0.0';
          return (
            <div key={c.code}>
              <div className="flex items-center justify-between text-caption mb-0.5">
                <span className="dash-body truncate max-w-[55%]" title={c.name}>{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="dash-muted">{share}%</span>
                  <span className="dash-fg font-mono w-16 text-right">
                    {formatMeasure(c.weight, 'THS_T')}
                  </span>
                </div>
              </div>
              <div className="h-2.5 dash-raised rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max((c.weight / max) * 100, 1)}%`,
                    background: `var(${MIX_TOKENS[Math.min(idx, MIX_TOKENS.length - 1)]})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
