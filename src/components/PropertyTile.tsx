import type { PropertyData } from '../types';

interface PropertyTileProps {
  data: PropertyData | null;
  loading: boolean;
}

export function PropertyTile({ data, loading }: PropertyTileProps) {
  if (loading) return <TileSkeleton />;
  if (!data) return null;

  const maxPermits = Math.max(...data.constructionPermits.map((p) => p.count), 1);
  const maxCerts = Math.max(...data.energyCerts.map((c) => c.count), 1);

  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-ocean-400">🏗️</span> Property & Energy
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Construction permits */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-xs text-ocean-400">Construction Permits</p>
            <p className="text-xl font-bold text-white font-mono">{data.totalPermits.toLocaleString()}</p>
          </div>
          <div className="space-y-1.5">
            {data.constructionPermits.slice(0, 8).map((p) => (
              <div key={p.municipality}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-ocean-200 truncate max-w-[60%]">{p.municipality}</span>
                  <span className="text-white font-mono">{p.count}</span>
                </div>
                <div className="h-1.5 bg-ocean-800/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: `${(p.count / maxPermits) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-ocean-500 mt-2">BVKB via data.gov.lv</p>
        </div>

        {/* Energy profile by carrier */}
        <div className="bg-ocean-900/40 backdrop-blur-sm border border-ocean-700/30 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-xs text-ocean-400">Building Energy Profile</p>
            <p className="text-xl font-bold text-white font-mono">{data.totalCerts.toLocaleString()}</p>
          </div>
          {data.energyCerts.length > 0 ? (
            <div className="space-y-2">
              {data.energyCerts.map((cert) => (
                <div key={cert.rating}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-ocean-200 truncate max-w-[65%]">{cert.rating}</span>
                    <span className="text-white font-mono">{cert.count}</span>
                  </div>
                  <div className="h-1.5 bg-ocean-800/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${(cert.count / maxCerts) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ocean-500">Awaiting energy data...</p>
          )}
          <p className="text-xs text-ocean-500 mt-2">Energy carrier distribution · data.gov.lv</p>
        </div>
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-ocean-400">🏗️</span> Property & Energy
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-ocean-900/40 border border-ocean-700/30 rounded-2xl p-5 animate-pulse">
            <div className="h-3 bg-ocean-700/40 rounded w-1/3 mb-3" />
            <div className="h-6 bg-ocean-700/40 rounded w-1/4 mb-4" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-2 bg-ocean-700/40 rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
