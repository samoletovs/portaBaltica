import type { ArticleSummary } from '../../news-types';

/**
 * Tier C — link-out only.
 *
 * We show the outlet's headline, the snippet the outlet itself published in
 * its RSS `<description>`, the attribution and a link back. Nothing else, ever.
 *
 * The component takes the four fields it is allowed to show rather than the
 * whole article, so there is no code path by which a body block, a rewrite or
 * a paraphrase could reach the page even if one were somehow present in the
 * JSON. That is a structural guarantee, not a convention: EU DSM Art. 15 and
 * Google's scaled-content-abuse policy both make a rewritten feed item the
 * single most expensive mistake this portal could make.
 *
 * Visually it is deliberately not one of our article cards. Dashed rule,
 * outlet name first, and an explicit statement that the reader is leaving.
 */

interface Props {
  headline: string;
  /** Verbatim from the outlet's own feed. Never rewritten, never expanded. */
  snippet?: string;
  attribution: string;
  originalUrl: string;
  publishedAt?: string;
}

export function LinkOutCard({ headline, snippet, attribution, originalUrl, publishedAt }: Props) {
  const when = publishedAt ? new Date(publishedAt) : null;

  return (
    <article
      className="group border-l-2 border-dashed border-slate-600/70 bg-slate-900/30 py-3 pl-4 pr-3 transition-colors hover:bg-slate-900/60"
      data-tier="C"
      aria-label={`External story from ${attribution}`}
    >
      <p className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-slate-500">
        <span aria-hidden="true">↗</span>
        <span>{attribution}</span>
      </p>

      <h3 className="text-[15px] font-medium leading-snug text-slate-200">
        <a
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer external"
          className="underline decoration-slate-600 decoration-dotted underline-offset-4 hover:decoration-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
        >
          {headline}
          <span className="sr-only"> (opens {attribution} in a new tab)</span>
        </a>
      </h3>

      {snippet && (
        <blockquote className="mt-1.5 border-0 text-[13px] leading-relaxed text-slate-400">
          <p>{snippet}</p>
          <footer className="mt-1 text-[11px] text-slate-500">
            Summary published by <cite className="not-italic">{attribution}</cite> in its own feed, quoted verbatim.
          </footer>
        </blockquote>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        Not our reporting — this link leaves portaBaltica.
        {when && (
          <>
            {' · '}
            <time dateTime={publishedAt}>{when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>
          </>
        )}
      </p>
    </article>
  );
}

/** Adapts a feed summary onto the four fields tier C is permitted to render. */
export function LinkOutCardFromSummary({ summary }: { summary: ArticleSummary }) {
  const syndicated = summary.syndicated;
  if (!syndicated?.original_url || !syndicated.attribution) return null;

  return (
    <LinkOutCard
      headline={summary.headline}
      snippet={syndicated.snippet}
      attribution={syndicated.attribution}
      originalUrl={syndicated.original_url}
      publishedAt={summary.published_at}
    />
  );
}
