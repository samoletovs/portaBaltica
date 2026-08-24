import type { ArticleTier } from '../../news-types';

const TIER_STYLES: Record<ArticleTier, { label: string; title: string; className: string }> = {
  A: {
    label: 'Our analysis',
    title: 'Original analysis written from open data we retrieved and checked.',
    className: 'border-ocean-500/50 bg-ocean-500/10 text-ocean-200',
  },
  B: {
    label: 'Official release',
    title: 'An official press release, reproduced verbatim under its licence. Not rewritten.',
    className: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  },
  C: {
    label: 'Elsewhere',
    title: 'A third-party story. Headline, the outlet’s own summary, and a link out. Nothing more.',
    className: 'border-dashed border-slate-500/50 bg-transparent text-slate-400',
  },
};

/** Says which of the three tiers a reader is looking at, in words rather than a letter. */
export function TierBadge({ tier }: { tier: ArticleTier }) {
  const style = TIER_STYLES[tier];
  return (
    <span
      title={style.title}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}
