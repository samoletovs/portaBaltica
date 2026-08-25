// ─── Dashboard-wide types ───

/** Active dashboard section */
export type DashboardSection = 'economy' | 'trade' | 'government' | 'labour' | 'energy' | 'property' | 'environment' | 'maritime' | 'business';

/** AI insight significance level */
export type InsightLevel = 'routine' | 'notable' | 'significant';

export interface Insight {
  headline: string;
  description: string;
  level: InsightLevel;
  category: DashboardSection;
  timestamp: string;
}

export const INSIGHT_BADGES: Record<InsightLevel, { label: string; color: string; emoji: string }> = {
  routine: { label: 'Routine', color: 'text-emerald-400', emoji: '🟢' },
  notable: { label: 'Notable', color: 'text-yellow-400', emoji: '🟡' },
  significant: { label: 'Significant', color: 'text-red-400', emoji: '🔴' },
};

// ─── Economy & Business types ───

export interface ExchangeRate {
  currency: string;
  rate: number;
  name: string;
}

export interface ElectricityPrice {
  timestamp: string;
  price: number; // EUR/MWh
}

export interface EconomyIndicator {
  label: string;
  value: string;
  change?: string;
  unit?: string;
}

/**
 * "Business pulse" counts from the data.gov.lv registries.
 *
 * `null` means the portal could not answer, and must render as such. These
 * were plain numbers that defaulted to `0` on failure, which is how a tile
 * reading "0 Suspended Activities" went unnoticed while the dataset behind it
 * had never existed.
 */
export interface BusinessPulse {
  /** Businesses registered for VAT today — excludes the struck-off majority. */
  activeVatPayers: number | null;
  /** Suspension decisions still in force: not restored, and not yet lapsed. */
  suspendedBusinesses: number | null;
}

export interface EconomyData {
  exchangeRates: ExchangeRate[];
  electricityPrices: ElectricityPrice[];
  electricityCurrent: number;
  indicators: EconomyIndicator[];
  businessPulse: BusinessPulse;
  fetchedAt: string;
}

// ─── Property & Energy types ───

export interface ConstructionPermit {
  municipality: string;
  count: number;
}

export interface EnergyCertDistribution {
  rating: string; // A, B, C, D, E, F, G
  count: number;
}

export interface PropertyData {
  constructionPermits: ConstructionPermit[];
  totalPermits: number;
  permitsTrend: number; // % change vs previous period
  energyCerts: EnergyCertDistribution[];
  totalCerts: number;
  fetchedAt: string;
}

// ─── Environment & Daily Life types ───

export interface WeatherCondition {
  city: string;
  temperature: number;
  windSpeed: number;
  humidity: number;
  description: string;
}

export interface AirQualityData {
  pm25: number;
  no2: number;
  status: 'good' | 'moderate' | 'unhealthy';
  label: string;
}

export interface EnvironmentData {
  weather: WeatherCondition[];
  airQuality: AirQualityData;
  capitalPopulation: number | null;
  /** What the population figure actually counts — a NUTS 3 region, which is
   *  the city for Rīga but a wider capital region for Tallinn and Vilnius. */
  capitalPopulationLabel?: string;
  capitalPopulationYear?: string | null;
  capitalPopulationSource?: string;
  rigaPopulation?: number; // backward compat with cached API responses
  fetchedAt: string;
}

// ─── Business Intelligence types (Phase 2) ───

export interface UBOOwner {
  forename: string;
  surname: string;
  nationality: string;
  residence: string;
  registeredOn: string;
}

export interface UBOCompany {
  registrationNumber: string;
  owners: UBOOwner[];
}

export interface BusinessSearchResult {
  query: string;
  totalMatches: number;
  companies: UBOCompany[];
  source: string;
  fetchedAt: string;
}

export interface EUFundProject {
  number: string;
  version: string;
  date: string;
  status: string;
}

export interface EUFundStatusSummary {
  status: string;
  count: number;
}

export interface EUFundsData {
  projects: EUFundProject[];
  statusSummary: EUFundStatusSummary[];
  total: number;
  source: string;
  fetchedAt: string;
}

// ─── Geospatial types (Phase 3) ───

export interface AddressResult {
  code: number;
  fullAddress: string;
  name: string;
  postalCode: string;
  lat: number | null;
  lon: number | null;
}

export interface AddressSearchResult {
  query: string;
  total: number;
  addresses: AddressResult[];
  source: string;
  fetchedAt: string;
}

// ─── System status types (Phase 3) ───

export interface DataSourceCheck {
  name: string;
  status: 'healthy' | 'unhealthy';
  latency: number;
  error?: string;
}

