import { useState } from 'react';
import type { Article, PublishedObservation } from '../../news-types';
import { COUNTRY_INFO, type Country } from '../../CountryContext';
import { downloadText } from '../../utils/downloadText';
import './FrozenEvidence.css';

function belongsToArticle(point: PublishedObservation, article: Article): boolean {
  return Boolean(point && point.article_id === article.id && point.slug === article.slug
    && Number.isFinite(point.value) && typeof point.metric_label === 'string'
    && typeof point.geography === 'string' && typeof point.unit === 'string' && typeof point.raw_source === 'boolean'
    && typeof point.period === 'string' && point.period);
}

function sourceUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function FrozenEvidence({ article }: { article: Article }) {
  const [download, setDownload] = useState<{ article: string; message: string } | null>(null);
  if (article.tier !== 'A') return null;
  const recorded = article.provenance.published_observations ?? [];
  const observations = recorded.filter(point => belongsToArticle(point, article));
  const omitted = recorded.length - observations.length;

  function exportEvidence() {
    const text = JSON.stringify({
      record_type: 'frozen_publication_evidence',
      note: 'Observations recorded for this article, not a complete historical series or current data. Read any correction notices before reuse.',
      article: { id: article.id, slug: article.slug, headline: article.headline, published_at: article.published_at },
      published_observations: observations,
      sources: article.provenance.sources,
      corrections: article.corrections ?? [],
      ...(omitted ? { omitted_entries: omitted } : {}),
      exported_at: new Date().toISOString(),
    }, null, 2);
    const started = downloadText(`portabaltica-${article.slug}-frozen-evidence.json`, 'application/json;charset=utf-8', text);
    setDownload({
      article: article.id,
      message: started ? 'Frozen evidence download started.' : 'Download is not available in this browser. The recorded values remain in the table.',
    });
  }

  return (
    <section className="frozen-evidence" aria-labelledby="frozen-evidence-heading">
      <h3 id="frozen-evidence-heading" className="news-fg text-lead font-semibold">The evidence at publication</h3>
      <p className="news-muted mt-2 text-ui">
        These are the frozen observations recorded for this story, not a complete historical series.
        Current charts and source datasets may include later releases or revisions.
      </p>
      {Boolean(article.corrections?.length) && (
        <p className="news-warning mt-2 text-ui">Read the correction notices before reusing these original observations.</p>
      )}
      {omitted > 0 && (
        <p className="news-warning mt-2 text-ui">
          {omitted} recorded {omitted === 1 ? 'entry could' : 'entries could'} not be matched to this article or a valid value and {omitted === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
      {observations.length === 0 ? (
        <p className="news-muted mt-3 text-ui">Frozen observations were not recorded with this article, or no usable record is available. Today’s data is not a substitute for that missing record.</p>
      ) : (
        <>
          <div className="frozen-evidence-tools mt-3">
            <button type="button" className="site-action text-ui" onClick={exportEvidence}>Download frozen evidence as JSON</button>
            <p className="news-muted text-caption" role="status" aria-atomic="true" data-testid="frozen-download-status">
              {download?.article === article.id ? download.message : ''}
            </p>
          </div>
          <p className="news-subtle mt-2 text-caption">Exact recorded values and units. Scroll the table horizontally if needed.</p>
          <div className="frozen-evidence-scroll mt-2" role="region" aria-label="Frozen observation values" tabIndex={0}>
            <table className="site-table frozen-evidence-table text-ui">
              <caption className="news-muted text-caption">Frozen observations · {observations.length} recorded entries</caption>
              <thead><tr>
                <th scope="col">Measure</th><th scope="col">Country</th><th scope="col">Period</th>
                <th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Record type</th><th scope="col">Source</th>
              </tr></thead>
              <tbody>{observations.map((point, index) => {
                const source = article.provenance.sources.find(item => item.source_id === point.source_id
                  && (item.dataset ?? null) === point.dataset);
                const href = sourceUrl(source?.url);
                const country = Object.hasOwn(COUNTRY_INFO, point.geography)
                  ? COUNTRY_INFO[point.geography as Country].label : point.geography;
                return (
                  <tr key={`${point.metric}-${point.geography}-${point.period}-${index}`}>
                    <th scope="row">{point.metric_label}</th>
                    <td>{country}</td><td>{point.period}</td><td className="tabular-nums">{String(point.value)}</td><td>{point.unit || 'Not stated'}</td>
                    <td>{point.raw_source ? 'Source observation' : 'Calculated finding'}</td>
                    <td>{href ? <a className="news-link" href={href} target="_blank" rel="noopener noreferrer">{point.dataset ?? point.source_id} ↗<span className="sr-only"> (opens in a new tab)</span></a> : <>{point.dataset ?? point.source_id}<span className="news-subtle block text-caption">Source link not recorded</span></>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
