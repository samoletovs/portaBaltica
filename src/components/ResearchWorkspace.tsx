import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { COUNTRY_INFO, useCountry, type Country } from '../CountryContext';
import { useFilter } from '../FilterContext';
import { DASHBOARD_SECTIONS, type DashboardSection } from '../sections';
import { useIndicatorRegistry, type IndicatorRegistryEntry } from '../hooks/useIndicatorRegistry';
import { usePageMeta } from '../newsroom/usePageMeta';
import { freshnessOf, axisPeriodLabel } from '../dataFreshness';
import { formatValue } from '../utils/formatValue';
import { type SeriesExport } from '../utils/exportSeries';
import {
  entriesForSection, FREQUENCY_LABEL, NATIONAL_INDICATORS, RESEARCH_SECTIONS,
  researchSection, resolveResearchId,
} from '../utils/researchCatalog';
import { DownloadMenu } from './DownloadMenu';
import './ResearchWorkspace.css';
import { useCountryFromQuery } from '../hooks/useCountryFromQuery';
import { useAnalysisTransition } from '../motion/useScrollChoreography';

const BalticCompareChart = lazy(() => import('./BalticCompareChart').then(module => ({ default: module.BalticCompareChart })));
const NationalChart = lazy(() => import('./IndicatorCard').then(module => ({ default: module.IndicatorChart })));
const COUNTRIES: Country[] = ['LV', 'EE', 'LT'];

interface ResearchWorkspaceProps {
  section?: DashboardSection | 'all';
  indicatorId?: string;
}

function IndicatorMeta({ id, entry, loading }: { id: string; entry?: IndicatorRegistryEntry; loading: boolean }) {
  usePageMeta({
    title: `${entry?.title ?? 'Indicator'} | portaBaltica`,
    description: entry
      ? `${entry.title} for Latvia, Estonia and Lithuania. ${FREQUENCY_LABEL[entry.freq] ?? 'Periodic'} series in ${entry.unit}, from Eurostat dataset ${entry.dataset}, downloadable as CSV or JSON.`
      : undefined,
    canonicalPath: `/indicator/${id}`,
    index: Boolean(entry) || loading,
  });
  return null;
}

function LoadingIndicator() {
  return <div className="lab-loading text-ui" role="status" aria-label="Loading the indicator" aria-busy="true">Loading the source series…</div>;
}

