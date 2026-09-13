import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchEvidencePack } from '../../evidence-api';
import { useEvidenceResource } from '../../evidence-hooks';
import { isSnapshotId } from '../../evidence-validation';
import type { EvidencePack } from '../../evidence-types';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { PageIntro } from '../PageIntro';
import { EvidenceDownloads } from './EvidenceDownloads';
import { EvidenceObservations } from './EvidenceObservations';
import { EvidenceRevisions } from './EvidenceRevisions';
import { EvidenceFailure, EvidenceLoading, EvidenceTime } from './EvidenceState';
import '../../evidence-styles.css';

function PackContents({ pack }: { pack: EvidencePack }) {
  const { manifest, data, comparison } = pack;
  const periods = data.rows.map(row => row.period).sort();
  return <>
    <section className="evidence-section" aria-labelledby="capture-basis-heading">
      <h2 id="capture-basis-heading" className="site-section-title text-title font-semibold news-fg">Observation and capture dates</h2>
      <dl className="evidence-facts text-callout">
        <div><dt>Observation periods</dt><dd>{periods[0]} to {periods[periods.length - 1]}</dd></div>
        <div><dt>Source retrieved</dt><dd><EvidenceTime value={manifest.provenance.retrieved_at} /></dd></div>
        <div><dt>Source last updated</dt><dd><EvidenceTime value={data.source_updated_at} /></dd></div>
        <div><dt>Archive pack created</dt><dd><EvidenceTime value={manifest.created_at} /></dd></div>
      </dl>
      <p className="text-ui news-muted">Observation periods say when unemployment was measured. Retrieval says when we received this response. Pack creation may be later, especially for an audited historical import.</p>
      <p className="text-callout news-fg">{manifest.row_count} Baltic rows · {manifest.missing_count} missing · {manifest.flagged_count} flagged</p>
      <p className="text-ui news-muted">
        The normalized subset covers EE, LV and LT from January 2020: monthly, seasonally adjusted,
        total age and sex, percent of the active population (M / SA / TOTAL / T / PC_ACT).
        The complete raw response may include earlier periods and the EU aggregate. It is not limited to the table below.
      </p>
      <details>
        <summary className="text-ui news-fg">Source request and archive identity</summary>
        <p className="text-ui news-muted">Snapshot <code>{manifest.snapshot_id}</code></p>
        <a className="evidence-capture-link news-link text-ui" href={manifest.provenance.request_url} target="_blank" rel="noopener noreferrer">
          Open the original request at Eurostat <span className="sr-only">(live response, opens in a new tab)</span>
        </a>
        <p className="text-ui news-muted">That URL now returns live data, not this frozen response. Use the original source download below to reproduce this capture.</p>
        <p className="text-ui news-muted"><code>{manifest.provenance.request_url}</code></p>
      </details>
    </section>
    <EvidenceObservations data={data} />
    <EvidenceRevisions comparison={comparison} />
    <EvidenceDownloads manifest={manifest} key={manifest.snapshot_id} />
    <footer className="evidence-section text-ui news-muted">
      <p>{manifest.attribution}</p><p>{manifest.modifications}</p><p>{manifest.disclaimer}</p>
    </footer>
  </>;
}

export function EvidencePage() {
  const { snapshotId = '' } = useParams<{ snapshotId: string }>();
  const load = useCallback((signal: AbortSignal) => fetchEvidencePack(snapshotId, signal), [snapshotId]);
  const { state, retry } = useEvidenceResource(snapshotId, load);
  usePageMeta({
    title: 'Frozen evidence | portaBaltica',
    description: 'A timestamped Baltic unemployment snapshot with original source data, missing-value flags and reproducible downloads.',
    canonicalPath: isSnapshotId(snapshotId) ? `/evidence/${snapshotId}` : '/evidence',
    index: false,
  });
  const month = state.status === 'ready' ? state.value.manifest.provenance.retrieved_at.slice(0, 7) : '';
  return (
    <main id="main" className="evidence-page">
      <PageIntro title="Frozen evidence" lead="Baltic unemployment, exactly as retrieved."
        description="This is a historical capture, not a live reading or a guarantee that the source’s figures were final."
        backLink={<Link className="evidence-capture-link news-link text-ui" to={`/evidence${month ? `?month=${month}` : ''}`}>← Browse capture history</Link>} />
      {state.status === 'loading' && <EvidenceLoading label="Reading and verifying frozen evidence" />}
      {state.status === 'error' && <EvidenceFailure error={state.error} retry={retry} />}
      {state.status === 'ready' && <PackContents pack={state.value} key={snapshotId} />}
    </main>
  );
}
