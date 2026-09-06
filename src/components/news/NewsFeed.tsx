import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { correctedSlugs, fetchArticleIndex, fetchCorrections } from '../../news-api';
import type { CorrectionState } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleCard, CorrectionsUnavailable, FeedItem } from './NewsCard';
import ElsewhereRail from './ElsewhereRail';
import { SECTION_LABELS } from '../../newsroom/sections';
import { NewsTools } from './NewsTools';

const PAGE_SIZE = 12;

function byNewestFirst(a: ArticleSummary, b: ArticleSummary): number {
  return (b.published_at ?? '').localeCompare(a.published_at ?? '');
}

export default function NewsFeed() {
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const navigationType = useNavigationType();
  const { key: navigationKey } = useLocation();
  const topic = params.get('topic') ?? 'all';
  const filter = Object.hasOwn(SECTION_LABELS, topic) ? topic : 'all';
  const urlSearch = (params.get('q') ?? '').slice(0, 200);
  const [search, setSearch] = useState(urlSearch);
  const [restoredKey, setRestoredKey] = useState(navigationKey);
  const pageParam = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const visibleCount = Math.min(page, Math.max(1, Math.ceil((articles?.length ?? 0) / PAGE_SIZE))) * PAGE_SIZE;
  const [corrections, setCorrections] = useState<CorrectionState>({ state: 'loading' });

  // Restore external navigation before rendering; our URL writes may lag typing.
  if (navigationType !== 'REPLACE' && restoredKey !== navigationKey) {
    setRestoredKey(navigationKey);
    setSearch(urlSearch);
  }

  function changeFilter(key: 'q' | 'topic', value: string) {
    if (key === 'q') setSearch(value);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (search) next.set('q', search);
      else next.delete('q');
      if (!value || (key === 'topic' && value === 'all')) next.delete(key);
      else next.set(key, value);
      next.delete('page');
      return next;
    }, { replace: true });
  }

  usePageMeta({
    title: 'portaBaltica | Baltic open data, reported',
    description:
      'Original data journalism from Baltic open data: economy, energy, maritime, environment and government, with every figure traceable to its dataset.',
    canonicalPath: '/',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchArticleIndex(controller.signal)
      .then((index) => { if (!controller.signal.aborted) setArticles(index.articles); })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setArticles([]);
        }
      });

    // Fetched separately and failing separately, on purpose — the idiom
    // `WeeklyPage` already uses for its run report. Folding this into the
    // promise above would let a failure to read the corrections log take down
    // the front page, and the articles are by far the more important artefact.
    // The reverse is guarded too: a reader whose corrections log did not arrive
    // is told so rather than shown an unmarked feed that looks clean.
    fetchCorrections(controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) {
          setCorrections({ state: 'ok', slugs: correctedSlugs(entries) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setCorrections({ state: 'failed' });
      });

    return () => controller.abort();
  }, [attempt]);

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
        .filter((article) => {
          const text = `${article.headline} ${article.dek ?? ''}`.toLowerCase();
          return search.trim().toLowerCase().split(/\s+/).every((word) => text.includes(word));
        })
        .sort(byNewestFirst),
    [articles, filter, search],
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

  const tools = <NewsTools sections={sections} filter={filter} search={search}
    shown={Math.min(visibleCount, ours.length)} total={ours.length}
    loading={articles === null} failed={failed}
    onFilter={(value) => changeFilter('topic', value)} onSearch={(value) => changeFilter('q', value)} />;

  if (articles === null) {
    return (
      /*
        `min-h-screen` is the whole fix, and it is not decoration.

        The loading state was three bars — about 384px. The feed that replaces
        it is roughly 12,000px, so the footer sat mid-viewport during the load
        and was thrown far below it when the articles arrived. Measured against
        production at 2026-09-02T09:4xZ, one layout shift at 745-966ms doing
        almost all of the damage, at every width:

              375   CLS 0.6892      768   CLS 0.6654
             1024   CLS 0.7273     1280   CLS 0.5819

        Google calls anything above 0.25 poor, so the front page was between
        2.2x and 2.9x that — on the one page most readers arrive at.

        A skeleton cannot reserve 12,000px, and does not need to: CLS only
        counts elements that are *visible* when they move. Reserving a viewport
        puts the footer below the fold before the content lands, so its journey
        from just-off-screen to far-off-screen is not a shift anybody sees.

        The extra bars are there because a 100vh box with three small bars at
        the top reads as a page that failed to load rather than one that is
        loading.
      */
      <div
        className="min-h-screen"
        aria-busy="true"
        aria-label="Loading the front page"
      >
        {tools}
        <div className="space-y-4">
          <div className="news-skeleton h-40 animate-pulse rounded-xl" />
          <div className="news-skeleton h-24 animate-pulse rounded-xl" />
          <div className="news-skeleton h-24 animate-pulse rounded-xl" />
          <div className="news-skeleton h-24 animate-pulse rounded-xl" />
          <div className="news-skeleton h-24 animate-pulse rounded-xl" />
          <div className="news-skeleton h-24 animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  const [lead, ...rest] = ours.slice(0, visibleCount);
  const isCorrected = (summary: ArticleSummary) =>
    corrections.state === 'ok' && corrections.slugs.has(summary.slug);

  return (
    <div>
      {tools}

      {/*
        The rail becomes a sidebar at `md`, not at `lg`.

        It is the second grid child, so in a single column it lands after the
        *whole* feed — and the feed is now 49 articles rather than the 10 it
        had when this was written. Measured against production at
        2026-09-02T07:3xZ, with the rail located by its heading text:

              w=  768   page=12080   railTop=11042   12.3 screens down
              w= 1023   page=10768   railTop= 9750   10.8 screens down
              w= 1024   page=11859   railTop=  334    0.4 screens down

        A tablet reader never reaches it. The cliff is `lg:` = 1024px, and the
        band below it is not short of room: the newsroom container is
        `max-w-5xl`, so 1023px carries 975px of content against 976px at 1024px
        — one pixel of viewport either side of a completely different layout.

        The rail narrows to 16rem in the new band so the main column keeps a
        tablet's width rather than a phone's: at 768px that is 416px of
        article against the 352px a 20rem rail would have left. Both the
        untouched bands are untouched by construction — below `md` there is no
        column definition at all, and at `lg` and above the 20rem rule still
        wins.
      */}
      <div className="grid grid-cols-1 gap-12 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div id="news-results">
          {ours.length === 0 ? (
            <div className="news-border news-panel rounded-xl border px-6 py-12 text-center">
              <h1 className="balance-text news-fg text-title font-semibold">
                {failed ? 'The front page could not be loaded' : search.trim() ? 'No matching articles' : 'Nothing to report yet today'}
              </h1>
              <p className="pretty-text news-muted mx-auto mt-3 max-w-md text-callout">
                {failed
                  ? 'Published articles are served as static files. If this persists, the dashboard is unaffected.'
                  : search.trim()
                    ? 'Try fewer words or clear the search and section filter. The current index may not contain older coverage.'
                    : 'We publish when the data warrants it and not otherwise. A quiet day means fewer stories, never padded ones.'}
              </p>
              {failed && (
                <button type="button" className="news-border news-panel news-fg mt-4 rounded-lg border px-4 py-2 text-ui"
                  onClick={() => {
                    setArticles(null);
                    setFailed(false);
                    setCorrections({ state: 'loading' });
                    setAttempt((value) => value + 1);
                  }}>
                  Retry loading articles
                </button>
              )}
              {search.trim() && (
                <button type="button" className="news-link mt-4 px-3 py-2 text-ui underline underline-offset-4"
                  onClick={() => {
                    setSearch('');
                    setParams((previous) => {
                      const next = new URLSearchParams(previous);
                      ['q', 'topic', 'page'].forEach((key) => next.delete(key));
                      return next;
                    }, { replace: true });
                  }}>
                  Clear search and filters
                </button>
              )}
              <p className="mt-6 text-ui">
                <Link
                  to="/data"
                  className="news-link underline underline-offset-4"
                >
                  Go to the live dashboard →
                </Link>
              </p>
              {/*
                A quiet day is exactly when a reader most needs to be told how
                they will hear about a loud one. Without this, the page that
                says "we publish only when the data warrants it" offers no way
                to find out when it next does.
              */}
              <p className="mt-2 text-ui">
                <Link to="/follow" className="news-link underline underline-offset-4">
                  Get the next one by RSS or JSON Feed →
                </Link>
              </p>
            </div>
          ) : (
            <>
              <h1 className="sr-only">Front page</h1>
              {corrections.state === 'failed' && <CorrectionsUnavailable />}
              <ArticleCard summary={lead} variant="lead" corrected={isCorrected(lead)} />
              <div className="mt-8 space-y-6">
                {rest.map((summary) => (
                  <FeedItem
                    key={summary.id ?? summary.slug}
                    summary={summary}
                    corrected={isCorrected(summary)}
                  />
                ))}
              </div>
              {visibleCount < ours.length && (
                <button type="button" aria-controls="news-results"
                  className="news-border news-panel news-hover-panel news-fg mt-6 rounded-lg border px-4 py-2 text-ui font-semibold"
                  onClick={() => setParams((previous) => {
                    const next = new URLSearchParams(previous);
                    if (search) next.set('q', search);
                    else next.delete('q');
                    next.set('page', String(page + 1));
                    return next;
                  }, { replace: true })}>
                  Show more articles
                </button>
              )}
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

          {/*
            The path back.

            Measured against production at 2026-08-28T12:25Z, before this
            existed: the front page had NO link to /follow at all. The shortest
            route was two clicks and ran through an article — so a reader who
            landed here, read the headlines and left had passed no follow
            affordance except the word "RSS" in the footer.

            It says how we publish rather than promising a schedule, because a
            subscriber who hears nothing for a fortnight should be able to tell
            a quiet fortnight from a dead site.
          */}
          <section className="news-border news-panel mt-6 rounded-xl border px-6 py-4">
            <h2 className="news-fg text-callout font-semibold">Keep up with this</h2>
            <p className="news-muted mt-2 text-ui">
              Some days carry several stories and some carry none, so a feed is the only reliable
              way to catch the ones you want. There is no email list: following by feed does not
              ask for your address, so there is nothing to unsubscribe from.
            </p>
            <p className="mt-3 text-ui">
              <Link to="/follow" className="news-link underline underline-offset-4">
                RSS, JSON Feed and the weekly review →
              </Link>
            </p>
            <p className="mt-3 text-ui">
              <Link to="/briefings" className="news-link underline underline-offset-4">
                Help shape our business briefing pilot
              </Link>
            </p>
          </section>
        </div>

        <ElsewhereRail items={elsewhere} />
      </div>
    </div>
  );
}
