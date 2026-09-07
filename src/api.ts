import type { MarineWeatherForecast, PortWeather, Port, PortDataResponse, EconomyData, PropertyData, EnvironmentData, BusinessSearchResult, EUFundsData, AddressSearchResult, SystemStatus, TradePartnersData } from './types';
import { PRICE_INTERVAL_MS, priceInterval, isCurrentPriceTime } from './utils/priceFreshness';


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
  /**
   * The upstream cube code on its own, e.g. `une_rt_m`.
   *
   * `source` already contains it, as `Eurostat (une_rt_m)`, but only as prose.
   * A consumer that wants the code has to parse the parenthesis out, which is
   * a second place the truth lives. The API has sent this field since
   * `api/baltic-compare/index.js:157`; it was simply never declared, so every
   * caller had to reach for it through a cast or re-derive it from `source`.
   */
  dataset?: string;
  /** When the API read this from Eurostat. Sent by the API and, until now,
   *  undeclared — so an export could not say when the figures were retrieved
   *  without asserting the download time was the retrieval time, which is a
   *  different and quietly wrong claim. */
  fetchedAt?: string;
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
  priceSchedule?: EconomyData['priceSchedule'];
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

/**
 * Latvia's goods trade by partner country and commodity chapter.
 *
 * Takes no country parameter, and that is the honest shape rather than an
 * omission: the source is CSP's national CN-8 dataset on data.gov.lv, so it
 * describes Latvia and does not become Estonian when the selector moves. The
 * payload says so itself in `countryOnly`, and the panel reads that rather than
 * assuming it.
 *
 * The cache key carries no country for the same reason. A key that varied by a
 * parameter the request does not send would serve one country's response under
 * three headings, which is the collision `AGENTS.md` records shipping once
 * already — real figures, correctly parsed, attached to the wrong subject.
 */
export async function fetchTradePartners(): Promise<TradePartnersData> {
  return cachedFetch<TradePartnersData>('trade-partners', '/api/trade-partners');
}

// ─── Cached fetch helper ───

const CACHE_TTL: Record<string, number> = {
  economy: PRICE_INTERVAL_MS, // Also invalidated at the next delivery boundary.
  'power-prices': PRICE_INTERVAL_MS,
  property: 60 * 60 * 1000,   // 1 hour — daily data
  environment: 15 * 60 * 1000, // 15 min — weather updates frequently
  baltic_compare: 60 * 60 * 1000,
  // Matched to the server's own five-minute TTL. Without an entry this fell to
  // the one-hour default below, so the panel headed "Estonian grid" could show
  // an hour-old reading of a feed that republishes every quarter of an hour —
  // and, before the ages were derived at render time, could date it as though
  // it had just arrived.
  'live-grid': 5 * 60 * 1000,
  // Six hours, matched to the server's own TTL. The upstream is monthly, so a
  // longer client cache would cost nothing in accuracy — but matching the
  // server is what keeps the two layers from compounding into an age neither
  // of them knows about, which is how a quarter-hourly feed came to be held
  // for an hour under a heading that dated it as fresh.
  'trade-partners': 6 * 60 * 60 * 1000,
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

function writeCache(cacheKey: string, data: unknown, timestamp = Date.now()): void {
  try {
    const payload = JSON.stringify({ data, timestamp });
    try {
      localStorage.setItem(cacheKey, payload);
      return;
    } catch (error) {
      // Denied storage is not a quota problem; eviction cannot repair it.
      if (!(error instanceof DOMException) ||
        !['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error.name)) return;
    }
    if (evictOldestEntries(0.25)) localStorage.setItem(cacheKey, payload);
  } catch {
    // Cache access, enumeration, eviction and retry are all optional. Network
    // and response parsing errors are handled outside this boundary.
  }
}

function readCache<T>(cacheKey: string, key: string): T | null {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (isPricingKey(key) && priceInterval(timestamp) !== priceInterval()) return null;
    if (Date.now() - timestamp < getTTL(key)) return data as T;
  } catch {
    // Malformed cache is no cache; fall through to a live request.
  }
  return null;
}

const inFlightRequests = new Map<string, Promise<unknown>>();

function isPricingKey(key: string): boolean {
  return key.startsWith('economy-') || key === 'power-prices';
}

interface PriceRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  readers: number;
}
const priceRequests = new Map<string, PriceRequest>();

function readPriceRequest<T>(key: string, request: PriceRequest, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    request.readers++;
    let finished = false;
    function release() {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      request.readers--;
      // App and the ticker share a request; one unmount cannot cancel the other.
      if (request.readers === 0) {
        request.controller.abort();
        if (priceRequests.get(key) === request) priceRequests.delete(key);
      }
    }
    function abort() {
      if (finished) return;
      release();
      reject(new DOMException('Request cancelled', 'AbortError'));
    }
    signal?.addEventListener('abort', abort, { once: true });
    void (async () => {
      try {
        const data = await request.promise;
        if (!finished) { release(); resolve(data as T); }
      } catch (error) {
        if (!finished) { release(); reject(error); }
      }
    })();
  });
}

