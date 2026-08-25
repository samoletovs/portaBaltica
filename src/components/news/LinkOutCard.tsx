import type { ArticleSummary } from '../../news-types';
import { clampSnippet, snippetText } from '../../newsroom/snippet';

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
 * The outbound link is deliberately the most prominent thing in the card. The
 * published policy says: "If you find their story interesting, you should read
 * it on their site, and we would rather you did." A card that buried the link
 * in a footnote would be saying one thing and designing the opposite.
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
  // Feed descriptions are HTML. Take the publisher's prose out of it and keep
  // it short — see src/newsroom/snippet.ts for why neither step is a rewrite.
  const quote = clampSnippet(snippetText(snippet));

  return (
    <article
      className="news-border news-panel news-hover-panel group border-l-2 border-dashed py-3 pl-4 pr-3 transition-colors"
      data-tier="C"
      aria-label={`External story from ${attribution}`}
    >
      <p className="news-subtle mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest">
        <span aria-hidden="true">↗</span>
        <span>{attribution}</span>
        {when && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={publishedAt} className="font-normal tracking-normal">
              {when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </time>
          </>
        )}
      </p>

      <h3 className="news-fg text-[15px] font-medium leading-snug">
        <a
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer external"
          className="news-link news-focus underline decoration-dotted underline-offset-4"
        >
          {headline}
          <span className="sr-only"> (opens {attribution} in a new tab)</span>
        </a>
      </h3>

      {quote && (
        <blockquote className="news-muted mt-1.5 border-0 text-[13px] leading-relaxed">
          <p>{quote}</p>
          <footer className="news-subtle mt-1 text-[11px]">
            Summary published by <cite className="not-italic">{attribution}</cite> in its own feed, quoted verbatim.
          </footer>
        </blockquote>
      )}

      <a
        href={originalUrl}
        target="_blank"
        rel="noopener noreferrer external"
        className="news-tier-accent news-focus mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors"
      >
        Read this at {attribution}
        <span aria-hidden="true">↗</span>
        <span className="sr-only">(opens in a new tab)</span>
      </a>

      <p className="news-subtle mt-2 text-[11px] leading-relaxed">
        Their reporting, not ours — and we would rather you read it on their site.
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
