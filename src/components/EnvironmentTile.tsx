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
  'Overcast': '☁️',
  'Foggy': '🌫️',
  'Drizzle': '🌦️',
  'Rain': '🌧️',
  'Snow': '❄️',
  'Rain showers': '🌧️',
  'Snow showers': '🌨️',
  'Thunderstorm': '⛈️',
};

export function EnvironmentTile({ data, loading }: EnvironmentTileProps) {
  const { countryLabel, flag, country, timezone } = useCountry();
  if (loading) return <TileSkeleton />;
  if (!data) return null;

  // `AQI_STYLES.good` was the fallback for an unknown status, so a failed
  // reading was painted in the same green as clean air. An unavailable
  // measurement now has no colour of its own to borrow.
  const aq = data.airQuality;
  const aqAvailable = aq.available !== false && aq.status !== null;
  const aqiStyle = aqAvailable ? (AQI_STYLES[aq.status ?? 'good'] ?? AQI_STYLES.good) : null;
  const capitals: Record<string, string> = { LV: 'Riga', EE: 'Tallinn', LT: 'Vilnius' };
  const capital = capitals[country] || 'Riga';
  const coverage = data.weatherCoverage;

  return (
    <section>
      <h2 className="balance-text text-title font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>Environment <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel}</span></h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Weather */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 md:col-span-2">
          <p className="text-caption text-slate-400 mb-3">Current Weather</p>
          {data.weather.length === 0 ? (
            <p className="text-ui text-slate-400">No city reported a reading just now.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data.weather.map((w) => (
                <div key={w.city} className="text-center">
                  <p className="text-title mb-1">{WEATHER_ICONS[w.description ?? ''] ?? '🌡️'}</p>
                  <p className="text-lead font-semibold text-white">
                    {w.temperature !== null ? `${w.temperature.toFixed(0)}°` : '—'}
                  </p>
                  <p className="text-ui text-slate-200">{w.city}</p>
                  <p className="text-caption text-slate-400">{w.description ?? 'no reading'}</p>
                  <p className="text-caption text-slate-500">
                    💨 {w.windSpeed !== null ? `${w.windSpeed.toFixed(0)} km/h` : '—'}
                    {' · '}💧 {w.humidity !== null ? `${w.humidity}%` : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
          {coverage && coverage.missing > 0 && (
            // A list one city short is indistinguishable from a country with
            // fewer cities unless it says so.
            <p className="text-caption mt-3" style={{ color: 'var(--data-warning)' }}>
              {coverage.missing} of {coverage.requested} cities did not report just now.
            </p>
          )}
          <p className="text-caption text-slate-500 mt-3">Open-Meteo API · {timezone}</p>
        </div>

        {/* Air quality + Population */}
        <div className="space-y-4">
          {/* Air quality */}
          {aqAvailable && aqiStyle ? (
            <div className={`${aqiStyle.bg} backdrop-blur-sm border ${aqiStyle.ring}/30 rounded-xl p-6`}>
              <p className="text-caption text-slate-400 mb-2">Air Quality · {capital}</p>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-12 h-12 rounded-full border-3 ${aqiStyle.ring} flex items-center justify-center`}>
                  <span className={`text-ui font-semibold ${aqiStyle.text}`}>
                    {aq.status === 'good' ? '✓' : aq.status === 'moderate' ? '!' : '✕'}
                  </span>
                </div>
                <div>
                  <p className={`text-prose font-semibold ${aqiStyle.text}`}>{aq.label}</p>
                  <p className="text-caption text-slate-400">European AQI</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-ui font-mono text-white">
                    {aq.pm25 !== null ? aq.pm25.toFixed(1) : '—'}
                  </p>
                  <p className="text-caption text-slate-400">PM2.5 µg/m³</p>
                </div>
                <div>
                  <p className="text-ui font-mono text-white">
                    {aq.no2 !== null ? aq.no2.toFixed(1) : '—'}
                  </p>
                  <p className="text-caption text-slate-400">NO₂ µg/m³</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
              <p className="text-caption text-slate-400 mb-2">Air Quality · {capital}</p>
              <p className="text-ui" style={{ color: 'var(--data-warning)' }}>
                No reading available right now.
              </p>
              <p className="text-caption text-slate-500 mt-1">
                This is not a clean-air reading. The measurement could not be taken.
              </p>
            </div>
          )}

          {/* Population */}
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
            <p className="text-caption text-slate-400 mb-1">{capital} area population</p>
            <p className="text-title font-semibold text-white font-mono">
              {(data.capitalPopulation ?? data.rigaPopulation) != null
                ? (data.capitalPopulation ?? data.rigaPopulation ?? 0).toLocaleString()
                : '—'}
            </p>
            <p className="text-caption text-slate-500 mt-1">
              {data.capitalPopulationLabel ?? `${capital} region`}
              {data.capitalPopulationYear ? ` · ${data.capitalPopulationYear}` : ''}
            </p>
            <p className="text-caption text-slate-600 mt-0.5">{data.capitalPopulationSource ?? 'Eurostat'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <section>
      <h2 className="text-callout font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-slate-400">🌤️</span> Environment & Daily Life
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 md:col-span-2 animate-pulse">
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
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 animate-pulse">
            <div className="h-12 w-12 bg-slate-700/30 rounded-full mb-2" />
            <div className="h-4 bg-slate-700/30 rounded w-1/2" />
          </div>
          <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 animate-pulse">
            <div className="h-3 bg-slate-700/30 rounded w-1/3 mb-2" />
            <div className="h-6 bg-slate-700/30 rounded w-1/2" />
          </div>
        </div>
      </div>
    </section>
  );
}
