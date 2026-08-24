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
        <div className="news-skeleton h-8 w-3/4 animate-pulse rounded" />
        <div className="news-skeleton h-4 w-1/2 animate-pulse rounded" />
        <div className="news-skeleton h-40 animate-pulse rounded" />
      </div>
    );
  }

  if (load.state === 'not-found') {
    return (
      <div className="news-border news-panel mx-auto max-w-2xl rounded-xl border px-6 py-8 text-center">
        <h1 className="news-fg text-lg font-semibold">Article not found</h1>
        <p className="news-muted mt-2 text-sm">
          No article is published at this address.{' '}
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

  if (load.state === 'not-servable') {
    return (
      <div
        role="alert"
        className="news-border news-warning-panel mx-auto max-w-2xl rounded-xl border px-6 py-8 text-center"
      >
        <h1 className="news-warning text-lg font-semibold">This article is not available</h1>
        <p className="news-warning mt-2 text-sm leading-relaxed">
          It has not passed the checks we run before publishing, so we will not show it.
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

  return <ArticleView article={load.article} />;
}
