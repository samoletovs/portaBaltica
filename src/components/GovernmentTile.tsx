import { IndicatorCard }
from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';

export function GovernmentTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Government & fiscal</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · CSP data</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="gov_revenue" title="Government revenue" unit="M EUR" />
        <IndicatorCard id="gov_debt" title="Government debt" unit="M EUR" />
        <IndicatorCard id="biz_confidence" title="Economic sentiment" unit="index" />
        <IndicatorCard id="energy_price_gas" title="Gas price" unit="EUR/GJ" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalticCompareChart indicator="gov_debt_gdp" title="Government debt / GDP" compact />
        <BalticCompareChart indicator="consumer_confidence" title="Consumer confidence" compact />
      </div>
    </section>
  );
}
