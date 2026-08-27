import type { Port, MarineWeatherForecast, PortWeather } from '../types';
import { classifySeaState, SEA_STATE_LABELS } from '../types';
import { fixed, finite, list } from '../utils/payload';

interface PortCardProps {
  port: Port;
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export function PortCard({ port, marine, weather }: PortCardProps) {
  const seaState = classifySeaState(marine.current?.waveHeight);
  const stateInfo = seaState ? SEA_STATE_LABELS[seaState] : null;
  // Narrowed once here rather than re-read inside the JSX. `finite()` returns
  // the value or null, so using its result is what actually proves the reading
  // exists — testing it and then reading the raw field again asserts the same
  // thing twice and only the second one reaches `windDirectionLabel`.
  const windDirection = finite(weather?.windDirection);
  // `classifySeaState` already treats an absent wave height as unknown, and
  // every reading below came from the same payload — so guarding one and
  // calling `.toFixed()` straight on the others would have the card announce
  // "sea state unavailable" and then throw on the next line. `fixed` is the
  // helper written for exactly this and renders an em dash instead.
  //
  // The forecast bars are filtered rather than formatted, because a null there
  // is worse than a crash: `(null / max) * 100` is `NaN`, `height: NaN%` is
  // dropped silently by CSS, and the bar renders at the container's height —
  // an absent hour drawn as tall as a real one. That is the EU-funds bars
  // defect (DESIGN.md §3.8) in a different component.
  const forecast = list<number>(marine.hourly?.waveHeight)
    .slice(0, 72)
    .flatMap((height, i) => {
      const value = finite(height);
      return value === null ? [] : [{ height: value, time: marine.hourly?.time?.[i] }];
    });
  const peak = Math.max(...forecast.map((p) => p.height), 1);

  return (
    <div className="dash-card border dash-edge rounded-xl p-6 dash-hover-edge transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lead font-semibold dash-fg">{port.name}</h2>
          <p className="text-caption dash-muted font-mono">{port.code}</p>
        </div>
        <div className="text-right">
          {stateInfo ? (
            <span className="text-ui font-semibold" style={{ color: stateInfo.token }}>
              {stateInfo.emoji} {stateInfo.label}
            </span>
          ) : (
            <span className="text-ui" style={{ color: 'var(--text-tertiary)' }}>
              Sea state unavailable
            </span>
          )}
        </div>
      </div>

      {/* Marine conditions */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Metric label="Wave Height" value={`${fixed(marine.current?.waveHeight, 1)}m`} />
        <Metric label="Sea Temp" value={`${fixed(marine.current?.seaSurfaceTemp, 1)}°C`} />
        <Metric label="Wave Period" value={`${fixed(marine.current?.wavePeriod, 0)}s`} />
        <Metric label="Swell" value={`${fixed(marine.current?.swellWaveHeight, 1)}m`} />
      </div>

      {/* Weather conditions */}
      <div className="border-t dash-edge pt-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-callout font-semibold dash-fg">{fixed(weather?.temperature, 0)}°</p>
            <p className="text-caption dash-muted">Air</p>
          </div>
          <div>
            <p className="text-callout font-semibold dash-fg">{fixed(weather?.windSpeed, 0)}</p>
            <p className="text-caption dash-muted">
              km/h {windDirection === null
                ? '—'
                : windDirectionLabel(windDirection)}
            </p>
          </div>
          <div>
            <p className="text-callout font-semibold dash-fg">{fixed(weather?.cloudCover, 0)}%</p>
            <p className="text-caption dash-muted">Clouds</p>
          </div>
        </div>
      </div>

      {/* 3-day wave mini-chart using simple bars */}
      {forecast.length > 0 && (
        <div className="mt-4 border-t dash-edge pt-3">
          <p className="text-caption dash-muted mb-2">Wave height — next 72h</p>
          <div className="flex items-end gap-px h-12">
            {forecast.map((point, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm min-w-0"
                style={{
                  height: `${Math.max((point.height / peak) * 100, 2)}%`,
                  background: 'var(--cat-4)',
                }}
                title={`${point.time ?? 'unknown time'}: ${point.height.toFixed(1)}m`}
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-caption dash-subtle mt-3">{port.description}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dash-raised rounded-lg p-2 text-center">
      <p className="text-ui font-semibold dash-fg font-mono">{value}</p>
      <p className="text-caption dash-muted">{label}</p>
    </div>
  );
}
