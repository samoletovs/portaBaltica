import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { EconomyData } from '../types';
import { IndicatorCard } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';
import { IndicatorTable } from './IndicatorTable';
import { TileHeader } from './TileHeader';
import { finite, fixed, list } from '../utils/payload';
import { useTheme } from '../ThemeContext';

import { useCountry } from '../CountryContext';
import { chartTick, chartTooltip, tickInterval } from '../utils/chartType';
import { describeSeries } from '../utils/chartAccessibility';

interface EconomyTileProps {
  data: EconomyData | null;
  loading: boolean;
}

export function EconomyTile({ data, loading }: EconomyTileProps) {
  const { chartColors } = useTheme();
  const { countryLabel, flag, country, timezone } = useCountry();
  return (
    <section>
      <TileHeader title="Economy & markets" meta={`${flag} ${countryLabel} · Eurostat + live feeds`} />

      <div className="space-y-6">

      {/* Key macro indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="gdp" title="GDP growth" unit="% YoY" loading={loading} />
        <IndicatorCard id="salary" title="Hourly labour cost" unit="EUR/hour" loading={loading} />
        <IndicatorCard id="cpi" title="Consumer prices" unit="% YoY" loading={loading} />
        <IndicatorCard id="unemployment" title="Unemployment" unit="%" loading={loading} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="house_prices" title="House prices" unit="% YoY" loading={loading} />
        <IndicatorCard id="retail_sales" title="Retail sales" unit="% YoY" loading={loading} />
        <IndicatorCard id="industrial" title="Industrial output" unit="% YoY" loading={loading} />
        <IndicatorCard id="population" title="Population" unit="persons" loading={loading} />
      </div>

      {/* Live operational data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Electricity — hourly bar chart */}
        <div className="dash-card border dash-edge rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-caption dash-muted font-semibold uppercase tracking-widest">Electricity</p>
            {data && (
              <p className="text-lead font-semibold dash-fg font-mono">
                {finite(data.electricityCurrent) === null ? (
                  // Not "€0.00/MWh", which is what this showed when the fetch
                  // failed — and zero is a real Nord Pool price, so it read as
                  // a reading rather than as an absence.
                  <span className="dash-subtle">—<span className="text-caption font-normal ml-1">/MWh</span></span>
                ) : (
                  <>€{fixed(data.electricityCurrent, 2)}<span className="text-caption font-normal dash-subtle ml-1">/MWh</span></>
                )}
              </p>
            )}
          </div>
          {data && list(data.electricityPrices).length > 0 ? (() => {
            // The day this chart shows and the hours it labels have to be the
            // same day.
            //
            // They were not. The window was selected with
            // `new Date().toISOString().slice(0, 10)` — a *UTC* date — while
            // each bar was labelled with `new Date(p.timestamp).getHours()`,
            // the *local* hour. In Riga, two or three hours ahead of UTC, the
            // UTC day therefore ends at 01:00 or 02:00 the following morning,
            // which is why the axis ran "…19:00, 21:00, 0:00, 1:00" and looked
            // like tomorrow's prices had leaked in. Nothing had: the component
            // was reading one clock and writing another.
            //
            // Both now come from the selected country's timezone, which is the
            // clock in the masthead and the one a reader of a Baltic
            // electricity price means.
            const hourIn = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: timezone });
            const dayIn = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone });
            const today = dayIn.format(new Date());
            const todayPrices = list<{ timestamp: string; price: number }>(data.electricityPrices).filter((p) => dayIn.format(new Date(p.timestamp)) === today);
            const prices = todayPrices.length > 0 ? todayPrices : list<{ timestamp: string; price: number }>(data.electricityPrices).slice(0, 24);
            // Filtered before the aggregate, not floored after it. `Math.min`
            // coerces `null` to 0 and propagates `NaN`, so a single unpriced
            // interval — which a day-ahead feed routinely contains — printed
            // "Low €0.00" for a day whose real floor was nowhere near zero.
            const priced = prices.map((p) => finite(p.price)).filter((v): v is number => v !== null);
            const minPrice = priced.length > 0 ? Math.min(...priced) : null;
            const maxPrice = priced.length > 0 ? Math.max(...priced) : null;

            return (
              <>
                <div className="flex items-center gap-3 mb-2 text-caption">
                  {minPrice !== null && <span className="dash-positive">Low €{minPrice.toFixed(2)}</span>}
                  {maxPrice !== null && <span className="dash-negative">High €{maxPrice.toFixed(2)}</span>}
                  {finite(data.electricityCurrent) !== null && data.electricityCurrent! < 0 && (
                    <span className="dash-warning dash-tint-warning px-2 py-0.5 rounded">Negative price</span>
                  )}
                </div>
                <div
                  className="h-28"
                  role="img"
                  // Routed through `describeSeries` rather than hand-written,
                  // so the dashboard has one vocabulary for "what is in this
                  // chart" and a reader who has heard one chart described
                  // knows the shape of the next. The period is already a
                  // clock label, so it needs no reformatting.
                  aria-label={describeSeries(
                    "Today's day-ahead electricity price by hour",
                    prices.map((p) => ({
                      period: `${hourIn.format(new Date(p.timestamp))}:00`,
                      value: finite(p.price),
                    })),
                    (v) => (v === null ? 'no price' : `€${v.toFixed(2)} per megawatt hour`),
                  )}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={prices.map((p) => ({
                      // Zero-padded so the labels are a fixed width and the
                      // axis stops jittering between "9:00" and "10:00".
                      hour: `${hourIn.format(new Date(p.timestamp))}:00`,
                      price: p.price,
                    }))}>
                      {/* The tick count is derived from the series, not from an
                          assumption about it. `interval={3}` sat here with a
                          comment claiming "six ticks across a 24-hour day",
                          which was true when the feed was hourly and stopped
                          being true when Elering moved to 15-minute
                          resolution — 88 quarter-hours, 22 labels, 20 of them
                          overlapping at 402px. See `tickInterval`. */}
                      <XAxis dataKey="hour" tick={chartTick(chartColors.axis)} tickLine={false} axisLine={false} interval={tickInterval(prices.length)} />
                      <Tooltip
                        contentStyle={chartTooltip(chartColors.tooltipBg, chartColors.tooltipBorder)}
                        formatter={(v) => [`€${(v as number).toFixed(2)} /MWh`, 'Price']}
                        labelFormatter={(label) => `Today ${label}`}
                      />
                      <Bar dataKey="price" fill={chartColors.seriesDefault} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          })() : (
            <div className="h-28 animate-pulse dash-raised rounded" />
          )}
          <p className="text-caption dash-subtle mt-1">NordPool day-ahead · Elering API</p>
        </div>

        {/* Exchange rates table */}
        <div className="dash-card border dash-edge rounded-xl p-4">
          <p className="text-caption dash-muted font-semibold uppercase tracking-widest mb-3">Exchange rates</p>
          {data ? (
            <div className="space-y-1">
              {list<{ currency: string; name: string; rate: number }>(data.exchangeRates).map((rate) => (
                <div key={rate.currency} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-ui dash-body">EUR/{rate.currency}</span>
                    <span className="text-caption dash-subtle">{rate.name}</span>
                  </div>
                  <span className="text-ui font-mono dash-fg">{fixed(rate.rate, 4)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 dash-skeleton rounded" />)}
            </div>
          )}
          <p className="text-caption dash-subtle mt-2">ECB official rates · Updated daily 16:00 CET</p>
        </div>
      </div>

      {/* Business pulse — Latvia only (data.gov.lv registries) */}
      {data && country === 'LV' && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="VAT-registered businesses"
              hint="Currently active payers in the VID VAT register"
              value={finite(data.businessPulse?.activeVatPayers)}
            />
            <StatCard
              label="Suspended activities"
              hint="Businesses barred by VID from trading: suspension decided, never lifted, and not yet expired"
              value={finite(data.businessPulse?.suspendedBusinesses)}
            />
          </div>
          <p className="text-caption dash-subtle mt-2">
            State Revenue Service registers via data.gov.lv
          </p>
        </div>
      )}

      {/* Baltic comparison */}
      <div>
        <h3 className="text-callout font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Baltic comparison</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="inflation" title="Inflation (HICP)" compact />
          <BalticCompareChart indicator="core_inflation" title="Core inflation" compact />
          <BalticCompareChart indicator="energy_inflation" title="Energy inflation" compact />
          <BalticCompareChart indicator="food_inflation" title="Food inflation" compact />
          <BalticCompareChart indicator="services_inflation" title="Services inflation" compact />
          <BalticCompareChart indicator="goods_inflation" title="Goods inflation" compact />
          <BalticCompareChart indicator="house_prices" title="House prices across the Baltics" compact />
          <BalticCompareChart indicator="industrial" title="Industrial production" compact />
          <BalticCompareChart indicator="business_registrations" title="New business registrations" compact />
          <BalticCompareChart indicator="bankruptcies" title="Bankruptcy declarations" compact />
        </div>
      </div>

      {/* Indicator table */}
      <IndicatorTable />
      </div>
    </section>
  );
}

/**
 * A single registry count.
 *
 * `null` renders as a dash and an explicit "unavailable", never as `0`. These
 * numbers come from an upstream portal that answers 404 for datasets that have
 * been renamed, and the previous version turned every such failure into a
 * confident zero — which is how "Suspended Activities: 0" survived on the
 * dashboard while the dataset it named did not exist.
 *
 * There is deliberately no way to tint one of these. "Suspended activities"
 * was drawn in amber, and amber is a *status* colour: Fluent's rule is "use
 * them for important messages, don't use them for decoration", and DESIGN.md
 * §1.5 repeats it. 3,693 suspensions is a steady-state registry total that has
 * been the same order of magnitude for years — not a warning, and nothing on
 * the page justified telling a reader it was one. It is the same error
 * DESIGN.md §3.5 exists to prevent, a rise being read as bad news, applied to
 * a single number instead of to a chart. A count with no comparison has no
 * direction to colour, so it gets none.
 */
function StatCard({ label, hint, value }: { label: string; hint?: string; value: number | null }) {
  const available = typeof value === 'number' && Number.isFinite(value);

  return (
    <div className="dash-card border dash-edge rounded-xl p-3 text-center" title={hint}>
      <p
        className="text-prose font-semibold font-mono"
        style={{ color: available ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
      >
        {available ? value.toLocaleString() : '—'}
      </p>
      <p className="text-caption dash-muted">{label}</p>
      {!available && <p className="text-caption dash-subtle">Unavailable</p>}
    </div>
  );
}
