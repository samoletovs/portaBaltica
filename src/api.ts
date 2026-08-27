import type { MarineWeatherForecast, PortWeather, Port, PortDataResponse, EconomyData, PropertyData, EnvironmentData, BusinessSearchResult, EUFundsData, AddressSearchResult, SystemStatus } from './types';


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


/**
 * Live marine and surface weather for the three ports, in one request.
 *
 * This used to be six cross-origin calls straight from the browser — two per
 * port — on every load of `/data`. The ports are fixed coordinates, so every
 * visitor was fetching the same six payloads independently, for data Open-Meteo
 * republishes hourly. It was also the only data on the site that could not be
 * cached server-side, because it never reached our server.
 *
 * `/api/sea-state` answers all three ports from one cached response. Every
 * reading is `number | null` — never a zero standing in for absence, because
 * zero is an ordinary wave height.
 *
 * The two upstream services fail independently, and the endpoint keeps that
 * asymmetry rather than flattening it. A port whose *land* forecast failed is
 * still returned, with `weather: null`, because the sea state is the point of
 * the card and the air temperature is context beside it — joining them with
 * `Promise.all` meant one 500 from the forecast API dropped a port whose wave
 * heights had arrived perfectly. A port whose *marine* call failed has nothing
 * to say and is named in `unavailable` instead.
 */
export interface SeaStateResponse {
  ports: { port: Port; marine: MarineWeatherForecast; weather: PortWeather | null }[];
  unavailable: string[];
  source: string;
  fetchedAt: string;
}

export async function fetchAllWeather() {
  const data = await cachedFetch<SeaStateResponse>('sea-state', '/api/sea-state');
  return data.ports;
}

/** Fetch Baltic port statistics (cargo, passengers, vessels) via the SWA API
 *  proxy. Cached per country for an hour.
 *
 *  Keyed by country: a shared key served Estonia's figures under Latvia's label
 *  for an hour after switching. It now goes through the same helper as
 *  everything else rather than carrying its own hand-rolled copy of the cache,
 *  which is how it came to be the one path with no in-flight deduplication and
 *  no quota handling. */
export async function fetchPortData(country: string = 'LV'): Promise<PortDataResponse> {
  const code = country.toUpperCase();
  return cachedFetch<PortDataResponse>(
    `port_data_${code}`,
    `/api/port-data?country=${encodeURIComponent(code)}`
  );
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

const CACHE_PREFIX = 'portabaltica_';

/**
 * Write to localStorage, and make room rather than giving up when it is full.
 *
 * The previous `catch { }` swallowed a quota error and moved on, which sounds
 * harmless and is not: once the quota is reached *nothing* can be cached again,
 * so the browser silently reverts to fetching everything on every navigation
 * and the failure is invisible from the outside.
 *
 * Reaching the quota is not far-fetched. `baltic_compare` keys carry both an
 * indicator and a year span — 65 indicators against several spans — and nothing
 * ever removed one. A reader who browses the dashboard accumulates keys
 * indefinitely.
 *
 * So a failed write drops the oldest entries this site owns and tries again.
 * Only our own prefix is touched: the quota is shared with anything else on the
 * origin, and clearing keys we do not own to make room for a cached chart would
 * be a rude way to lose someone's unrelated state.
 */
function evictOldestEntries(fraction: number): boolean {
  const entries: { key: string; at: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    let at = 0;
    try {
      at = JSON.parse(localStorage.getItem(key) || '{}').timestamp || 0;
    } catch {
      // Unparseable means unusable, so treat it as the very oldest.
    }
    entries.push({ key, at });
  }
  if (entries.length === 0) return false;

  entries.sort((a, b) => a.at - b.at);
  const drop = Math.max(1, Math.ceil(entries.length * fraction));
  for (let i = 0; i < drop && i < entries.length; i++) {
    localStorage.removeItem(entries[i].key);
  }
  return true;
}

function writeCache(cacheKey: string, data: unknown): void {
  const payload = JSON.stringify({ data, timestamp: Date.now() });
  try {
    localStorage.setItem(cacheKey, payload);
    return;
  } catch {
    // Most likely the quota. Make room and try once more.
  }
  if (!evictOldestEntries(0.25)) return;
  try {
    localStorage.setItem(cacheKey, payload);
  } catch {
    // Still no room — the payload may simply be larger than the quota. Caching
    // is an optimisation, so failing to cache must never fail the request.
  }
}

function readCache<T>(cacheKey: string, key: string): T | null {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < getTTL(key)) return data as T;
  } catch {
    // Malformed cache is no cache; fall through to a live request.
  }
  return null;
}

const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Fetch once per key per TTL, and once per key at a time.
 *
 * There used to be two of these — one that deduplicated concurrent callers and
 * one that did not — and all but a single endpoint used the one that did not.
 * That is a distinction nobody can be expected to make correctly at each call
 * site, and getting it wrong is invisible: the page works, it simply issues the
 * request twice. The dashboard mounts several components at once and re-fetches
 * on every country switch, so the duplicate path was the common one.
 *
 * There is now one function and no choice to get wrong.
 */
async function cachedFetch<T>(key: string, endpoint: string): Promise<T> {
  const cacheKey = `${CACHE_PREFIX}${key}`;

  const cached = readCache<T>(cacheKey, key);
  if (cached !== null) return cached;

  const existing = inFlightRequests.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const request = fetch(endpoint)
    .then(async (res) => {
      if (!res.ok) throw new Error(`${key} API failed: ${res.status}`);
      const data = await res.json() as T;
      writeCache(cacheKey, data);
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
  return cachedFetch<BalticCompareData | null>(
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
