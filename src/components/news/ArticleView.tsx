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
      className="mx-auto max-w-2xl rounded-xl border border-amber-700/40 bg-amber-950/20 px-6 py-8 text-center"
    >
      <h1 className="text-lg font-semibold text-amber-100">This article is not available</h1>
      <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
        It has not passed the checks we run before publishing, so we will not show it. Nothing is
        served from this portal without a passing validator verdict.
      </p>
      <p className="mt-4 text-sm">
        <Link
          to="/"
          className="text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
        >
          Back to the front page
        </Link>
      </p>
    </div>
  );
}

function Block({ block }: { block: ArticleBlock }) {
  switch (block.type) {
    case 'chart':
      return block.chart_ref ? <ChartEmbed indicatorId={block.chart_ref} caption={block.text} /> : null;

    case 'quote':
      return (
        <blockquote className="my-6 border-l-2 border-ocean-600/60 pl-4 text-lg italic leading-relaxed text-slate-200">
          {block.text}
        </blockquote>
      );

    case 'callout':
      return (
        <aside className="my-6 rounded-lg border border-ocean-800/50 bg-ocean-950/30 px-4 py-3 text-sm leading-relaxed text-ocean-100">
          {block.text}
        </aside>
      );

    case 'list':
      return (
        <ul className="my-4 list-disc space-y-1 pl-6 text-[17px] leading-relaxed text-slate-300">
          {(block.text ?? '').split('\n').filter(Boolean).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );

    case 'table':
    case 'paragraph':
    default:
      return <p className="my-4 text-[17px] leading-relaxed text-slate-300">{block.text}</p>;
  }
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
        <p className="mb-4 text-sm text-slate-400">
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
          className="text-xs uppercase tracking-widest text-slate-400 underline underline-offset-4 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
        >
          {SECTION_LABELS[article.section] ?? article.section}
        </Link>
      </div>

      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
        {article.headline}
      </h1>

      {article.dek && (
        <p className="mt-3 text-lg leading-relaxed text-slate-400">{article.dek}</p>
      )}

      <div className="mt-5 border-y border-slate-800/60 py-4">
        {article.persona ? (
          <Byline
            persona={{ ...article.persona, beat: article.persona.beat }}
            variant="full"
            timestamp={article.published_at}
          />
        ) : (
          <p className="text-sm text-slate-400">
            Reproduced verbatim from {article.syndicated?.attribution ?? 'the original publisher'}. No
            portaBaltica byline: we did not write this.
          </p>
        )}
      </div>

      {article.corrections && article.corrections.length > 0 && (
        <section
          aria-label="Corrections to this article"
          className="mt-6 rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-3"
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-200">Corrected</h2>
          <ul className="mt-2 space-y-2">
            {article.corrections.map((correction) => (
              <li key={correction.corrected_at} className="text-sm text-amber-100/90">
                <time dateTime={correction.corrected_at} className="text-amber-300/80">
                  {new Date(correction.corrected_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
                {' — '}
                {correction.description}
                {correction.previous_value && (
                  <span className="block text-xs text-amber-200/60">
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
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-5">
            <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">
              Reproduced in full, unedited
            </p>
            <div className="whitespace-pre-line text-[17px] leading-relaxed text-slate-300">
              {article.syndicated.full_text}
            </div>
          </div>
        ) : (
          (article.body ?? []).map((block, index) => (
            <Block key={`${block.type}-${index}`} block={block} />
          ))
        )}
      </div>

      {article.tier === 'A' && (
        <p className="mt-8 rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-3 text-sm text-slate-400">
          Every figure above is on the dashboard, live.{' '}
          <Link
            to={chartRefs[0] ? `/indicator/${chartRefs[0]}` : `/data/${article.section}`}
            className="text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
          >
            Check it yourself →
          </Link>
        </p>
      )}

      <ProvenanceBlock provenance={article.provenance} />
    </article>
  );
}
