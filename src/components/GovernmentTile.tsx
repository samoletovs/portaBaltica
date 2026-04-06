import { IndicatorCard } from './IndicatorCard';

export function GovernmentTile() {
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Government & fiscal</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Latvia · CSP data</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="gov_revenue" title="Government revenue" unit="M EUR" />
        <IndicatorCard id="gov_debt" title="Government debt" unit="M EUR" />
        <IndicatorCard id="biz_confidence" title="Economic sentiment" unit="index" />
        <IndicatorCard id="population" title="Population" unit="persons" />
      </div>
    </section>
  );
}
