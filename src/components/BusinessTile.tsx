import { useEffect, useRef, useState } from 'react';
import type { BusinessSearchResult, EUFundsData, AddressSearchResult } from '../types';
import { searchBusinessOwners, searchAddress } from '../api';
import { useCountry } from '../CountryContext';
import { TileHeader } from './TileHeader';
import { finite, list } from '../utils/payload';

interface BusinessTileProps {
  euFunds: EUFundsData | null;
  euLoading: boolean;
}

type SearchState<T> =
  | { status: 'idle' }
  | { status: 'loading' | 'error'; query: string }
  | { status: 'success'; query: string; data: T };

function useRegistrySearch<T>(search: (query: string) => Promise<T>) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState<T>>({ status: 'idle' });
  const requestId = useRef(0);
  const pendingQuery = useRef<string | null>(null);

  useEffect(() => () => {
    requestId.current += 1;
    pendingQuery.current = null;
  }, []);

  function changeQuery(value: string) {
    // Editing also invalidates a response already on its way.
    requestId.current += 1;
    pendingQuery.current = null;
    setQuery(value);
    setState({ status: 'idle' });
  }

  async function submit() {
    const submitted = query.trim();
    if (submitted.length < 3 || pendingQuery.current === submitted) return;
    const current = ++requestId.current;
    pendingQuery.current = submitted;
    setState({ status: 'loading', query: submitted });
    try {
      const data = await search(submitted);
      if (current === requestId.current) {
        setState({ status: 'success', query: submitted, data });
      }
    } catch {
      if (current === requestId.current) {
        setState({ status: 'error', query: submitted });
      }
    } finally {
      if (current === requestId.current) pendingQuery.current = null;
    }
  }

  return { query, changeQuery, state, submit };
}

