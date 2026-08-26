import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleCard, FeedItem } from './NewsCard';
import ElsewhereRail from './ElsewhereRail';
import { SECTION_LABELS } from '../../newsroom/sections';

type Filter = 'all' | string;

function byNewestFirst(a: ArticleSummary, b: ArticleSummary): number {
  return (b.published_at ?? '').localeCompare(a.published_at ?? '');
}

export default function NewsFeed() {
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

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

  // OUR SECTIONS DESCRIBE OUR JOURNALISM.
  //
  // syndicate.py files every link-out under a single hardcoded section, so in
  // the live index all 154 tier C cards were "government" and none of the seven
  // originals were. Building the tab strip from every article therefore offered
  // a "Government" tab that led to "Nothing to report yet today" beside a full
  // rail -- a tab that always emptied the page, caused entirely by us asserting
  // a classification over articles we did not write.
  //
  // The taxonomy is ours and it describes what we have covered. A section we
  // have not written about is not a section of this newspaper.
  const sections = useMemo(() => {
    const present = new Set(
      (articles ?? []).filter((article) => article.tier !== 'C').map((article) => article.section),
    );
    return Object.keys(SECTION_LABELS).filter((section) => present.has(section as never));
  }, [articles]);

  const ours = useMemo(
    () =>
      (articles ?? [])
        .filter((article) => article.tier !== 'C')
        .filter((article) => filter === 'all' || article.section === filter)
        .sort(byNewestFirst),
    [articles, filter],
  );

  // Deliberately NOT narrowed by the section filter. The rail is a standing
  // pointer to other outlets' work, and the only section value it carries is
  // one we assigned ourselves, so filtering on it would be filtering by our own
  // invention. It has an outlet filter of its own, which is a fact about the
  // item rather than a judgement about it.
  const elsewhere = useMemo(
    () => (articles ?? []).filter((article) => article.tier === 'C').sort(byNewestFirst),
    [articles],
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
                'rounded-full border px-4 py-2 text-caption transition-colors',
                '',
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

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {ours.length === 0 ? (
            <div className="news-border news-panel rounded-xl border px-6 py-12 text-center">
              <h1 className="balance-text news-fg text-title font-semibold">
                {failed ? 'The front page could not be loaded' : 'Nothing to report yet today'}
              </h1>
              <p className="pretty-text news-muted mx-auto mt-3 max-w-md text-callout">
                {failed
                  ? 'Published articles are served as static files. If this persists, the dashboard is unaffected.'
                  : 'We publish when the data warrants it and not otherwise. A quiet day means fewer stories, never padded ones.'}
              </p>
              <p className="mt-6 text-ui">
                <Link
                  to="/data"
                  className="news-link underline underline-offset-4"
                >
                  Go to the live dashboard →
                </Link>
              </p>
            </div>
          ) : (
            <>
              <h1 className="sr-only">Front page</h1>
              <ArticleCard summary={lead} variant="lead" />
              <div className="mt-8 space-y-6">
                {rest.map((summary) => (
                  <FeedItem key={summary.id ?? summary.slug} summary={summary} />
                ))}
              </div>
            </>
          )}

          <section className="news-border news-accent-panel mt-12 rounded-xl border px-6 py-4">
            <h2 className="news-fg text-callout font-semibold">The dashboard is the evidence</h2>
            <p className="news-muted mt-2 text-ui">
              Every figure in our reporting comes from a series you can open, filter and check
              yourself. More than 30 Baltic indicators, updated independently of the article.
            </p>
            <p className="mt-3 text-ui">
              <Link
                to="/data"
                className="news-link underline underline-offset-4"
              >
                Open the live dashboard →
              </Link>
            </p>
          </section>
        </div>

        <ElsewhereRail items={elsewhere} />
      </div>
    </div>
  );
}
