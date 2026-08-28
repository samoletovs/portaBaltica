import type { EnvironmentData } from '../types';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { TileHeader } from './TileHeader';
import { fixed, list } from '../utils/payload';

/**
 * Demography, and why it is drawn without a verdict.
 *
 * `demo_r_mwk_ts` is the only weekly series on the site. Every other Eurostat
 * table here is monthly or slower, so this is the one place a reader can watch
 * something at a tempo a person lives at — a flu wave is visible in it and is
 * invisible in a monthly series. That is its value, and it is worth the space
 * even though the newest observation is about seven weeks old: fifty-two
 * observations a year is a different instrument from twelve, however far
 * behind both of them run.
 *
 * Three deliberate refusals, because a death count is the series on this
 * dashboard most easily turned into a claim nobody measured.
 *
 *   - **No sentiment colour.** `BalticCompareChart` draws flag colours and
 *     applies no polarity at all, and `weekly_deaths` is absent from
 *     `POLARITY`, so nothing here is coloured by whether a number went the way
 *     someone would prefer. A rise in deaths is bad news, unambiguously — but
 *     the reason to keep colour out is that most of what this chart shows is
 *     seasonality, and painting January red every year would be a verdict on
 *     winter.
 *   - **No rate.** Eurostat publishes the count; a per-100 000 figure would
 *     have to be computed here against a population from a different table
 *     with a different vintage, which is a derived statistic with no
 *     provenance. The count is what the source says.
 *   - **So the levels are not comparable, and the card says so.** Lithuania's
 *     line sits above Latvia's because Lithuania is larger. A reader comparing
 *     heights learns about population and believes they learned about
 *     mortality, and no amount of colour or axis work fixes that — only a
 *     sentence does.
 */
const WEEKLY_DEATHS_NOTE =
  'Counts, not rates: Lithuania sits highest because its population is largest, ' +
  'so the shapes are comparable and the levels are not. Mortality is strongly ' +
  'seasonal — every winter is a peak.';

interface EnvironmentTileProps {
  data: EnvironmentData | null;
  loading: boolean;
}

/**
 * The six European air-quality bands.
 *
 * Six, not three, because the index we fetch is the EEA's `european_aqi` and
 * the EEA runs it in six bands at 20/40/60/80/100. This used to carry three,
 * split at the **US EPA's** 50 and 100 with the EPA's word "Unhealthy" — a
 * European index banded on an American scale. Measured over 6696 hourly
 * readings from the three capitals, 76.1% of them named the air better than the
 * European scale does and none named it worse.
 *
 * Colour comes from the semantic tokens rather than raw Tailwind, so both
 * themes follow and both are contrast-checked. The ring used to be
 * `border-yellow-500` and `border-red-500`, which on a white card measure
 * 1.91:1 and 3.81:1 — the moderate ring was very nearly invisible in the light
 * theme, and neither was reachable by the compatibility layer.
 *
 * `rank` is the part that matters most. Good and the worst band are green and
 * red, and under a deuteranopia simulation they measure **ΔE 8.3** apart in the
 * dark theme — indistinguishable for roughly 8% of men. In light, moderate and
 * unhealthy sat at 23.1, also under the 25 floor. The glyph and the band label
 * were the only other encodings, and a glyph is easy to miss at 14px.
 *
 * So the band is also drawn as an ordinal meter: one segment per band, filled
 * up to the current one. That is a *position* encoding, which survives any
 * colour vision and greyscale printing, and it suits the data — air quality is
 * ordered, not categorical. See DESIGN.md §3.2.
 *
 * **Colour and glyph carry four steps and group the same bands.** There are
 * four semantic tokens and six bands, so some must share; what must not happen
 * is colour and glyph grouping *differently*, which is the defect that had five
 * sea states rendering in three colours beside a five-step emoji. The colour
 * changes at 40 — where the EEA's own "Moderate" begins and it first advises
 * sensitive groups to consider easing off — and the meter and label carry the
 * full six.
 */
const AQI_BANDS: Record<string, { token: string; glyph: string; rank: number }> = {
  'good': { token: '--data-positive', glyph: '✓', rank: 1 },
  'fair': { token: '--data-positive', glyph: '✓', rank: 2 },
  'moderate': { token: '--data-neutral', glyph: '~', rank: 3 },
  'poor': { token: '--data-warning', glyph: '!', rank: 4 },
  'very-poor': { token: '--data-negative', glyph: '✕', rank: 5 },
  'extremely-poor': { token: '--data-negative', glyph: '✕', rank: 6 },
};