export function BusinessTile({ euFunds, euLoading }: BusinessTileProps) {
  const { country } = useCountry();
  const owners = useRegistrySearch<BusinessSearchResult>(searchBusinessOwners);
  const addresses = useRegistrySearch<AddressSearchResult>(searchAddress);
  const searchResult = owners.state.status === 'success' ? owners.state.data : null;
  const addrResult = addresses.state.status === 'success' ? addresses.state.data : null;
  const searching = owners.state.status === 'loading';
  const addrSearching = addresses.state.status === 'loading';

  // The registry holds up to 904 matches for a common surname; this shows ten
  // of them. Derived once so the line above the list and the list itself cannot
  // disagree about how many are on screen.
  const shownCompanies = list<{
    registrationNumber: string;
    owners: { forename: string; surname: string; nationality?: string }[];
  }>(searchResult?.companies).slice(0, 10);

  return (
    <section>
      <TileHeader
        title="Business intelligence"
        meta={country === 'LV' ? '🇱🇻 Latvia · data.gov.lv registries' : undefined}
      >
        {country !== 'LV' && (
          <div className="mt-3 px-3 py-2 rounded-lg text-caption" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
            🇱🇻 This section shows Latvia data only. Estonia and Lithuania business registries coming soon.
          </div>
        )}
      </TileHeader>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* UBO Search */}
        <div className="dash-card border dash-edge rounded-xl p-6">
          <h3 className="text-callout font-semibold dash-fg mb-2">Who Owns This Company?</h3>
          <p className="text-caption dash-subtle mb-3">Search Latvia's Beneficial Owners Registry (195K+ records)</p>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={owners.query}
              onChange={(e) => owners.changeQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void owners.submit()}
              placeholder="Company reg# or surname..."
              className="flex-1 min-w-0 dash-raised border dash-edge rounded-lg px-3 py-2 text-ui dash-fg dash-placeholder"
              aria-label="Search beneficial owners by company registration number or surname"
            />
            <button
              onClick={() => void owners.submit()}
              disabled={searching || owners.query.trim().length < 3}
              className="dash-btn dash-fg text-ui px-4 py-2 rounded-lg transition-colors"
              aria-label="Search"
            >
              {searching ? '...' : '🔍'}
            </button>
          </div>

          <p role="status" aria-atomic="true" className={`text-caption mb-2 ${owners.state.status === 'error' ? 'dash-negative' : 'dash-muted'}`}>
            {owners.state.status === 'idle' && 'Enter at least 3 characters, then search.'}
            {owners.state.status === 'loading' && <>Searching owners for &quot;{owners.state.query}&quot;…</>}
            {owners.state.status === 'error' && <>Could not search owners for &quot;{owners.state.query}&quot;. Please try again.</>}
            {owners.state.status === 'success' && searchResult && (
              shownCompanies.length === 0
                ? <>No owners found for &quot;{owners.state.query}&quot;. Try another registration number or surname.</>
                : <>
                {finite(searchResult.totalMatches) === null
                  ? '—'
                  : finite(searchResult.totalMatches)!.toLocaleString()} matches for &quot;{owners.state.query}&quot;
                {shownCompanies.length < list(searchResult.companies).length
                  || searchResult.truncated
                  ? ` — showing ${shownCompanies.length}`
                  : ''}
                </>
            )}
          </p>
          {owners.state.status === 'error' && (
            <button type="button" onClick={() => void owners.submit()} className="dash-btn dash-fg text-ui px-3 py-2 rounded-lg mb-3">
              Retry owner search
            </button>
          )}

          {searchResult && (
            <div>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {shownCompanies.map((company) => (
                  <div key={company.registrationNumber} className="dash-raised rounded-lg p-3">
                    <p className="text-ui font-mono dash-body mb-1">
                      Reg# {company.registrationNumber}
                    </p>
                    <div className="space-y-1">
                      {list<{ forename: string; surname: string; nationality?: string }>(company.owners).map((owner, i) => (
                        <div key={i} className="flex items-center gap-2 text-caption">
                          <span className="dash-fg">{owner.forename} {owner.surname}</span>
                          <span className="dash-subtle">
                            {owner.nationality && `🏳️ ${owner.nationality}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-caption dash-subtle mt-2">{searchResult.source}</p>
            </div>
          )}

          {owners.state.status === 'idle' && (
            <div className="text-caption dash-subtle">
              <p>Try: <button onClick={() => owners.changeQuery('40003229495')} className="dash-muted underline">40003229495</button> (company) or <button onClick={() => owners.changeQuery('Bērziņš')} className="dash-muted underline">Bērziņš</button> (surname)</p>
            </div>
          )}
        </div>

        {/* EU Recovery Fund */}
        <div className="dash-card border dash-edge rounded-xl p-6">
          <h3 className="text-callout font-semibold dash-fg mb-2">EU Recovery & Resilience Fund</h3>

          {euLoading && (
            <div className="animate-pulse space-y-2">
              <div className="h-8 dash-skeleton rounded w-1/3" />
              <div className="h-3 dash-skeleton rounded w-2/3" />
              <div className="h-20 dash-skeleton rounded" />
            </div>
          )}

          {euFunds && !euLoading && (
            <>
              <p className="text-title font-semibold dash-fg font-mono mb-1">
                {finite(euFunds.total) ?? '—'}
                <span className="text-ui font-normal dash-muted ml-2">projects</span>
              </p>

              <div className="space-y-2 mb-3">
                {list<{ status: unknown; count: unknown }>(euFunds.statusSummary).map((raw, i) => {
                  // Two things `list<T>()` promised and cannot deliver: it
                  // validates the container and casts the contents, so both
                  // fields here are claims about a runtime payload.
                  //
                  // `status` was read straight into `.toLowerCase()`, which
                  // throws in the render path and takes the section with it.
                  //
                  // `count` divides `total`. The `total > 0` guard fixed the
                  // EU-funds `Infinity` bars by protecting the *denominator*;
                  // a missing `count` is a missing *numerator*, `undefined / 12`
                  // is `NaN`, CSS drops `width: NaN%`, and the bar disappears —
                  // leaving an empty track that is pixel-identical to a zero.
                  // So a status we cannot measure keeps its name, shows a dash,
                  // and draws no track at all.
                  const status = typeof raw.status === 'string' ? raw.status : null;
                  const count = finite(raw.count);
                  const total = finite(euFunds.total) ?? 0;
                  const pct = count !== null && total > 0 ? (count / total) * 100 : null;
                  const isApproved = status?.toLowerCase().includes('apstiprin') ?? false;
                  return (
                    <div key={status ?? `row-${i}`}>
                      <div className="flex items-center justify-between text-caption mb-0.5">
                        <span className="dash-body truncate max-w-[70%]">{status ?? 'Unlabelled'}</span>
                        <span className="dash-fg font-mono">{count === null ? '—' : count}</span>
                      </div>
                      {pct !== null && (
                        <div className="h-1.5 dash-raised rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: isApproved ? 'var(--data-positive)' : 'var(--cat-3)',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-caption dash-subtle">{euFunds.source}</p>
            </>
          )}

          {!euFunds && !euLoading && (
            <p className="dash-muted text-ui">No EU fund data available.</p>
          )}
        </div>

        {/* Address Search */}
        <div className="dash-card border dash-edge rounded-xl p-6">
          <h3 className="text-callout font-semibold dash-fg mb-2">Address Lookup</h3>
          <p className="text-caption dash-subtle mb-3">Search 608K+ Latvian addresses with GPS coordinates</p>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={addresses.query}
              onChange={(e) => addresses.changeQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addresses.submit()}
              placeholder="Street, city, or postal code..."
              className="flex-1 min-w-0 dash-raised border dash-edge rounded-lg px-3 py-2 text-ui dash-fg dash-placeholder"
              aria-label="Search Latvian addresses"
            />
            <button
              onClick={() => void addresses.submit()}
              disabled={addrSearching || addresses.query.trim().length < 3}
              className="dash-btn dash-fg text-ui px-4 py-2 rounded-lg transition-colors"
              aria-label="Search addresses"
            >
              {addrSearching ? '...' : '📍'}
            </button>
          </div>

          <p role="status" aria-atomic="true" className={`text-caption mb-2 ${addresses.state.status === 'error' ? 'dash-negative' : 'dash-muted'}`}>
            {addresses.state.status === 'idle' && 'Enter at least 3 characters, then search.'}
            {addresses.state.status === 'loading' && <>Searching addresses for &quot;{addresses.state.query}&quot;…</>}
            {addresses.state.status === 'error' && <>Could not search addresses for &quot;{addresses.state.query}&quot;. Please try again.</>}
            {addresses.state.status === 'success' && addrResult && (
              list(addrResult.addresses).length === 0
                ? <>No addresses found for &quot;{addresses.state.query}&quot;. Try another street, city or postal code.</>
                : <>{finite(addrResult.total)?.toLocaleString() ?? '—'} total matches for &quot;{addresses.state.query}&quot; — showing {Math.min(list(addrResult.addresses).length, 8)}</>
            )}
          </p>
          {addresses.state.status === 'error' && (
            <button type="button" onClick={() => void addresses.submit()} className="dash-btn dash-fg text-ui px-3 py-2 rounded-lg mb-3">
              Retry address search
            </button>
          )}

          {addrResult && (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {list<{ code: string; fullAddress: string; postalCode?: string; lat?: number; lon?: number }>(addrResult.addresses).slice(0, 8).map((addr) => (
                <div key={addr.code} className="dash-raised rounded-lg p-2">
                  <p className="text-caption dash-fg leading-snug">{addr.fullAddress}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {addr.postalCode && (
                      <span className="text-caption dash-muted dash-raised px-2 py-0.5 rounded">{addr.postalCode}</span>
                    )}
                    {addr.lat && addr.lon && (
                      <a
                        href={`https://www.google.com/maps?q=${addr.lat},${addr.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-caption dash-muted dash-hover-fg underline"
                      >
                        📍 Map
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {addresses.state.status === 'idle' && (
            <p className="text-caption dash-subtle">
              Try: <button onClick={() => addresses.changeQuery('Brīvības iela')} className="dash-muted underline">Brīvības iela</button> or <button onClick={() => addresses.changeQuery('LV-1010')} className="dash-muted underline">LV-1010</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
