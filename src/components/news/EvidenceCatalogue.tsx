import { Link } from 'react-router-dom';
import { evidenceHealth, fetchEvidenceIndex } from '../../evidence-api';
import { useEvidenceResource } from '../../evidence-hooks';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { PageIntro } from '../PageIntro';
import { EvidenceHistory } from './EvidenceHistory';
import { EvidenceFailure, EvidenceLoading, EvidenceTime } from './EvidenceState';
import '../../evidence-styles.css';

export function EvidenceCatalogue() {
  usePageMeta({
    title: 'Evidence archive | portaBaltica',
    description: 'Inspect frozen Baltic unemployment observations, download their original evidence and compare what changed between source captures.',
    canonicalPath: '/evidence',
  });
  const { state, retry } = useEvidenceResource('catalogue', fetchEvidenceIndex);
  const index = state.status === 'ready' ? state.value : null;
  const health = index ? evidenceHealth(index) : null;
  return (
    <main id="main" className="evidence-page">
      <PageIntro title="Evidence archive" lead="What the source returned. Kept as it was."
        description="Free, frozen records behind Baltic reporting. A capture is a retrieval, not the first publication of a figure. Not every intermediate source release is captured."
        actions={<Link to="/explore" className="site-action text-ui">Open live data explorer</Link>} />
      {state.status === 'loading' && <EvidenceLoading />}
      {state.status === 'error' && <EvidenceFailure error={state.error} retry={retry} />}
      {index && health && <>
        <section aria-labelledby="archive-status-heading" className="evidence-health">
          <div>
            <h2 id="archive-status-heading" className="text-callout font-semibold news-fg">{health.label}</h2>
            <p className="text-ui news-muted">{health.detail}</p>
          </div>
          <dl className="evidence-facts text-ui">
            <div><dt>Last attempt</dt><dd><EvidenceTime value={index.last_attempt?.finished_at ?? null} /></dd></div>
            <div><dt>Last successful retrieval</dt><dd><EvidenceTime value={index.last_success_at} /></dd></div>
          </dl>
        </section>
        <section className="evidence-section" aria-labelledby="archive-series-heading">
          <h2 id="archive-series-heading" className="site-section-title text-title font-semibold news-fg">{index.title}</h2>
          <p className="text-callout news-muted">
            Estonia, Latvia and Lithuania. Monthly, seasonally adjusted unemployment as a percentage
            of the active population; total age and sex. Normalized observations start in January 2020.
          </p>
          <p className="text-ui news-muted">
            Eurostat <code>une_rt_m</code> · M / SA / TOTAL / T / PC_ACT.
            Each raw response is kept in full; it may also include earlier periods and the EU aggregate.
          </p>
          {index.latest_snapshot_id && <Link className="site-action site-action-primary text-ui" to={`/evidence/${index.latest_snapshot_id}`}>Open latest capture</Link>}
        </section>
        <EvidenceHistory index={index} />
      </>}
    </main>
  );
}
