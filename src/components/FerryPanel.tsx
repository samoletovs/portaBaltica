import type { FerryData } from '../types';

interface FerryPanelProps {
  data: FerryData[];
}

export function FerryPanel({ data }: FerryPanelProps) {
  if (data.length === 0) {
    return (
      <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">🛳️ Ferry Traffic</h3>
        <p className="text-slate-400 text-sm">No recent ferry data available. Published biweekly by the Ministry of Transport.</p>
      </section>
    );
  }

  const totalPassengers = data.reduce((sum, d) => sum + d.passengers, 0);

  // Group by route
  const byRoute = data.reduce<Record<string, { passengers: number; flag: string; port: string }>>((acc, d) => {
    const key = `${d.portCode} ↔ ${d.previousNextPort}`;
    if (!acc[key]) acc[key] = { passengers: 0, flag: d.flagName, port: d.portCode };
    acc[key].passengers += d.passengers;
    return acc;
  }, {});

  return (
    <section className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-2">🛳️ Ferry Traffic</h3>
      <p className="text-2xl font-bold text-slate-300 mb-4">
        {totalPassengers.toLocaleString()} <span className="text-sm font-normal text-slate-400">passengers (latest period)</span>
      </p>

      <div className="space-y-2">
        {Object.entries(byRoute)
          .sort(([, a], [, b]) => b.passengers - a.passengers)
          .map(([route, info]) => {
            const pct = (info.passengers / totalPassengers) * 100;
            return (
              <div key={route}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-200">{route}</span>
                  <span className="text-white font-mono">{info.passengers.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-slate-800/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-400 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Flag: {info.flag}</p>
              </div>
            );
          })}
      </div>
    </section>
  );
}
