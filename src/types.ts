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
  routine: { label: 'Routine', color: 'dash-positive', emoji: '🟢' },
  notable: { label: 'Notable', color: 'dash-warning', emoji: '🟡' },
  significant: { label: 'Significant', color: 'dash-negative', emoji: '🔴' },
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
  /**
   * The price now, or `null` when we do not have one.
   *
   * Nullable because it used to be `0` on both a missing hour and a failed
   * fetch, and zero is a plausible Nord Pool price rather than an obvious
   * sentinel — the tile even has a branch for negative prices. So the
   * fabricated value was indistinguishable from a reading.
   */
  electricityCurrent: number | null;
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
  /** Null when the reading was missing. Never a zero standing in for one:
   *  an absent temperature rendered as 0°C reads as an ordinary winter day. */
  temperature: number | null;
  windSpeed: number | null;
  humidity: number | null;
  description: string | null;
}

/**
 * Air quality for the capital.
 *
 * `available` is false when the reading could not be taken. The endpoint used
 * to answer a failed fetch with `status: 'good', label: 'Good'` and three
 * zeroes, which told a reader the air was clean on the strength of a request
 * that never completed. Every field is nullable now, and nothing is invented.
 */
export interface AirQualityData {
  pm25: number | null;
  no2: number | null;
  aqi?: number | null;
  /**
   * The EEA band. Six of them, at 20/40/60/80/100.
   *
   * This used to be `'good' | 'moderate' | 'unhealthy'` — the US EPA's three
   * bands and the EPA's word, applied to Europe's index. See
   * `api/shared/airQuality.js`.
   */
  status: 'good' | 'fair' | 'moderate' | 'poor' | 'very-poor' | 'extremely-poor' | null;
  label: string | null;
  /** Which band, 1–6, so a caller can draw a meter without knowing the scale. */
  rank?: number | null;
  bandCount?: number;
  available?: boolean;
  unavailableReason?: string;
}

/** How many of the requested cities actually reported. */
export interface WeatherCoverage {
  reporting: number;
  requested: number;
  missing: number;
}