async function cachedPriceFetch<T>(key: string, endpoint: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const cacheKey = `${CACHE_PREFIX}${key}`;
  const cached = readCache<T>(cacheKey, key);
  if (cached !== null) return cached;
  const startedAt = Date.now();
  const requestKey = `${cacheKey}|${priceInterval(startedAt)}`;
  let request = priceRequests.get(requestKey);
  if (!request) {
    const entry: PriceRequest = {
      controller: new AbortController(), readers: 0, promise: Promise.resolve(),
    };
    entry.promise = (async () => {
      try {
        const response = await fetch(endpoint, { signal: entry.controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error(`${key} API failed: ${response.status}`);
        const data: unknown = await response.json();
        if (entry.controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        // A response begun in the old interval must not become a new cache hit.
        if (priceInterval(startedAt) === priceInterval()) writeCache(cacheKey, data, startedAt);
        return data;
      } finally {
        if (priceRequests.get(requestKey) === entry) priceRequests.delete(requestKey);
      }
    })();
    priceRequests.set(requestKey, entry);
    request = entry;
  }
  return readPriceRequest<T>(requestKey, request, signal);
}

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
async function cachedFetch<T>(key: string, endpoint: string, signal?: AbortSignal): Promise<T> {
  if (isPricingKey(key)) return cachedPriceFetch<T>(key, endpoint, signal);
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

export async function fetchEconomyData(country = 'lv', signal?: AbortSignal): Promise<EconomyData> {
  const code = country.toLowerCase();
  const data = await cachedFetch<EconomyData>(`economy-${code}`, `/api/economy-data?country=${code}`, signal);
  if (data && 'electricityCurrentTime' in data && !isCurrentPriceTime(data.electricityCurrentTime)) {
    return { ...data, electricityCurrent: null };
  }
  return data;
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

export async function fetchPowerPrices(signal?: AbortSignal): Promise<PowerPriceData> {
  const data = await cachedFetch<PowerPriceData>('power-prices', '/api/power-prices', signal);
  if (data && !isCurrentPriceTime(data.currentTime)) {
    return {
      ...data, currentTime: null, currentSpread: null, coupled: null,
      zones: Array.isArray(data.zones) ? data.zones.map(zone => ({ ...zone, current: null })) : [],
    };
  }
  return data;
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
/**
 * The newest renewable share that is actually known, on its own clock.
 *
 * Solar is metered a day at a time, so `latest.renewableShare` is null for
 * almost every interval the API serves — measured 2026-08-30, **1 of 45
 * (2.2%)**, in one unbroken run at the newest end with zero interior holes.
 * The API measured the same shape over 763 readings across eight days: 44
 * nulls, one run, nothing missing beyond 12.3 hours. It is not an outage.
 *
 * So the share comes with its own timestamp and age, and a consumer that draws
 * it beside the metered figures must say so. Printing 53.9 under a header
 * reading "metered to 07:45" would be a 12-hour-old number wearing a 55-minute-
 * old timestamp — the same fault as reading a forecast as a reading.
 */
export interface LiveGridRenewable {
  share: number;
  time: string;
}

export interface LiveGridData {
  area: string;
  areaLabel: string;
  operator: string;
  unit: string;
  latest: LiveGridPoint | null;
  /**
   * Timestamp of the newest metered reading. Metering lags by over an hour.
   *
   * An absolute instant, and deliberately not accompanied by an age: the
   * response carried `minutesBehind` until it was measured frozen — computed
   * against `Date.now()` when the body was built, then served unchanged for the
   * server's whole TTL and cached again in this client on top of that. A
   * consumer subtracts from this at the moment it renders, which cannot go
   * stale however long the body is held.
   */
  meteredTo: string | null;
  /**
   * Absent when no interval in the served window carries a share at all, which
   * is a different state from "the newest interval has none" and is why this is
   * optional rather than a nullable number.
   */
  renewableLatest?: LiveGridRenewable | null;
  actual: LiveGridPoint[];
  forecast: LiveGridPoint[];
  source: string;
  fetchedAt: string;
}

export async function fetchLiveGrid(): Promise<LiveGridData> {
  return cachedFetch<LiveGridData>('live-grid', '/api/live-grid');
}
