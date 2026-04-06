import { IndicatorCard }
from './IndicatorCard';
import { useCountry } from '../CountryContext';

export function TradeTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Trade & tourism</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · CSP data</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="exports" title="Exports" unit="M EUR" />
        <IndicatorCard id="imports" title="Imports" unit="M EUR" />
        <IndicatorCard id="trade_balance" title="Trade balance" unit="M EUR" />
        <IndicatorCard id="ppi" title="Producer prices" unit="% YoY" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="hotel_occupancy" title="Hotel occupancy" unit="%" />
        <IndicatorCard id="tourist_arrivals" title="Tourist arrivals" unit="thousands" />
      </div>
    </section>
  );
}
