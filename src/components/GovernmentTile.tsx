import { IndicatorCard } from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { RankedComparison } from './RankedComparison';
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
          <BalticCompareChart indicator="gov_deficit" title="Government deficit/surplus" compact />
          <BalticCompareChart indicator="consumer_confidence" title="Consumer confidence" compact />
          <BalticCompareChart indicator="current_account" title="Current account balance" compact />
          {/* Annual series of four or five points, grouped at the end so the two
              shapes do not interleave. Which end is "best" is declared per
              indicator, not inferred: the polarity registry keys on the card ids
              (`gov_debt`, not `gov_debt_gdp`), so all three resolve to neutral
              there and inference would rank the worst performer top. Debt and
              Gini rank lowest first; R&D highest. */}
          <RankedComparison indicator="gov_debt_gdp" title="Government debt / GDP" higherIsBetter={false} />
          <RankedComparison indicator="inequality" title="Income inequality (Gini)" higherIsBetter={false} />
          <RankedComparison indicator="rd_spending" title="R&D expenditure" higherIsBetter />
        </div>
      </div>
    </section>
  );
}