import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { ProvenanceSource } from '../../news-types';
import { isEligibleEvidenceSource, resolveEvidenceSource } from '../../evidence-api';
import { useEvidenceResource } from '../../evidence-hooks';

function ExactSourceLink({ source }: { source: ProvenanceSource }) {
  const { source_id, dataset, retrieved_at, url, evidence_snapshot_id } = source;
  const key = JSON.stringify([source_id, dataset, retrieved_at, url, evidence_snapshot_id]);
  const load = useCallback((signal: AbortSignal) => resolveEvidenceSource({
    source_id, dataset, retrieved_at, url, evidence_snapshot_id,
  }, signal), [source_id, dataset, retrieved_at, url, evidence_snapshot_id]);
  const { state, retry } = useEvidenceResource(key, load);
  if (state.status === 'loading') return <span role="status" className="news-muted text-caption">Checking for an exact frozen source…</span>;
  if (state.status === 'error') return <span className="news-muted text-caption">
    Frozen source not verified.{' '}
    <button className="news-link min-h-11 underline underline-offset-2" type="button" onClick={retry}>Retry source check</button>
  </span>;
  if (!state.value) return <span className="news-muted text-caption">No exact frozen source match is published.</span>;
  return <Link to={`/evidence/${state.value}`} className="news-link flex min-h-11 items-center underline underline-offset-2">
    Open exact frozen source
  </Link>;
}

export function EvidenceSourceLink({ source }: { source: ProvenanceSource }) {
  return isEligibleEvidenceSource(source) ? <ExactSourceLink source={source} /> : null;
}
