import { IndicatorCard } from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { PowerMarketCard } from './PowerMarketCard';
import { GridStatePanel } from './GridStatePanel';
import { TileHeader } from './TileHeader';

export function EnergyTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section>
      <TileHeader title="Energy & infrastructure" meta={`${flag} ${countryLabel} · Eurostat`} />

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <IndicatorCard id="construction_output" title="Construction output" unit="index" />
          <IndicatorCard id="building_permits" title="New building starts" unit="index" />
          <IndicatorCard id="new_vehicles" title="Cars per 1000 residents" unit="per 1000" />
          <IndicatorCard id="renewable_share" title="Renewable energy" unit="%" />
        </div>

        {/* The price and the physical situation that sets it, side by side. The
            dashboard plotted a day-ahead price for months without ever showing
            whether the grid was short. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <PowerMarketCard />
          <GridStatePanel />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="construction" title="Construction output across the Baltics" compact />
          <BalticCompareChart indicator="interest_rate" title="Long-term interest rate" compact />
          <BalticCompareChart indicator="elec_production" title="Electricity production" compact />
          <BalticCompareChart indicator="elec_renewable_gen" title="Renewable electricity generated" compact />
          <BalticCompareChart indicator="elec_price_household" title="Electricity price (households)" compact />
          <BalticCompareChart indicator="elec_price_industry" title="Electricity price (industry)" compact />
          <BalticCompareChart indicator="renewables" title="Renewable energy share" compact />
          <BalticCompareChart indicator="home_energy_inflation" title="Home energy inflation" compact />
          <BalticCompareChart indicator="admin_prices" title="Administered prices" compact />
          <BalticCompareChart indicator="ghg_emissions" title="Greenhouse gas emissions" compact />
        </div>
      </div>
    </section>
  );
}