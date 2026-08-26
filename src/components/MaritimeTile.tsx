import type { PortWeather, MarineWeatherForecast, PortDataResponse } from '../types';
import { PORTS } from '../types';
import { PortCard } from './PortCard';
import { VesselTrafficPanel } from './VesselTrafficPanel';
import { PassengerPanel } from './PassengerPanel';
import { CargoPanel } from './CargoPanel';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { freshnessOf, formatPeriod, periodCoverage } from '../dataFreshness';

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

  // The three maritime tables are published independently and do drift apart —
  // the Europe-wide vessel cube was padded to 2026-Q2 while Latvian goods
  // stopped at 2025-Q4. Heading the tile with the newest of them dates all
  // three panels to a quarter two of them have not reached.
  const coverage = periodCoverage(stats?.dataFrom, stats?.dataAsOf);

  // Staleness is judged on the *oldest* measure, not the newest. Keying it on
  // `dataAsOf` meant one current table could hold the warning off while another
  // panel sat years behind: the reader would be looking at frozen figures under
  // a tile that had decided everything was fine. The oldest bound is the one
  // capable of misleading, so it is the one that decides whether to warn.
  const oldest = stats?.dataFrom ?? stats?.dataAsOf;
  const newest = stats?.dataAsOf;
  const freshness = freshnessOf(oldest);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-6 gap-3 flex-wrap">
        <h2 className="balance-text text-title font-semibold text-white">Maritime</h2>
        {/* The port weather below is live; the statistics are quarterly and
            always in arrears. Saying which is which is the whole point. */}
        {coverage && (
          <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            Port statistics for {coverage.label}{coverage.spans ? ', by measure' : ''}
          </span>
        )}
      </div>

      {freshness?.stale && (
        // `text-amber-300` is not remapped by the theme layer in `index.css` —
        // that layer covers the 400 step and not the 300 — so in light mode
        // this shipped at 1.44:1 against white. A staleness warning nobody can
        // read is worse than none, because the page then looks confident.
        // `--data-warning` is defined per theme and is legible on both.
        <div className="mb-3 px-3 py-2 rounded-lg text-caption bg-amber-400/10 border border-amber-400/20"
          style={{ color: 'var(--data-warning)' }}>
          {coverage?.spans && newest ? (
            // Naming only the oldest would be false about the measures that are
            // current, and naming only the newest is what hid the problem.
            <>
              The oldest figures below are {freshness.label}, at {formatPeriod(freshness.period)};
              the newest reach {formatPeriod(newest)}. Each panel states its own quarter.
              Weather and sea state are live.
            </>
          ) : (
            <>
              Cargo, passenger and vessel figures below are {freshness.label}. Eurostat has
              published nothing newer for {countryLabel} than {formatPeriod(freshness.period)}.
              Weather and sea state are live.
            </>
          )}
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
      <h2 className="balance-text text-title font-semibold text-white mb-6">Maritime</h2>
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
