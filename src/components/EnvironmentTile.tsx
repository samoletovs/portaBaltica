import type { EnvironmentData } from '../types';
import { useCountry } from '../CountryContext';

interface EnvironmentTileProps {
  data: EnvironmentData | null;
  loading: boolean;
}

const AQI_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  good: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', ring: 'border-emerald-500' },
  moderate: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', ring: 'border-yellow-500' },
  unhealthy: { bg: 'bg-red-900/30', text: 'text-red-400', ring: 'border-red-500' },
};

const WEATHER_ICONS: Record<string, string> = {
  'Clear sky': '☀️',
  'Partly cloudy': '⛅',
  'Foggy': '🌫️',
  'Drizzle': '🌦️',
  'Rain': '🌧️',
  'Snow': '❄️',
  'Rain showers': '🌧️',
  'Snow showers': '🌨️',
  'Thunderstorm': '⛈️',
};

export function EnvironmentTile({ data, loading }: EnvironmentTileProps) {
  const { countryLabel, flag } = useCountry();
  if (loading) return <TileSkeleton />;
  if (!data) return null;

  const aqiStyle = AQI_STYLES[data.airQuality.status] ?? AQI_STYLES.good;

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-body)' }}>Environment <span className="font-normal normal-case" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel}</span></h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Weather */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5 md:col-span-2">
          <p className="text-xs text-slate-400 mb-3">Current Weather</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.weather.map((w) => (
              <div key={w.city} className="text-center">
                <p className="text-2xl mb-1">{WEATHER_ICONS[w.description] ?? '🌡️'}</p>
                <p className="text-xl font-bold text-white">{w.temperature.toFixed(0)}°</p>
                <p className="text-sm font-medium text-slate-200">{w.city}</p>
                <p className="text-xs text-slate-400">{w.description}</p>
                <p className="text-xs text-slate-500">
                  💨 {w.windSpeed.toFixed(0)} km/h · 💧 {w.humidity}%
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">Open-Meteo API · Europe/Riga timezone</p>
        </div>

        {/* Air quality + Population */}
        <div className="space-y-4">
          {/* Air quality */}
          <div className={`${aqiStyle.bg} backdrop-blur-sm border ${aqiStyle.ring}/30 rounded-xl p-5`}>
            <p className="text-xs text-slate-400 mb-2">Air Quality · Riga</p>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-12 h-12 rounded-full border-3 ${aqiStyle.ring} flex items-center justify-center`}>
                <span className={`text-sm font-bold ${aqiStyle.text}`}>
                  {data.airQuality.status === 'good' ? '✓' : data.airQuality.status === 'moderate' ? '!' : '✕'}
                </span>
              </div>
              <div>
                <p className={`text-lg font-bold ${aqiStyle.text}`}>{data.airQuality.label}</p>
                <p className="text-xs text-slate-400">European AQI</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div>
                <p className="text-sm font-mono text-white">{data.airQuality.pm25.toFixed(1)}</p>
                <p className="text-xs text-slate-400">PM2.5 µg/m³</p>
              </div>
              <div>
                <p className="text-sm font-mono text-white">{data.airQuality.no2.toFixed(1)}</p>
                <p className="text-xs text-slate-400">NO₂ µg/m³</p>
              </div>
            </div>
          </div>

          {/* Population */}
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5">
            <p className="text-xs text-slate-400 mb-1">Riga Population</p>
            <p className="text-2xl font-bold text-white font-mono">
              {data.rigaPopulation.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 mt-1">Declared residents · opendata.riga.lv</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-slate-400">🌤️</span> Environment & Daily Life
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5 md:col-span-2 animate-pulse">
          <div className="h-3 bg-slate-700/30 rounded w-1/4 mb-4" />
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="text-center">
                <div className="h-10 w-10 bg-slate-700/30 rounded-full mx-auto mb-2" />
                <div className="h-4 bg-slate-700/30 rounded w-3/4 mx-auto" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5 animate-pulse">
            <div className="h-12 w-12 bg-slate-700/30 rounded-full mb-2" />
            <div className="h-4 bg-slate-700/30 rounded w-1/2" />
          </div>
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5 animate-pulse">
            <div className="h-3 bg-slate-700/30 rounded w-1/3 mb-2" />
            <div className="h-6 bg-slate-700/30 rounded w-1/2" />
          </div>
        </div>
      </div>
    </section>
  );
}
