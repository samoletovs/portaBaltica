import type { EnvironmentData } from '../types';
import { useCountry } from '../CountryContext';
import { TileHeader } from './TileHeader';

interface EnvironmentTileProps {
  data: EnvironmentData | null;
  loading: boolean;
}

/**
 * The three air-quality bands.
 *
 * Colour comes from the semantic tokens rather than raw Tailwind, so both
 * themes follow and both are contrast-checked. The ring used to be
 * `border-yellow-500` and `border-red-500`, which on a white card measure
 * 1.91:1 and 3.81:1 — the moderate ring was very nearly invisible in the light
 * theme, and neither was reachable by the compatibility layer.
 *
 * `rank` is the part that matters most. Good and unhealthy are green and red,
 * and under a deuteranopia simulation they measure **ΔE 8.3** apart in the dark
 * theme — indistinguishable for roughly 8% of men. In light, moderate and
 * unhealthy sit at 23.1, also under the 25 floor. The glyph and the band label
 * were the only other encodings, and a glyph is easy to miss at 14px.
 *
 * So the band is also drawn as an ordinal meter: three segments, filled up to
 * the current band. That is a *position* encoding, which survives any colour
 * vision and greyscale printing, and it suits the data — air quality is
 * ordered, not categorical. See DESIGN.md §3.2.
 */
const AQI_BANDS: Record<string, { token: string; glyph: string; rank: number }> = {
  good: { token: '--data-positive', glyph: '✓', rank: 1 },
  moderate: { token: '--data-warning', glyph: '!', rank: 2 },
  unhealthy: { token: '--data-negative', glyph: '✕', rank: 3 },
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
  const band = aqAvailable && aq.status ? AQI_BANDS[aq.status] ?? null : null;
  const capitals: Record<string, string> = { LV: 'Riga', EE: 'Tallinn', LT: 'Vilnius' };
  const capital = capitals[country] || 'Riga';
  const coverage = data.weatherCoverage;

  return (
    <section>
      <TileHeader title="Environment" meta={`${flag} ${countryLabel} · Open-Meteo`} />

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
          {aqAvailable && band ? (
            <div
              className="rounded-xl p-6"
              style={{
                background: `color-mix(in srgb, var(${band.token}) 10%, var(--bg-card))`,
                border: `1px solid color-mix(in srgb, var(${band.token}) 35%, var(--border-card))`,
              }}
            >
              <p className="text-caption text-slate-400 mb-2">Air Quality · {capital}</p>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                  style={{ border: `3px solid var(${band.token})` }}
                >
                  <span className="text-ui font-semibold" style={{ color: `var(${band.token})` }} aria-hidden="true">
                    {band.glyph}
                  </span>
                </div>
                <div>
                  <p className="text-prose font-semibold" style={{ color: `var(${band.token})` }}>{aq.label}</p>
                  <p className="text-caption text-slate-400">European AQI</p>
                </div>
              </div>
              {/* The ordinal encoding. Good and unhealthy are green and red,
                  which converge under deuteranopia (ΔE 8.3 in dark), so the
                  band cannot be carried by hue. Three segments filled to the
                  current band is a position encoding: it survives any colour
                  vision, and greyscale. */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-1" aria-hidden="true">
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className="h-1.5 w-6 rounded"
                      style={{
                        background: step <= band.rank ? `var(${band.token})` : 'var(--border-card)',
                      }}
                    />
                  ))}
                </div>
                <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
                  Band {band.rank} of 3
                </span>
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
      <TileHeader title="Environment" />
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
