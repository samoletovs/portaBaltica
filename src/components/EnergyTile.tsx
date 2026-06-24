import { IndicatorCard }
from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';

export function EnergyTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Energy & infrastructure</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · Eurostat</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="construction_output" title="Construction output" unit="index" />
        <IndicatorCard id="building_permits" title="New building starts" unit="index" />
        <IndicatorCard id="new_vehicles" title="Cars per 1000 residents" unit="per 1000" />
        <IndicatorCard id="renewable_share" title="Renewable energy" unit="%" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalticCompareChart indicator="construction" title="Construction output" compact />
        <BalticCompareChart indicator="interest_rate" title="Long-term interest rate" compact />
        <BalticCompareChart indicator="elec_production" title="Electricity production" compact />
        <BalticCompareChart indicator="elec_price_household" title="Electricity price (households)" compact />
        <BalticCompareChart indicator="renewables" title="Renewable energy share" compact />
      </div>
    </section>
  );
}
