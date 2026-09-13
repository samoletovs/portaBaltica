import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EVIDENCE_CHANGE_LABELS, EVIDENCE_COUNTRIES, type EvidenceComparison } from '../../evidence-types';
import { EvidenceReading } from './EvidenceObservations';

export function EvidenceRevisions({ comparison }: { comparison: EvidenceComparison | null }) {
  const [filter, setFilter] = useState('all');
  if (!comparison) return (
    <section className="evidence-section" aria-labelledby="revisions-heading">
      <h2 id="revisions-heading" className="site-section-title text-title font-semibold news-fg">Between captures</h2>
      <p className="text-callout news-muted">No earlier comparison is attached to this capture. That does not establish that the source was never revised.</p>
    </section>
  );
  const matching = comparison.changes.filter(change => filter === 'all' || change.kind === filter);
  const shown = matching.slice(0, 12);
  return (
    <section className="evidence-section" aria-labelledby="revisions-heading">
      <h2 id="revisions-heading" className="site-section-title text-title font-semibold news-fg">Between captures</h2>
      <p className="text-callout news-muted">
        {comparison.value_revisions} revised numeric readings.
        {comparison.unchanged ? ' No observation or dimension-label changes were found.' : ' Flags, missing readings and changes to coverage are listed separately.'}
      </p>
      <p className="text-ui news-muted">
        Newly included history can reflect expanded request coverage; it is not counted as a revised reading.
        A new observation month is also separate from revisions to earlier months.
        {comparison.metadata_changed && ' Source dimension labels also changed.'}
      </p>
      <Link to={`/evidence/${comparison.before}`} className="site-action text-ui">Open previous capture</Link>
      {comparison.changes.length > 0 && <>
        <label className="evidence-control text-ui">Change category
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All changes ({comparison.changes.length})</option>
            {Object.entries(EVIDENCE_CHANGE_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>{label} ({comparison.changes.filter(change => change.kind === kind).length})</option>
            ))}
          </select>
        </label>
        <p className="text-ui news-muted" role="status">Showing {shown.length} of {matching.length} matching changes. Download the comparison JSON for every row.</p>
        {shown.length ? <div className="evidence-scroll" role="region" aria-label="Revision table" tabIndex={0}>
          <table className="evidence-table text-ui">
            <caption>Original and subsequent source readings, including flags</caption>
            <thead><tr><th scope="col">Country / month</th><th scope="col">Change</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{shown.map(change => <tr key={`${change.geo}-${change.period}`}>
              <th scope="row">{EVIDENCE_COUNTRIES[change.geo]}<br />{change.period}</th>
              <td>{EVIDENCE_CHANGE_LABELS[change.kind]}</td>
              <td><EvidenceReading row={change.before} /></td>
              <td><EvidenceReading row={change.after} /></td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="text-callout news-muted">No changes in this category. Select another category to inspect the comparison.</p>}
      </>}
    </section>
  );
}
