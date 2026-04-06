import { IndicatorCard } from './IndicatorCard';

export function LabourTile() {
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-body)' }}>Labour market</h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Latvia · CSP data</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <IndicatorCard id="salary" title="Average salary" unit="EUR/month" />
        <IndicatorCard id="unemployment" title="Unemployment" unit="%" />
        <IndicatorCard id="wages_industry" title="Manufacturing wages" unit="EUR/month" />
        <IndicatorCard id="wages_it" title="IT sector wages" unit="EUR/month" />
      </div>
    </section>
  );
}
