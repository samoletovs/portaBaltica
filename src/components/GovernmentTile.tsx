import { IndicatorCard } from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { TileHeader } from './TileHeader';

export function GovernmentTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section>
      <TileHeader title="Government & fiscal" meta={`${flag} ${countryLabel} · Eurostat`} />

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <IndicatorCard id="gov_revenue" title="Government revenue" unit="M EUR" />
          <IndicatorCard id="gov_debt" title="Government debt" unit="% GDP" />
          <IndicatorCard id="biz_confidence" title="Economic sentiment" unit="index" />
          <IndicatorCard id="energy_price_gas" title="Gas price" unit="EUR/GJ" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="gov_debt_gdp" title="Government debt / GDP" compact />
          <BalticCompareChart indicator="gov_deficit" title="Government deficit/surplus" compact />
          <BalticCompareChart indicator="consumer_confidence" title="Consumer confidence" compact />
          <BalticCompareChart indicator="current_account" title="Current account balance" compact />
          <BalticCompareChart indicator="inequality" title="Income inequality (Gini)" compact />
          <BalticCompareChart indicator="rd_spending" title="R&D expenditure" compact />
        </div>
      </div>
    </section>
  );
}