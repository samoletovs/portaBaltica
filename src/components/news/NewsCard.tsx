import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import type { DashboardSection } from '../../types';
import { Byline } from './Byline';
import { LinkOutCardFromSummary } from './LinkOutCard';
import { SECTION_LABELS } from '../../newsroom/sections';
import { TierBadge } from './TierBadge';

interface CardProps {
  summary: ArticleSummary;
  variant?: 'lead' | 'standard';
}

/** Tier A and B: our own page, our own URL. */
export function ArticleCard({ summary, variant = 'standard' }: CardProps) {
  const isLead = variant === 'lead';
  const section = SECTION_LABELS[summary.section as DashboardSection] ?? summary.section;

  return (
    <article
      data-tier={summary.tier}
      className={
        isLead
          ? 'news-border news-panel rounded-xl border p-6 transition-colors'
          : 'news-border border-b pb-5'
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TierBadge tier={summary.tier} />
        <span className="news-subtle text-[11px] uppercase tracking-widest">{section}</span>
      </div>

      <h2
        className={
          isLead
            ? 'news-fg text-2xl font-semibold leading-tight tracking-tight sm:text-3xl'
            : 'news-fg text-lg font-medium leading-snug'
        }
      >
        <Link
          to={`/article/${summary.slug}`}
          className="news-hover news-focus"
        >
          {summary.headline}
        </Link>
      </h2>

      {summary.dek && (
        <p className={isLead ? 'news-muted mt-3 text-base leading-relaxed' : 'news-muted mt-1.5 text-sm leading-relaxed'}>
          {summary.dek}
        </p>
      )}

      <div className="mt-3">
        {summary.persona ? (
          <Byline persona={summary.persona} timestamp={summary.published_at} />
        ) : (
          <p className="news-subtle text-xs">
            {summary.syndicated?.attribution
              ? `Reproduced verbatim from ${summary.syndicated.attribution}`
              : 'Reproduced verbatim'}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Routes a feed item to the renderer its tier permits.
 *
 * Tier C goes to `LinkOutCard`, which is given only the four fields it is
 * allowed to display. There is no branch here that would let a tier C item
 * render as one of our articles.
 */
export function FeedItem({ summary, variant }: CardProps) {
  if (summary.tier === 'C') return <LinkOutCardFromSummary summary={summary} />;
  return <ArticleCard summary={summary} variant={variant} />;
}
