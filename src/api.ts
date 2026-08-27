import type { MarineWeatherForecast, PortWeather, Port, PortDataResponse, EconomyData, PropertyData, EnvironmentData, BusinessSearchResult, EUFundsData, AddressSearchResult, SystemStatus } from './types';
import { PORTS } from './types';
import { finite } from './utils/payload';

const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const OPEN_METEO_WEATHER = 'https://api.open-meteo.com/v1/forecast';

export interface BalticCompareSeriesPoint {
  period: string;
  value: number | null;
}

export interface BalticCompareCountrySeries {
  label: string;
  series: BalticCompareSeriesPoint[];
}

export interface BalticCompareData {
  indicator: string;
  title: string;
  unit: string;
  countries: Record<string, BalticCompareCountrySeries>;
  /**
   * The EU27 average, when the cube carries one — a benchmark, not a country.
   *
   * Kept out of `countries` on purpose: everything that iterates that record
   * treats its keys as Baltic states, so a fourth entry would put the European
   * Union into a ranking of Latvia, Estonia and Lithuania. `null` for the 12
   * indicators with no usable EU figure, and a caller must withhold the
   * benchmark entirely rather than draw an empty one.
   */
  reference?: {
    code: string;
    label: string;
    fullLabel: string;
    series: { period: string; value: number | null }[];
    latest: number;
    latestPeriod: string;
  } | null;
  source: string;
  /** Dimensions the indicator definition failed to pin. Always empty for a
   *  correctly specified indicator — a non-empty value means the API had to
   *  guess which slice of the Eurostat cube to read. */
  assumptions?: { dimension: string; chosen: string; optionCount: number; reason: string }[];
}

export interface PowerPriceZone {
  id: 'ee' | 'lv' | 'lt' | 'fi';
  label: string;
  flag: string;
  current: number | null;
  /** Today's low, high and mean. Previously these spanned both days while the
   *  card described them as today's. */
  min: number | null;
  max: number | null;
  avg: number | null;
  /** Tomorrow's, once Nord Pool has published it. Null until then. */
  tomorrow?: { min: number | null; max: number | null; avg: number | null } | null;
}

export interface PowerPricePoint {
  time: string;
  /** Calendar day this interval belongs to, so two days of repeating
   *  quarter-hour labels can be told apart. */
  day?: string;
  ee: number | null;
  lv: number | null;
  lt: number | null;
  fi: number | null;
  spread: number;
}

export interface PowerPriceData {
  unit: string;
  zones: PowerPriceZone[];
  series: PowerPricePoint[];
  /** The day every "today" figure here describes. */
  today?: string;
  /** Tomorrow's date once published, otherwise null. */
  tomorrow?: string | null;
  currentTime: string | null;
  currentSpread: number | null;
  coupled: boolean | null;
  /** Scoped to `today`, not to the whole two-day window. */
  decoupledIntervals: number;
  totalIntervals: number;
  widestSpread: { spread: number; time: string } | null;
  tomorrowOutlook?: {
    date: string;
    decoupledIntervals: number;
    totalIntervals: number;
    widestSpread: { spread: number; time: string } | null;
  } | null;
  source: string;
  fetchedAt: string;
}

/** Fetch marine weather for a port from Open-Meteo */
export async function fetchMarineWeather(port: Port): Promise<MarineWeatherForecast> {
  const params = new URLSearchParams({
    latitude: port.lat.toString(),
    longitude: port.lon.toString(),
    current: 'wave_height,wave_direction,wave_period,sea_surface_temperature,wind_wave_height,swell_wave_height',
    hourly: 'wave_height,sea_surface_temperature',
    forecast_days: '3',
    timezone: 'Europe/Riga',
  });

  const res = await fetch(`${OPEN_METEO_MARINE}?${params}`);
  if (!res.ok) throw new Error(`Marine weather failed: ${res.status}`);
  const data = await res.json();

  return {
    portCode: port.code,
    current: {
      waveHeight: finite(data.current?.wave_height),
      waveDirection: finite(data.current?.wave_direction),
      wavePeriod: finite(data.current?.wave_period),
      seaSurfaceTemp: finite(data.current?.sea_surface_temperature),
      windWaveHeight: finite(data.current?.wind_wave_height),
      swellWaveHeight: finite(data.current?.swell_wave_height),
    },
    hourly: {
      time: data.hourly?.time ?? [],
      waveHeight: data.hourly?.wave_height ?? [],
      seaSurfaceTemp: data.hourly?.sea_surface_temperature ?? [],
    },
  };
}

