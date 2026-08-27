import { IndicatorCard } from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { TileHeader } from './TileHeader';

export function LabourTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section>
      <TileHeader title="Labour market" meta={`${flag} ${countryLabel} · Eurostat`} />

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <IndicatorCard id="salary" title="Hourly labour cost" unit="EUR/hour" />
          <IndicatorCard id="unemployment" title="Unemployment" unit="%" />
          <IndicatorCard id="wages_industry" title="Manufacturing wages" unit="index (2020=100)" />
          <IndicatorCard id="wages_it" title="IT sector wages" unit="index (2020=100)" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="youth_unemployment" title="Youth unemployment (U25)" compact />
          <BalticCompareChart indicator="employment_rate" title="Employment rate (20-64)" compact />
          <BalticCompareChart indicator="job_vacancy" title="Job vacancy rate" compact />
          <BalticCompareChart indicator="minimum_wage" title="Minimum wage" compact />
          <BalticCompareChart indicator="gdp_per_capita" title="GDP per capita" compact />
          <BalticCompareChart indicator="life_expectancy" title="Life expectancy at birth" compact />
          <BalticCompareChart indicator="digital_skills" title="Basic digital skills" compact />
          <BalticCompareChart indicator="online_shoppers" title="Online shoppers" compact />
        </div>
      </div>
    </section>
  );
}