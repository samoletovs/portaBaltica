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
      <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">📦 Port Cargo</h3>
        <p className="text-ocean-400 text-sm">No cargo data available.</p>
      </section>
    );
  }

  // Get unique ports from the per-port cargo data
  const ports = [...new Set(data.map(d => d.portCode))].filter(Boolean);
  const year = data[0]?.year || '';

  // Filter per-port data by selected port
  const filteredData = selectedPort === 'all' ? data : data.filter(d => d.portCode === selectedPort);
  const importCount = filteredData.filter(d => d.direction === 'IN').length;
  const exportCount = filteredData.filter(d => d.direction === 'OUT').length;

  return (
    <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white">📦 Port Cargo</h3>
        {/* Port filter */}
        <div className="flex gap-1 bg-ocean-800/60 rounded-lg p-0.5">
          <button
            onClick={() => { setSelectedPort('all'); setShowAll(false); }}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${selectedPort === 'all' ? 'bg-ocean-600 text-white' : 'text-ocean-400 hover:text-ocean-200'}`}
          >
            All
          </button>
          {ports.map(p => (
            <button
              key={p}
              onClick={() => { setSelectedPort(p); setShowAll(false); }}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${selectedPort === p ? 'bg-ocean-600 text-white' : 'text-ocean-400 hover:text-ocean-200'}`}
            >
              {PORT_NAMES[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {/* Tonnage chart (all ports aggregate — CKAN data doesn't break down by port) */}
      {selectedPort === 'all' && turnover.length > 0 && (
        <TonnageChart turnover={turnover} showAll={showAll} onToggle={() => setShowAll(!showAll)} />
      )}

      {/* Per-port: show import/export breakdown */}
      {selectedPort !== 'all' && (
        <PortCargoDetail
          data={filteredData}
          portName={PORT_NAMES[selectedPort] ?? selectedPort}
          importCount={importCount}
          exportCount={exportCount}
        />
      )}

      {/* All ports aggregate: show tonnage + summary */}
      {selectedPort === 'all' && turnover.length === 0 && (
        <p className="text-ocean-400 text-sm">No tonnage data available.</p>
      )}

      <p className="text-xs text-ocean-600 mt-3">
        {selectedPort === 'all'
          ? `Aggregate cargo tonnage across all Latvian ports · Biweekly data${year ? ` (${year})` : ''}`
          : `${importCount} import + ${exportCount} export cargo groups${year ? ` · ${year}` : ''}`}
      </p>
    </section>
  );
}

function TonnageChart({ turnover, showAll, onToggle }: { turnover: CargoTurnover[]; showAll: boolean; onToggle: () => void }) {
  // Aggregate by cargo type code
  const byType = turnover.reduce<Record<string, number>>((acc, t) => {
    acc[t.cargoTypeCode] = (acc[t.cargoTypeCode] || 0) + t.weight;
    return acc;
  }, {});

  const sorted = Object.entries(byType)
    .map(([code, weight]) => ({
      code,
      name: CARGO_TYPE_NAMES[code] || `Type ${code}`,
      weight,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = sorted[0]?.weight || 1;
  const totalWeight = sorted.reduce((s, t) => s + t.weight, 0);
  const displayItems = showAll ? sorted : sorted.slice(0, DEFAULT_SHOW);
  const hiddenCount = sorted.length - DEFAULT_SHOW;

  const barColors = [
    'bg-ocean-400', 'bg-ocean-400', 'bg-ocean-500',
    'bg-cyan-500', 'bg-cyan-500', 'bg-teal-500',
    'bg-teal-500', 'bg-emerald-600', 'bg-emerald-600',
    'bg-green-600',
  ];

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold text-white font-mono">
          {formatWeight(totalWeight)}
        </span>
        <span className="text-sm text-ocean-400">total tonnes</span>
        <span className="text-xs text-ocean-500">({sorted.length} categories)</span>
      </div>

      <div className="space-y-1.5">
        {displayItems.map((item, idx) => {
          const pct = (item.weight / maxWeight) * 100;
          const share = ((item.weight / totalWeight) * 100).toFixed(1);
          return (
            <div key={item.code}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-ocean-200 truncate max-w-[55%]" title={item.name}>
                  {item.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-ocean-400">{share}%</span>
                  <span className="text-white font-mono font-medium w-14 text-right">
                    {formatWeight(item.weight)}
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-ocean-800/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColors[Math.min(idx, barColors.length - 1)]}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={onToggle}
          className="mt-2 text-xs text-ocean-400 hover:text-ocean-200 transition-colors"
        >
          {showAll ? '▲ Show top 10' : `▼ Show all ${sorted.length} categories (+${hiddenCount} more)`}
        </button>
      )}
    </div>
  );
}

function PortCargoDetail({ data, portName, importCount, exportCount }: {
  data: CargoData[];
  portName: string;
  importCount: number;
  exportCount: number;
}) {
  const imports = data.filter(d => d.direction === 'IN');
  const exports = data.filter(d => d.direction === 'OUT');

  return (
    <div>
      <div className="flex gap-4 mb-3">
        <div className="text-sm">
          <span className="text-emerald-400 font-bold">{importCount}</span>
          <span className="text-ocean-400"> imports</span>
        </div>
        <div className="text-sm">
          <span className="text-orange-400 font-bold">{exportCount}</span>
          <span className="text-ocean-400"> exports</span>
        </div>
      </div>

      {imports.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-emerald-400 mb-1.5 font-medium">↓ Imports into {portName}</p>
          <div className="flex flex-wrap gap-1">
            {imports.map((c, i) => (
              <span key={i} className="inline-block bg-emerald-900/40 text-emerald-300 text-xs px-2 py-0.5 rounded-full border border-emerald-700/30" title={c.cargoGroupName}>
                {truncate(c.cargoGroupName, 28)}
              </span>
            ))}
          </div>
        </div>
      )}

      {exports.length > 0 && (
        <div>
          <p className="text-xs text-orange-400 mb-1.5 font-medium">↑ Exports from {portName}</p>
          <div className="flex flex-wrap gap-1">
            {exports.map((c, i) => (
              <span key={i} className="inline-block bg-orange-900/40 text-orange-300 text-xs px-2 py-0.5 rounded-full border border-orange-700/30" title={c.cargoGroupName}>
                {truncate(c.cargoGroupName, 28)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatWeight(tonnes: number): string {
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
