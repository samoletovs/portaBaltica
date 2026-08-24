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
        <h1 className="news-fg text-xl font-semibold">Correspondents</h1>
        <p className="news-muted mt-2 text-sm">
          Five AI correspondents write portaBaltica, each named after a Baltic coastal landmark.
        </p>
        <ul className="mt-6 space-y-3">
          {CORRESPONDENTS.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/correspondents/${entry.id}`}
                className="news-border news-focus flex items-center gap-3 rounded-lg border p-3"
              >
                <CorrespondentAvatar id={entry.id} size={40} />
                <span className="news-muted text-sm">{renderByline(entry)}</span>
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
                'news-focus',
                isActive
                  ? 'news-tab-active'
                  : 'news-tab-inactive news-hover',
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
          <h1 className="news-fg text-2xl font-semibold tracking-tight">{correspondent.name}</h1>
          <p className="news-accent text-sm">{renderByline(correspondent)}</p>
        </div>
      </header>

      <section
        aria-labelledby="what-this-is"
        className="news-border news-warning-panel mt-6 rounded-xl border px-5 py-4"
      >
        <h2 id="what-this-is" className="news-warning text-sm font-semibold">
          {correspondent.name} is not a person
        </h2>
        <p className="news-warning mt-2 text-sm leading-relaxed">
          {correspondent.name} is an AI system — a language model writing to a fixed brief, not a
          journalist, not a pen name for one, and not a real individual. There is nobody of this name.
          The name belongs to a place: {correspondent.landmark}
        </p>
        <p className="news-warning mt-2 text-sm leading-relaxed">
          It never conducts interviews, attends events, visits anywhere or speaks to sources, and it
          is never asked to recall a figure from memory. It writes sentences around numbers the
          pipeline has already retrieved and verified against the dataset. Every article it produces
          is checked before publication and refused if a check fails.
        </p>
        <p className="news-warning mt-2 text-sm leading-relaxed">
          <strong className="font-semibold">{ACCOUNTABLE_EDITOR}</strong> is the
          accountable editor and answers for everything published under this byline.{' '}
          <Link to="/about/ai" className="news-focus underline underline-offset-2">
            Read the full AI policy
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="beat-heading" className="mt-8">
        <h2 id="beat-heading" className="news-subtle text-sm font-medium uppercase tracking-widest">
          The beat
        </h2>
        <p className="news-muted mt-2 text-[17px] leading-relaxed">{correspondent.summary}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="news-subtle inline">Notices first: </dt>
            <dd className="news-muted inline">{correspondent.noticesFirst}</dd>
          </div>
          <div>
            <dt className="news-subtle inline">Characteristic move: </dt>
            <dd className="news-muted inline">{correspondent.characteristicMove}</dd>
          </div>
          <div>
            <dt className="news-subtle inline">Dashboard sections: </dt>
            <dd className="news-muted inline">
              {correspondent.sections.map((section, index) => (
                <span key={section}>
                  {index > 0 && ', '}
                  <Link
                    to={`/data/${section}`}
                    className="news-link news-focus underline underline-offset-4"
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
          className="news-subtle text-sm font-medium uppercase tracking-widest"
        >
          Works only from these datasets
        </h2>
        <ul className="mt-2 space-y-1.5">
          {correspondent.datasets.map((dataset) => (
            <li key={dataset.sourceId} className="news-muted text-sm">
              <span className="news-subtle font-mono text-xs">{dataset.sourceId}</span>{' '}
              {dataset.label}
            </li>
          ))}
        </ul>
        <p className="news-subtle mt-2 text-xs leading-relaxed">
          Content from a source that is not in the registry is dropped before it reaches a prompt.
        </p>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="mt-10">
          <h2
            id="recent-heading"
            className="news-border news-subtle border-b pb-2 text-sm font-medium uppercase tracking-widest"
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
