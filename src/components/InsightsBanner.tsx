import { useState, useEffect } from 'react';
import type { Insight } from '../types';
import { INSIGHT_BADGES } from '../types';
import { useCountry } from '../CountryContext';

export function InsightsBanner() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const { country } = useCountry();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/ai-insights?country=${country.toLowerCase()}`);
        const payload = response.ok ? await response.json() : null;
        if (!cancelled) {
          setInsights(payload?.insights ?? []);
        }
      } catch {
        if (!cancelled) {
          setInsights([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [country]);

  if (loading) {
    return (
      <section className="mb-6" aria-live="polite" aria-busy="true">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Insights</h2>
          <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-hover)' }}>Refreshing</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" role="status" aria-label="Loading insights">
          {[1, 2, 3].map((placeholder) => (
            <div key={placeholder} className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0 animate-pulse">
              <div className="h-3 w-20 rounded bg-slate-700/40 mb-3" />
              <div className="h-4 w-3/4 rounded bg-slate-700/30 mb-2" />
              <div className="h-3 w-full rounded bg-slate-700/20 mb-1" />
              <div className="h-3 w-5/6 rounded bg-slate-700/20" />
            </div>
          ))}
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
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" aria-live="polite">
        {insights.map((insight, i) => {
          const badge = INSIGHT_BADGES[insight.level];
          return (
            <div
              key={`${insight.level}-${insight.headline}-${i}`}
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
