import { IndicatorCard }
from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { FreightModalSplit } from './FreightModalSplit';

export function TradeTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="balance-text text-title font-semibold" style={{ color: 'var(--text-primary)' }}>Trade & tourism</h2>
        <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · Eurostat</span>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalticCompareChart indicator="exports" title="Exports of goods" compact />
        <BalticCompareChart indicator="imports" title="Imports of goods" compact />
        <BalticCompareChart indicator="trade_balance" title="Trade balance" compact />
        {/* Replaces the goods-balance and services-balance charts. Those were
            two of five balance-of-payments series on one tile saying versions
            of the same thing; this says something none of them did, and
            something most readers would guess the wrong way round. */}
        <FreightModalSplit compact />
        <BalticCompareChart indicator="transport_services" title="Transport services balance" compact />
        <BalticCompareChart indicator="financial_services" title="Financial services balance" compact />
        <BalticCompareChart indicator="tourism_foreign" title="Nights spent by foreign visitors" compact />
        <BalticCompareChart indicator="tourism" title="Tourist arrivals" compact />
        <BalticCompareChart indicator="air_passengers" title="Air passengers carried" compact />
      </div>
    </section>
  );
}
