import type { DashboardSection } from '../sections';
import type { IndicatorRegistryEntry } from '../hooks/useIndicatorRegistry';
import aliases from '../../api/shared/researchAliases.json';

export const RESEARCH_SECTIONS: Record<DashboardSection, { title: string; indicators: string[]; tools: string }> = {
  economy: {
    title: 'Economy', tools: 'Exchange rates, prices & national indicators',
    indicators: ['gdp', 'gdp_per_capita', 'inflation', 'core_inflation', 'energy_inflation', 'food_inflation', 'services_inflation', 'goods_inflation', 'ppi', 'industrial', 'retail', 'interest_rate', 'consumer_confidence', 'economic_sentiment'],
  },
  trade: {
    title: 'Trade', tools: 'Trading partners, commodities & transport',
    indicators: ['exports', 'imports', 'trade_balance', 'goods_balance', 'services_balance', 'transport_services', 'financial_services', 'ict_services', 'other_business_services', 'current_account', 'tourism', 'tourism_foreign', 'hotel_occupancy', 'air_passengers', 'rail_freight', 'road_freight', 'road_freight_tkm', 'rail_passengers'],
  },
  government: {
    title: 'Government', tools: 'Public finances & EU funding',
    indicators: ['gov_debt_gdp', 'gov_revenue', 'gov_deficit', 'inequality', 'poverty_risk', 'rd_spending'],
  },
  labour: {
    title: 'Labour', tools: 'Employment, pay & living standards',
    indicators: ['unemployment', 'youth_unemployment', 'employment_rate', 'job_vacancy', 'salary', 'wages_mfg', 'wages_it', 'minimum_wage', 'labour_productivity', 'digital_skills'],
  },
  energy: {
    title: 'Energy', tools: 'Day-ahead power prices & the live grid',
    indicators: ['elec_price_household', 'elec_price_industry', 'gas_price_household', 'elec_production', 'elec_renewable_gen', 'renewables', 'home_energy_inflation', 'admin_prices', 'vehicles'],
  },
  property: {
    title: 'Property', tools: 'Construction, certificates & cadastral data',
    indicators: ['house_prices', 'construction', 'building_permits', 'building_permits_residential', 'building_permits_non_residential'],
  },
  environment: {
    title: 'Environment', tools: 'Weather, air quality & population',
    indicators: ['ghg_emissions', 'population', 'weekly_deaths', 'life_expectancy', 'net_migration', 'asylum_applications', 'birth_rate'],
  },
  maritime: {
    title: 'Maritime', tools: 'Port cargo, passengers, vessels & sea state',
    indicators: ['transport_services', 'trade_balance', 'rail_freight'],
  },
  business: {
    title: 'Business', tools: 'Company, ownership & address registers',
    indicators: ['business_registrations', 'bankruptcies', 'economic_sentiment', 'online_shoppers', 'rd_spending'],
  },
};

export const FREQUENCY_LABEL: Record<string, string> = {
  A: 'Annual', S: 'Half-yearly', Q: 'Quarterly', M: 'Monthly', W: 'Weekly', D: 'Daily',
};

// Only historical route names, never a replacement for the live catalogue.
const LEGACY_IDS: Readonly<Record<string, string>> = aliases;

export const NATIONAL_INDICATORS = new Set([
  'gdp', 'salary', 'cpi', 'unemployment', 'house_prices', 'retail_sales',
  'industrial', 'population', 'exports', 'imports', 'hotel_occupancy',
  'tourist_arrivals', 'gov_revenue', 'gov_debt', 'biz_confidence',
  'construction_output', 'building_permits', 'new_vehicles', 'wages_industry',
  'wages_it', 'energy_price_gas', 'renewable_share', 'ppi', 'trade_balance',
]);

export function resolveResearchId(id: string, entries: IndicatorRegistryEntry[]): string {
  if (entries.some(entry => entry.id === id)) return id;
  if (Object.hasOwn(LEGACY_IDS, id)) return LEGACY_IDS[id];
  const tail = id.includes('.') ? id.split('.').at(-1) : undefined;
  return tail && entries.some(entry => entry.id === tail) ? tail : id;
}

export function entriesForSection(entries: IndicatorRegistryEntry[], section: DashboardSection | 'all') {
  if (section === 'all') return entries;
  const ids = RESEARCH_SECTIONS[section].indicators;
  return entries.filter(entry => ids.includes(entry.id));
}

export function researchSection(id: string): DashboardSection | undefined {
  return (Object.keys(RESEARCH_SECTIONS) as DashboardSection[])
    .find(section => RESEARCH_SECTIONS[section].indicators.includes(id));
}
