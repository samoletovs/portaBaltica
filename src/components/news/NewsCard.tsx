import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import type { DashboardSection } from '../../types';
import { Byline } from './Byline';
import { LinkOutCardFromSummary } from './LinkOutCard';
import { SECTION_LABELS } from '../../newsroom/sections';
import { FormatBadge } from './FormatBadge';
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
          : 'news-border border-b pb-6'
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TierBadge tier={summary.tier} />
        <FormatBadge format={summary.format} />
        <span className="news-subtle text-caption font-semibold uppercase tracking-widest">
          {section}
        </span>
      </div>

      <h2
        className={
          isLead
            ? 'balance-text news-fg text-headline font-semibold tracking-tight sm:text-display'
            : 'balance-text news-fg text-lead font-semibold'
        }
      >
        <Link
          to={`/article/${summary.slug}`}
          className="news-hover"
        >
          {summary.headline}
        </Link>
      </h2>

      {summary.dek && (
        <p
          className={
            isLead
              ? 'pretty-text news-muted mt-3 text-lead'
              : 'pretty-text news-muted mt-2 text-callout'
          }
        >
          {summary.dek}
        </p>
      )}

      <div className="mt-3">
        {summary.persona ? (
          <Byline persona={summary.persona} timestamp={summary.published_at} />
        ) : (
          <p className="news-subtle text-caption">
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
