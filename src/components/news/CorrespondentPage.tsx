import { useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex } from '../../news-api';
import {
  ACCOUNTABLE_PUBLISHER,
  AI_EDITOR,
  CORRESPONDENTS,
  getCorrespondent,
  renderByline,
} from '../../newsroom/correspondents';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { CorrespondentAvatar } from './CorrespondentAvatar';
import { ArticleCard } from './NewsCard';
import { SECTION_LABELS } from '../../newsroom/sections';
import { NewsroomIndex } from './NewsroomIndex';

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
      ? `${correspondent.name}, AI correspondent, ${correspondent.beat} | portaBaltica`
      : 'The newsroom | portaBaltica',
    description: correspondent
      ? `${correspondent.name} is an AI system that writes portaBaltica's ${correspondent.beat} coverage from open data. Not a person.`
      : undefined,
    canonicalPath: id ? `/newsroom/${id}` : '/newsroom',
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
    return <NewsroomIndex />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Correspondents" className="mb-8 flex flex-wrap gap-2">
        {CORRESPONDENTS.map((entry) => (
          <NavLink
            key={entry.id}
            to={`/newsroom/${entry.id}`}
            className={({ isActive }) =>
              [
                'rounded-full border px-4 py-2 text-caption transition-colors',
                '',
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

      <header className="flex flex-wrap items-center gap-6">
        <CorrespondentAvatar id={correspondent.id} size={88} />
        <div>
          <h1 className="balance-text news-fg text-headline font-semibold tracking-tight">{correspondent.name}</h1>
          <p className="news-accent mt-1 text-ui">{renderByline(correspondent)}</p>
        </div>
      </header>

      <section
        aria-labelledby="what-this-is"
        className="news-border news-warning-panel mt-6 rounded-xl border px-6 py-4"
      >
        <h2 id="what-this-is" className="balance-text news-warning text-title font-semibold">
          {correspondent.name} is not a person
        </h2>
        <p className="pretty-text news-warning mt-3 text-callout">
          {correspondent.name} is an AI system: a language model writing to a fixed brief, not a
          journalist, not a pen name for one, and not a real individual. There is nobody of this
          name. The name is invented, the expertise below describes what this correspondent is built
          to look for, and it has never held a job, studied anywhere or been anywhere.
        </p>
        <p className="pretty-text news-warning mt-3 text-callout">
          It never conducts interviews, attends events, visits anywhere or speaks to sources, and it
          is never asked to recall a figure from memory. It writes sentences around numbers the
          pipeline has already retrieved and verified against the dataset. Every article it produces
          is checked before publication and refused if a check fails.
        </p>
        <p className="pretty-text news-warning mt-3 text-callout">
          Every story filed here is reviewed by{' '}
          <Link to="/newsroom/saulkrasti" className="underline underline-offset-2">
            {AI_EDITOR.name}
          </Link>
          , the AI editor, who sends work back with notes or holds it.{' '}
          <strong className="font-semibold">{ACCOUNTABLE_PUBLISHER}</strong> is the accountable
          publisher and answers for everything published under this byline.{' '}
          <Link to="/about/ai" className="underline underline-offset-2">
            Read the full AI policy
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="beat-heading" className="mt-8">
        <h2 id="beat-heading" className="news-fg text-callout font-semibold">
          The beat
        </h2>
        <p className="pretty-text news-muted mt-3 text-prose">{correspondent.summary}</p>
        <div className="news-border news-panel mt-4 rounded-lg border px-4 py-3">
          <h3 className="news-subtle text-caption font-semibold uppercase tracking-widest">
            How this one writes
          </h3>
          <p className="pretty-text news-muted mt-2 text-callout">{correspondent.styleNote}</p>
        </div>
        <dl className="mt-6 space-y-2 text-ui">
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
                    className="news-link underline underline-offset-4"
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
          className="news-fg text-callout font-semibold"
        >
          Works only from these datasets
        </h2>
        <ul className="mt-2 space-y-2">
          {correspondent.datasets.map((dataset) => (
            <li key={dataset.sourceId} className="news-muted text-ui">
              <span className="news-subtle font-mono text-caption">{dataset.sourceId}</span>{' '}
              {dataset.label}
            </li>
          ))}
        </ul>
        <p className="news-subtle mt-3 text-caption">
          Content from a source that is not in the registry is dropped before it reaches a prompt.
        </p>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="mt-12">
          <h2
            id="recent-heading"
            className="news-border news-fg border-b pb-2 text-callout font-semibold"
          >
            Recent articles
          </h2>
          <div className="mt-4 space-y-6">
            {recent.map((summary) => (
              <ArticleCard key={summary.id ?? summary.slug} summary={summary} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
