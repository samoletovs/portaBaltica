import type { Port, MarineWeatherForecast, PortWeather } from '../types';
import { classifySeaState, SEA_STATE_LABELS } from '../types';

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
  const seaState = classifySeaState(marine.current.waveHeight);
  const stateInfo = seaState ? SEA_STATE_LABELS[seaState] : null;

  return (
    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 dash-hover-edge transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lead font-semibold dash-fg">{port.name}</h2>
          <p className="text-caption dash-muted font-mono">{port.code}</p>
        </div>
        <div className="text-right">
          {stateInfo ? (
            <span className={`text-ui font-semibold ${stateInfo.color}`}>
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
        <Metric label="Wave Height" value={`${marine.current.waveHeight.toFixed(1)}m`} />
        <Metric label="Sea Temp" value={`${marine.current.seaSurfaceTemp.toFixed(1)}°C`} />
        <Metric label="Wave Period" value={`${marine.current.wavePeriod.toFixed(0)}s`} />
        <Metric label="Swell" value={`${marine.current.swellWaveHeight.toFixed(1)}m`} />
      </div>

      {/* Weather conditions */}
      <div className="border-t border-slate-800/40 pt-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-callout font-semibold dash-fg">{weather.temperature.toFixed(0)}°</p>
            <p className="text-caption dash-muted">Air</p>
          </div>
          <div>
            <p className="text-callout font-semibold dash-fg">{weather.windSpeed.toFixed(0)}</p>
            <p className="text-caption dash-muted">km/h {windDirectionLabel(weather.windDirection)}</p>
          </div>
          <div>
            <p className="text-callout font-semibold dash-fg">{weather.cloudCover}%</p>
            <p className="text-caption dash-muted">Clouds</p>
          </div>
        </div>
      </div>

      {/* 3-day wave mini-chart using simple bars */}
      {marine.hourly.waveHeight.length > 0 && (
        <div className="mt-4 border-t border-slate-800/40 pt-3">
          <p className="text-caption dash-muted mb-2">Wave height — next 72h</p>
          <div className="flex items-end gap-px h-12">
            {marine.hourly.waveHeight.slice(0, 72).map((h, i) => {
              const max = Math.max(...marine.hourly.waveHeight.slice(0, 72), 1);
              const pct = (h / max) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm min-w-0"
                  style={{ height: `${Math.max(pct, 2)}%`, background: 'var(--cat-4)' }}
                  title={`${marine.hourly.time[i]}: ${h.toFixed(1)}m`}
                />
              );
            })}
          </div>
        </div>
      )}

      <p className="text-caption dash-subtle mt-3">{port.description}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800/40 rounded-lg p-2 text-center">
      <p className="text-ui font-semibold dash-fg font-mono">{value}</p>
      <p className="text-caption dash-muted">{label}</p>
    </div>
  );
}
