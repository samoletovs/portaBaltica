import { useState } from 'react';
import { EVIDENCE_COUNTRIES, type EvidenceCountry, type EvidenceNormalized, type EvidenceRow } from '../../evidence-types';

export function EvidenceReading({ row }: { row: EvidenceRow | null }) {
  if (!row) return <>Not returned</>;
  return <>{row.missing ? 'Missing' : String(row.value)}{row.status && <span className="news-muted"> · flag {row.status}</span>}</>;
}

export function EvidenceObservations({ data, printing = false }: { data: EvidenceNormalized; printing?: boolean }) {
  const [country, setCountry] = useState<EvidenceCountry>('LV');
  const [allPeriods, setAllPeriods] = useState(false);
  const rows = data.rows.filter(row => row.geo === country).sort((a, b) => b.period.localeCompare(a.period));
  const shown = allPeriods || printing ? rows : rows.slice(0, 12);
  const countries = Object.entries(EVIDENCE_COUNTRIES);
  return (
    <section className="evidence-section" aria-labelledby="observations-heading">
      <div className="evidence-section-heading">
        <h2 id="observations-heading" className="site-section-title text-title font-semibold news-fg">Frozen observations</h2>
        <label className="evidence-control evidence-screen-only text-ui">Country
          <select value={country} onChange={event => {
            const next = event.target.value;
            if (next === 'EE' || next === 'LV' || next === 'LT') setCountry(next);
          }}>
            {countries.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-ui news-muted">
        Percent of the active population (PC_ACT). Missing means no numeric reading, not zero.
        Flags are the source’s original codes; a blank flag does not certify a final reading.
      </p>
      <p className="text-ui news-muted" role="status" aria-atomic="true">Showing {shown.length} of {rows.length} observation months for {EVIDENCE_COUNTRIES[country]}. The CSV includes all countries and periods.</p>
      <div className="evidence-scroll" role="region" aria-label="Frozen observation table" tabIndex={0}>
        <table className="site-table evidence-table text-ui">
          <caption>{EVIDENCE_COUNTRIES[country]} · months measured, not retrieval months</caption>
          <thead><tr><th scope="col">Observation month</th><th scope="col">Unemployment (%)</th><th scope="col">Source flags</th></tr></thead>
          <tbody>{shown.map(row => <tr key={row.period}>
            <th scope="row">{row.period}</th>
            <td>{row.missing ? 'Missing' : String(row.value)}</td>
            <td>{row.status || 'No flag supplied'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > 12 && <button type="button" className="site-action evidence-screen-only text-ui" aria-expanded={allPeriods} onClick={() => setAllPeriods(value => !value)}>
        {allPeriods ? 'Show latest 12 months' : `Show all ${rows.length} months`}
      </button>}
    </section>
  );
}
