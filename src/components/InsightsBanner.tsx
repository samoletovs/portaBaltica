import { useState, useEffect } from 'react';
import type { Insight } from '../types';
import { INSIGHT_BADGES } from '../types';
import { useCountry } from '../CountryContext';
import { useOverflowFade } from '../utils/useOverflowFade';

export function InsightsBanner() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const { country } = useCountry();
  const [fadeRef, fadeClass] = useOverflowFade<HTMLDivElement>();

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
          <h2 className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
          <span className="text-caption px-2 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card-hover)' }}>Refreshing</span>
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
        <h2 className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
        <span className="text-caption px-2 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card-hover)' }}>
          Live
        </span>
      </div>
      {/* The row scrolls sideways when there are more insights than fit, and
          used to clip dead at the right edge with nothing to say so. The mask
          lets the last card fade rather than be severed. */}
      <div ref={fadeRef} className={`flex gap-3 overflow-x-auto pb-2 scrollbar-hide ${fadeClass}`} aria-live="polite">
        {insights.map((insight, i) => {
          // An unrecognised level used to take the whole dashboard down: this
          // read `badge.color` straight off the lookup, so one unexpected
          // string from the insights endpoint threw and the ErrorBoundary
          // replaced the entire page with "Something went wrong". A tile fed by
          // a generative upstream should degrade to a plain badge, not to a
          // blank screen.
          const badge = INSIGHT_BADGES[insight.level] ?? { label: insight.level, color: '', emoji: '' };
          const dot =
            badge.color === 'text-emerald-400'
              ? 'bg-emerald-400'
              : badge.color === 'text-yellow-400'
                ? 'bg-yellow-400'
                : 'bg-red-400';
          return (
            <div
              key={`${insight.level}-${insight.headline}-${i}`}
              className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className={`text-caption ${badge.color}`}>{badge.label}</span>
              </div>
              <p className="text-ui font-semibold text-white mb-1">{insight.headline}</p>
              <p className="text-caption text-slate-300 leading-relaxed">{insight.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
