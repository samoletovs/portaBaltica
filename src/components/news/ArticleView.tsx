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
import { FormatBadge } from './FormatBadge';
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
      className="news-border news-warning-panel mx-auto max-w-measure rounded-xl border px-6 py-8 text-center"
    >
      <h1 className="news-warning text-title font-semibold">This article is not available</h1>
      <p className="news-warning mt-3 text-callout">
        It has not passed the checks we run before publishing, so we will not show it. Nothing is
        served from this portal without a passing validator verdict.
      </p>
      <p className="mt-4 text-ui">
        <Link
          to="/"
          className="news-link underline underline-offset-4"
        >
          Back to the front page
        </Link>
      </p>
    </div>
  );
}

/**
 * The retraction.
 *
 * A retracted article did not fail validation — it passed every check and was
 * wrong anyway. Showing it the generic refusal, "it has not passed the checks
 * we run before publishing", says something false about it, and false in the
 * direction that flatters us.
 *
 * The published corrections policy makes three promises: the page stays up, it
 * shows why, and we do not delete the evidence. An earlier version of this
 * rendered the notice and nothing else, on the reasoning that a false headline
 * should not be set as the largest text on the page. That reasoning was sound
 * about the headline and wrong about the article: withholding the body keeps
 * one promise of three, and it fails on the exact page a sceptical reader
 * visits to find out whether we admit our mistakes.
 *
 * So the notice comes first and unmissably, and the piece follows it, marked.
 * That is what a newspaper does with a withdrawn story, and the ordering is
 * what stops the headline being read before the retraction of it.
 */
