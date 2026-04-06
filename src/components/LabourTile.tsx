import { IndicatorCard }
from './IndicatorCard';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';

export function LabourTile() {
  const { countryLabel, flag } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Labour market</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · Eurostat</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="salary" title="Hourly labour cost" unit="EUR/hour" />
        <IndicatorCard id="unemployment" title="Unemployment" unit="%" />
        <IndicatorCard id="wages_industry" title="Manufacturing wages" unit="index (2020=100)" />
        <IndicatorCard id="wages_it" title="IT sector wages" unit="index (2020=100)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalticCompareChart indicator="youth_unemployment" title="Youth unemployment (U25)" compact />
        <BalticCompareChart indicator="job_vacancy" title="Job vacancy rate" compact />
        <BalticCompareChart indicator="gdp_per_capita" title="GDP per capita" compact />
        <BalticCompareChart indicator="life_expectancy" title="Life expectancy" compact />
      </div>
    </section>
  );
}