export interface EnvironmentData {
  weather: WeatherCondition[];
  weatherCoverage?: WeatherCoverage;
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
  /**
   * Four states, deliberately not three. `stale` is a source that answered but
   * has stopped moving, which is a different thing to tell a reader than one
   * that is unreachable — flattening the two is how `prc_hicp_manr` served the
   * same month for eight months behind a green light. `pending` is an optional
   * source still being checked: we do not yet know, and "we do not know" must
   * render as neither of the other three.
   */
  status: 'healthy' | 'stale' | 'pending' | 'unhealthy';
  latency: number;
  error?: string;
  pendingReason?: string;
  required?: boolean;
  powers?: string;
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
  /** Months this port's newest filing trails the newest any port reached. */
  monthsBehind?: number | null;
  /**
   * True when the port has filed nothing for over a year — it has stopped
   * reporting, rather than merely being a quarter late. Riga's sea passenger
   * series ends at 2021-Q4 behind four literal zeroes, which is a route that
   * closed; a port one quarter in arrears is a table that has not caught up.
   * A reader shown a chart missing a port must be able to tell which.
   */
  discontinued?: boolean;
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

/**
 * Cargo split by type for a single quarter, in thousand tonnes.
 *
 * `breakdown` distinguishes the three reasons `categories` can be empty, which
 * an empty array alone cannot:
 *
 *   - `published` — the categories are here.
 *   - `unpublished` — Eurostat publishes no cargo-type breakdown for this
 *     country at all. `mar_go_qm_ee` carries exactly one cargo code, `TOTAL`,
 *     so Estonia has a total and no components and always will. Saying so is
 *     the difference between a reader believing our chart broke and a reader
 *     learning something true about the source.
 *   - `unavailable` — the fetch failed. Possibly transient, and not the same
 *     claim at all.
 */
export interface CargoMix {
  period: string | null;
  total: number | null;
  categories: { code: string; name: string; weight: number }[];
  breakdown?: 'published' | 'unpublished' | 'unavailable';
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
  /**
   * The quarter every measure has reached. Equal to `dataAsOf` when the three
   * tables are in step, older when they have drifted apart — Eurostat publishes
   * them independently, so the tile must state a span rather than date all
   * three panels to the newest one.
   */
  dataFrom?: string | null;
  source?: string;
  /** Non-empty only if a cube dimension went unpinned and a slice was guessed. */
  assumptions?: { dimension: string; chosen: string; optionCount: number; reason: string }[];
  fetchedAt: string;
}

/**
 * Sea state, named as the WMO sea state code names it.
 *
 * These keys were previously `calm | slight | moderate | rough | very-rough`
 * against the same thresholds, which is the same scale shifted one degree
 * towards alarm — see `classifySeaState`.
 */
export type SeaState = 'calm' | 'smooth' | 'slight' | 'moderate' | 'rough';

/**
 * The WMO sea state for a wave height, or `null` when there is no reading.
 *
 * **The thresholds were always right and the names were always wrong.**
 * 0.1, 0.5, 1.25 and 2.5 metres are exactly the WMO sea state code boundaries,
 * so whoever wrote this had the scale in front of them — but the labels were
 * assigned one degree too high all the way up, so every band claimed the sea
 * was worse than the international scale says it is:
 *
 * | Wave height | WMO degree | WMO name | this used to say |
 * |---|---|---|---|
 * | < 0.1 m      | 0–1 | Calm     | Calm           |
 * | 0.1 – 0.5 m  | 2   | Smooth   | **Slight**     |
 * | 0.5 – 1.25 m | 3   | Slight   | **Moderate**   |
 * | 1.25 – 2.5 m | 4   | Moderate | **Rough**      |
 * | ≥ 2.5 m      | 5   | Rough    | **Very Rough** |
 *
 * Measured against 8928 hourly readings from the four Latvian ports over 92
 * days, **92% of all observations carried a label one degree too alarming** —
 * only the 7.9% that are genuinely Calm were named correctly. "Very Rough" is
 * degree 6 and starts at 4 m; the highest wave in that whole sample was 2.66 m,
 * so the old scale fired its most alarming label a metre and a half early and
 * the Baltic could never reach the state it claimed to be showing.
 *
 * That matters more here than a wrong axis label elsewhere would, because this
 * is the one number on the site somebody might plan an afternoon around.
 *
 * The `null` matters too, and for the same reason. This used to take a bare
 * `number` and compare it with a chain of `<`, and every one of those
 * comparisons is false for `NaN` — so a missing wave height fell through to the
 * final `return` and a port with **no data** was labelled "Very Rough", in red,
 * as confidently as a real storm (DESIGN.md §3.8).
 */
export function classifySeaState(waveHeight: number | null | undefined): SeaState | null {
  if (typeof waveHeight !== 'number' || !Number.isFinite(waveHeight)) return null;
  if (waveHeight < 0.1) return 'calm';
  if (waveHeight < 0.5) return 'smooth';
  if (waveHeight < 1.25) return 'slight';
  if (waveHeight < 2.5) return 'moderate';
  return 'rough';
}

/**
 * How each band is drawn.
 *
 * **Colour and emoji deliberately carry four steps for five bands, and they
 * carry the same four.** Two encodings claiming different granularity is what
 * produced the defect this replaces: the colour layer resolved five bands onto
 * three tokens (calm and slight both positive, rough and very rough both
 * negative) while the emoji showed five distinct steps, so the two contradicted
 * each other on the page for as long as that layer existed.
 *
 * Calm and Smooth share, because "the sea is fine" is one piece of news and
 * those two together are 56% of all readings. The severe end does **not**
 * share: Moderate is `--data-warning` and Rough is `--data-negative`, because
 * that is the boundary a reader would actually act on. The label carries the
 * fifth distinction, and a word is unambiguous in a way no swatch is.
 *
 * `token` is a CSS custom property rather than a utility class so the ramp can
 * reach `--data-neutral`, which has no `.dash-*` utility, without editing
 * `index.css`.
 */
export const SEA_STATE_LABELS: Record<
  SeaState,
  { label: string; token: string; emoji: string }
> = {
  'calm': { label: 'Calm', token: 'var(--data-positive)', emoji: '🟢' },
  'smooth': { label: 'Smooth', token: 'var(--data-positive)', emoji: '🟢' },
  // Neutral, not positive: at 0.5–1.25 m the sea is unremarkable rather than
  // good news, and it is the single most ordinary state the Baltic is in.
  'slight': { label: 'Slight', token: 'var(--data-neutral)', emoji: '⚪' },
  'moderate': { label: 'Moderate', token: 'var(--data-warning)', emoji: '🟠' },
  'rough': { label: 'Rough', token: 'var(--data-negative)', emoji: '🔴' },
};
