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
  /**
   * Whether this article carries a published correction.
   *
   * A prop rather than a field on `summary`, because the answer is not in the
   * index and cannot be put there — see `correctedSlugs` in `src/news-api.ts`
   * for the measurement. The page fetches the log and tells the card.
   *
   * Deliberately a boolean and not a count. See the same comment.
   */
  corrected?: boolean;
}

/**
 * Says that the claim beside this has been corrected.
 *
 * WHY IT SAYS ONLY ONE WORD
 * -------------------------
 * A correction to a headline and a correction to a figure in paragraph four are
 * different things, and this badge says the same thing for both. That is not an
 * oversight, it is the limit of what we know: nothing in `Correction` records
 * WHICH part was wrong.
 *
 * The gap is wider than that. The same log carries entries whose own text says
 * they are not our error at all — "this is a restatement by the source, not a
 * reporting error" — beside entries retracting a claim we made. Measured on
 * 2026-09-01, `previous_value` is the only structured field that could tell
 * them apart and does not: 7 of the 28 entries carry it and it appears on both
 * kinds. Anything finer has to be read out of the prose, which is a word list
 * standing in for a property — the thing this repository keeps being beaten by,
 * and a trap this comment fell into itself before the numbers were checked.
 *
 * Nor can the correction's own words go here instead, so a reader can judge:
 * measured across the same log they run 407 to 1386 characters, median 639 —
 * a paragraph on 18 of the 43 articles on the front page. Truncating to the
 * first sentence does not rescue it either, because first sentences run from 10
 * to 179 characters ("CORRECTED." is a sentence).
 *
 * So: one word, the same word `ArticleView` uses for the notice itself, and the
 * full text one click away on the page that already renders it well. If
 * `Correction` ever gains a structured kind, every surface can say more — and
 * that is a pipeline change rather than this one.
 *
 * WHY IT COMES BEFORE THE HEADLINE
 * --------------------------------
 * `ArticleView` settled this and the argument carries over unchanged: "the
 * notice comes first and unmissably, and the piece follows it, marked ... the
 * ordering is what stops the headline being read before the retraction of it."
 * It is first in the badge row rather than merely in it, so it is the first
 * thing announced for the article — and in the accessibility tree reading order
 * is the only order there is.
 *
 * Colour is composed from `news-warning` and `news-warning-panel`, the two
 * tokens `ArticleView` already pairs for exactly this. A hand-rolled colour
 * would be invisible to `tests/design-system.test.ts`, which computes ratios
 * against declared custom properties.
 *
 * The border is `border-current` rather than `news-border`, and the difference
 * is measured. Of the two badges already shipping, the neutral one borders at
 * 1.43:1 against its own fill and the accent one at 6.67:1 — a strong border is
 * what this system uses for a badge that means something. `news-border` here
 * would have given 1.60:1 dark and 1.43:1 light, the quieter of the two
 * treatments, on the one badge that qualifies a claim. Taking the text colour
 * instead gives 13.33:1 and 6.84:1, and costs no new token.
 */
export function CorrectionBadge() {
  return (
    <span
      title="We have published a correction to this article. The notice is at the top of the piece, and the full text is in our corrections log."
      className="news-warning news-warning-panel inline-flex items-center rounded-full border border-current px-2 py-0.5 text-caption font-semibold uppercase tracking-widest"
    >
      Corrected
    </span>
  );
}

/**
 * Said once, quietly, when the correction log could not be read.
 *
 * Lives beside `CorrectionBadge` deliberately. The marker and the notice that
 * the marker is missing are two halves of one statement — a surface that shows
 * one without the other is telling a reader something it does not know. Keeping
 * them in one file is what stops a page acquiring the first and forgetting the
 * second.
 *
 * `role="status"` rather than `alert`: a blob read that did not answer is a
 * disclosure about our own machinery, not an emergency for the reader. The same
 * judgement `WeeklyPage` makes about its "the review has not run" notice.
 */
export function CorrectionsUnavailable() {
  return (
    <p role="status" className="news-warning mb-6 text-ui">
      Correction notices could not be loaded, so nothing here is marked as corrected. Some of these
      articles may be. Our{' '}
      <Link to="/corrections" className="news-link underline underline-offset-4">
        corrections log
      </Link>{' '}
      is the complete record.
    </p>
  );
}

/** Tier A and B: our own page, our own URL. */
export function ArticleCard({ summary, variant = 'standard', corrected = false }: CardProps) {
  const isLead = variant === 'lead';
  const section = SECTION_LABELS[summary.section as DashboardSection] ?? summary.section;

  return (
    <article
      data-tier={summary.tier}
      className={
        isLead
          ? // `p-4` below `sm`: 24px of inner padding each side is 15% of a
            // 320px viewport, and the lead card is the one element whose
            // content is set at 34px, so it pays for that padding in wrapped
            // lines rather than in whitespace. Measured at 320px the headline
            // box is 238px wide and the headline runs to 7 lines at 1.57 words
            // per line.
            'news-border news-panel rounded-xl border p-4 transition-colors sm:p-6'
          : 'news-border border-b pb-6'
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {corrected && <CorrectionBadge />}
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
export function FeedItem({ summary, variant, corrected }: CardProps) {
  if (summary.tier === 'C') return <LinkOutCardFromSummary summary={summary} />;
  return <ArticleCard summary={summary} variant={variant} corrected={corrected} />;
}
