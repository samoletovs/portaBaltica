import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchEvidenceMonth } from '../../evidence-api';
import { useEvidenceResource } from '../../evidence-hooks';
import type { EvidenceIndex, EvidenceSummary } from '../../evidence-types';
import { EvidenceFailure, EvidenceLoading, EvidenceTime } from './EvidenceState';

const PAGE_SIZE = 12;

function CaptureList({ snapshots }: { snapshots: EvidenceSummary[] }) {
  return (
    <ul className="evidence-captures">
      {snapshots.map(snapshot => <li key={snapshot.snapshot_id}>
        <div>
          <Link className="evidence-capture-link news-link text-callout" to={`/evidence/${snapshot.snapshot_id}`}>
            <span>Retrieved <EvidenceTime value={snapshot.observed_at} /></span>
            <span aria-hidden="true">↗</span>
          </Link>
          <p className="text-ui news-muted">Source updated <EvidenceTime value={snapshot.source_updated_at} /></p>
        </div>
        <p className="evidence-counts text-ui news-muted">
          {snapshot.row_count} rows · {snapshot.missing_count} missing · {snapshot.flagged_count} flagged
        </p>
      </li>)}
    </ul>
  );
}

function MonthlyCaptures({ month }: { month: string }) {
  const load = useCallback((signal: AbortSignal) => fetchEvidenceMonth(month, signal), [month]);
  const { state, retry } = useEvidenceResource(month, load);
  const [page, setPage] = useState(0);
  if (state.status === 'loading') return <EvidenceLoading label={`Reading captures from ${month}`} />;
  if (state.status === 'error') return <EvidenceFailure error={state.error} retry={retry} />;
  const snapshots = [...state.value.snapshots].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const start = page * PAGE_SIZE;
  return <>
    <p className="text-ui news-muted" role="status">{snapshots.length} captures in {month}. {snapshots.length > PAGE_SIZE && `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, snapshots.length)}.`}</p>
    {snapshots.length === 0 ? <p className="text-callout news-muted">No completed captures are listed for this month. Choose another retrieval month.</p>
      : <CaptureList snapshots={snapshots.slice(start, start + PAGE_SIZE)} />}
    {snapshots.length > PAGE_SIZE && <nav className="evidence-actions" aria-label="Capture pages">
      <button className="site-action text-ui" type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Newer captures</button>
      <button className="site-action text-ui" type="button" disabled={start + PAGE_SIZE >= snapshots.length} onClick={() => setPage(value => value + 1)}>Older captures</button>
    </nav>}
  </>;
}

export function EvidenceHistory({ index }: { index: EvidenceIndex }) {
  const [search, setSearch] = useSearchParams();
  const selected = search.get('month') ?? '';
  const months = [...index.months].sort().reverse();
  const month = months.includes(selected) ? selected : '';
  return (
    <section className="evidence-section" aria-labelledby="capture-history-heading">
      <div className="evidence-section-heading">
        <h2 id="capture-history-heading" className="site-section-title text-title font-semibold news-fg">Capture history</h2>
        <label className="evidence-control text-ui">
          Retrieval month
          <select value={month} onChange={event => {
            const next = new URLSearchParams(search);
            if (event.target.value) next.set('month', event.target.value); else next.delete('month');
            setSearch(next);
          }}>
            <option value="">Recent captures</option>
            {months.map(item => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p className="text-ui news-muted">Choose any retrieval month to reach its complete archive. Retrieval month is not the month being measured.</p>
      {month ? <MonthlyCaptures month={month} key={month} /> : <>
        {index.recent.length === 0 ? <p className="text-callout news-muted">No captures are published yet. Try again after a successful collection.</p>
          : <CaptureList snapshots={index.recent.slice(0, PAGE_SIZE)} />}
        {months.length > 0 && <p className="text-ui news-muted">The recent list is only a preview. Every completed capture remains available by month.</p>}
      </>}
    </section>
  );
}
