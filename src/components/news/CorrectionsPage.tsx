import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import policySource from '../../../newsroom/policy/corrections.md?raw';
import type { CorrectionLogEntry } from '../../news-api';
import { fetchArticleIndex, fetchCorrections } from '../../news-api';
import { Markdown } from '../../newsroom/markdown';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { PolicyFooter } from './PolicyFooter';

/**
 * The corrections policy, and the log it describes.
 *
 * The policy text is rendered from newsroom/policy/corrections.md — the
 * authoritative copy — and the live log follows it, because the policy commits
 * to publishing "corrections per hundred articles as an ongoing metric rather
 * than a claim". That rate is computed here from the log and the published
 * index rather than asserted.
 */
export default function CorrectionsPage() {
  const [entries, setEntries] = useState<CorrectionLogEntry[] | null>(null);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  usePageMeta({
    title: 'Corrections | portaBaltica',
    description:
      'Our corrections policy and the complete public log: what was wrong, what it now says, and when it changed.',
    canonicalPath: '/corrections',
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchCorrections(controller.signal)
      .then(setEntries)
      .catch(() => setEntries([]));

    fetchArticleIndex(controller.signal)
      .then((index) => setPublishedCount(index.articles.filter((a) => a.tier !== 'C').length))
      .catch(() => setPublishedCount(null));

    return () => controller.abort();
  }, []);

  const perHundred =
    entries !== null && publishedCount !== null && publishedCount > 0
      ? ((entries.length / publishedCount) * 100).toFixed(1)
      : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Markdown source={policySource} />

      <section aria-labelledby="the-log" className="mt-10">
        <h2 id="the-log" className="news-fg text-xl font-semibold tracking-tight">
          The log
        </h2>

        {entries !== null && publishedCount !== null && (
          <dl className="news-border news-panel-muted mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3">
            <div className="news-panel px-4 py-3">
              <dt className="news-subtle text-xs uppercase tracking-widest">Corrections</dt>
              <dd className="news-fg mt-0.5 font-mono text-lg">{entries.length}</dd>
            </div>
            <div className="news-panel px-4 py-3">
              <dt className="news-subtle text-xs uppercase tracking-widest">Articles published</dt>
              <dd className="news-fg mt-0.5 font-mono text-lg">{publishedCount}</dd>
            </div>
            <div className="news-panel px-4 py-3">
              <dt className="news-subtle text-xs uppercase tracking-widest">Per hundred</dt>
              <dd className="news-fg mt-0.5 font-mono text-lg">{perHundred ?? '—'}</dd>
            </div>
          </dl>
        )}

        {entries === null ? (
          <div className="news-skeleton mt-4 h-24 animate-pulse rounded-lg" aria-busy="true" />
        ) : entries.length === 0 ? (
          <p className="news-border news-panel news-muted mt-4 rounded-lg border px-5 py-6 text-sm leading-relaxed">
            No corrections have been issued yet. This log is published whether or not it has
            entries, so that its emptiness is verifiable rather than assumed.
          </p>
        ) : (
          <ol className="mt-6 space-y-5">
            {entries.map((entry) => (
              <li
                key={`${entry.slug}-${entry.corrected_at}`}
                className="news-border border-l-2 py-1 pl-4"
              >
                <time
                  dateTime={entry.corrected_at}
                  className="news-warning text-xs uppercase tracking-widest"
                >
                  {new Date(entry.corrected_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
                <h3 className="news-fg mt-1 text-base font-medium">
                  <Link
                    to={`/article/${entry.slug}`}
                    className="news-link news-focus underline underline-offset-4"
                  >
                    {entry.headline}
                  </Link>
                </h3>
                <p className="news-muted mt-1 text-sm leading-relaxed">{entry.description}</p>
                {entry.previous_value && (
                  <p className="news-subtle mt-1 text-xs">Previously: {entry.previous_value}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <PolicyFooter sourcePath="newsroom/policy/corrections.md" />
    </div>
  );
}
