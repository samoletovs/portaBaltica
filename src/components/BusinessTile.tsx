import { useState } from 'react';
import type { BusinessSearchResult, EUFundsData, AddressSearchResult } from '../types';
import { searchBusinessOwners, searchAddress } from '../api';
import { useCountry } from '../CountryContext';

interface BusinessTileProps {
  euFunds: EUFundsData | null;
  euLoading: boolean;
}

export function BusinessTile({ euFunds, euLoading }: BusinessTileProps) {
  const { country } = useCountry();
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<BusinessSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Address search state
  const [addrQuery, setAddrQuery] = useState('');
  const [addrResult, setAddrResult] = useState<AddressSearchResult | null>(null);
  const [addrSearching, setAddrSearching] = useState(false);

  async function handleSearch() {
    if (query.length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await searchBusinessOwners(query);
      setSearchResult(result);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddrSearch() {
    if (addrQuery.length < 3) return;
    setAddrSearching(true);
    try {
      const result = await searchAddress(addrQuery);
      setAddrResult(result);
    } catch { /* ignore */ } finally {
      setAddrSearching(false);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Business intelligence</h2>
      {country !== 'LV' && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
          🇱🇻 This section shows Latvia data only. Estonia and Lithuania business registries coming soon.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* UBO Search */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5">
          <p className="text-xs text-slate-400 mb-2">Who Owns This Company?</p>
          <p className="text-xs text-slate-500 mb-3">Search Latvia's Beneficial Owners Registry (195K+ records)</p>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Company reg# or surname..."
              className="flex-1 bg-slate-800/50 border border-slate-800/40 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              aria-label="Search beneficial owners by company registration number or surname"
            />
            <button
              onClick={handleSearch}
              disabled={searching || query.length < 3}
              className="bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
              aria-label="Search"
            >
              {searching ? '...' : '🔍'}
            </button>
          </div>

          {searchError && (
            <p className="text-xs text-red-400 mb-2">{searchError}</p>
          )}

          {searchResult && (
            <div>
              <p className="text-xs text-slate-400 mb-2">
                {searchResult.totalMatches} matches for &quot;{searchResult.query}&quot;
              </p>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {searchResult.companies.slice(0, 10).map((company) => (
                  <div key={company.registrationNumber} className="bg-slate-800/40 rounded-lg p-3">
                    <p className="text-sm font-mono text-slate-300 mb-1">
                      Reg# {company.registrationNumber}
                    </p>
                    <div className="space-y-1">
                      {company.owners.map((owner, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-white">{owner.forename} {owner.surname}</span>
                          <span className="text-slate-500">
                            {owner.nationality && `🏳️ ${owner.nationality}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-2">{searchResult.source}</p>
            </div>
          )}

          {!searchResult && !searching && (
            <div className="text-xs text-slate-500">
              <p>Try: <button onClick={() => { setQuery('40003229495'); }} className="text-slate-400 underline">40003229495</button> (company) or <button onClick={() => { setQuery('Bērziņš'); }} className="text-slate-400 underline">Bērziņš</button> (surname)</p>
            </div>
          )}
        </div>

        {/* EU Recovery Fund */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5">
          <p className="text-xs text-slate-400 mb-2">EU Recovery & Resilience Fund</p>

          {euLoading && (
            <div className="animate-pulse space-y-2">
              <div className="h-8 bg-slate-700/30 rounded w-1/3" />
              <div className="h-3 bg-slate-700/30 rounded w-2/3" />
              <div className="h-20 bg-slate-700/30 rounded" />
            </div>
          )}

          {euFunds && !euLoading && (
            <>
              <p className="text-2xl font-bold text-white font-mono mb-1">
                {euFunds.total}
                <span className="text-sm font-normal text-slate-400 ml-2">projects</span>
              </p>

              <div className="space-y-2 mb-3">
                {euFunds.statusSummary.map((s) => {
                  const pct = (s.count / euFunds.total) * 100;
                  const isApproved = s.status.toLowerCase().includes('apstiprin');
                  return (
                    <div key={s.status}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-slate-200 truncate max-w-[70%]">{s.status}</span>
                        <span className="text-white font-mono">{s.count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isApproved ? 'bg-emerald-500' : 'bg-slate-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500">{euFunds.source}</p>
            </>
          )}

          {!euFunds && !euLoading && (
            <p className="text-slate-400 text-sm">No EU fund data available.</p>
          )}
        </div>

        {/* Address Search */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-5">
          <p className="text-xs text-slate-400 mb-2">Address Lookup</p>
          <p className="text-xs text-slate-500 mb-3">Search 608K+ Latvian addresses with GPS coordinates</p>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={addrQuery}
              onChange={(e) => setAddrQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddrSearch()}
              placeholder="Street, city, or postal code..."
              className="flex-1 bg-slate-800/50 border border-slate-800/40 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              aria-label="Search Latvian addresses"
            />
            <button
              onClick={handleAddrSearch}
              disabled={addrSearching || addrQuery.length < 3}
              className="bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
              aria-label="Search addresses"
            >
              {addrSearching ? '...' : '📍'}
            </button>
          </div>

          {addrResult && (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {addrResult.addresses.slice(0, 8).map((addr) => (
                <div key={addr.code} className="bg-slate-800/40 rounded-lg p-2">
                  <p className="text-xs text-white leading-snug">{addr.fullAddress}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {addr.postalCode && (
                      <span className="text-xs text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded">{addr.postalCode}</span>
                    )}
                    {addr.lat && addr.lon && (
                      <a
                        href={`https://www.google.com/maps?q=${addr.lat},${addr.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-400 hover:text-slate-200 underline"
                      >
                        📍 Map
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-600">{addrResult.total.toLocaleString()} total matches</p>
            </div>
          )}

          {!addrResult && !addrSearching && (
            <p className="text-xs text-slate-500">
              Try: <button onClick={() => { setAddrQuery('Brīvības iela'); }} className="text-slate-400 underline">Brīvības iela</button> or <button onClick={() => { setAddrQuery('LV-1010'); }} className="text-slate-400 underline">LV-1010</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
