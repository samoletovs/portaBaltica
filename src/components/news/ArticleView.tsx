import { Link } from 'react-router-dom';
import type { Article, ArticleBlock } from '../../news-types';
import { isServable } from '../../news-types';
import { newsArticleJsonLd } from '../../newsroom/structured-data';
import { Byline } from './Byline';
import { ChartEmbed } from './ChartEmbed';
import { JsonLd } from './JsonLd';
import { LinkOutCard } from './LinkOutCard';
import { ProvenanceBlock } from './ProvenanceBlock';
import { SECTION_LABELS } from '../../newsroom/sections';
import { formatFigures } from '../../newsroom/format-figures';
import { resolveChartRef } from '../../newsroom/chart-ref';
import { soleCountry } from '../../newsroom/article-country';
import { TierBadge } from './TierBadge';

/**
 * The refusal.
 *
 * Rendered instead of an article that reached the client without a passing
 * validator verdict. It is a visible, indexable-as-noindex dead end rather
 * than a silent blank, because a reader who followed a link deserves to know
 * the difference between "gone" and "we would not stand behind it".
 */
function NotServable() {
  return (
    <div
      role="alert"
      className="news-border news-warning-panel mx-auto max-w-2xl rounded-xl border px-6 py-8 text-center"
    >
      <h1 className="news-warning text-lg font-semibold">This article is not available</h1>
      <p className="news-warning mt-2 text-sm leading-relaxed">
        It has not passed the checks we run before publishing, so we will not show it. Nothing is
        served from this portal without a passing validator verdict.
      </p>
      <p className="mt-4 text-sm">
        <Link
          to="/"
          className="news-link news-focus underline underline-offset-4"
        >
          Back to the front page
        </Link>
      </p>
    </div>
  );
}

/**
 * Prose with over-precise decimals shortened for reading.
 *
 * The exact value stays in the title attribute rather than being discarded, so
 * the rounding is recoverable by anyone who wants the full figure.
 */
function Prose({ text, className }: { text?: string; className: string }) {
  if (!text) return null;
  const readable = formatFigures(text);
  const rounded = readable !== text;
  return (
    <p className={className} title={rounded ? text : undefined}>
      {readable}
    </p>
  );
}

function Block({ block, country }: { block: ArticleBlock; country?: 'LV' | 'EE' | 'LT' }) {
  switch (block.type) {
    case 'chart':
      return block.chart_ref ? (
        <ChartEmbed indicatorId={block.chart_ref} country={country} caption={block.text} />
      ) : null;

    case 'quote':
      return (
        <blockquote className="news-border news-muted my-6 border-l-2 pl-4 text-lg italic leading-relaxed">
          {block.text}
        </blockquote>
      );

    case 'callout':
      return (
        <aside className="news-border news-accent-panel news-muted my-6 rounded-lg border px-4 py-3 text-sm leading-relaxed">
          {formatFigures(block.text ?? '')}
        </aside>
      );

    case 'list':
      return (
        <ul className="news-muted my-4 list-disc space-y-1 pl-6 text-[17px] leading-relaxed">
          {(block.text ?? '').split('\n').filter(Boolean).map((item) => (
            <li key={item}>{formatFigures(item)}</li>
          ))}
        </ul>
      );

    case 'table':
    case 'paragraph':
    default:
      return <Prose text={block.text} className="news-muted my-4 text-[17px] leading-relaxed" />;
  }
}

/**
 * Where "check it yourself" should land.
 *
 * The indicator page answers for one country at a time, and without a country
 * on the link it answers for whatever the dashboard's switcher was last left
 * on. Under a story about Estonia that could open Lithuania — which does not
 * read as a different country so much as an article that cannot be trusted.
 * Single-country stories therefore carry their country; Baltic-wide ones fall
 * back to the section, which shows all three.
 */
function checkItHref(article: Article, chartRef?: string): string {
  // Resolve before linking. An article published with an id the dashboard
  // cannot serve would otherwise send the reader to a page that answers 400.
  const resolved = resolveChartRef(chartRef);
  if (!resolved) return `/data/${article.section}`;
  const country = soleCountry(article);
  return country ? `/indicator/${resolved}?country=${country}` : `/indicator/${resolved}`;
}

