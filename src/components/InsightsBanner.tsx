import { useState, useEffect } from 'react';
import type { Insight } from '../types';
import { INSIGHT_BADGES } from '../types';
import { useCountry } from '../CountryContext';
import { useOverflowFade } from '../utils/useOverflowFade';

/**
 * The scrolling row of insight cards, as its own component.
 *
 * Not a tidy-up. `useOverflowFade` attaches in an effect, and an effect runs
 * once when its **owner** mounts. `InsightsBanner` mounts in its loading state,
 * which returns a different element entirely, so the effect ran against a null
 * ref — and a ref object cannot re-trigger an effect when it is later filled.
 * The result was a fade that is spread onto the element, present in the source,
 * and dead: measured at 320px the row hid **1061px** with `mask: NONE`, and the
 * first card's live figure was cut mid-word as *"Highest ter"*. A reader cannot
 * tell a truncated number from a short one.
 *
 * Reading the source called this correct, which is why the check that catches
 * it is a live one that reads the computed mask
 * (`tests/reducedMotionLayout.live.test.ts`). `NewsFeed`'s section filter had
 * the identical fault and the identical fix: let the element arrive together
 * with its own hook.
 */
function InsightsRow({ insights }: { insights: Insight[] }) {
  const [fadeRef, fadeClass] = useOverflowFade<HTMLDivElement>();

  return (
    <div
      ref={fadeRef}
      className={`flex gap-3 overflow-x-auto pb-2 scrollbar-hide ${fadeClass}`}
      aria-live="polite"
    >
      {insights.map((insight, i) => {
        // An unrecognised level used to take the whole dashboard down: this
        // read `badge.color` straight off the lookup, so one unexpected
        // string from the insights endpoint threw and the ErrorBoundary
        // replaced the entire page with "Something went wrong". A tile fed by
        // a generative upstream should degrade to a plain badge, not to a
        // blank screen.
        const badge = INSIGHT_BADGES[insight.level] ?? { label: insight.level, color: '', emoji: '' };
        const dot =
          badge.color === 'dash-positive'
            ? 'dash-fill-positive'
            : badge.color === 'dash-warning'
              ? 'dash-fill-warning'
              : 'dash-fill-negative';
        return (
          <div
            key={`${insight.level}-${insight.headline}-${i}`}
            className="dash-card border dash-edge rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className={`text-caption ${badge.color}`}>{badge.label}</span>
            </div>
            <p className="text-ui font-semibold dash-fg mb-1">{insight.headline}</p>
            <p className="text-caption dash-body leading-relaxed">{insight.description}</p>
          </div>
        );
      })}
    </div>
  );
}

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
          <h2 className="text-title font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
          <span className="text-caption px-2 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card-hover)' }}>Refreshing</span>
        </div>
        {/* `overflow-hidden`, not `overflow-x-auto`: three fixed-width
            placeholders overflow a phone, and a skeleton has nothing to scroll
            *to*. Leaving it scrollable created a region a reader could swipe
            into empty space, and — because it is only on screen while the
            fetch is in flight — it appeared in the live sweep's unfaded list
            on one run and not the next. A flaky offender is worse than a
            steady one: it makes the assertion that catches it untrustworthy. */}
        <div className="flex gap-3 overflow-hidden pb-2 scrollbar-hide" role="status" aria-label="Loading insights">
          {[1, 2, 3].map((placeholder) => (
            <div key={placeholder} className="dash-card border dash-edge rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0 animate-pulse">
              <div className="h-3 w-20 rounded dash-skeleton mb-3" />
              <div className="h-4 w-3/4 rounded dash-skeleton mb-2" />
              <div className="h-3 w-full rounded dash-skeleton mb-1" />
              <div className="h-3 w-5/6 rounded dash-skeleton" />
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
        <h2 className="text-title font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
        <span className="text-caption px-2 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card-hover)' }}>
          Live
        </span>
      </div>
      {/* The row scrolls sideways when there are more insights than fit, and
          used to clip dead at the right edge with nothing to say so. The mask
          lets the last card fade rather than be severed — see `InsightsRow`
          for why it has to be a separate component to work at all. */}
      <InsightsRow insights={insights} />
    </section>
  );
}