/** Fetch regular weather for a port from Open-Meteo */
export async function fetchPortWeather(port: Port): Promise<PortWeather> {
  const params = new URLSearchParams({
    latitude: port.lat.toString(),
    longitude: port.lon.toString(),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation',
    timezone: 'Europe/Riga',
  });

  const res = await fetch(`${OPEN_METEO_WEATHER}?${params}`);
  if (!res.ok) throw new Error(`Port weather failed: ${res.status}`);
  const data = await res.json();

  return {
    portCode: port.code,
    temperature: finite(data.current?.temperature_2m),
    windSpeed: finite(data.current?.wind_speed_10m),
    windDirection: finite(data.current?.wind_direction_10m),
    cloudCover: finite(data.current?.cloud_cover),
    precipitation: finite(data.current?.precipitation),
  };
}

/**
 * Marine and land weather for every port.
 *
 * Two endpoints per port, and they answer different questions: the marine API
 * carries the sea state, which is the point of the card, and the forecast API
 * carries air temperature and wind, which are context beside it.
 *
 * They are joined with `allSettled` rather than `all` because they fail
 * independently. Under `Promise.all` a single 500 from the forecast endpoint
 * rejected the pair, `allSettled` dropped the whole port, and a run where the
 * marine API answered perfectly returned **no ports at all** — every card lost,
 * including the wave heights that had arrived.
 *
 * `PortCard` was already built for this: it reads `weather?.temperature`
 * through `fixed()`, which renders an em dash. The component handled the case
 * the fetch layer made impossible.
 *
 * The sea state is *not* optional in the same way. A port card with no sea
 * state has nothing to say, so a marine failure still drops that port — and
 * only that port.
 */
export async function fetchAllWeather() {
  const settled = await Promise.allSettled(
    PORTS.map(async (port) => {
      const [marine, weather] = await Promise.all([
        fetchMarineWeather(port),
        fetchPortWeather(port).catch(() => null),
      ]);
      return { port, marine, weather };
    })
  );
  return settled
    .filter((r): r is PromiseFulfilledResult<{ port: Port; marine: MarineWeatherForecast; weather: PortWeather | null }> => r.status === 'fulfilled')
    .map(r => r.value);
}

const PORT_DATA_CACHE_KEY = 'portabaltica_port_data';
/** Eurostat publishes maritime tables quarterly; an hour is already generous. */
const PORT_DATA_CACHE_TTL = 60 * 60 * 1000;

/** Fetch Baltic port statistics (cargo, passengers, vessels) via the SWA API
 *  proxy. Cached per country in localStorage for an hour. */
export async function fetchPortData(country: string = 'LV'): Promise<PortDataResponse> {
  // Keyed by country: a shared key served Estonia's figures under Latvia's
  // label for an hour after switching.
  const cacheKey = `${PORT_DATA_CACHE_KEY}_${country.toUpperCase()}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < PORT_DATA_CACHE_TTL) return data;
    }
  } catch { /* ignore cache errors */ }

  const res = await fetch(`/api/port-data?country=${encodeURIComponent(country.toUpperCase())}`);
  if (!res.ok) throw new Error(`Port data API failed: ${res.status}`);
  const data: PortDataResponse = await res.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore storage errors */ }

  return data;
}

// ─── Cached fetch helper ───

const CACHE_TTL: Record<string, number> = {
  economy: 30 * 60 * 1000,    // 30 min — electricity updates hourly
  property: 60 * 60 * 1000,   // 1 hour — daily data
  environment: 15 * 60 * 1000, // 15 min — weather updates frequently
  baltic_compare: 60 * 60 * 1000,
};

function getTTL(key: string): number {
  const match = Object.entries(CACHE_TTL).find(([k]) => key.startsWith(k));
  return match ? match[1] : 60 * 60 * 1000;
}

async function cachedFetch<T>(key: string, endpoint: string): Promise<T> {
  const cacheKey = `portabaltica_${key}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < getTTL(key)) {
        return data as T;
      }
    }
  } catch { /* ignore */ }

  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`${key} API failed: ${res.status}`);
  const data: T = await res.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore */ }

  return data;
}

