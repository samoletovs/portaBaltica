import type { PortWeather, MarineWeatherForecast, ShipVisit, FerryData, CargoData, CargoTurnover } from '../types';
import { PORTS } from '../types';
import { PortCard } from './PortCard';
import { ShipVisitsPanel } from './ShipVisitsPanel';
import { FerryPanel } from './FerryPanel';
import { CargoPanel } from './CargoPanel';

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
  if (loading) return <TileSkeleton />;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Maritime</h2>

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
        <span className="text-ocean-400">⚓</span> Maritime
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-ocean-900/40 border border-ocean-700/30 rounded-2xl p-6 animate-pulse">
            <div className="h-5 bg-ocean-700/40 rounded w-1/3 mb-4" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-12 bg-ocean-700/40 rounded-lg" />
              ))}
            </div>
            <div className="h-12 bg-ocean-700/40 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}