export function ArticleView({ article }: { article: Article }) {
  // ─── The gate ───
  // Applied before anything about this article reaches the DOM. Do not move it
  // below a render of article content, and do not replace it with a check on
  // `status` alone: an article can be marked published and still have failed.
  if (!isServable(article)) return <NotServable />;

  // Tier C never gets an article page of its own. If one is requested we show
  // the link-out card and nothing else — no body, no byline, no prose.
  if (article.tier === 'C') {
    const syndicated = article.syndicated;
    return (
      <div className="mx-auto max-w-2xl">
        <p className="news-muted mb-4 text-sm">
          This is an external story. portaBaltica did not write it and does not reproduce it.
        </p>
        {syndicated && (
          <LinkOutCard
            headline={article.headline}
            snippet={syndicated.snippet}
            attribution={syndicated.attribution}
            originalUrl={syndicated.original_url}
            publishedAt={article.published_at}
          />
        )}
      </div>
    );
  }

  const chartRefs = (article.body ?? [])
    .map((block) => block.chart_ref)
    .filter((ref): ref is string => Boolean(ref));

  return (
    <article className="mx-auto max-w-2xl">
      <JsonLd data={newsArticleJsonLd(article)} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TierBadge tier={article.tier} />
        <Link
          to={`/data/${article.section}`}
          className="news-link news-focus text-xs uppercase tracking-widest underline underline-offset-4"
        >
          {SECTION_LABELS[article.section] ?? article.section}
        </Link>
      </div>

      <h1 className="news-fg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        {formatFigures(article.headline)}
      </h1>

      {article.dek && (
        <Prose text={article.dek} className="news-muted mt-3 text-lg leading-relaxed" />
      )}

      <div className="news-border mt-5 border-y py-4">
        {article.persona ? (
          <Byline
            persona={{ ...article.persona, beat: article.persona.beat }}
            variant="full"
            timestamp={article.published_at}
          />
        ) : (
          <p className="news-muted text-sm">
            Reproduced verbatim from {article.syndicated?.attribution ?? 'the original publisher'}. No
            portaBaltica byline: we did not write this.
          </p>
        )}
      </div>

      {article.corrections && article.corrections.length > 0 && (
        <section
          aria-label="Corrections to this article"
          className="news-border news-warning-panel mt-6 rounded-lg border px-4 py-3"
        >
          <h2 className="news-warning text-xs font-semibold uppercase tracking-widest">Corrected</h2>
          <ul className="mt-2 space-y-2">
            {article.corrections.map((correction) => (
              <li key={correction.corrected_at} className="news-warning text-sm">
                <time dateTime={correction.corrected_at}>
                  {new Date(correction.corrected_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
                {': '}
                {correction.description}
                {correction.previous_value && (
                  <span className="block text-xs">
                    Previously: {correction.previous_value}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        {article.tier === 'B' && article.syndicated?.full_text ? (
          <div className="news-border news-panel rounded-lg border p-5">
            <p className="news-subtle mb-3 text-xs uppercase tracking-widest">
              Reproduced in full, unedited
            </p>
            <div className="news-muted whitespace-pre-line text-[17px] leading-relaxed">
              {article.syndicated.full_text}
            </div>
          </div>
        ) : (
          (article.body ?? []).map((block, index) => (
            <Block
              key={`${block.type}-${index}`}
              block={block}
              country={soleCountry(article)}
            />
          ))
        )}
      </div>

      {article.tier === 'A' && (
        <p className="news-border news-panel news-muted mt-8 rounded-lg border px-4 py-3 text-sm">
          Every figure above is on the dashboard, live.{' '}
          <Link
            to={checkItHref(article, chartRefs[0])}
            className="news-link news-focus underline underline-offset-4"
          >
            Check it yourself →
          </Link>
        </p>
      )}

      <ProvenanceBlock provenance={article.provenance} />
    </article>
  );
}
