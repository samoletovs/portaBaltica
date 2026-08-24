import type { ArticleTier } from '../../news-types';

const TIER_STYLES: Record<ArticleTier, { label: string; title: string; className: string }> = {
  A: {
    label: 'Our analysis',
    title: 'Original analysis written from open data we retrieved and checked.',
    className: 'news-tier-accent',
  },
  B: {
    label: 'Official release',
    title: 'An official press release, reproduced verbatim under its licence. Not rewritten.',
    className: 'news-tier-neutral',
  },
  C: {
    label: 'Elsewhere',
    title: 'A third-party story. Headline, the outlet’s own summary, and a link out. Nothing more.',
    className: 'news-tier-neutral border-dashed bg-transparent',
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
