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

  usePageMeta({
    title: 'portaBaltica — Baltic open data, reported',
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
        <div className="h-40 animate-pulse rounded-xl bg-slate-800/30" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-800/20" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-800/20" />
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
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400',
                filter === section
                  ? 'border-ocean-500/60 bg-ocean-500/15 text-ocean-100'
                  : 'border-slate-700/60 text-slate-400 hover:text-slate-200',
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
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 px-6 py-10 text-center">
              <h1 className="text-lg font-medium text-slate-200">
                {failed ? 'The front page could not be loaded' : 'Nothing to report yet today'}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                {failed
                  ? 'Published articles are served as static files. If this persists, the dashboard is unaffected.'
                  : 'We publish when the data warrants it and not otherwise. A quiet day means fewer stories, never padded ones.'}
              </p>
              <p className="mt-4 text-sm">
                <Link
                  to="/data"
                  className="text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
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

          <section className="mt-10 rounded-xl border border-ocean-800/50 bg-ocean-950/30 px-5 py-4">
            <h2 className="text-sm font-semibold text-ocean-100">The dashboard is the evidence</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
              Every figure in our reporting comes from a series you can open, filter and check
              yourself — 30+ Baltic indicators, updated independently of the article.
            </p>
            <p className="mt-3 text-sm">
              <Link
                to="/data"
                className="text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
              >
                Open the live dashboard →
              </Link>
            </p>
          </section>
        </div>

        <aside aria-labelledby="elsewhere-heading">
          <h2
            id="elsewhere-heading"
            className="border-b border-slate-800/60 pb-2 text-xs font-medium uppercase tracking-widest text-slate-500"
          >
            Elsewhere in the Baltics
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Other outlets’ reporting. Headline and their own summary only — we link out rather than
            reproduce.
          </p>
          {elsewhere.length === 0 ? (
            <p className="mt-4 text-xs text-slate-600">Nothing filed here right now.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {elsewhere.map((summary) => (
                <LinkOutCardFromSummary key={summary.id ?? summary.slug} summary={summary} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
