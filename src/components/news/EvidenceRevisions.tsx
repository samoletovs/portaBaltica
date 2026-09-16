import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EVIDENCE_CHANGE_LABELS, EVIDENCE_COUNTRIES, type EvidenceComparison, type EvidenceCountry } from '../../evidence-types';
import { EvidenceReading } from './EvidenceObservations';

export function EvidenceRevisions({ comparison, printing = false }: { comparison: EvidenceComparison | null; printing?: boolean }) {
  const [filter, setFilter] = useState('all');
  const [country, setCountry] = useState<EvidenceCountry | 'all'>('all');
  const [expanded, setExpanded] = useState(false);
  if (!comparison) return (
    <section className="evidence-section" aria-labelledby="revisions-heading">
      <h2 id="revisions-heading" className="site-section-title text-title font-semibold news-fg">Between captures</h2>
      <p className="text-callout news-muted">No earlier comparison is attached to this capture. That does not establish that the source was never revised.</p>
    </section>
  );
  const countryChanges = comparison.changes.filter(change => country === 'all' || change.geo === country);
  const matching = countryChanges.filter(change => filter === 'all' || change.kind === filter);
  const shown = expanded || printing ? matching : matching.slice(0, 12);
  const countryLabel = country === 'all' ? 'all Baltic countries' : EVIDENCE_COUNTRIES[country];
  const categoryLabel = Object.entries(EVIDENCE_CHANGE_LABELS).find(([kind]) => kind === filter)?.[1] ?? 'All changes';
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
        <div className="evidence-actions evidence-screen-only">
          <label className="evidence-control text-ui">Revision country
            <select value={country} onChange={event => {
              const next = event.target.value;
              if (next === 'all' || next === 'EE' || next === 'LV' || next === 'LT') {
                setCountry(next);
                setExpanded(false);
              }
            }}>
              <option value="all">All Baltic countries</option>
              {Object.entries(EVIDENCE_COUNTRIES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <label className="evidence-control text-ui">Change category
            <select value={filter} onChange={event => { setFilter(event.target.value); setExpanded(false); }}>
              <option value="all">All changes ({countryChanges.length})</option>
              {Object.entries(EVIDENCE_CHANGE_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>{label} ({countryChanges.filter(change => change.kind === kind).length})</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-ui news-muted" role="status" aria-atomic="true">Showing {shown.length} of {matching.length} matching changes for {countryLabel}. The comparison JSON includes every country and category.</p>
        {shown.length ? <div className="evidence-scroll" role="region" aria-label="Revision table" tabIndex={0}>
          <table className="site-table evidence-table text-ui">
            <caption>Original and subsequent source readings, including flags · {countryLabel} · {categoryLabel}</caption>
            <thead><tr><th scope="col">Country / month</th><th scope="col">Change</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{shown.map(change => <tr key={`${change.geo}-${change.period}`}>
              <th scope="row">{EVIDENCE_COUNTRIES[change.geo]}<br />{change.period}</th>
              <td>{EVIDENCE_CHANGE_LABELS[change.kind]}</td>
              <td><EvidenceReading row={change.before} /></td>
              <td><EvidenceReading row={change.after} /></td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="text-callout news-muted">No changes match this country and category. Select another country or category to inspect the comparison.</p>}
        {matching.length > 12 && <button type="button" className="site-action evidence-screen-only text-ui" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Show first 12 matching changes' : `Show all ${matching.length} matching changes`}
        </button>}
      </>}
    </section>
  );
}
