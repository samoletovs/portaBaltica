import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CorrectionLogEntry } from '../../news-api';
import { fetchCorrections } from '../../news-api';
import { ACCOUNTABLE_EDITOR } from '../../newsroom/correspondents';
import { usePageMeta } from '../../newsroom/usePageMeta';

/**
 * The public corrections log.
 *
 * Append-only and linked from the masthead rather than tucked away. A portal
 * that publishes automatically has to be conspicuously willing to say when it
 * got something wrong, or the automation is the only thing anyone remembers.
 */
export default function CorrectionsPage() {
  const [entries, setEntries] = useState<CorrectionLogEntry[] | null>(null);

  usePageMeta({
    title: 'Corrections — portaBaltica',
    description:
      'The public, append-only log of every correction portaBaltica has issued, with what changed and when.',
    canonicalPath: '/corrections',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchCorrections(controller.signal)
      .then(setEntries)
      .catch(() => setEntries([]));
    return () => controller.abort();
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Corrections</h1>
      <p className="mt-3 leading-relaxed text-slate-400">
        Every correction we have issued, in full, oldest never removed. If a figure or a reading
        changes after publication, the article carries the correction at the top and it is recorded
        here. {ACCOUNTABLE_EDITOR} is the accountable editor.
      </p>

      {entries === null ? (
        <div className="mt-8 h-24 animate-pulse rounded-lg bg-slate-800/30" aria-busy="true" />
      ) : entries.length === 0 ? (
        <p className="mt-8 rounded-lg border border-slate-800/60 bg-slate-900/30 px-5 py-6 text-sm text-slate-400">
          No corrections have been issued. This log is published whether or not it has entries, so
          that its emptiness is verifiable rather than assumed.
        </p>
      ) : (
        <ol className="mt-8 space-y-5">
          {entries.map((entry) => (
            <li
              key={`${entry.slug}-${entry.corrected_at}`}
              className="border-l-2 border-amber-600/50 py-1 pl-4"
            >
              <time dateTime={entry.corrected_at} className="text-xs uppercase tracking-widest text-amber-300/80">
                {new Date(entry.corrected_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
              <h2 className="mt-1 text-base font-medium text-slate-100">
                <Link
                  to={`/article/${entry.slug}`}
                  className="underline decoration-slate-700 underline-offset-4 hover:decoration-ocean-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
                >
                  {entry.headline}
                </Link>
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">{entry.description}</p>
              {entry.previous_value && (
                <p className="mt-1 text-xs text-slate-500">Previously: {entry.previous_value}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
