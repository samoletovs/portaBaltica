import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { EconomyData } from '../types';
import { IndicatorCard } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';
import { IndicatorTable } from './IndicatorTable';
import { useTheme } from '../ThemeContext';

import { useCountry } from '../CountryContext';
import { chartTick, chartTooltip } from '../utils/chartType';

interface EconomyTileProps {
  data: EconomyData | null;
  loading: boolean;
}

export function EconomyTile({ data, loading }: EconomyTileProps) {
  const { chartColors } = useTheme();
  const { countryLabel, flag, country } = useCountry();
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="balance-text text-title font-semibold" style={{ color: 'var(--text-primary)' }}>Economy & markets</h2>
        <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>{flag} {countryLabel} · Eurostat + live feeds</span>
      </div>

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
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-caption text-slate-400 font-medium uppercase tracking-widest">Electricity</p>
            {data && (
              <p className="text-lead font-semibold text-white font-mono">
                €{data.electricityCurrent.toFixed(2)}<span className="text-caption font-normal text-slate-500 ml-1">/MWh</span>
              </p>
            )}
          </div>
          {data && data.electricityPrices.length > 0 ? (() => {
            // Show only today's 24 hours
            const today = new Date().toISOString().slice(0, 10);
            const todayPrices = data.electricityPrices.filter((p) => p.timestamp.startsWith(today));
            const prices = todayPrices.length > 0 ? todayPrices : data.electricityPrices.slice(0, 24);
            const now = new Date().getHours();
            const minPrice = Math.min(...prices.map((p) => p.price));
            const maxPrice = Math.max(...prices.map((p) => p.price));

            return (
              <>
                <div className="flex items-center gap-3 mb-2 text-caption">
                  <span className="text-emerald-400">Low €{minPrice.toFixed(2)}</span>
                  <span className="text-red-400">High €{maxPrice.toFixed(2)}</span>
                  {data.electricityCurrent < 0 && (
                    <span className="text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">Negative price</span>
                  )}
                </div>
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={prices.map((p) => {
                      const h = new Date(p.timestamp).getHours();
                      return { hour: `${h}:00`, price: p.price, isCurrent: h === now };
                    })}>
                      <XAxis dataKey="hour" tick={chartTick(chartColors.axis)} tickLine={false} axisLine={false} interval={5} />
                      <Tooltip
                        contentStyle={chartTooltip(chartColors.tooltipBg, chartColors.tooltipBorder)}
                        formatter={(v) => [`€${(v as number).toFixed(2)} /MWh`, 'Price']}
                        labelFormatter={(label) => `Today ${label}`}
                      />
                      <Bar dataKey="price" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          })() : (
            <div className="h-28 animate-pulse bg-slate-800/30 rounded" />
          )}
          <p className="text-caption text-slate-600 mt-1">NordPool day-ahead · Elering API</p>
        </div>

        {/* Exchange rates table */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
          <p className="text-caption text-slate-400 font-medium uppercase tracking-widest mb-3">Exchange rates</p>
          {data ? (
            <div className="space-y-1">
              {data.exchangeRates.map((rate) => (
                <div key={rate.currency} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-ui text-slate-300 font-medium">EUR/{rate.currency}</span>
                    <span className="text-caption text-slate-500">{rate.name}</span>
                  </div>
                  <span className="text-ui font-mono text-white">{rate.rate.toFixed(4)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 bg-slate-700/30 rounded" />)}
            </div>
          )}
          <p className="text-caption text-slate-600 mt-2">ECB official rates · Updated daily 16:00 CET</p>
        </div>
      </div>

      {/* Business pulse — Latvia only (CKAN data) */}
      {data && country === 'LV' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatCard label="VAT Registered Businesses" value={data.businessPulse.newVatRegistrations.toLocaleString()} />
          <StatCard label="Suspended Activities" value={data.businessPulse.suspendedBusinesses.toLocaleString()} color="amber" />
        </div>
      )}

      {/* Baltic comparison */}
      <div>
        <h3 className="text-caption text-slate-400 font-medium uppercase tracking-widest mb-3">Baltic comparison</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="gdp" title="GDP growth" compact />
          <BalticCompareChart indicator="unemployment" title="Unemployment" compact />
          <BalticCompareChart indicator="inflation" title="Inflation (HICP)" compact />
          <BalticCompareChart indicator="core_inflation" title="Core inflation" compact />
          <BalticCompareChart indicator="energy_inflation" title="Energy inflation" compact />
          <BalticCompareChart indicator="food_inflation" title="Food inflation" compact />
          <BalticCompareChart indicator="services_inflation" title="Services inflation" compact />
          <BalticCompareChart indicator="goods_inflation" title="Goods inflation" compact />
          <BalticCompareChart indicator="house_prices" title="House prices" compact />
          <BalticCompareChart indicator="industrial" title="Industrial production" compact />
          <BalticCompareChart indicator="business_registrations" title="New business registrations" compact />
          <BalticCompareChart indicator="bankruptcies" title="Bankruptcy declarations" compact />
        </div>
      </div>

      {/* Indicator table */}
      <IndicatorTable />
    </section>
  );
}

function StatCard({ label, value, change, color }: { label: string; value: string; change?: string; color?: string }) {
  const textColor = color === 'amber' ? 'text-amber-400' : 'text-white';
  return (
    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-3 text-center">
      <p className={`text-prose font-semibold font-mono ${textColor}`}>{value}</p>
      <p className="text-caption text-slate-400">{label}</p>
      {change && (
        <p className={`text-caption font-mono ${change.startsWith('+') ? 'text-emerald-400' : change.startsWith('-') ? 'text-red-400' : 'text-slate-400'}`}>
          {change}
        </p>
      )}
    </div>
  );
}
