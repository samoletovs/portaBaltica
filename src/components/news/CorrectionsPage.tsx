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
    title: 'Corrections — portaBaltica',
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
        <h2 id="the-log" className="text-xl font-semibold tracking-tight text-white">
          The log
        </h2>

        {entries !== null && publishedCount !== null && (
          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-800/60 bg-slate-800/60 sm:grid-cols-3">
            <div className="bg-slate-900/60 px-4 py-3">
              <dt className="text-xs uppercase tracking-widest text-slate-500">Corrections</dt>
              <dd className="mt-0.5 font-mono text-lg text-slate-100">{entries.length}</dd>
            </div>
            <div className="bg-slate-900/60 px-4 py-3">
              <dt className="text-xs uppercase tracking-widest text-slate-500">Articles published</dt>
              <dd className="mt-0.5 font-mono text-lg text-slate-100">{publishedCount}</dd>
            </div>
            <div className="bg-slate-900/60 px-4 py-3">
              <dt className="text-xs uppercase tracking-widest text-slate-500">Per hundred</dt>
              <dd className="mt-0.5 font-mono text-lg text-slate-100">{perHundred ?? '—'}</dd>
            </div>
          </dl>
        )}

        {entries === null ? (
          <div className="mt-4 h-24 animate-pulse rounded-lg bg-slate-800/30" aria-busy="true" />
        ) : entries.length === 0 ? (
          <p className="mt-4 rounded-lg border border-slate-800/60 bg-slate-900/30 px-5 py-6 text-sm leading-relaxed text-slate-400">
            No corrections have been issued yet. This log is published whether or not it has
            entries, so that its emptiness is verifiable rather than assumed.
          </p>
        ) : (
          <ol className="mt-6 space-y-5">
            {entries.map((entry) => (
              <li
                key={`${entry.slug}-${entry.corrected_at}`}
                className="border-l-2 border-amber-600/50 py-1 pl-4"
              >
                <time
                  dateTime={entry.corrected_at}
                  className="text-xs uppercase tracking-widest text-amber-300/80"
                >
                  {new Date(entry.corrected_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
                <h3 className="mt-1 text-base font-medium text-slate-100">
                  <Link
                    to={`/article/${entry.slug}`}
                    className="underline decoration-slate-700 underline-offset-4 hover:decoration-ocean-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
                  >
                    {entry.headline}
                  </Link>
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{entry.description}</p>
                {entry.previous_value && (
                  <p className="mt-1 text-xs text-slate-500">Previously: {entry.previous_value}</p>
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
