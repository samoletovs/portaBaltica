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

/** Standard cargo type code → name mapping (NST 2007) */
export const CARGO_TYPE_NAMES: Record<string, string> = {
  '01': 'Agriculture & Forestry',
  '02': 'Coal & Lignite',
  '03': 'Petroleum & Natural Gas',
  '04': 'Metal Ores & Mining',
  '05': 'Food, Beverages & Tobacco',
  '06': 'Textiles & Leather',
  '07': 'Wood & Paper Products',
  '08': 'Chemicals & Plastics',
  '09': 'Non-metallic Minerals',
  '10': 'Basic Metals & Fabricated Products',
  '11': 'Machinery & Equipment',
  '12': 'Transport Equipment',
  '13': 'Furniture & Other Manufactured',
  '14': 'Secondary Raw Materials & Waste',
  '15': 'Mail & Parcels',
  '16': 'Equipment for Transport',
  '17': 'Goods In Group Transport',
  '18': 'Unidentifiable Goods',
  '19': 'Other Goods n.e.c.',
  '20': 'Grouped Goods',
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
