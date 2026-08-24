import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArticleLoad } from '../../news-api';
import { loadArticle } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleView } from './ArticleView';

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  // Keyed by slug so a navigation between articles shows the loading state
  // without a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ slug: string; result: ArticleLoad } | null>(null);
  const load = loaded && loaded.slug === slug ? loaded.result : null;

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    loadArticle(slug, controller.signal)
      .then((result) => setLoaded({ slug, result }))
      .catch(() => {
        // Fail closed: a failed fetch is never an excuse to render something.
        if (!controller.signal.aborted) setLoaded({ slug, result: { state: 'not-servable' } });
      });
    return () => controller.abort();
  }, [slug]);

  const article = load?.state === 'ok' ? load.article : null;

  usePageMeta({
    title: article ? `${article.headline} — portaBaltica` : 'portaBaltica',
    description: article?.dek,
    canonicalPath: slug ? `/article/${slug}` : undefined,
    index: Boolean(article),
  });

  if (load === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-3" aria-busy="true" aria-label="Loading article">
        <div className="h-8 w-3/4 animate-pulse rounded bg-slate-800/40" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-800/30" />
        <div className="h-40 animate-pulse rounded bg-slate-800/20" />
      </div>
    );
  }

  if (load.state === 'not-found') {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-800/60 bg-slate-900/30 px-6 py-8 text-center">
        <h1 className="text-lg font-semibold text-slate-100">Article not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          No article is published at this address.{' '}
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

  if (load.state === 'not-servable') {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-xl border border-amber-700/40 bg-amber-950/20 px-6 py-8 text-center"
      >
        <h1 className="text-lg font-semibold text-amber-100">This article is not available</h1>
        <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
          It has not passed the checks we run before publishing, so we will not show it.
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

  return <ArticleView article={load.article} />;
}
