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

type ViewMode = 'turnover' | 'categories';

export function CargoPanel({ data, turnover }: CargoPanelProps) {
  const [view, setView] = useState<ViewMode>('turnover');

  if (data.length === 0 && turnover.length === 0) {
    return (
      <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">📦 Port Cargo</h3>
        <p className="text-ocean-400 text-sm">No cargo data available.</p>
      </section>
    );
  }

  return (
    <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">📦 Port Cargo</h3>
        <div className="flex gap-1 bg-ocean-800/60 rounded-lg p-0.5">
          <button
            onClick={() => setView('turnover')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'turnover' ? 'bg-ocean-600 text-white' : 'text-ocean-400 hover:text-ocean-200'}`}
          >
            Tonnage
          </button>
          <button
            onClick={() => setView('categories')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'categories' ? 'bg-ocean-600 text-white' : 'text-ocean-400 hover:text-ocean-200'}`}
          >
            Categories
          </button>
        </div>
      </div>

      {view === 'turnover' ? (
        <TurnoverChart turnover={turnover} />
      ) : (
        <CategoriesView data={data} />
      )}
    </section>
  );
}

function TurnoverChart({ turnover }: { turnover: CargoTurnover[] }) {
  if (turnover.length === 0) {
    return <p className="text-ocean-400 text-sm">No tonnage data available.</p>;
  }

  // Aggregate by cargo type code
  const byType = turnover.reduce<Record<string, number>>((acc, t) => {
    acc[t.cargoTypeCode] = (acc[t.cargoTypeCode] || 0) + t.weight;
    return acc;
  }, {});

  // Sort by weight descending
  const sorted = Object.entries(byType)
    .map(([code, weight]) => ({
      code,
      name: CARGO_TYPE_NAMES[code] || `Type ${code}`,
      weight,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = sorted[0]?.weight || 1;
  const totalWeight = sorted.reduce((s, t) => s + t.weight, 0);

  // Color gradient based on position
  const barColors = [
    'bg-ocean-400', 'bg-ocean-400', 'bg-ocean-500',
    'bg-cyan-500', 'bg-cyan-500', 'bg-teal-500',
    'bg-teal-500', 'bg-emerald-600', 'bg-emerald-600',
    'bg-green-600',
  ];

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xl font-bold text-white font-mono">
          {formatWeight(totalWeight)}
        </span>
        <span className="text-sm text-ocean-400">total tonnes</span>
      </div>

      <div className="space-y-2">
        {sorted.map((item, idx) => {
          const pct = (item.weight / maxWeight) * 100;
          const share = ((item.weight / totalWeight) * 100).toFixed(1);
          return (
            <div key={item.code}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-ocean-200 truncate max-w-[60%]" title={item.name}>
                  {item.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-ocean-400">{share}%</span>
                  <span className="text-white font-mono font-medium w-16 text-right">
                    {formatWeight(item.weight)}
                  </span>
                </div>
              </div>
              <div className="h-3 bg-ocean-800/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColors[Math.min(idx, barColors.length - 1)]}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-ocean-500 mt-4">
        {sorted.length} cargo categories · Latest biweekly snapshot
      </p>
    </div>
  );
}

function CategoriesView({ data }: { data: CargoData[] }) {
  // Group by port and direction
  const byPort = data.reduce<Record<string, { imports: CargoData[]; exports: CargoData[] }>>((acc, d) => {
    const key = d.portCode;
    if (!acc[key]) acc[key] = { imports: [], exports: [] };
    if (d.direction === 'IN') acc[key].imports.push(d);
    else acc[key].exports.push(d);
    return acc;
  }, {});

  const importCount = data.filter(d => d.direction === 'IN').length;
  const exportCount = data.filter(d => d.direction === 'OUT').length;

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <div className="text-sm">
          <span className="text-emerald-400 font-bold">{importCount}</span>
          <span className="text-ocean-400"> import groups</span>
        </div>
        <div className="text-sm">
          <span className="text-orange-400 font-bold">{exportCount}</span>
          <span className="text-ocean-400"> export groups</span>
        </div>
      </div>

      {Object.entries(byPort).map(([portCode, { imports, exports }]) => (
        <div key={portCode} className="mb-4 last:mb-0">
          <h4 className="text-sm font-semibold text-ocean-200 mb-2">
            {PORT_NAMES[portCode] ?? portCode}
          </h4>

          {imports.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-emerald-400 mb-1">↓ Imports</p>
              <div className="flex flex-wrap gap-1">
                {imports.map((c, i) => (
                  <span key={i} className="inline-block bg-emerald-900/40 text-emerald-300 text-xs px-2 py-0.5 rounded-full border border-emerald-700/30" title={c.cargoGroupName}>
                    {truncate(c.cargoGroupName, 22)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {exports.length > 0 && (
            <div>
              <p className="text-xs text-orange-400 mb-1">↑ Exports</p>
              <div className="flex flex-wrap gap-1">
                {exports.map((c, i) => (
                  <span key={i} className="inline-block bg-orange-900/40 text-orange-300 text-xs px-2 py-0.5 rounded-full border border-orange-700/30" title={c.cargoGroupName}>
                    {truncate(c.cargoGroupName, 22)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-ocean-500 mt-3">
        {data.length} cargo groups across {Object.keys(byPort).length} port{Object.keys(byPort).length > 1 ? 's' : ''} ({data[0]?.year})
      </p>
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
