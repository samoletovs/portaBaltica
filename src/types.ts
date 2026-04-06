// ─── Dashboard-wide types ───

/** Active dashboard section */
export type DashboardSection = 'economy' | 'property' | 'environment' | 'maritime';

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

export interface BusinessPulse {
  newVatRegistrations: number;
  suspendedBusinesses: number;
  suspendedChangePercent: number;
  newCompanies: number;
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
  rigaPopulation: number;
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

/** Ship visit from SKLOIS data (data.gov.lv) */
export interface ShipVisit {
  portCode: string;
  portName: string;
  ship: string;             // "IMO / MMSI / SHIP_NAME"
  visitDate: string;        // ISO date
  type: 'cancelled' | 'rejected' | 'completed';
  snapshotDate?: string;
}

/** Ferry passenger data (data.gov.lv) */
export interface FerryData {
  portCode: string;
  previousNextPort: string;
  flagCode: string;
  flagName: string;
  passengers: number;
  snapshotDate?: string;
}

/** Loaded cargo by group (data.gov.lv) */
export interface CargoData {
  year: string;
  portCode: string;
  portName: string;
  direction: 'IN' | 'OUT';
  cargoGroupCode: number;
  cargoGroupName: string;
}

/** Cargo turnover with weight in tonnes (data.gov.lv) */
export interface CargoTurnover {
  cargoTypeCode: string;
  weight: number;
}

/** HS (Harmonized System) chapter codes → human-readable names */
export const CARGO_TYPE_NAMES: Record<string, string> = {
  '02': 'Meat',
  '03': 'Fish & Seafood',
  '04': 'Dairy, Eggs, Honey',
  '07': 'Edible Vegetables',
  '08': 'Edible Fruit & Nuts',
  '09': 'Coffee, Tea, Spices',
  '10': 'Cereals',
  '11': 'Milling Products',
  '15': 'Animal/Vegetable Fats',
  '16': 'Meat & Fish Preparations',
  '19': 'Cereal Preparations',
  '20': 'Vegetable Preparations',
  '22': 'Beverages & Spirits',
  '23': 'Food Residues & Animal Feed',
  '25': 'Salt, Sulphur, Stone, Cement',
  '27': 'Mineral Fuels & Oils',
  '28': 'Inorganic Chemicals',
  '29': 'Organic Chemicals',
  '30': 'Pharmaceutical Products',
  '31': 'Fertilizers',
  '33': 'Essential Oils & Cosmetics',
  '34': 'Soap & Surface Agents',
  '35': 'Glues & Enzymes',
  '38': 'Misc. Chemical Products',
  '39': 'Plastics & Plastic Articles',
  '44': 'Wood & Wood Articles',
  '46': 'Woven Vegetable Materials',
  '48': 'Paper & Paperboard',
  '49': 'Printed Materials',
  '52': 'Cotton',
  '54': 'Man-made Filaments',
  '56': 'Wadding, Felt, Nonwovens',
  '57': 'Carpets & Textile Flooring',
  '61': 'Knitted Apparel',
  '68': 'Stone, Plaster, Cement Articles',
  '69': 'Ceramic Products',
  '70': 'Glass & Glassware',
  '71': 'Precious Stones & Metals',
  '72': 'Iron & Steel',
  '73': 'Iron/Steel Articles',
  '84': 'Machinery & Equipment',
  '85': 'Electrical Equipment',
  '94': 'Furniture & Lighting',
  '95': 'Toys & Games',
  '96': 'Misc. Manufactured Articles',
  '99': 'Special Classification',
  'N/A': 'Unclassified Cargo',
};

/** Combined port data from the API proxy */
export interface PortDataResponse {
  shipVisits: ShipVisit[];
  ferryData: FerryData[];
  cargoData: CargoData[];
  cargoTurnover: CargoTurnover[];
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
