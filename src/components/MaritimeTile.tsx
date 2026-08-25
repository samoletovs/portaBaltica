import type { PortWeather, MarineWeatherForecast, PortDataResponse } from '../types';
import { PORTS } from '../types';
import { PortCard } from './PortCard';
import { VesselTrafficPanel } from './VesselTrafficPanel';
import { PassengerPanel } from './PassengerPanel';
import { CargoPanel } from './CargoPanel';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { freshnessOf, formatPeriod } from '../dataFreshness';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

interface MaritimeTileProps {
  portData: PortWeatherData[];
  /** Eurostat port statistics, or null while loading or after a failure. */
  stats: PortDataResponse | null;
  loading: boolean;
}

export function MaritimeTile({ portData, stats, loading }: MaritimeTileProps) {
  const { country, countryLabel } = useCountry();
  if (loading) return <TileSkeleton />;

  const freshness = freshnessOf(stats?.dataAsOf);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h2 className="balance-text text-title font-semibold text-white">Maritime</h2>
        {/* The port weather below is live; the statistics are quarterly and
            always in arrears. Saying which is which is the whole point. */}
        {freshness && (
          <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            Port statistics for {formatPeriod(freshness.period)}
          </span>
        )}
      </div>

      {freshness?.stale && (
        <div className="mb-3 px-3 py-2 rounded-lg text-caption text-amber-300 bg-amber-400/10 border border-amber-400/20">
          Cargo, passenger and vessel figures below are {freshness.label}. Eurostat has published
          nothing newer for {countryLabel} than {formatPeriod(freshness.period)}. Weather and sea
          state are live.
        </div>
      )}

      {/* Port overview cards — Latvian ports only, because the marine forecast
          is fetched per coordinate and only these three are defined. */}
      {country === 'LV' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {portData.map(({ port, marine, weather }) => (
            <PortCard key={port.code} port={port} marine={marine} weather={weather} />
          ))}
        </div>
      )}

      {stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <VesselTrafficPanel measure={stats.vessels} />
          <PassengerPanel measure={stats.passengers} />
          <CargoPanel measure={stats.goods} mix={stats.cargoMix} />
        </div>
      ) : (
        <div className="px-3 py-2 rounded-lg text-caption text-slate-400 bg-slate-900/50 border border-slate-800/40">
          Port statistics are unavailable right now.
        </div>
      )}

      {/* Baltic trade comparison — available for all 3 countries */}
      <div className="mt-4">
        <BalticCompareChart indicator="trade_balance" title="Trade balance (goods & services)" compact />
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <section>
      <h2 className="balance-text text-title font-semibold text-white mb-5">Maritime</h2>
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
