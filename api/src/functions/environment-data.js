/**
 * Azure SWA API function: Environment & Daily Life data aggregator.
 * Fetches: Weather (Open-Meteo), Air Quality (LVĢMC), Riga population (OData).
 *
 * GET /api/environment-data
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const RIGA_POP_URL = 'https://opendata.riga.lv/odata/service/DeclaredPersons';

const CITIES = [
  { name: 'Riga', lat: 56.95, lon: 24.11 },
  { name: 'Liepāja', lat: 56.51, lon: 21.01 },
  { name: 'Daugavpils', lat: 55.87, lon: 26.53 },
  { name: 'Jūrmala', lat: 56.97, lon: 23.77 },
];

async function fetchWeather() {
  const results = [];
  for (const city of CITIES) {
    try {
      const params = new URLSearchParams({
        latitude: city.lat.toString(),
        longitude: city.lon.toString(),
        current: 'temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code',
        timezone: 'Europe/Riga',
      });
      const res = await fetch(`${OPEN_METEO}?${params}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();

      const weatherCode = data.current?.weather_code ?? 0;
      results.push({
        city: city.name,
        temperature: data.current?.temperature_2m ?? 0,
        windSpeed: data.current?.wind_speed_10m ?? 0,
        humidity: data.current?.relative_humidity_2m ?? 0,
        description: describeWeather(weatherCode),
      });
    } catch {
      // Skip failed city
    }
  }
  return results;
}

function describeWeather(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

async function fetchAirQuality() {
  try {
    // Use Open-Meteo Air Quality API for Riga
    const params = new URLSearchParams({
      latitude: '56.95',
      longitude: '24.11',
      current: 'pm2_5,nitrogen_dioxide,european_aqi',
      timezone: 'Europe/Riga',
    });
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { pm25: 0, no2: 0, status: 'good', label: 'Good' };
    const data = await res.json();

    const aqi = data.current?.european_aqi ?? 0;
    let status = 'good';
    let label = 'Good';
    if (aqi > 100) { status = 'unhealthy'; label = 'Unhealthy'; }
    else if (aqi > 50) { status = 'moderate'; label = 'Moderate'; }

    return {
      pm25: data.current?.pm2_5 ?? 0,
      no2: data.current?.nitrogen_dioxide ?? 0,
      status,
      label,
    };
  } catch {
    return { pm25: 0, no2: 0, status: 'good', label: 'Good' };
  }
}

async function fetchRigaPopulation() {
  try {
    const res = await fetch(RIGA_POP_URL, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 605802; // Fallback 2025 data
    const data = await res.json();
    const records = data.value ?? data.d?.results ?? [];
    if (records.length === 0) return 605802;
    // Sum all districts
    const total = records.reduce((sum, r) => sum + (r.PersonCount ?? r.Count ?? 0), 0);
    return total > 0 ? total : 605802;
  } catch {
    return 605802;
  }
}

export default async function (request, context) {
  try {
    const [weather, airQuality, rigaPopulation] = await Promise.all([
      fetchWeather(),
      fetchAirQuality(),
      fetchRigaPopulation(),
    ]);

    const result = {
      weather,
      airQuality,
      rigaPopulation,
      fetchedAt: new Date().toISOString(),
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
}
