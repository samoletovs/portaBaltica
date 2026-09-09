import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { loadArticle } from '../../news-api';
import { formatPeriod } from '../../dataFreshness';
import { storyEvidence, type StoryEvidence } from '../../newsroom/story-evidence';
import { useEvidenceReveal } from '../../motion/useScrollChoreography';

const COUNTRIES = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

export function StoryEvidenceGraphic({ evidence, sourceHref }: { evidence: StoryEvidence; sourceHref: string }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEvidenceReveal(ref, evidence.points.map(point => `${point.geography}:${point.period}:${point.value}`).join('|'));
  const span = evidence.maximum - evidence.minimum;
  const zero = -evidence.minimum / span * 100;
  return (
    <figure ref={ref} className="story-evidence-graphic" aria-labelledby={titleId}>
      <figcaption>
        <p id={titleId} className="text-lead font-semibold news-fg">{evidence.title}</p>
        <p className="text-ui news-subtle">
          {evidence.kind === 'countries' ? formatPeriod(evidence.points[0].period) : COUNTRIES[evidence.points[0].geography]}
          {' · '}{evidence.unit}
        </p>
      </figcaption>
      <dl className="story-evidence-readings">
        {evidence.points.map(point => {
          const position = (point.value - evidence.minimum) / span * 100;
          return (
            <div key={`${point.geography}:${point.period}`} className="story-evidence-reading">
              <dt className="text-ui">{evidence.kind === 'countries' ? COUNTRIES[point.geography] : formatPeriod(point.period)}</dt>
              <dd className="text-title font-semibold tabular-nums" title={`Recorded value: ${point.value} ${point.unit}`}>
                <span>
                  {point.value.toLocaleString('en-GB', { maximumFractionDigits: 20 }).replace(/^-/, '\u2212')}
                </span>
                <div className="story-evidence-track" aria-hidden="true">
                <span className="story-evidence-zero" style={{ left: `${zero}%` }} />
                <span className={`story-evidence-fill evidence-${point.geography.toLowerCase()}`} style={{
                  left: `${Math.min(zero, position)}%`, width: `${Math.abs(position - zero)}%`,
                  transformOrigin: point.value < 0 ? 'right center' : 'left center',
                }} />
                {point.value === 0 && <span className="story-evidence-dot" style={{ left: `${zero}%` }} />}
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-caption news-subtle">
        Recorded with this article, not a live feed. {evidence.kind === 'periods' && 'Two recorded observations, not a complete time series. '}
        Source: {evidence.points[0].dataset ?? evidence.points[0].source_id}.
      </p>
      <Link to={sourceHref} className="lab-link text-ui">Inspect the source record ↗</Link>
    </figure>
  );
}

/** One additional read for the promoted story only; the rest of the feed stays lightweight. */
export function LeadStoryEvidence({ summary }: { summary: ArticleSummary }) {
  const [result, setResult] = useState<{ slug: string; evidence: StoryEvidence | null; failed: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadArticle(summary.slug, controller.signal).then(loaded => {
      if (controller.signal.aborted) return;
      const article = loaded.state === 'ok' && loaded.article.id === summary.id && loaded.article.slug === summary.slug
        ? loaded.article : null;
      setResult({ slug: summary.slug, evidence: article ? storyEvidence(article) : null, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ slug: summary.slug, evidence: null, failed: true });
    });
    return () => controller.abort();
  }, [summary.id, summary.slug]);
  if (result?.slug !== summary.slug) return null;
  if (result.failed) return <p role="status" className="text-ui news-subtle">The recorded graphic could not be loaded. The article links to its evidence.</p>;
  return result.evidence ? <StoryEvidenceGraphic evidence={result.evidence} sourceHref={`/article/${summary.slug}#article-evidence`} /> : null;
}
