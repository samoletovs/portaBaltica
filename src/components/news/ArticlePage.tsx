import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArticleLoad } from '../../news-api';
import { loadArticle } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { syndicatedOriginalUrl } from '../../newsroom/canonical';
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
  const withdrawn = load?.state === 'retracted' ? load.article : null;
  /**
   * Whether this piece carries a published correction.
   *
   * Mirrors `buildHead` in `api/shared/articleMeta.js`, which a parity test
   * enforces: the served head and the head after hydration must be the same
   * strings, or a crawler and a reader are told different things about the same
   * page. Deliberately not folded into `withdrawn` — retracted means withdrawn,
   * corrected means amended and still standing, and only the first branch here
   * can be reached by a retracted piece.
   */
  const corrected = Boolean(article?.corrections?.length);

  /**
   * A syndicated piece points its canonical at the source it reproduces.
   *
   * Mirrors `canonicalFor` in `api/shared/articleMeta.js`, held to it by
   * `tests/articleMetaParity.test.ts`. Without this the served head would name
   * the source and hydration would immediately overwrite it with our own URL —
   * the client runs last, so a server-only fix would have been undone in the
   * browser, and only in the browser, which is where Google looks.
   *
   * Read from `withdrawn` as well as `article`: a retracted syndicated piece is
   * `noindex` either way, but there is no reason to make a false claim about it
   * on the way out.
   */
  const foreignCanonical = syndicatedOriginalUrl(article ?? withdrawn);

  usePageMeta({
    title: article
      ? `${corrected ? 'Corrected: ' : ''}${article.headline} | portaBaltica`
      : withdrawn
        ? `Retracted: ${withdrawn.headline} | portaBaltica`
        : 'portaBaltica',
    description: article?.dek,
    canonicalPath: foreignCanonical || !slug ? undefined : `/article/${slug}`,
    canonicalUrl: foreignCanonical ?? undefined,
    // Never indexed. The page stays up for a reader following the corrections
    // log, not for a search engine to keep circulating a story we withdrew.
    index: Boolean(article),
  });

  if (load === null) {
    return (
      /*
        `min-h-screen` and a key, for the reasons `NewsFeed` records.

        The skeleton is about 230px; a published article is several thousand.
        So the footer sat mid-viewport during the load and was thrown below it
        when the prose arrived. Measured against production at 375px, on a tier
        A article: **CLS 0.1453**, one shift, source
        `footer.news-border.news-subtle` going `548,129 -> 0,0` — a footer
        leaving the viewport rather than moving within it.

        Article pages were missed by the first sweep of this because
        `navigableRoutes()` cannot enumerate a parameterised route, so
        `/article/:slug` — the page most readers arrive on from search or a
        shared link — was measured last rather than first.

        `min-h-screen` puts the footer below the fold before the prose lands.
        The key stops React reconciling this tree into `ArticleView`'s: a node
        that MOVES is a layout shift, one that is removed and replaced is not.
      */
      <div
        key="article-loading"
        className="mx-auto min-h-screen max-w-measure space-y-3"
        aria-busy="true"
        aria-label="Loading article"
      >
        <div className="news-skeleton h-8 w-3/4 animate-pulse rounded" />
        <div className="news-skeleton h-4 w-1/2 animate-pulse rounded" />
        <div className="news-skeleton h-40 animate-pulse rounded" />
        <div className="news-skeleton h-40 animate-pulse rounded" />
        <div className="news-skeleton h-40 animate-pulse rounded" />
      </div>
    );
  }

  if (load.state === 'not-found') {
    return (
      <div className="news-border news-panel mx-auto max-w-measure rounded-xl border px-6 py-8 text-center">
        <h1 className="balance-text news-fg text-title font-semibold">Article not found</h1>
        <p className="news-muted mt-3 text-callout">
          No article is published at this address.{' '}
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

  if (load.state === 'retracted') {
    return <ArticleView key="article-loaded" article={load.article} />;
  }

  if (load.state === 'not-servable') {
    return (
      <div
        role="alert"
        className="news-border news-warning-panel mx-auto max-w-measure rounded-xl border px-6 py-8 text-center"
      >
        <h1 className="balance-text news-warning text-title font-semibold">This article is not available</h1>
        <p className="news-warning mt-3 text-callout">
          It has not passed the checks we run before publishing, so we will not show it.
        </p>
        <p className="mt-6 text-ui">
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

  return <ArticleView key="article-loaded" article={load.article} />;
}
