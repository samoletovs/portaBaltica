import type { EconomyData } from '../types';

interface EconomyTileProps {
  data: EconomyData | null;
  loading: boolean;
}

export function EconomyTile({ data, loading }: EconomyTileProps) {
  if (loading) return <TileSkeleton title="Economy & Business" />;
  if (!data) return null;

  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-ocean-400">📊</span> Economy & Business
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Electricity price */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <p className="text-xs text-ocean-400 mb-1">Electricity Price (Latvia)</p>
          <p className="text-3xl font-bold text-white font-mono">
            €{data.electricityCurrent.toFixed(2)}
            <span className="text-sm font-normal text-ocean-400 ml-1">/MWh</span>
          </p>
          {data.electricityPrices.length > 0 && (
            <div className="mt-3 flex items-end gap-px h-10">
              {data.electricityPrices.map((p, i) => {
                const max = Math.max(...data.electricityPrices.map((x) => x.price), 1);
                const pct = (p.price / max) * 100;
                const hour = new Date(p.timestamp).getHours();
                const currentHour = new Date().getHours();
                const isCurrent = hour === currentHour;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm min-w-0 ${isCurrent ? 'bg-yellow-400' : 'bg-ocean-500/60'}`}
                    style={{ height: `${Math.max(pct, 4)}%` }}
                    title={`${hour}:00 — €${p.price.toFixed(2)}/MWh`}
                  />
                );
              })}
            </div>
          )}
          <p className="text-xs text-ocean-500 mt-1">Hourly day-ahead spot prices · NordPool via Elering</p>
        </div>

        {/* Exchange rates */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <p className="text-xs text-ocean-400 mb-2">Exchange Rates (ECB)</p>
          <div className="space-y-1.5">
            {data.exchangeRates.slice(0, 6).map((rate) => (
              <div key={rate.currency} className="flex items-center justify-between">
                <span className="text-sm text-ocean-300">EUR/{rate.currency}</span>
                <span className="text-sm font-mono text-white font-medium">{rate.rate.toFixed(4)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-ocean-500 mt-2">Official ECB rates via Latvijas Banka</p>
        </div>

        {/* Economic indicators */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <p className="text-xs text-ocean-400 mb-2">Key Indicators (CSP)</p>
          <div className="grid grid-cols-2 gap-3">
            {data.indicators.map((ind) => (
              <div key={ind.label} className="text-center">
                <p className="text-lg font-bold text-white">{ind.value}</p>
                <p className="text-xs text-ocean-400">{ind.label}</p>
                {ind.change && (
                  <p className={`text-xs font-mono ${ind.change.startsWith('+') ? 'text-emerald-400' : ind.change.startsWith('-') ? 'text-red-400' : 'text-ocean-400'}`}>
                    {ind.change}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-ocean-500 mt-2">Latvia Central Statistical Bureau</p>
        </div>

        {/* Business pulse */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <p className="text-xs text-ocean-400 mb-2">Business Pulse</p>
          <div className="space-y-3">
            <div>
              <p className="text-2xl font-bold text-white font-mono">
                {data.businessPulse.newVatRegistrations.toLocaleString()}
              </p>
              <p className="text-xs text-ocean-400">VAT-registered businesses</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-400 font-mono">
                {data.businessPulse.suspendedBusinesses.toLocaleString()}
              </p>
              <p className="text-xs text-ocean-400">Suspended businesses</p>
            </div>
          </div>
          <p className="text-xs text-ocean-500 mt-2">State Revenue Service (VID) via data.gov.lv</p>
        </div>
      </div>
    </section>
  );
}

function TileSkeleton({ title }: { title: string }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-ocean-400">📊</span> {title}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-ocean-900/40 border border-ocean-700/30 rounded-2xl p-5 animate-pulse">
            <div className="h-3 bg-ocean-700/40 rounded w-1/3 mb-3" />
            <div className="h-8 bg-ocean-700/40 rounded w-1/2 mb-2" />
            <div className="h-2 bg-ocean-700/40 rounded w-2/3" />
          </div>
        ))}
      </div>
    </section>
  );
}
