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
  if (visits.length === 0) {
    return (
      <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">🚢 Recent Ship Visits</h3>
        <p className="text-ocean-400 text-sm">No recent ship visit data available. Data is published biweekly by the Ministry of Transport.</p>
      </section>
    );
  }

  // Group by port
  const byPort = visits.reduce<Record<string, ShipVisit[]>>((acc, v) => {
    const key = v.portName || v.portCode;
    if (!acc[key]) acc[key] = [];
    acc[key].push(v);
    return acc;
  }, {});

  return (
    <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-4">🚢 Recent Ship Visits</h3>
      <p className="text-xs text-ocean-400 mb-4">
        From SKLOIS (Latvia Maritime Single Window) — cancelled and rejected visits data
      </p>

      {Object.entries(byPort).map(([portName, portVisits]) => (
        <div key={portName} className="mb-4 last:mb-0">
          <h4 className="text-sm font-semibold text-ocean-200 mb-2">{portName}</h4>
          <div className="space-y-1">
            {portVisits.slice(0, 10).map((v, i) => {
              const ship = parseShipInfo(v.ship);
              return (
                <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-ocean-800/30 last:border-0">
                  <span className={v.type === 'cancelled' ? 'text-yellow-400' : 'text-red-400'}>
                    {v.type === 'cancelled' ? '⚠' : '✕'}
                  </span>
                  <span className="text-white font-medium truncate flex-1">{ship.name}</span>
                  <span className="text-ocean-400 font-mono text-xs">{ship.imo}</span>
                  <span className="text-ocean-500 text-xs">
                    {v.visitDate ? new Date(v.visitDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
