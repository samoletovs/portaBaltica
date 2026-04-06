import { useState } from 'react';
import type { CargoData, CargoTurnover } from '../types';
import { CARGO_TYPE_NAMES } from '../types';

interface CargoPanelProps {
  data: CargoData[];
  turnover: CargoTurnover[];
}

const PORT_NAMES: Record<string, string> = {
  LVRIX: 'Riga',
  LVVNT: 'Ventspils',
  LVLPX: 'Liepāja',
};

const DEFAULT_SHOW = 10;

export function CargoPanel({ data, turnover }: CargoPanelProps) {
  const [selectedPort, setSelectedPort] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

  if (data.length === 0 && turnover.length === 0) {
    return (
      <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">📦 Port Cargo</h3>
        <p className="text-slate-400 text-sm">No cargo data available.</p>
      </section>
    );
  }

  const ports = [...new Set(data.map(d => d.portCode))].filter(Boolean);
  const year = data[0]?.year || '';
  const filteredData = selectedPort === 'all' ? data : data.filter(d => d.portCode === selectedPort);

  return (
    <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white">📦 Port Cargo</h3>
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5">
          <button
            onClick={() => { setSelectedPort('all'); setShowAll(false); }}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${selectedPort === 'all' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            All Ports
          </button>
          {ports.map(p => (
            <button
              key={p}
              onClick={() => { setSelectedPort(p); setShowAll(false); }}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${selectedPort === p ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {PORT_NAMES[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {selectedPort === 'all' ? (
        <TonnageView turnover={turnover} showAll={showAll} onToggle={() => setShowAll(!showAll)} year={year} />
      ) : (
        <PortDetailView data={filteredData} portName={PORT_NAMES[selectedPort] ?? selectedPort} showAll={showAll} onToggle={() => setShowAll(!showAll)} year={year} />
      )}
    </section>
  );
}

/* ── All Ports: aggregate tonnage bar chart ── */

function TonnageView({ turnover, showAll, onToggle, year }: { turnover: CargoTurnover[]; showAll: boolean; onToggle: () => void; year: string }) {
  if (turnover.length === 0) return <p className="text-slate-400 text-sm">No tonnage data available.</p>;

  const byType = turnover.reduce<Record<string, number>>((acc, t) => {
    acc[t.cargoTypeCode] = (acc[t.cargoTypeCode] || 0) + t.weight;
    return acc;
  }, {});

  const sorted = Object.entries(byType)
    .map(([code, weight]) => ({ code, name: CARGO_TYPE_NAMES[code] || `Type ${code}`, weight }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = sorted[0]?.weight || 1;
  const totalWeight = sorted.reduce((s, t) => s + t.weight, 0);
  const display = showAll ? sorted : sorted.slice(0, DEFAULT_SHOW);
  const hiddenCount = sorted.length - DEFAULT_SHOW;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold text-white font-mono">{fmt(totalWeight)}</span>
        <span className="text-sm text-slate-400">total tonnes</span>
        <span className="text-xs text-slate-500">({sorted.length} categories)</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Imports + Exports combined · All Latvian ports · Biweekly{year ? ` (${year})` : ''}</p>

      <div className="space-y-1.5">
        {display.map((item, idx) => (
          <Bar key={item.code} name={item.name} weight={item.weight} maxWeight={maxWeight} totalWeight={totalWeight} idx={idx} />
        ))}
      </div>

      {hiddenCount > 0 && (
        <button onClick={onToggle} className="mt-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          {showAll ? '▲ Show top 10' : `▼ Show all ${sorted.length} categories (+${hiddenCount} more)`}
        </button>
      )}
    </div>
  );
}

/* ── Per-Port: import/export cargo list ── */

function PortDetailView({ data, portName, showAll, onToggle, year }: {
  data: CargoData[]; portName: string; showAll: boolean; onToggle: () => void; year: string;
}) {
  const imports = data.filter(d => d.direction === 'IN');
  const exports = data.filter(d => d.direction === 'OUT');

  // Merge into a single sorted list: each item has direction + name
  const allItems = [
    ...imports.map(d => ({ ...d, dir: 'IN' as const })),
    ...exports.map(d => ({ ...d, dir: 'OUT' as const })),
  ];

  const display = showAll ? allItems : allItems.slice(0, DEFAULT_SHOW);
  const hiddenCount = allItems.length - DEFAULT_SHOW;

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-xl font-bold text-white">{portName}</span>
        <span className="text-emerald-400 text-sm font-medium">↓ {imports.length} imports</span>
        <span className="text-orange-400 text-sm font-medium">↑ {exports.length} exports</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Cargo categories handled at this port{year ? ` · ${year}` : ''}</p>

      <div className="space-y-0.5">
        {display.map((item, i) => (
          <div key={i} className="flex items-center gap-2 py-1 border-b border-slate-800/20 last:border-0">
            <span className={`text-xs font-bold w-5 ${item.dir === 'IN' ? 'text-emerald-400' : 'text-orange-400'}`}>
              {item.dir === 'IN' ? '↓' : '↑'}
            </span>
            <span className="text-sm text-slate-200 flex-1" title={item.cargoGroupName}>
              {truncate(item.cargoGroupName, 45)}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${item.dir === 'IN' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-orange-900/30 text-orange-400'}`}>
              {item.dir === 'IN' ? 'Import' : 'Export'}
            </span>
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button onClick={onToggle} className="mt-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          {showAll ? '▲ Show less' : `▼ Show all ${allItems.length} cargo groups (+${hiddenCount} more)`}
        </button>
      )}
    </div>
  );
}

/* ── Shared bar component ── */

const BAR_COLORS = ['bg-slate-400', 'bg-slate-400', 'bg-slate-500', 'bg-cyan-500', 'bg-cyan-500', 'bg-teal-500', 'bg-teal-500', 'bg-emerald-600', 'bg-emerald-600', 'bg-green-600'];

function Bar({ name, weight, maxWeight, totalWeight, idx }: { name: string; weight: number; maxWeight: number; totalWeight: number; idx: number }) {
  const pct = (weight / maxWeight) * 100;
  const share = ((weight / totalWeight) * 100).toFixed(1);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-slate-200 truncate max-w-[55%]" title={name}>{name}</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{share}%</span>
          <span className="text-white font-mono font-medium w-14 text-right">{fmt(weight)}</span>
        </div>
      </div>
      <div className="h-2.5 bg-slate-800/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[Math.min(idx, BAR_COLORS.length - 1)]}`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}

function fmt(tonnes: number): string {
  if (tonnes >= 1_000_000) return (tonnes / 1_000_000).toFixed(1) + 'M';
  if (tonnes >= 1_000) return (tonnes / 1_000).toFixed(0) + 'K';
  return tonnes.toFixed(0);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const semi = s.indexOf(';');
  if (semi > 0 && semi < max) return s.slice(0, semi);
  return s.slice(0, max - 1) + '…';
}
