import type { PropertyData } from '../types';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { TileHeader } from './TileHeader';
import { finite, list } from '../utils/payload';

interface PropertyTileProps {
  data: PropertyData | null;
  loading: boolean;
}

export function PropertyTile({ data, loading }: PropertyTileProps) {
  const { country } = useCountry();
  if (loading) return <TileSkeleton />;
  if (!data) return null;

  // `!data` above checks that something arrived, not that it has these two
  // arrays. A 404-shaped response from data.gov.lv resolves fine and has
  // neither, and `.map` on `undefined` threw in the render path.
  const permits = list<{ municipality: string; count: number }>(data.constructionPermits);
  const certs = list<{ rating: string; count: number }>(data.energyCerts);
  const maxPermits = Math.max(...permits.map((p) => p.count), 1);
  const maxCerts = Math.max(...certs.map((c) => c.count), 1);
  const totalPermits = finite(data.totalPermits);
  const totalCerts = finite(data.totalCerts);

  return (
    <section>
      <TileHeader
        title="Property & energy"
        meta={country === 'LV' ? '🇱🇻 Latvia · data.gov.lv' : undefined}
      >
        {country !== 'LV' && <LvOnlyNotice />}
      </TileHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Construction permits */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-caption text-slate-400">Construction Permits</p>
            <p className="text-lead font-semibold text-white font-mono">{totalPermits === null ? '—' : totalPermits.toLocaleString()}</p>
          </div>
          <div className="space-y-2">
            {permits.slice(0, 8).map((p) => (
              <div key={p.municipality}>
                <div className="flex items-center justify-between text-caption mb-0.5">
                  <span className="text-slate-200 truncate max-w-[60%]">{p.municipality}</span>
                  <span className="text-white font-mono">{p.count}</span>
                </div>
                <div className="h-1.5 bg-slate-800/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: `${(p.count / maxPermits) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-caption text-slate-500 mt-2">BVKB via data.gov.lv</p>
        </div>

        {/* Energy profile by carrier */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-caption text-slate-400">Building Energy Profile</p>
            <p className="text-lead font-semibold text-white font-mono">{totalCerts === null ? '—' : totalCerts.toLocaleString()}</p>
          </div>
          {certs.length > 0 ? (
            <div className="space-y-2">
              {certs.map((cert) => (
                <div key={cert.rating}>
                  <div className="flex items-center justify-between text-caption mb-0.5">
                    <span className="text-slate-200 truncate max-w-[65%]">{cert.rating}</span>
                    <span className="text-white font-mono">{cert.count}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${(cert.count / maxCerts) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ui text-slate-500">Awaiting energy data...</p>
          )}
          <p className="text-caption text-slate-500 mt-2">Energy carrier distribution · data.gov.lv</p>
        </div>
      </div>

      {/* Baltic comparison charts — available for all 3 countries */}
      <div className="mt-4">
        <BalticCompareChart indicator="house_prices" title="House price change (% YoY)" compact />
      </div>
    </section>
  );
}

function LvOnlyNotice() {
  return (
    <div className="mt-3 px-3 py-2 rounded-lg text-caption" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
      🇱🇻 This section shows Latvia data only. Estonia and Lithuania property data coming soon.
    </div>
  );
}

function TileSkeleton() {
  return (
    <section>
      <TileHeader title="Property & energy" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 animate-pulse">
            <div className="h-3 bg-slate-700/30 rounded w-1/3 mb-3" />
            <div className="h-6 bg-slate-700/30 rounded w-1/4 mb-4" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-2 bg-slate-700/30 rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
