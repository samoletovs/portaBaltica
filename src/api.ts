import type { MarineWeatherForecast, PortWeather, ShipVisit, FerryData, Port } from './types';
import { PORTS } from './types';

const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const OPEN_METEO_WEATHER = 'https://api.open-meteo.com/v1/forecast';
const CKAN_API = 'https://data.gov.lv/dati/api/3/action';

// --- CKAN dataset IDs ---
const FORMALITIES_DATASET = 'ar-juras-parvadajumiem-un-ostas-formalitatem-saistito-formalitasu-statistika';
const FERRY_DATASET = '8c5af8aa-eb45-4832-a502-313108499951';

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
      waveHeight: data.current?.wave_height ?? 0,
      waveDirection: data.current?.wave_direction ?? 0,
      wavePeriod: data.current?.wave_period ?? 0,
      seaSurfaceTemp: data.current?.sea_surface_temperature ?? 0,
      windWaveHeight: data.current?.wind_wave_height ?? 0,
      swellWaveHeight: data.current?.swell_wave_height ?? 0,
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
    temperature: data.current?.temperature_2m ?? 0,
    windSpeed: data.current?.wind_speed_10m ?? 0,
    windDirection: data.current?.wind_direction_10m ?? 0,
    cloudCover: data.current?.cloud_cover ?? 0,
    precipitation: data.current?.precipitation ?? 0,
  };
}

/** Fetch all marine + regular weather for all 3 ports */
export async function fetchAllWeather() {
  const results = await Promise.all(
    PORTS.map(async (port) => {
      const [marine, weather] = await Promise.all([
        fetchMarineWeather(port),
        fetchPortWeather(port),
      ]);
      return { port, marine, weather };
    })
  );
  return results;
}

/** Fetch ship visits from CKAN (latest available resource) */
export async function fetchShipVisits(): Promise<ShipVisit[]> {
  // Search for resources in the formalities dataset - get the latest ones
  const searchUrl = `${CKAN_API}/package_show?id=${FORMALITIES_DATASET}`;
  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error(`CKAN package_show failed: ${res.status}`);
  const pkg = await res.json();

  const resources = pkg.result.resources as Array<{
    id: string;
    name: string;
    description: string;
    datastore_active: boolean;
  }>;

  // Get the last few CNCVESLS and REJVESLS resources that have datastore active
  const activeResources = resources.filter(r => r.datastore_active);
  const lastResources = activeResources.slice(-6); // last 3 pairs

  const visits: ShipVisit[] = [];
  for (const resource of lastResources) {
    try {
      const dsUrl = `${CKAN_API}/datastore_search?resource_id=${resource.id}&limit=100`;
      const dsRes = await fetch(dsUrl);
      if (!dsRes.ok) continue;
      const dsData = await dsRes.json();

      const type = resource.name.startsWith('CNCVESLS') ? 'cancelled' as const : 'rejected' as const;
      for (const record of dsData.result.records) {
        visits.push({
          portCode: record['Osta (Kods)'] ?? '',
          portName: record['Osta (Nosaukums)'] ?? '',
          ship: record['Kuģis'] ?? '',
          visitDate: record['Vizītes datums'] ?? '',
          type,
        });
      }
    } catch {
      // Skip resources that fail
    }
  }

  return visits;
}

/** Fetch latest ferry passenger data */
export async function fetchFerryData(): Promise<FerryData[]> {
  // Get latest ferry resource
  const searchUrl = `${CKAN_API}/package_show?id=${FERRY_DATASET}`;
  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error(`CKAN ferry failed: ${res.status}`);
  const pkg = await res.json();

  const resources = pkg.result.resources as Array<{
    id: string;
    datastore_active: boolean;
  }>;

  const activeResources = resources.filter(r => r.datastore_active);
  const latestResource = activeResources[activeResources.length - 1];
  if (!latestResource) return [];

  const dsUrl = `${CKAN_API}/datastore_search?resource_id=${latestResource.id}&limit=100`;
  const dsRes = await fetch(dsUrl);
  if (!dsRes.ok) return [];
  const dsData = await dsRes.json();

  return dsData.result.records.map((r: Record<string, string>) => ({
    portCode: r['Osta'] ?? '',
    previousNextPort: r['Iepriekšējā/nākamā osta'] ?? '',
    flagCode: r['Prāmja pieraksta valsts (karogs) (Kods)'] ?? '',
    flagName: r['Prāmja pieraksta valsts (karogs) (Nosaukums)'] ?? '',
    passengers: parseInt(r['Pasažieri'] ?? '0', 10),
    date: '', // Derived from resource name
  }));
}
