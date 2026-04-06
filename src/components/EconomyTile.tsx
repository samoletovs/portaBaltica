import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { EconomyData } from '../types';
import { IndicatorCard } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';
import { IndicatorTable } from './IndicatorTable';

interface EconomyTileProps {
  data: EconomyData | null;
  loading: boolean;
}

export function EconomyTile({ data, loading }: EconomyTileProps) {
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Economy & markets</h2>
        <span className="text-xs text-slate-500">Latvia · Live data</span>
      </div>

      {/* Key macro indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="gdp" title="GDP growth" unit="% YoY" loading={loading} />
        <IndicatorCard id="salary" title="Average salary" unit="EUR/month" loading={loading} />
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
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Electricity</p>
            {data && (
              <p className="text-xl font-semibold text-white font-mono">
                €{data.electricityCurrent.toFixed(2)}<span className="text-xs font-normal text-slate-500 ml-1">/MWh</span>
              </p>
            )}
          </div>
          {data && data.electricityPrices.length > 0 ? (
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.electricityPrices.map((p) => ({
                  hour: new Date(p.timestamp).getHours() + ':00',
                  price: p.price,
                  isCurrent: new Date(p.timestamp).getHours() === new Date().getHours(),
                }))}>
                  <XAxis dataKey="hour" tick={{ fill: '#7dd3fc', fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
                  <Tooltip
                    contentStyle={{ background: '#0c4a6e', border: '1px solid #075985', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v) => [`€${(v as number).toFixed(2)}/MWh`, 'Price']}
                  />
                  <Bar dataKey="price" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-24 animate-pulse bg-ocean-700/20 rounded" />
          )}
          <p className="text-xs text-slate-600 mt-1">NordPool day-ahead · Elering API</p>
        </div>

        {/* Exchange rates table */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Exchange rates</p>
          {data ? (
            <div className="space-y-1">
              {data.exchangeRates.map((rate) => (
                <div key={rate.currency} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300 font-medium">EUR/{rate.currency}</span>
                    <span className="text-xs text-slate-500">{rate.name}</span>
                  </div>
                  <span className="text-sm font-mono text-white">{rate.rate.toFixed(4)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 bg-ocean-700/40 rounded" />)}
            </div>
          )}
          <p className="text-xs text-slate-600 mt-2">ECB official rates · Updated daily 16:00 CET</p>
        </div>
      </div>

      {/* Business pulse */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard label="VAT Businesses" value={data.businessPulse.newVatRegistrations.toLocaleString()} />
          <StatCard label="Suspended" value={data.businessPulse.suspendedBusinesses.toLocaleString()} color="amber" />
          {data.indicators.map((ind) => (
            <StatCard key={ind.label} label={ind.label} value={ind.value} change={ind.change} />
          ))}
        </div>
      )}

      {/* Baltic comparison */}
      <div>
        <h3 className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Baltic comparison</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalticCompareChart indicator="gdp" title="GDP growth" compact />
          <BalticCompareChart indicator="unemployment" title="Unemployment" compact />
          <BalticCompareChart indicator="inflation" title="Inflation (HICP)" compact />
          <BalticCompareChart indicator="house_prices" title="House prices" compact />
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
    <div className="bg-ocean-900/40 border border-ocean-700/30 rounded-xl p-3 text-center">
      <p className={`text-lg font-bold font-mono ${textColor}`}>{value}</p>
      <p className="text-xs text-ocean-400">{label}</p>
      {change && (
        <p className={`text-xs font-mono ${change.startsWith('+') ? 'text-emerald-400' : change.startsWith('-') ? 'text-red-400' : 'text-ocean-400'}`}>
          {change}
        </p>
      )}
    </div>
  );
}