function Analysis({ entry, nationalId, focused }: { entry: IndicatorRegistryEntry; nationalId?: string; focused: boolean }) {
  const root = useRef<HTMLElement>(null);
  const { country } = useCountry();
  const { years } = useFilter();
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  const [result, setResult] = useState<{ key: string; data: BalticCompareData | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nationalOpen, setNationalOpen] = useState(false);
  const [period, setPeriod] = useState('');
  const [copyResult, setCopyResult] = useState<{ url: string; copied: boolean } | null>(null);
  const permalink = `/indicator/${entry.id}?country=${country}`;
  async function copyMeasureLink() {
    try {
      await navigator.clipboard.writeText(new URL(permalink, window.location.origin).href);
      setCopyResult({ url: permalink, copied: true });
    } catch {
      setCopyResult({ url: permalink, copied: false });
    }
  }
  const requestKey = `${entry.id}:${years}:${attempt}`;
  const data = result?.key === requestKey ? result.data : null;
  const state = result?.key !== requestKey ? 'loading' : data ? 'ready' : 'error';
  useAnalysisTransition(root, `${mode}:${entry.id}:${state}`);

  useEffect(() => {
    let active = true;
    void fetchBalticCompare(entry.id, years).then(payload => {
      if (!active) return;
      if (!payload || !payload.countries || payload.indicator !== entry.id) {
        setResult({ key: requestKey, data: null });
        return;
      }
      setResult({ key: requestKey, data: payload });
    }).catch(() => {
      if (active) setResult({ key: requestKey, data: null });
    });
    return () => { active = false; };
  }, [entry.id, years, requestKey]);

  const series = (geo: Country) => data?.countries[geo]?.series ?? [];
  const periods = [...new Set([
    ...COUNTRIES.flatMap(geo => series(geo).map(point => point.period)),
    ...(data?.reference?.series ?? []).map(point => point.period),
  ])].sort().reverse();
  const commonPeriod = periods.find(label => COUNTRIES.every(geo =>
    series(geo).some(point => point.period === label && point.value !== null && Number.isFinite(point.value)),
  ));
  const inspectPeriod = periods.includes(period) ? period : commonPeriod ?? periods[0];
  const usable = COUNTRIES.some(geo => series(geo).some(point => point.value !== null && Number.isFinite(point.value)));
  const sourceUrl = `https://ec.europa.eu/eurostat/databrowser/view/${encodeURIComponent(entry.dataset)}/default/table?lang=en`;
  const exportData: SeriesExport | null = data && usable ? {
    indicator: entry.id,
    title: data.title,
    unit: data.unit,
    source: data.source,
    dataset: data.dataset ?? entry.dataset,
    retrievedAt: data.fetchedAt,
    exportedAt: new Date().toISOString(),
    series: [
      ...COUNTRIES.map(geo => ({ label: COUNTRY_INFO[geo].label, observations: series(geo) })),
      ...(data.reference ? [{ label: `${data.reference.label} average`, observations: data.reference.series }] : []),
    ],
  } : null;

  return (
    <section ref={root} className="lab-analysis" aria-label={`Analysis: ${entry.title}`}>
      <header className="lab-analysis-heading">
        <div>
          <h2 className="text-title font-semibold">{focused ? 'Baltic comparison' : entry.title}</h2>
          <p className="text-ui lab-muted">{FREQUENCY_LABEL[entry.freq] ?? entry.freq} · {entry.unit} · {years}-year window</p>
        </div>
        <div className="lab-permalink">
          <button type="button" className="lab-link text-ui" onClick={copyMeasureLink}>Copy measure link</button>
          {copyResult?.url === permalink && (
            <p className="text-caption" role="status">
              {copyResult.copied ? 'Measure link copied.' : <><span>Copy unavailable. </span><Link className="lab-link" to={permalink}>Open the permanent link</Link></>}
            </p>
          )}
        </div>
      </header>
      <div className="lab-viewbar">
        <div className="lab-modes" role="group" aria-label="Analysis view">
          <button className="text-ui" type="button" aria-pressed={mode === 'chart'} onClick={() => setMode('chart')}>Chart</button>
          <button className="text-ui" type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}>Table</button>
        </div>
        <DownloadMenu data={exportData} />
      </div>

      {state === 'loading' && <LoadingIndicator />}
      {state === 'error' && (
        <div className="lab-empty text-ui" role="status">
          <p>The series could not be loaded. Your indicator selection is unchanged.</p>
          <button type="button" className="lab-link" onClick={() => setAttempt(value => value + 1)}>Retry series</button>
        </div>
      )}
      {state === 'ready' && !usable && <p className="lab-empty text-ui" role="status">No published observations in this window. Try a longer time range.</p>}
      {state === 'ready' && usable && data && (
        <>
          <div className="lab-readings" aria-label="Latest readings by country">
            {COUNTRIES.map(geo => {
              const latest = [...series(geo)].filter(point => point.value !== null && Number.isFinite(point.value))
                .sort((a, b) => a.period.localeCompare(b.period)).at(-1);
              const freshness = freshnessOf(latest?.period);
              return (
                <div key={geo} className="lab-reading" data-selected={country === geo || undefined}>
                  <p className="text-ui">{COUNTRY_INFO[geo].label}{country === geo && <span className="lab-focus text-caption">Your focus</span>}</p>
                  <p className="text-title font-semibold tabular-nums">{latest ? formatValue(latest.value, data.unit) : '—'}</p>
                  <p className="text-caption lab-muted">{latest ? axisPeriodLabel(latest.period) : 'No published reading'}</p>
                  <p className={`text-caption ${freshness?.stale ? 'dash-warning' : 'lab-muted'}`}>
                    {freshness ? `${freshness.stale ? 'Stale · ' : freshness.late ? 'Publication lag · ' : ''}${freshness.label}` : 'Freshness unavailable'}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="lab-reading-note text-caption lab-muted">Each headline is the country’s own latest reading. Use the period inspector for like-for-like comparisons.</p>
          {mode === 'chart' ? (
            <Suspense fallback={<LoadingIndicator />}>
              <BalticCompareChart indicator={entry.id} years={years} workspace />
            </Suspense>
          ) : (
            <div className="lab-table-scroll" role="region" aria-label="Indicator observations" tabIndex={0}>
              <table className="lab-table text-ui">
                <caption className="text-caption lab-muted">Source values in {data.unit}. — means no published observation, not zero.</caption>
                <thead><tr><th scope="col">Period</th>{COUNTRIES.map(geo => <th key={geo} scope="col">{COUNTRY_INFO[geo].label}</th>)}{data.reference && <th scope="col">{data.reference.label} average</th>}</tr></thead>
                <tbody>{periods.map(label => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {COUNTRIES.map(geo => {
                      const value = series(geo).find(point => point.period === label)?.value;
                      return <td key={geo}>{typeof value === 'number' && Number.isFinite(value) ? String(value) : <span aria-label="No published observation">—</span>}</td>;
                    })}
                    {data.reference && <td>{data.reference.series.find(point => point.period === label)?.value ?? '—'}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="lab-inspector">
            <div className="lab-inspector-heading">
              <label htmlFor="lab-period" className="text-ui font-semibold">Inspect one period</label>
              <select id="lab-period" className="text-ui" value={inspectPeriod ?? ''} onChange={event => setPeriod(event.target.value)}>
                {periods.map(label => <option key={label} value={label}>{label}{label === commonPeriod ? ' · latest shared' : ''}</option>)}
              </select>
            </div>
            <p className="text-caption lab-muted">{commonPeriod ? `Latest period with a reading from all three: ${commonPeriod}.` : 'No shared period across all three countries in this window.'}</p>
            <dl className="lab-period-values text-ui">
              {COUNTRIES.map(geo => {
                const value = series(geo).find(point => point.period === inspectPeriod)?.value;
                return <div key={geo}><dt>{COUNTRY_INFO[geo].label}</dt><dd className="font-semibold">{typeof value === 'number' && Number.isFinite(value) ? formatValue(value, data.unit) : 'Not published'}</dd></div>;
              })}
            </dl>
          </div>
        </>
      )}
      <details className="lab-definition" open>
        <summary className="text-ui font-semibold">Source &amp; definition</summary>
        <dl className="lab-definition-grid text-ui">
          <div><dt>Measure</dt><dd>{entry.title}</dd></div>
          <div><dt>Unit / frequency</dt><dd>{entry.unit} · {FREQUENCY_LABEL[entry.freq] ?? entry.freq}</dd></div>
          <div><dt>Dataset</dt><dd><a href={sourceUrl} target="_blank" rel="noopener noreferrer">{entry.dataset} ↗</a></dd></div>
          <div><dt>Source</dt><dd>{data?.source ?? 'Eurostat'}</dd></div>
          <div><dt>Retrieved by API</dt><dd>{data?.fetchedAt ? <time dateTime={data.fetchedAt}>{data.fetchedAt}</time> : 'Not reported'}</dd></div>
        </dl>
        <p className="text-caption lab-muted">Official statistics follow their own publication calendars. The retrieval time is not the observation period.</p>
        {data?.assumptions && data.assumptions.length > 0 && <p className="text-ui dash-warning">Source selection includes assumptions: {data.assumptions.map(assumption => `${assumption.dimension}: ${assumption.chosen}`).join('; ')}.</p>}
        <a className="lab-link text-ui" href={`/api/baltic-compare?indicator=${encodeURIComponent(entry.id)}&years=${years}`} target="_blank" rel="noopener noreferrer">View the API response ↗</a>
      </details>
      {nationalId && (
        <details className="lab-definition" onToggle={event => setNationalOpen(event.currentTarget.open)}>
          <summary className="text-ui font-semibold">National source series</summary>
          <p className="text-ui lab-muted">The existing national-data view, with its own source and definition. National and harmonised series may use different bases.</p>
          {nationalOpen && <Suspense fallback={<LoadingIndicator />}><NationalChart id={nationalId} /></Suspense>}
        </details>
      )}
    </section>
  );
}

export function ResearchWorkspace({ section = 'all', indicatorId }: ResearchWorkspaceProps) {
  const { entries, error, retry } = useIndicatorRegistry();
  const { country } = useCountry();
  useCountryFromQuery();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(() => typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 900px)').matches : true);

  const scoped = entriesForSection(entries ?? [], section);
  const requested = indicatorId ?? params.get('indicator');
  const preferred = section === 'all' ? 'gdp' : RESEARCH_SECTIONS[section].indicators[0];
  const selectedId = requested !== null && requested !== undefined
    ? resolveResearchId(requested, entries ?? [])
    : scoped.find(entry => entry.id === preferred)?.id ?? scoped[0]?.id;
  const selected = entries?.find(entry => entry.id === selectedId);
  // Searching deliberately crosses domains: an unclassified future entry is
  // reachable without waiting for a frontend release to add it to this list.
  const needle = search.trim().toLocaleLowerCase();
  const visible = (needle ? entries ?? [] : scoped).filter(entry =>
    `${entry.title} ${entry.id} ${entry.dataset} ${entry.unit}`.toLocaleLowerCase().includes(needle),
  );
  const relatedSection = selected ? researchSection(selected.id) : undefined;
  const related = selected && entries
    ? entriesForSection(entries, relatedSection ?? 'all').filter(entry => entry.id !== selected.id).slice(0, 4) : [];

  function selectIndicator(id: string) {
    const next = new URLSearchParams(params);
    next.set('country', country);
    if (indicatorId) {
      next.delete('indicator');
      navigate(`/indicator/${id}?${next.toString()}`);
    } else {
      next.set('indicator', id);
      if (section === 'all') next.delete('section');
      else next.set('section', section);
      navigate(`/explore?${next.toString()}`);
    }
  }

  return (
    <div className="lab-workspace">
      {indicatorId && <IndicatorMeta id={indicatorId} entry={selected} loading={!entries && !error} />}
      <header className="lab-header">
        <div>
          {indicatorId && <Link className="lab-link text-ui" to={`/explore?indicator=${encodeURIComponent(selected?.id ?? indicatorId)}&country=${country}`}>← Data explorer</Link>}
          <h1 className="text-display md:text-masthead font-semibold balance-text">{indicatorId ? selected?.title ?? 'Indicator' : 'Data explorer'}</h1>
          <p className="text-prose lab-muted">{indicatorId ? 'One measure, in depth. Inspect its periods, definitions and source values.' : 'Choose a measure. Compare the Baltics. Follow the evidence.'}</p>
        </div>
      </header>
      <div className="lab-workbench">
        <details className="lab-library" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}>
          <summary><span className="text-title font-semibold">Indicator library</span><span className="text-caption lab-muted">{entries ? `${entries.length} measures` : 'Official data'}</span></summary>
          <div className="lab-library-content" hidden={!libraryOpen}>
            <label className="lab-field text-ui font-semibold" htmlFor="lab-search">Find a measure
            <input id="lab-search" type="search" className="text-ui" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, unit or dataset" />
            </label>
            <label className="lab-field text-caption lab-muted" htmlFor="lab-domain">Sector
            <select id="lab-domain" className="text-ui" value={section} onChange={event => {
              setSearch('');
              const next = new URLSearchParams({ country });
              if (event.target.value !== 'all') next.set('section', event.target.value);
              navigate(`/explore?${next.toString()}`);
            }}>
              <option value="all">All sectors</option>
              {DASHBOARD_SECTIONS.map(domain => <option key={domain} value={domain}>{RESEARCH_SECTIONS[domain].title}</option>)}
            </select>
            </label>
            {error ? <div role="status" className="text-ui"><p>The indicator catalogue is unavailable.</p><button className="lab-link" type="button" onClick={retry}>Retry catalogue</button></div> : !entries ? <p role="status" className="text-ui">Loading the catalogue…</p> : (
              <>
                <p className="text-caption lab-muted" role="status">{visible.length} {needle ? 'search results across all sectors' : 'measures in this view'}</p>
                <ul className="lab-indicator-list">
                  {visible.map(entry => (
                    <li key={entry.id}>
                      <button type="button" aria-current={entry.id === selected?.id ? 'true' : undefined} onClick={() => selectIndicator(entry.id)}>
                        <span className="text-ui">{entry.title}</span>
                        <span className="text-caption lab-muted">{entry.unit} · {FREQUENCY_LABEL[entry.freq] ?? entry.freq}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {visible.length === 0 && <p className="text-ui lab-muted">No measures match. Try a different title, unit or dataset.</p>}
              </>
            )}
          </div>
        </details>
        <div className="lab-plane">
          {!entries && !error && <LoadingIndicator />}
          {error && <div role="status" className="lab-empty text-ui">We could not verify the indicator catalogue. Retry the catalogue to continue; this is not an unknown-indicator result.</div>}
          {entries && !selected && <div className="lab-empty text-ui" role="status"><p>{requested !== null && requested !== undefined ? 'Unknown indicator.' : 'No indicators available in this domain.'}</p>{requested && <p>“{requested}” is not in the source catalogue.</p>}<p>Choose a measure from the library.</p></div>}
          {selected && <Analysis key={selected.id} entry={selected} focused={Boolean(indicatorId)} nationalId={indicatorId && NATIONAL_INDICATORS.has(indicatorId) ? indicatorId : undefined} />}
          {indicatorId && (
            <section className="lab-related">
              <h2 className="text-title font-semibold">Continue researching</h2>
              <div className="lab-related-links text-ui">{related.map(entry => <Link key={entry.id} to={`/indicator/${entry.id}?country=${country}`}>{entry.title} ↗</Link>)}</div>
              <Link className="lab-link text-ui" to={`/data/${relatedSection ?? 'economy'}?country=${country}`}>View the sector dashboard ↗</Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
