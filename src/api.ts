import type { MarineWeatherForecast, PortWeather, Port, PortDataResponse } from './types';
import { PORTS } from './types';

const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const OPEN_METEO_WEATHER = 'https://api.open-meteo.com/v1/forecast';

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

const PORT_DATA_CACHE_KEY = 'portabaltica_port_data';
const PORT_DATA_CACHE_TTL = 60 * 60 * 1000; // 1 hour — data.gov.lv updates biweekly

/** Fetch all port data (ship visits, ferry, cargo) via SWA API proxy to bypass CORS.
 *  Caches in localStorage for 1 hour to reduce API calls. */
export async function fetchPortData(): Promise<PortDataResponse> {
  // Check cache
  try {
    const cached = localStorage.getItem(PORT_DATA_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < PORT_DATA_CACHE_TTL) {
        console.log('Using cached port data');
        return data;
      }
    }
  } catch { /* ignore cache errors */ }

  const res = await fetch('/api/port-data');
  if (!res.ok) throw new Error(`Port data API failed: ${res.status}`);
  const data: PortDataResponse = await res.json();

  // Save to cache
  try {
    localStorage.setItem(PORT_DATA_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore storage errors */ }

  return data;
}
