import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { correctedSlugs, fetchArticleIndex, fetchCorrections } from '../../news-api';
import type { CorrectionState } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleCard, CorrectionsUnavailable, FeedItem } from './NewsCard';
import ElsewhereRail from './ElsewhereRail';
import { SECTION_LABELS } from '../../newsroom/sections';
import { useOverflowFade } from '../../utils/useOverflowFade';

type Filter = 'all' | string;

/**
 * The section filter, as its own component.
 *
 * Not a nicety: `useOverflowFade` attaches in an effect, and an effect runs
 * once when its *owner* mounts. `NewsFeed` mounts showing a skeleton, because
 * the index has not arrived, so the strip does not exist yet and the hook
 * bails on a null ref — measured, the fade never appeared (`mask: NONE` at
 * 320px with 601px hidden) while the two strips in `Header` worked, because
 * those elements are present at mount. A ref object cannot re-trigger the
 * effect when it is later filled, so the element has to arrive *with* its own
 * hook. Mounting this only once there are sections does exactly that.
 */
function SectionFilter({
  sections,
  filter,
  onChange,
}: {
  sections: string[];
  filter: Filter;
  onChange: (next: Filter) => void;
}) {
  const [ref, fade] = useOverflowFade<HTMLDivElement>();

  return (
    // One row that scrolls sideways on a phone, wrapping only once there is
    // room to wrap into.
    //
    // Wrapping at every width made the filter cost **200px across four rows**
    // at 320px — 26% of a 780px viewport, spent on a control, above any
    // journalism. That is the same arithmetic §4.4 already applies to the
    // guided tour: what costs a tenth of a laptop costs a quarter of a phone.
    // A sideways strip is the answer the site header and the dashboard rail
    // both already give, so this is the existing idiom rather than a new one.
    <div
      ref={ref}
      className={`mb-6 flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-x-visible ${fade}`}
      role="group"
      aria-label="Filter by section"
    >
      {(['all', ...sections] as Filter[]).map((section) => (
        <button
          key={section}
          type="button"
          onClick={() => onChange(section)}
          aria-pressed={filter === section}
          className={[
            'shrink-0 rounded-full border px-4 py-2 text-caption transition-colors',
            '',
            filter === section ? 'news-tab-active' : 'news-tab-inactive news-hover',
          ].join(' ')}
        >
          {section === 'all' ? 'Everything' : SECTION_LABELS[section as never] ?? section}
        </button>
      ))}
    </div>
  );
}

function byNewestFirst(a: ArticleSummary, b: ArticleSummary): number {
  return (b.published_at ?? '').localeCompare(a.published_at ?? '');
}

export default function NewsFeed() {
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [corrections, setCorrections] = useState<CorrectionState>({ state: 'loading' });

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
  const isCorrected = (summary: ArticleSummary) =>
    corrections.state === 'ok' && corrections.slugs.has(summary.slug);

  return (
    <div>
      {sections.length > 1 && (
        <SectionFilter sections={sections} filter={filter} onChange={setFilter} />
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
              way to catch the ones you want. There is no email list: we do not collect addresses,
              so there is nothing to unsubscribe from.
            </p>
            <p className="mt-3 text-ui">
              <Link to="/follow" className="news-link underline underline-offset-4">
                RSS, JSON Feed and the weekly review →
              </Link>
            </p>
          </section>
        </div>

        <ElsewhereRail items={elsewhere} />
      </div>
    </div>
  );
}
