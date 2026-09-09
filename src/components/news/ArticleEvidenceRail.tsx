import { Link } from 'react-router-dom';
import type { Article } from '../../news-types';

function sourceHref(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function sourceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      });
}

interface Props {
  article: Article;
  seriesHref?: string;
}

export function ArticleEvidenceRail({ article, seriesHref }: Props) {
  return (
    <aside className="folio-story-rail" aria-labelledby="article-rail-heading">
      <div className="folio-story-rail-inner">
        <h2 id="article-rail-heading" className="news-fg text-title font-semibold">
          {article.tier === 'A' ? 'Behind the story' : 'Publication record'}
        </h2>
        <p className="news-muted mt-3 text-ui">
          {article.tier === 'A'
            ? 'The reporting is a published record. The charts are a separate, live view of the data.'
            : 'The original publisher’s words, reproduced without editing. The source record is kept below.'}
        </p>

        {article.published_at && (
          <dl className="folio-story-published text-ui">
            <dt className="news-subtle">Published</dt>
            <dd className="news-fg">
              <time dateTime={article.published_at}>{sourceDate(article.published_at)}</time>
            </dd>
          </dl>
        )}

        <section aria-label="Sources recorded with this article" className="folio-story-sources">
          {article.provenance.sources.length > 0 ? (
            <ul>
              {article.provenance.sources.map((source, index) => {
                const href = sourceHref(source.url);
                return (
                  <li key={`${source.source_id}-${source.dataset ?? ''}-${index}`}>
                    <p className="news-fg text-callout font-semibold">
                      {source.dataset ?? source.source_id}
                    </p>
                    {source.dataset && <p className="news-subtle text-ui">{source.source_id}</p>}
                    {source.dataset_version && (
                      <p className="news-subtle mt-1 text-caption">
                        Recorded version {source.dataset_version}
                      </p>
                    )}
                    <p className="news-subtle mt-2 text-caption">
                      Captured{' '}
                      <time dateTime={source.retrieved_at}>{sourceDate(source.retrieved_at)}</time>
                    </p>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View source: ${source.dataset ?? source.source_id}`}
                        className="folio-story-source-link news-link flex min-h-11 items-center text-ui"
                      >
                        View source <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <p className="news-subtle mt-2 text-caption">Source URL not recorded</p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="news-subtle text-ui">No dataset sources were recorded with this article.</p>
          )}
        </section>

        {seriesHref && (
          <div className="folio-story-research">
            <p className="news-fg text-callout font-semibold">Continue in the data</p>
            <p className="news-muted mt-2 text-ui">
              Inspect the series and its observation periods. New releases and revisions may differ
              from the figures published here.
            </p>
            <Link
              to={seriesHref}
              className="folio-story-research-link news-link flex min-h-11 items-center text-ui font-semibold"
            >
              Open in Data explorer <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}

        <a
          href="#article-evidence"
          className="folio-story-record-link news-link flex min-h-11 items-center text-ui"
        >
          Full provenance &amp; checks <span aria-hidden="true">↓</span>
        </a>
      </div>
    </aside>
  );
}
