import { useState, useEffect } from 'react';
import type { SystemStatus, DataSourceCheck } from '../types';
import { fetchSystemStatus } from '../api';

/**
 * How each source state is drawn, and what it is called.
 *
 * Four states, four treatments. This used to be `healthy ? green : red`, which
 * meant a source that was merely *late* was painted exactly like one that was
 * unreachable — flattening the distinction the probes were rewritten to make.
 * A frozen table and a dead host are different news and a reader deserves to
 * see which one they have.
 *
 * The label is not decoration. At 6px a dot carries no shape, `--data-warning`
 * and `--data-negative` are close enough under deuteranopia to be a coin toss,
 * and WCAG 2.2 SC 1.4.1 forbids colour as the only carrier of meaning. So every
 * state except healthy says its own name.
 */
function sourceLook(status: DataSourceCheck['status']): { dot: string; label: string } {
  switch (status) {
    case 'healthy': return { dot: 'var(--data-positive)', label: 'ok' };
    case 'stale': return { dot: 'var(--data-warning)', label: 'stale' };
    // Neutral, not warning: an optional source still being checked is not bad
    // news, it is an absence of news, and colouring it amber would invite a
    // reader to worry about something that may be perfectly healthy.
    case 'pending': return { dot: 'var(--data-neutral)', label: 'checking' };
    default: return { dot: 'var(--data-negative)', label: 'down' };
  }
}

export function SystemStatusFooter() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchSystemStatus().then(setStatus).catch(() => {});
  }, []);

  // `!status` guarded a rejected fetch but not a *resolved* one carrying the
  // wrong shape, and `status.dataSources.healthy` then threw. This footer sits
  // outside the per-section error boundaries in App, so that one read took the
  // whole page down — the status line, of all things, reporting an outage by
  // removing the site. A payload missing its counts is treated the same as no
  // payload: the footer simply does not render.
  const counts = status?.dataSources;
  if (!status || !counts || typeof counts.healthy !== 'number' || typeof counts.total !== 'number') {
    return null;
  }

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
          <span className={`text-ui ${statusColor}`}>
            System {status.status}
          </span>
          <span className="text-caption dash-subtle">
            {counts.healthy}/{counts.total} data sources · {status.apis?.total ?? '—'} APIs · {status.version}
          </span>
        </div>
        <span className="text-caption dash-subtle">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-800/30">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Data source health */}
            <div>
              <p className="text-caption dash-muted mb-2">Data Sources</p>
              <div className="space-y-1">
                {(counts.checks ?? []).map((check) => {
                  const look = sourceLook(check.status);
                  return (
                    <div key={check.name} className="flex items-center justify-between text-caption">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: look.dot }} />
                        <span className="dash-body">{check.name}</span>
                        {/* The word, not just the dot. Four states cannot be
                            told apart by colour alone at 6px, and two of them
                            are indistinguishable under deuteranopia. */}
                        {check.status !== 'healthy' && (
                          <span className="font-mono" style={{ color: look.dot }}>
                            {look.label}
                          </span>
                        )}
                      </div>
                      <span className="dash-subtle font-mono">
                        {check.status === 'pending' ? '—' : `${check.latency}ms`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Self-sustaining metrics */}
            <div>
              <p className="text-caption dash-muted mb-2">Moonshot Status</p>
              <div className="space-y-2 text-caption">
                <div className="flex justify-between">
                  <span className="dash-body">Infrastructure cost</span>
                  <span className="dash-fg font-mono">{status.selfSustaining.monthlyInfrastructureCost}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="dash-body">Revenue</span>
                  <span className="dash-fg font-mono">{status.selfSustaining.revenue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="dash-body">Phase</span>
                  <span className="dash-muted">{status.phase}</span>
                </div>
                <div className="flex justify-between">
                  <span className="dash-body">Response time</span>
                  <span className="dash-fg font-mono">{status.respondedIn}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
