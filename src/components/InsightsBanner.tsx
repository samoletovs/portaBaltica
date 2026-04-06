import { useState, useEffect } from 'react';
import type { Insight } from '../types';
import { INSIGHT_BADGES } from '../types';

export function InsightsBanner() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-insights')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.insights) setInsights(d.insights); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Insights</h2>
          <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-hover)' }}>Loading...</span>
        </div>
      </section>
    );
  }

  if (insights.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Insights</h2>
        <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-hover)' }}>
          Live
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {insights.map((insight, i) => {
          const badge = INSIGHT_BADGES[insight.level];
          return (
            <div
              key={i}
              className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-1.5 h-1.5 rounded-full ${badge.color === 'text-emerald-400' ? 'bg-emerald-400' : badge.color === 'text-yellow-400' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <span className={`text-xs font-medium ${badge.color}`}>{badge.label}</span>
              </div>
              <p className="text-sm font-semibold text-white mb-1">{insight.headline}</p>
              <p className="text-xs text-slate-300 leading-relaxed">{insight.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
