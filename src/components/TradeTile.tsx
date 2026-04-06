import { IndicatorCard } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';

export function TradeTile() {
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Trade & tourism</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Latvia · CSP data</span>
      </div>

      {/* Trade indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="exports" title="Exports" unit="M EUR" />
        <IndicatorCard id="imports" title="Imports" unit="M EUR" />
        <IndicatorCard id="hotel_occupancy" title="Hotel occupancy" unit="%" />
        <IndicatorCard id="tourist_arrivals" title="Tourist arrivals" unit="thousands" />
      </div>

      {/* Baltic comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalticCompareChart indicator="gdp" title="Trade balance trend" compact />
      </div>
    </section>
  );
}