const inFlightRequests = new Map<string, Promise<unknown>>();

async function cachedFetchDeduped<T>(key: string, endpoint: string): Promise<T> {
  const cacheKey = `portabaltica_${key}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < getTTL(key)) {
        return data as T;
      }
    }
  } catch {
    // Ignore malformed cache and continue with live request.
  }

  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    return existing as Promise<T>;
  }

  const request = fetch(endpoint)
    .then(async (res) => {
      if (!res.ok) throw new Error(`${key} API failed: ${res.status}`);
      const data = await res.json() as T;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      } catch {
        // Ignore storage failures.
      }
      return data;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, request as Promise<unknown>);
  return request;
}

// ─── New data endpoints ───

export async function fetchEconomyData(country = 'lv'): Promise<EconomyData> {
  return cachedFetch<EconomyData>(`economy-${country}`, `/api/economy-data?country=${country}`);
}

export async function fetchPropertyData(): Promise<PropertyData> {
  return cachedFetch<PropertyData>('property', '/api/property-data');
}

export async function fetchEnvironmentData(country = 'lv'): Promise<EnvironmentData> {
  return cachedFetch<EnvironmentData>(`environment-${country}`, `/api/environment-data?country=${country}`);
}

// ─── Phase 2: Business Intelligence ───

export async function searchBusinessOwners(query: string): Promise<BusinessSearchResult> {
  const res = await fetch(`/api/business-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export async function fetchEUFunds(): Promise<EUFundsData> {
  return cachedFetch<EUFundsData>('eu-funds', '/api/eu-funds');
}

// ─── Phase 3: Geospatial + System ───

export async function searchAddress(query: string): Promise<AddressSearchResult> {
  const res = await fetch(`/api/address-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Address search failed: ${res.status}`);
  return res.json();
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/system-status');
  if (!res.ok) throw new Error(`Status failed: ${res.status}`);
  return res.json();
}

export async function fetchBalticCompare(indicator: string, years = 5): Promise<BalticCompareData | null> {
  const normalizedYears = Number.isFinite(years) && years >= 0 ? years : 5;
  const encodedIndicator = encodeURIComponent(indicator);
  return cachedFetchDeduped<BalticCompareData | null>(
    `baltic_compare-${encodedIndicator}-${normalizedYears}`,
    `/api/baltic-compare?indicator=${encodedIndicator}&years=${normalizedYears}`
  );
}

export async function fetchPowerPrices(): Promise<PowerPriceData> {
  return cachedFetch<PowerPriceData>('power-prices', '/api/power-prices');
}

/** One metered or forecast interval of the Estonian power system. */
export interface LiveGridPoint {
  time: string;
  kind: 'actual' | 'forecast';
  production: number | null;
  consumption: number | null;
  renewable: number | null;
  /** Generation minus demand. Negative is a net import. */
  balance: number | null;
  renewableShare: number | null;
}

/**
 * The physical state of the Estonian grid.
 *
 * `area` is always `EE`. Elering is the Estonian transmission operator and this
 * is its own system, not a Baltic aggregate — consumption runs 670 to 870 MW
 * where the three states together draw three to four gigawatts.
 */
export interface LiveGridData {
  area: string;
  areaLabel: string;
  operator: string;
  unit: string;
  latest: LiveGridPoint | null;
  /** Timestamp of the newest metered reading. Metering lags by over an hour. */
  meteredTo: string | null;
  minutesBehind: number | null;
  actual: LiveGridPoint[];
  forecast: LiveGridPoint[];
  servedFromCache?: boolean;
  readAgoMs?: number;
  source: string;
  fetchedAt: string;
}

export async function fetchLiveGrid(): Promise<LiveGridData> {
  return cachedFetch<LiveGridData>('live-grid', '/api/live-grid');
}
