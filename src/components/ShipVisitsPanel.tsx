import { useState } from 'react';
import type { ShipVisit } from '../types';

interface ShipVisitsPanelProps {
  visits: ShipVisit[];
}

function parseShipInfo(ship: string) {
  const parts = ship.split(' / ');
  return {
    imo: parts[0] ?? '',
    mmsi: parts[1] ?? '',
    name: parts[2] ?? ship,
  };
}

export function ShipVisitsPanel({ visits }: ShipVisitsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (visits.length === 0) {
    return (
      <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-2">🚢 Vessel Activity</h3>
        <p className="text-slate-400 text-sm">No vessel data available. Published biweekly by the Ministry of Transport.</p>
      </section>
    );
  }

  // Deduplicate by ship name + port, keep latest
  const uniqueVisits = deduplicateVisits(visits);

  // Group by port
  const byPort = uniqueVisits.reduce<Record<string, ShipVisit[]>>((acc, v) => {
    const key = v.portName || v.portCode;
    if (!acc[key]) acc[key] = [];
    acc[key].push(v);
    return acc;
  }, {});

  // Date range
  const dates = visits.map(v => v.snapshotDate).filter((d): d is string => Boolean(d)).sort();
  const dateRange = dates.length > 0
    ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`
    : '';

  return (
    <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-1">🚢 Vessel Activity</h3>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block bg-amber-900/40 text-amber-300 text-xs px-2 py-0.5 rounded-full border border-amber-700/30">
          Cancelled & Rejected Only
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Vessels whose port visits were cancelled or rejected. Source: SKLOIS (Latvia Maritime Single Window).
        {dateRange && <> Period: <span className="text-slate-300">{dateRange}</span></>}
      </p>
      <p className="text-xs text-slate-500 mb-3">
        Note: actual arrivals/departures are not available as open data — SKLOIS only publishes cancellations.
      </p>

      {Object.entries(byPort).map(([portName, portVisits]) => {
        const showCount = expanded ? portVisits.length : Math.min(portVisits.length, 5);
        return (
          <div key={portName} className="mb-4 last:mb-0">
            <h4 className="text-sm font-semibold text-slate-200 mb-2">{portName}</h4>
            <div className="space-y-1">
              {portVisits.slice(0, showCount).map((v, i) => {
                const ship = parseShipInfo(v.ship);
                return (
                  <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-slate-800/30 last:border-0">
                    <span className="text-amber-400 text-xs">✕</span>
                    <span className="text-white font-medium truncate flex-1">{ship.name}</span>
                    <span className="text-slate-400 font-mono text-xs">{ship.imo}</span>
                    <span className="text-slate-500 text-xs whitespace-nowrap">
                      {v.visitDate ? new Date(v.visitDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {uniqueVisits.length > 10 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          {expanded ? '▲ Show less' : `▼ Show all ${uniqueVisits.length} vessels`}
        </button>
      )}

      <p className="text-xs text-slate-600 mt-3">{uniqueVisits.length} unique vessels across {Object.keys(byPort).length} ports</p>
    </section>
  );
}

function deduplicateVisits(visits: ShipVisit[]): ShipVisit[] {
  const map = new Map<string, ShipVisit>();
  for (const v of visits) {
    const key = `${v.portCode}-${v.ship}`;
    const existing = map.get(key);
    if (!existing || (v.visitDate && (!existing.visitDate || v.visitDate > existing.visitDate))) {
      map.set(key, v);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.visitDate ?? '').localeCompare(a.visitDate ?? ''));
}

function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' });
}
