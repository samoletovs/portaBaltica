import type { PortWeather, MarineWeatherForecast, ShipVisit, FerryData, CargoData, CargoTurnover } from '../types';
import { PORTS } from '../types';
import { PortCard } from './PortCard';
import { ShipVisitsPanel } from './ShipVisitsPanel';
import { FerryPanel } from './FerryPanel';
import { CargoPanel } from './CargoPanel';
import { useCountry } from '../CountryContext';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

interface MaritimeTileProps {
  portData: PortWeatherData[];
  shipVisits: ShipVisit[];
  ferryData: FerryData[];
  cargoData: CargoData[];
  cargoTurnover: CargoTurnover[];
  loading: boolean;
}

export function MaritimeTile({ portData, shipVisits, ferryData, cargoData, cargoTurnover, loading }: MaritimeTileProps) {
  const { country } = useCountry();
  if (loading) return <TileSkeleton />;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Maritime</h2>
      {country !== 'LV' && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
          🇱🇻 This section shows Latvia ports only (Riga, Ventspils, Liepāja). Baltic port expansion planned.
        </div>
      )}

      {/* Port overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {portData.map(({ port, marine, weather }) => (
          <PortCard key={port.code} port={port} marine={marine} weather={weather} />
        ))}
      </div>

      {/* Ship visits, ferry & cargo data */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ShipVisitsPanel visits={shipVisits} />
        <FerryPanel data={ferryData} />
        <CargoPanel data={cargoData} turnover={cargoTurnover} />
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-slate-400">⚓</span> Maritime
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 animate-pulse">
            <div className="h-5 bg-slate-700/30 rounded w-1/3 mb-4" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-12 bg-slate-700/30 rounded-lg" />
              ))}
            </div>
            <div className="h-12 bg-slate-700/30 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}