function Retracted({ article }: { article: Article }) {
  const notices = article.corrections ?? [];
  return (
    <div className="mx-auto max-w-measure">
      <div
        role="alert"
        className="news-border news-warning-panel rounded-xl border px-6 py-8"
      >
        <p className="news-warning text-caption font-semibold tracking-widest uppercase">
          Retracted
        </p>
        <h1 className="news-warning mt-3 text-title font-semibold">
          We have withdrawn this article
        </h1>
        {notices.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {notices.map((notice) => (
              <li key={notice.corrected_at} className="news-warning text-callout">
                {notice.description}
                <span className="news-muted block text-caption">{notice.corrected_at}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="news-warning mt-4 text-callout">
            It should not have been published. No figure in it should be relied on.
          </p>
        )}
        <p className="mt-4 text-ui">
          <Link to="/corrections" className="news-link underline underline-offset-4">
            Read our corrections policy and log
          </Link>
        </p>
      </div>

      {/* The evidence, kept. Below the notice, never above it. */}
      <section aria-label="The withdrawn article, as published" className="mt-8">
        <p className="news-muted text-caption font-semibold tracking-widest uppercase">
          As published, and withdrawn
        </p>
        <h2 className="news-muted mt-2 text-lead font-semibold">{article.headline}</h2>
        {article.dek && <Prose text={article.dek} className="news-muted mt-2 text-callout" />}
        <div className="mt-4 space-y-4">
          {(article.body ?? [])
            .filter((block) => block.type === 'paragraph' && block.text)
            .map((block, index) => (
              <Prose
                key={index}
                text={block.text}
                className="news-muted text-prose"
              />
            ))}
        </div>
      </section>
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
        <blockquote className="pretty-text news-border news-muted my-8 border-l-2 pl-6 text-lead italic">
          {block.text}
        </blockquote>
      );

    case 'callout':
      return (
        <aside className="pretty-text news-border news-accent-panel news-muted my-6 rounded-lg border px-4 py-3 text-callout">
          {formatFigures(block.text ?? '')}
        </aside>
      );

    case 'list':
      return (
        <ul className="pretty-text news-muted my-6 list-disc space-y-2 pl-6 text-prose">
          {(block.text ?? '').split('\n').filter(Boolean).map((item) => (
            <li key={item}>{formatFigures(item)}</li>
          ))}
        </ul>
      );

    case 'table':
    case 'paragraph':
    default:
      return <Prose text={block.text} className="pretty-text news-muted my-6 text-prose" />;
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

/**
 * The path back.
 *
 * A reader who has just finished an article is the one person on the site most
 * likely to want another, and until this existed there was nowhere for them to
 * go: the only follow affordance anywhere was the word "RSS" in the footer.
 *
 * Deliberately quiet, and deliberately not a promise. It says how we publish —
 * irregularly, when a series moves — because setting the expectation here is
 * what stops a subscriber concluding we died during a quiet fortnight.
 */
function KeepUp({ isWeekly }: { isWeekly: boolean }) {
  return (
    <p className="news-border news-muted mt-8 border-t pt-4 text-ui">
      {isWeekly ? (
        <>
          This is our weekly review, written when the week produced enough to review.{' '}
          <Link to="/weekly" className="news-link underline underline-offset-4">
            Earlier reviews
          </Link>
          {' · '}
          <Link to="/follow" className="news-link underline underline-offset-4">
            How to follow us
          </Link>
        </>
      ) : (
        <>
          We publish when the data warrants it, which is not every day.{' '}
          <Link to="/follow" className="news-link underline underline-offset-4">
            Follow by RSS or JSON Feed →
          </Link>
        </>
      )}
    </p>
  );
}

export function ArticleView({ article }: { article: Article }) {
  // ─── The gate ───
  // Applied before anything about this article reaches the DOM. Do not move it
  // below a render of article content, and do not replace it with a check on
  // `status` alone: an article can be marked published and still have failed.
  //
  // A retraction is a distinct refusal, not a softer one: it still renders no
  // article content, but it says truthfully why the page is empty instead of
  // telling a reader the piece failed checks it actually passed.
  if (article.status === 'retracted') return <Retracted article={article} />;
  if (!isServable(article)) return <NotServable />;

  // Tier C never gets an article page of its own. If one is requested we show
  // the link-out card and nothing else — no body, no byline, no prose.
  if (article.tier === 'C') {
    const syndicated = article.syndicated;
    return (
      <div className="mx-auto max-w-measure">
        <p className="news-muted mb-4 text-ui">
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
    <article className="mx-auto max-w-measure">
      <JsonLd data={newsArticleJsonLd(article)} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TierBadge tier={article.tier} />
        <FormatBadge format={article.format} />
        {/* The section link is a real navigation target, not a chip inside a
            larger one, so it takes the 44px floor rather than `target-inline`.
            Measured 43–99×18 across eight articles at every width: the row is
            `items-center`, so the target grows and the badges stay put. */}
        <Link
          to={`/data/${article.section}`}
          className="news-link flex min-h-11 items-center text-caption font-semibold uppercase tracking-widest underline underline-offset-4"
        >
          {SECTION_LABELS[article.section] ?? article.section}
        </Link>
      </div>

      <h1 className="balance-text news-fg text-headline font-semibold tracking-tight sm:text-display">
        {formatFigures(article.headline)}
      </h1>

      {article.dek && (
        <Prose text={article.dek} className="pretty-text news-muted mt-4 text-lead" />
      )}

      <div className="news-border mt-6 border-y py-4">
        {article.persona ? (
          <Byline
            persona={{ ...article.persona, beat: article.persona.beat }}
            variant="full"
            timestamp={article.published_at}
          />
        ) : (
          <p className="news-muted text-ui">
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
          <h2 className="news-warning text-callout font-semibold">Corrected</h2>
          <ul className="mt-2 space-y-2">
            {article.corrections.map((correction) => (
              <li key={correction.corrected_at} className="news-warning text-ui">
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
                  <span className="block text-caption">
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
          <div className="news-border news-panel rounded-lg border p-6">
            <p className="news-subtle mb-3 text-caption font-semibold uppercase tracking-widest">
              Reproduced in full, unedited
            </p>
            <div className="pretty-text news-muted whitespace-pre-line text-prose">
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
        <p className="news-border news-panel news-muted mt-8 rounded-lg border px-4 py-3 text-ui">
          Every figure above is on the dashboard, live.{' '}
          <Link
            to={checkItHref(article, chartRefs[0])}
            className="news-link underline underline-offset-4"
          >
            Check it yourself →
          </Link>
        </p>
      )}

      <KeepUp isWeekly={article.format === 'weekly_wrap'} />

      <ProvenanceBlock provenance={article.provenance} />
    </article>
  );
}