/** How many segments the ordinal meter draws. */
const AQI_BAND_COUNT = Object.keys(AQI_BANDS).length;

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

  // Weekly deaths are Eurostat and cover all three countries, so they do not
  // depend on the Open-Meteo payload arriving. Returning `null` for the whole
  // tile took a working Baltic-wide series down with a weather API.
  if (!data) {
    return (
      <section>
        <TileHeader title="Environment" />
        <WeeklyDeaths />
      </section>
    );
  }

  // `AQI_STYLES.good` was the fallback for an unknown status, so a failed
  // reading was painted in the same green as clean air. An unavailable
  // measurement now has no colour of its own to borrow.
  const aq = data.airQuality ?? { available: false, status: null, label: '', pm25: null, no2: null };
  const aqAvailable = aq.available !== false && aq.status !== null;
  const band = aqAvailable && aq.status ? AQI_BANDS[aq.status] ?? null : null;
  // `!data` says a payload arrived, not that it carries a weather array.
  const weather = list<{
    city: string;
    temperature: number | null;
    description: string | null;
    windSpeed: number | null;
    humidity: number | null;
  }>(data.weather);
  const capitals: Record<string, string> = { LV: 'Riga', EE: 'Tallinn', LT: 'Vilnius' };
  const capital = capitals[country] || 'Riga';
  const coverage = data.weatherCoverage;

  return (
    <section>
      <TileHeader title="Environment" meta={`${flag} ${countryLabel} · Open-Meteo`} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Weather */}
        <div className="dash-card border dash-edge rounded-xl p-6 md:col-span-2">
          <p className="text-caption dash-muted mb-3">Current Weather</p>
          {weather.length === 0 ? (
            <p className="text-ui dash-muted">No city reported a reading just now.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {weather.map((w) => (
                <div key={w.city} className="text-center">
                  <p className="text-title mb-1">{WEATHER_ICONS[w.description ?? ''] ?? '🌡️'}</p>
                  <p className="text-lead font-semibold dash-fg">
                    {w.temperature !== null ? `${fixed(w.temperature, 0)}°` : '—'}
                  </p>
                  <p className="text-ui dash-body">{w.city}</p>
                  <p className="text-caption dash-muted">{w.description ?? 'no reading'}</p>
                  <p className="text-caption dash-subtle">
                    💨 {w.windSpeed !== null ? `${fixed(w.windSpeed, 0)} km/h` : '—'}
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
          <p className="text-caption dash-subtle mt-3">Open-Meteo API · {timezone}</p>
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
              <p className="text-caption dash-muted mb-2">Air Quality · {capital}</p>
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
                  <p className="text-caption dash-muted">European AQI</p>
                </div>
              </div>
              {/* The ordinal encoding. The best and worst bands are green and
                  red, which converge under deuteranopia (ΔE 8.3 in dark), so the
                  band cannot be carried by hue. One segment per band, filled to
                  the current one, is a position encoding: it survives any colour
                  vision, and greyscale. Six segments because the European index
                  has six bands — it drew three while the scale had six, so the
                  meter itself was understating. */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-1" aria-hidden="true">
                  {Array.from({ length: AQI_BAND_COUNT }, (_, i) => i + 1).map((step) => (
                    <span
                      key={step}
                      className="h-1.5 w-4 rounded"
                      style={{
                        background: step <= band.rank ? `var(${band.token})` : 'var(--border-card)',
                      }}
                    />
                  ))}
                </div>
                <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
                  Band {band.rank} of {AQI_BAND_COUNT}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-ui font-mono dash-fg">
                    {fixed(aq.pm25, 1)}
                  </p>
                  <p className="text-caption dash-muted">PM2.5 µg/m³</p>
                </div>
                <div>
                  <p className="text-ui font-mono dash-fg">
                    {fixed(aq.no2, 1)}
                  </p>
                  <p className="text-caption dash-muted">NO₂ µg/m³</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="dash-card border dash-edge rounded-xl p-6">
              <p className="text-caption dash-muted mb-2">Air Quality · {capital}</p>
              <p className="text-ui" style={{ color: 'var(--data-warning)' }}>
                No reading available right now.
              </p>
              <p className="text-caption dash-subtle mt-1">
                This is not a clean-air reading. The measurement could not be taken.
              </p>
            </div>
          )}

          {/* Population */}
          <div className="dash-card border dash-edge rounded-xl p-6">
            <p className="text-caption dash-muted mb-1">{capital} area population</p>
            <p className="text-title font-semibold dash-fg font-mono">
              {(data.capitalPopulation ?? data.rigaPopulation) != null
                ? (data.capitalPopulation ?? data.rigaPopulation ?? 0).toLocaleString()
                : '—'}
            </p>
            <p className="text-caption dash-subtle mt-1">
              {data.capitalPopulationLabel ?? `${capital} region`}
              {data.capitalPopulationYear ? ` · ${data.capitalPopulationYear}` : ''}
            </p>
            <p className="text-caption dash-subtle mt-0.5">{data.capitalPopulationSource ?? 'Eurostat'}</p>
          </div>
        </div>
      </div>

      <WeeklyDeaths />
    </section>
  );
}

function WeeklyDeaths() {
  return (
    <div className="mt-4">
      <BalticCompareChart
        indicator="weekly_deaths"
        title="Deaths per week"
        note={WEEKLY_DEATHS_NOTE}
        compact
      />
    </div>
  );
}

function TileSkeleton() {
  return (
    <section>
      <TileHeader title="Environment" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="dash-card border dash-edge rounded-xl p-6 md:col-span-2 animate-pulse">
          <div className="h-3 dash-skeleton rounded w-1/4 mb-4" />
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="text-center">
                <div className="h-10 w-10 dash-skeleton rounded-full mx-auto mb-2" />
                <div className="h-4 dash-skeleton rounded w-3/4 mx-auto" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="dash-card border dash-edge rounded-xl p-6 animate-pulse">
            <div className="h-12 w-12 dash-skeleton rounded-full mb-2" />
            <div className="h-4 dash-skeleton rounded w-1/2" />
          </div>
          <div className="dash-card border dash-edge rounded-xl p-6 animate-pulse">
            <div className="h-3 dash-skeleton rounded w-1/3 mb-2" />
            <div className="h-6 dash-skeleton rounded w-1/2" />
          </div>
        </div>
      </div>
    </section>
  );
}
