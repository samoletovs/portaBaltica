import { useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex } from '../../news-api';
import {
  ACCOUNTABLE_EDITOR,
  CORRESPONDENTS,
  getCorrespondent,
  renderByline,
} from '../../newsroom/correspondents';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { CorrespondentAvatar } from './CorrespondentAvatar';
import { ArticleCard } from './NewsCard';
import { SECTION_LABELS } from '../../newsroom/sections';

/**
 * The bio page.
 *
 * Load-bearing, not decorative. It has to say plainly what this correspondent
 * is — a software system, not a person — which datasets it is permitted to
 * work from, and who is accountable for what it publishes. A reader who is
 * suspicious of an AI byline should find every answer here on the first
 * screen, in the first paragraph, not buried under a personality sketch.
 */
export default function CorrespondentPage() {
  const { id } = useParams<{ id: string }>();
  const correspondent = getCorrespondent(id);
  const [recent, setRecent] = useState<ArticleSummary[]>([]);

  usePageMeta({
    title: correspondent
      ? `${correspondent.name} — AI correspondent, ${correspondent.beat} — portaBaltica`
      : 'Correspondents — portaBaltica',
    description: correspondent
      ? `${correspondent.name} is an AI system that writes portaBaltica's ${correspondent.beat} coverage from open data. Not a person.`
      : undefined,
    canonicalPath: id ? `/correspondents/${id}` : '/correspondents',
  });

  useEffect(() => {
    if (!correspondent) return;
    const controller = new AbortController();
    fetchArticleIndex(controller.signal)
      .then((index) =>
        setRecent(
          index.articles.filter(
            (article) => article.tier !== 'C' && article.persona?.id === correspondent.id,
          ),
        ),
      )
      .catch(() => setRecent([]));
    return () => controller.abort();
  }, [correspondent]);

  if (!correspondent) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-100">Correspondents</h1>
        <p className="mt-2 text-sm text-slate-400">
          Five AI correspondents write portaBaltica, each covering a beat with a declared expertise.
        </p>
        <ul className="mt-6 space-y-3">
          {CORRESPONDENTS.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/correspondents/${entry.id}`}
                className="flex items-center gap-3 rounded-lg border border-slate-800/60 p-3 hover:border-ocean-700/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
              >
                <CorrespondentAvatar id={entry.id} size={40} />
                <span className="text-sm text-slate-200">{renderByline(entry)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Correspondents" className="mb-8 flex flex-wrap gap-2">
        {CORRESPONDENTS.map((entry) => (
          <NavLink
            key={entry.id}
            to={`/correspondents/${entry.id}`}
            className={({ isActive }) =>
              [
                'rounded-full border px-3 py-1 text-xs transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400',
                isActive
                  ? 'border-ocean-500/60 bg-ocean-500/15 text-ocean-100'
                  : 'border-slate-700/60 text-slate-400 hover:text-slate-200',
              ].join(' ')
            }
          >
            {entry.name}
          </NavLink>
        ))}
      </nav>

      <header className="flex flex-wrap items-center gap-5">
        <CorrespondentAvatar id={correspondent.id} size={88} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{correspondent.name}</h1>
          <p className="text-sm text-ocean-200">{renderByline(correspondent)}</p>
        </div>
      </header>

      <section
        aria-labelledby="what-this-is"
        className="mt-6 rounded-xl border border-amber-600/40 bg-amber-950/20 px-5 py-4"
      >
        <h2 id="what-this-is" className="text-sm font-semibold text-amber-100">
          {correspondent.name} is not a person
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/85">
          {correspondent.name} is an AI system — a language model writing to a fixed brief, not a
          journalist, not a pen name for one, and not a real individual. There is nobody of this
          name. The name is invented, the expertise below describes what this correspondent is built
          to look for, and it has never held a job, studied anywhere or been anywhere.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/85">
          It never conducts interviews, attends events, visits anywhere or speaks to sources, and it
          is never asked to recall a figure from memory. It writes sentences around numbers the
          pipeline has already retrieved and verified against the dataset. Every article it produces
          is checked before publication and refused if a check fails.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/85">
          <strong className="font-semibold text-amber-50">{ACCOUNTABLE_EDITOR}</strong> is the
          accountable editor and answers for everything published under this byline.{' '}
          <Link to="/about/ai" className="underline underline-offset-2 hover:text-amber-50">
            Read the full AI policy
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="beat-heading" className="mt-8">
        <h2 id="beat-heading" className="text-sm font-medium uppercase tracking-widest text-slate-500">
          The beat
        </h2>
        <p className="mt-2 text-[17px] leading-relaxed text-slate-300">{correspondent.summary}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="inline text-slate-500">Notices first: </dt>
            <dd className="inline text-slate-300">{correspondent.noticesFirst}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Characteristic move: </dt>
            <dd className="inline text-slate-300">{correspondent.characteristicMove}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Dashboard sections: </dt>
            <dd className="inline text-slate-300">
              {correspondent.sections.map((section, index) => (
                <span key={section}>
                  {index > 0 && ', '}
                  <Link
                    to={`/data/${section}`}
                    className="underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
                  >
                    {SECTION_LABELS[section] ?? section}
                  </Link>
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="datasets-heading" className="mt-8">
        <h2
          id="datasets-heading"
          className="text-sm font-medium uppercase tracking-widest text-slate-500"
        >
          Works only from these datasets
        </h2>
        <ul className="mt-2 space-y-1.5">
          {correspondent.datasets.map((dataset) => (
            <li key={dataset.sourceId} className="text-sm text-slate-300">
              <span className="font-mono text-xs text-slate-500">{dataset.sourceId}</span>{' '}
              {dataset.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Content from a source that is not in the registry is dropped before it reaches a prompt.
        </p>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="mt-10">
          <h2
            id="recent-heading"
            className="border-b border-slate-800/60 pb-2 text-sm font-medium uppercase tracking-widest text-slate-500"
          >
            Recent articles
          </h2>
          <div className="mt-4 space-y-5">
            {recent.map((summary) => (
              <ArticleCard key={summary.id ?? summary.slug} summary={summary} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
