import type { CargoData } from '../types';

interface CargoPanelProps {
  data: CargoData[];
}

const PORT_NAMES: Record<string, string> = {
  LVRIX: 'Riga',
  LVVNT: 'Ventspils',
  LVLPX: 'Liepāja',
};

export function CargoPanel({ data }: CargoPanelProps) {
  if (data.length === 0) {
    return (
      <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">📦 Port Cargo</h3>
        <p className="text-ocean-400 text-sm">No cargo data available. Published biweekly by the Ministry of Transport.</p>
      </section>
    );
  }

  // Group by port and direction
  const byPort = data.reduce<Record<string, { imports: CargoData[]; exports: CargoData[] }>>((acc, d) => {
    const key = d.portCode;
    if (!acc[key]) acc[key] = { imports: [], exports: [] };
    if (d.direction === 'IN') acc[key].imports.push(d);
    else acc[key].exports.push(d);
    return acc;
  }, {});

  const totalGroups = data.length;
  const importCount = data.filter(d => d.direction === 'IN').length;
  const exportCount = data.filter(d => d.direction === 'OUT').length;

  return (
    <section className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-2">📦 Port Cargo</h3>
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
                {imports.slice(0, 8).map((c, i) => (
                  <span key={i} className="inline-block bg-emerald-900/40 text-emerald-300 text-xs px-2 py-0.5 rounded-full border border-emerald-700/30">
                    {truncateCargoName(c.cargoGroupName)}
                  </span>
                ))}
                {imports.length > 8 && (
                  <span className="text-xs text-ocean-500">+{imports.length - 8} more</span>
                )}
              </div>
            </div>
          )}

          {exports.length > 0 && (
            <div>
              <p className="text-xs text-orange-400 mb-1">↑ Exports</p>
              <div className="flex flex-wrap gap-1">
                {exports.slice(0, 8).map((c, i) => (
                  <span key={i} className="inline-block bg-orange-900/40 text-orange-300 text-xs px-2 py-0.5 rounded-full border border-orange-700/30">
                    {truncateCargoName(c.cargoGroupName)}
                  </span>
                ))}
                {exports.length > 8 && (
                  <span className="text-xs text-ocean-500">+{exports.length - 8} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-ocean-500 mt-3">{totalGroups} cargo groups across {Object.keys(byPort).length} ports ({data[0]?.year})</p>
    </section>
  );
}

function truncateCargoName(name: string): string {
  // Shorten long cargo group names
  if (name.length <= 25) return name;
  const semi = name.indexOf(';');
  if (semi > 0 && semi < 30) return name.slice(0, semi);
  return name.slice(0, 23) + '…';
}
