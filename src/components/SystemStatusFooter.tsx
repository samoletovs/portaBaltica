import { useState, useEffect } from 'react';
import type { SystemStatus } from '../types';
import { fetchSystemStatus } from '../api';

export function SystemStatusFooter() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchSystemStatus().then(setStatus).catch(() => {});
  }, []);

  if (!status) return null;

  const statusColor =
    status.status === 'healthy' ? 'text-emerald-400' :
    status.status === 'degraded' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mt-8 bg-slate-900/40 border border-slate-800/30 rounded-xl p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
        aria-label="Toggle system status details"
      >
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${status.status === 'healthy' ? 'bg-emerald-400' : status.status === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'}`} />
          <span className={`text-sm font-medium ${statusColor}`}>
            System {status.status}
          </span>
          <span className="text-xs text-slate-500">
            {status.dataSources.healthy}/{status.dataSources.total} data sources · {status.apis.total} APIs · {status.version}
          </span>
        </div>
        <span className="text-xs text-slate-500">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-800/30">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Data source health */}
            <div>
              <p className="text-xs text-slate-400 mb-2">Data Sources</p>
              <div className="space-y-1">
                {status.dataSources.checks.map((check) => (
                  <div key={check.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${check.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="text-slate-300">{check.name}</span>
                    </div>
                    <span className="text-slate-500 font-mono">{check.latency}ms</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Self-sustaining metrics */}
            <div>
              <p className="text-xs text-slate-400 mb-2">Moonshot Status</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-300">Infrastructure cost</span>
                  <span className="text-white font-mono">{status.selfSustaining.monthlyInfrastructureCost}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Revenue</span>
                  <span className="text-white font-mono">{status.selfSustaining.revenue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Phase</span>
                  <span className="text-slate-400">{status.phase}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Response time</span>
                  <span className="text-white font-mono">{status.respondedIn}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
