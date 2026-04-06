import type { Insight } from '../types';
import { INSIGHT_BADGES } from '../types';

interface InsightsBannerProps {
  insights: Insight[];
}

export function InsightsBanner({ insights }: InsightsBannerProps) {
  if (insights.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-ocean-400 text-sm">✨</span>
        <h2 className="text-sm font-semibold text-ocean-300">AI Insights</h2>
        <span className="text-xs text-ocean-500 bg-ocean-800/40 px-2 py-0.5 rounded-full">
          Updated today
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {insights.map((insight, i) => {
          const badge = INSIGHT_BADGES[insight.level];
          return (
            <div
              key={i}
              className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-xl p-4 min-w-[280px] max-w-[340px] flex-shrink-0 hover:border-ocean-500/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <span>{badge.emoji}</span>
                <span className={`text-xs font-semibold ${badge.color}`}>{badge.label}</span>
              </div>
              <p className="text-sm font-semibold text-white mb-1">{insight.headline}</p>
              <p className="text-xs text-ocean-300 leading-relaxed">{insight.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Generate sample insights based on live data characteristics */
export function generateSampleInsights(): Insight[] {
  return [
    {
      headline: 'Electricity prices stable this week',
      description: 'Latvia day-ahead prices averaging €45/MWh, in line with seasonal norms. Wind generation across Baltics remains strong.',
      level: 'routine',
      category: 'economy',
      timestamp: new Date().toISOString(),
    },
    {
      headline: 'Construction permit activity rising',
      description: 'New building permits up 12% vs. last month, concentrated in Riga suburbs and Mārupe municipality. Residential dominates.',
      level: 'notable',
      category: 'property',
      timestamp: new Date().toISOString(),
    },
    {
      headline: 'Air quality excellent in Riga',
      description: 'PM2.5 levels well below WHO guidelines. Favorable wind patterns clearing urban pollution. Outdoor activities recommended.',
      level: 'routine',
      category: 'environment',
      timestamp: new Date().toISOString(),
    },
  ];
}