export interface SystemStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  phase: string;
  dataSources: {
    healthy: number;
    total: number;
    checks: DataSourceCheck[];
  };
  apis: {
    total: number;
    endpoints: string[];
  };
  selfSustaining: {
    monthlyInfrastructureCost: string;
    revenue: string;
    status: string;
  };
  respondedIn: string;
  fetchedAt: string;
}

// ─── Maritime types (existing) ───

/** Port definitions for Latvia's 3 major ports */
export interface Port {
  code: string;        // UN/LOCODE e.g. "LVRIX"
  name: string;
  lat: number;
  lon: number;
  description: string;
}

export const PORTS: Port[] = [
  { code: 'LVRIX', name: 'Riga', lat: 57.05, lon: 24.10, description: 'Freeport of Riga — Latvia\'s largest port and Baltic transit hub' },
  { code: 'LVVNT', name: 'Ventspils', lat: 57.40, lon: 21.55, description: 'Port of Ventspils — ice-free deepwater port on the open Baltic coast' },
  { code: 'LVLPX', name: 'Liepāja', lat: 56.52, lon: 20.97, description: 'Port of Liepāja — Latvia\'s warmest port with growing ferry traffic' },
];

/** Marine weather from Open-Meteo */
export interface MarineWeather {
  waveHeight: number;       // meters
  waveDirection: number;    // degrees
  wavePeriod: number;       // seconds
  seaSurfaceTemp: number;   // °C
  windWaveHeight: number;   // meters
  swellWaveHeight: number;  // meters
}

export interface MarineWeatherForecast {
  portCode: string;
  current: MarineWeather;
  hourly: {
    time: string[];
    waveHeight: number[];
    seaSurfaceTemp: number[];
  };
}

/** Weather from Open-Meteo */
export interface PortWeather {
  portCode: string;
  temperature: number;      // °C
  windSpeed: number;        // km/h
  windDirection: number;    // degrees
  cloudCover: number;       // %
  precipitation: number;    // mm
}


/** One quarterly observation, e.g. `{ period: '2025-Q4', value: 4237 }`. */
export interface PortPoint {
  period: string;
  value: number | null;
}

/** A quarterly series for one port, or for a country that Eurostat does not break down by port. */
export interface PortSeries {
  /** Eurostat `rep_mar` code, e.g. `LV_0LVRIX`. */
  code: string;
  name: string;
  series: PortPoint[];
  /** Newest period carrying a value. */
  latest: string | null;
}

/**
 * One measure across a country's ports.
 *
 * `countryOnly` is true when Eurostat publishes no port breakdown for that
 * country — Estonia's goods and passenger tables are national totals — so the
 * UI can label a national figure honestly instead of passing it off as a port.
 */
export interface PortMeasure {
  unit: 'THS_T' | 'THS' | 'NR';
  countryOnly: boolean;
  latest: string | null;
  ports: PortSeries[];
}

/** Cargo split by type for a single quarter, in thousand tonnes. */
export interface CargoMix {
  period: string | null;
  total: number | null;
  categories: { code: string; name: string; weight: number }[];
}

/** Baltic port statistics from Eurostat, via the API proxy. */
export interface PortDataResponse {
  country: string;
  /** Gross weight of goods handled, thousand tonnes per quarter. */
  goods: PortMeasure;
  /** Passengers embarked and disembarked, thousands per quarter. */
  passengers: PortMeasure;
  /** Vessels arriving, count per quarter. */
  vessels: PortMeasure;
  cargoMix: CargoMix;
  /**
   * Newest quarter the statistics reach — not `fetchedAt`. Eurostat publishes
   * maritime tables a quarter or two in arrears, so this always trails today
   * and the UI states it rather than implying the figures are current.
   */
  dataAsOf?: string | null;
  source?: string;
  /** Non-empty only if a cube dimension went unpinned and a slice was guessed. */
  assumptions?: { dimension: string; chosen: string; optionCount: number; reason: string }[];
  fetchedAt: string;
}

/** Sea state classification */
export type SeaState = 'calm' | 'slight' | 'moderate' | 'rough' | 'very-rough';

export function classifySeaState(waveHeight: number): SeaState {
  if (waveHeight < 0.1) return 'calm';
  if (waveHeight < 0.5) return 'slight';
  if (waveHeight < 1.25) return 'moderate';
  if (waveHeight < 2.5) return 'rough';
  return 'very-rough';
}

export const SEA_STATE_LABELS: Record<SeaState, { label: string; color: string; emoji: string }> = {
  'calm': { label: 'Calm', color: 'text-emerald-400', emoji: '🟢' },
  'slight': { label: 'Slight', color: 'text-green-400', emoji: '🟡' },
  'moderate': { label: 'Moderate', color: 'text-yellow-400', emoji: '🟠' },
  'rough': { label: 'Rough', color: 'text-orange-400', emoji: '🔴' },
  'very-rough': { label: 'Very Rough', color: 'text-red-400', emoji: '⛔' },
};
