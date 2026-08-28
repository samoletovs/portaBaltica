import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex, weeklyWraps } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { ArticleCard } from './NewsCard';

/**
 * The weekly review, and the archive of the ones before it.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * The newsroom has written a weekly wrap on its own timer for as long as it has
 * had a timer, and nothing surfaced it. `format: 'weekly_wrap'` was already a
 * real field on the article, `FormatBadge` already rendered it, and a reader had
 * no way to discover a weekly review existed at all — which makes the single
 * most natural reason to come back the one artefact this site hid.
 *
 * WHAT IT MUST NOT DO WHEN THERE IS NONE
 * --------------------------------------
 * Render an empty shell, a placeholder card, or the previous week's wrap under a
 * heading that implies it is current. Today there is genuinely no weekly review
 * published — the one that exists was retracted for filing a cross-beat digest
 * as a maritime report — so the absent case is the live case rather than a
 * hypothetical, and it is what a reader will actually see.
 *
 * The three states are kept apart on purpose:
 *
 *   loading  we do not know yet
 *   failed   we could not find out
 *   none     we found out, and there is none
 *
 * Collapsing `failed` into `none` would tell a reader we had published nothing
 * on the strength of a network error. That is the same fault as a feed serving
 * a valid empty document when its index 404s, which this repo has already
 * shipped once and now has three separate guards against.
 */

type Load =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ok'; wraps: ArticleSummary[] };

function WhatItIs() {
  return (
    <p className="pretty-text news-muted mt-4 text-prose">
      Once a week we read back over what we reported and write one piece about it. It is written on
      Sundays, and published only when the week produced enough findings to be worth reviewing, so
      some weeks carry none.
    </p>
  );
}

/**
 * No current review, and why.
 *
 * States the mechanism rather than the incident. A page naming the particular
 * wrap that was withdrawn is true today and stale the moment another is
 * published; the reason a week can be empty is true permanently.
 */
function NoReview() {
  return (
    <div className="news-border news-panel mt-8 rounded-xl border px-6 py-8">
      <h2 className="balance-text news-fg text-title font-semibold tracking-tight">
        No weekly review is published at the moment
      </h2>
      <p className="pretty-text news-muted mt-3 text-callout">
        Either the week did not produce enough to review, or a review that was published has since
        been withdrawn. A withdrawn piece leaves this page and the feeds at once, and the reason is
        recorded in the corrections log rather than quietly dropped.
      </p>
      <p className="mt-4 text-ui">
        <Link to="/corrections" className="news-link underline underline-offset-4">
          Read the corrections log →
        </Link>
      </p>
      <p className="mt-2 text-ui">
        <Link to="/" className="news-link underline underline-offset-4">
          Everything we have published →
        </Link>
      </p>
    </div>
  );
}

function CouldNotLoad() {
  return (
    <div
      role="alert"
      className="news-border news-warning-panel mt-8 rounded-xl border px-6 py-8"
    >
      <h2 className="balance-text news-warning text-title font-semibold tracking-tight">
        The archive could not be loaded
      </h2>
      <p className="pretty-text news-warning mt-3 text-callout">
        This is a failure to reach the published articles, not a statement that there are none. The
        dashboard is unaffected.
      </p>
    </div>
  );
}

export default function WeeklyPage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  usePageMeta({
    title: 'The weekly review | portaBaltica',
    description:
      'One piece a week reading back over what we reported from Baltic open data, published only when the week produced enough to review.',
    canonicalPath: '/weekly',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchArticleIndex(controller.signal)
      .then((index) => setLoad({ state: 'ok', wraps: weeklyWraps(index.articles) }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'failed' });
      });
    return () => controller.abort();
  }, []);

  const wraps = load.state === 'ok' ? load.wraps : [];
  const [latest, ...earlier] = wraps;

  return (
    <div className="mx-auto max-w-measure">
      <h1 className="balance-text news-fg text-display font-semibold tracking-tight">
        The weekly review
      </h1>

      <WhatItIs />

      {load.state === 'loading' && (
        <div
          className="news-skeleton mt-8 h-48 animate-pulse rounded-xl"
          aria-busy="true"
          aria-label="Loading the weekly review"
        />
      )}

      {load.state === 'failed' && <CouldNotLoad />}

      {load.state === 'ok' && !latest && <NoReview />}

      {latest && (
        <section aria-label="The latest weekly review" className="mt-8">
          {/*
            An eyebrow, not a heading. `text-caption` is 12px, and an h2 set
            smaller than the prose beneath it stops reading as a heading —
            `tests/typography.test.ts` fails on exactly that. The section is
            labelled for a screen reader by `aria-label` instead, which says
            more than the two words on screen do.
          */}
          <p className="news-subtle text-caption font-semibold uppercase tracking-widest">
            The latest
          </p>
          <div className="mt-3">
            <ArticleCard summary={latest} variant="lead" />
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section aria-labelledby="earlier-reviews" className="mt-12">
          <h2
            id="earlier-reviews"
            className="balance-text news-fg text-title font-semibold tracking-tight"
          >
            Earlier reviews
          </h2>
          <ol className="mt-4 space-y-4">
            {earlier.map((wrap) => (
              <li key={wrap.id ?? wrap.slug} className="news-border border-b pb-4">
                {wrap.published_at && (
                  <time
                    dateTime={wrap.published_at}
                    className="news-subtle text-caption font-semibold uppercase tracking-widest"
                  >
                    {new Date(wrap.published_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </time>
                )}
                <h3 className="balance-text news-fg mt-1 text-callout font-semibold">
                  <Link to={`/article/${wrap.slug}`} className="news-hover">
                    {wrap.headline}
                  </Link>
                </h3>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="news-border news-panel mt-12 rounded-lg border px-4 py-3">
        <p className="news-muted text-ui">Prefer everything as it lands?</p>
        <p className="mt-1 text-ui">
          <Link to="/follow" className="news-link underline underline-offset-4">
            Our feeds are here →
          </Link>
        </p>
      </div>
    </div>
  );
}
