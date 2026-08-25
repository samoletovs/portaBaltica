import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleCard, FeedItem } from './NewsCard';
import { LinkOutCardFromSummary } from './LinkOutCard';
import { SECTION_LABELS } from '../../newsroom/sections';

type Filter = 'all' | string;

function byNewestFirst(a: ArticleSummary, b: ArticleSummary): number {
  return (b.published_at ?? '').localeCompare(a.published_at ?? '');
}

export default function NewsFeed() {
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // The rail is a pointer to other people's work, not a second feed. Left
  // uncapped it ran longer than our own reporting and turned the front page
  // into a scroll. Four is enough to show there is a world outside.
  const [showAllElsewhere, setShowAllElsewhere] = useState(false);
  const visibleElsewhere = showAllElsewhere ? Number.POSITIVE_INFINITY : 4;

  usePageMeta({
    title: 'portaBaltica | Baltic open data, reported',
    description:
      'Original data journalism from Baltic open data: economy, energy, maritime, environment and government, with every figure traceable to its dataset.',
    canonicalPath: '/',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchArticleIndex(controller.signal)
      .then((index) => setArticles(index.articles))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setArticles([]);
        }
      });
    return () => controller.abort();
  }, []);

  const sections = useMemo(() => {
    const present = new Set((articles ?? []).map((article) => article.section));
    return Object.keys(SECTION_LABELS).filter((section) => present.has(section as never));
  }, [articles]);

  const filtered = useMemo(
    () => (articles ?? []).filter((article) => filter === 'all' || article.section === filter),
    [articles, filter],
  );

  const ours = useMemo(
    () => filtered.filter((article) => article.tier !== 'C').sort(byNewestFirst),
    [filtered],
  );
  const elsewhere = useMemo(
    () => filtered.filter((article) => article.tier === 'C').sort(byNewestFirst),
    [filtered],
  );

  if (articles === null) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the front page">
        <div className="news-skeleton h-40 animate-pulse rounded-xl" />
        <div className="news-skeleton h-24 animate-pulse rounded-xl" />
        <div className="news-skeleton h-24 animate-pulse rounded-xl" />
      </div>
    );
  }

  const [lead, ...rest] = ours;

  return (
    <div>
      {sections.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by section">
          {(['all', ...sections] as Filter[]).map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setFilter(section)}
              aria-pressed={filter === section}
              className={[
                'rounded-full border px-3 py-1 text-xs transition-colors',
                'news-focus',
                filter === section
                  ? 'news-tab-active'
                  : 'news-tab-inactive news-hover',
              ].join(' ')}
            >
              {section === 'all' ? 'Everything' : SECTION_LABELS[section as never] ?? section}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {ours.length === 0 ? (
            <div className="news-border news-panel rounded-xl border px-6 py-10 text-center">
              <h1 className="news-fg text-lg font-medium">
                {failed ? 'The front page could not be loaded' : 'Nothing to report yet today'}
              </h1>
              <p className="news-muted mx-auto mt-2 max-w-md text-sm leading-relaxed">
                {failed
                  ? 'Published articles are served as static files. If this persists, the dashboard is unaffected.'
                  : 'We publish when the data warrants it and not otherwise. A quiet day means fewer stories, never padded ones.'}
              </p>
              <p className="mt-4 text-sm">
                <Link
                  to="/data"
                  className="news-link news-focus underline underline-offset-4"
                >
                  Go to the live dashboard →
                </Link>
              </p>
            </div>
          ) : (
            <>
              <h1 className="sr-only">Front page</h1>
              <ArticleCard summary={lead} variant="lead" />
              <div className="mt-8 space-y-5">
                {rest.map((summary) => (
                  <FeedItem key={summary.id ?? summary.slug} summary={summary} />
                ))}
              </div>
            </>
          )}

          <section className="news-border news-accent-panel mt-10 rounded-xl border px-5 py-4">
            <h2 className="news-fg text-sm font-semibold">The dashboard is the evidence</h2>
            <p className="news-muted mt-1.5 text-sm leading-relaxed">
              Every figure in our reporting comes from a series you can open, filter and check
              yourself. More than 30 Baltic indicators, updated independently of the article.
            </p>
            <p className="mt-3 text-sm">
              <Link
                to="/data"
                className="news-link news-focus underline underline-offset-4"
              >
                Open the live dashboard →
              </Link>
            </p>
          </section>
        </div>

        <aside aria-labelledby="elsewhere-heading">
          <h2
            id="elsewhere-heading"
            className="news-border news-subtle border-b pb-2 text-xs font-medium uppercase tracking-widest"
          >
            Elsewhere in the Baltics
          </h2>
          <p className="news-subtle mt-2 text-xs leading-relaxed">
            Other outlets’ reporting. Headline and their own summary only. We link out rather than
            reproduce.
          </p>
          {elsewhere.length === 0 ? (
            <p className="news-subtle mt-4 text-xs">Nothing filed here right now.</p>
          ) : (
            <>
              <div className="mt-4 space-y-4">
                {elsewhere.slice(0, visibleElsewhere).map((summary) => (
                  <LinkOutCardFromSummary key={summary.id ?? summary.slug} summary={summary} />
                ))}
              </div>
              {elsewhere.length > visibleElsewhere && (
                <button
                  type="button"
                  onClick={() => setShowAllElsewhere(true)}
                  className="news-link news-focus mt-4 text-xs underline underline-offset-4"
                >
                  Show {elsewhere.length - visibleElsewhere} more from other outlets
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
