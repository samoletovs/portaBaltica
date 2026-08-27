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

/**
 * Thousands separators, with a fixed locale.
 *
 * `toLocaleString()` without an argument follows whoever is looking, which
 * means the same build renders `12,944` and `12 944` and `12.944` depending on
 * the browser — and makes any assertion about the rendered text a coin toss.
 * The site is English-only today, so the locale is pinned to match.
 */
function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * How stale the published traffic counts are, in words.
 *
 * The figure is republished hourly, so it is never live and must not look it.
 * Printing the age is what stops a reader reading a quiet hour as a crash.
 */
function freshnessLabel(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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
    status.status === 'healthy' ? 'dash-positive' :
    status.status === 'degraded' ? 'dash-warning' : 'dash-negative';

  // Same defence as `counts` above, for the same reason: the block is rendered
  // only when every figure it prints is actually a number. A payload carrying
  // the key with a null or a string would otherwise render "NaN" beside a
  // healthy status line, which reads as a broken site rather than as a missing
  // file.
  const rawTraffic = status.traffic;
  const traffic =
    rawTraffic &&
    typeof rawTraffic.today === 'number' &&
    typeof rawTraffic.last7Days === 'number' &&
    typeof rawTraffic.last30Days === 'number' &&
    typeof rawTraffic.dailyAverage30d === 'number'
      ? rawTraffic
      : null;

  return (
    <div className="mt-8 dash-card border dash-edge rounded-xl p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
        aria-label="Toggle system status details"
      >
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${status.status === 'healthy' ? 'dash-fill-positive' : status.status === 'degraded' ? 'dash-fill-warning' : 'dash-fill-negative'}`} />
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
        <div className="mt-3 pt-3 border-t dash-edge">
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

              {/* Traffic.
                  Deliberately headed "Site requests" rather than "Visits". The
                  source metric counts every HTTP request the app serves, and a
                  single-page app serves a dozen or more per arrival, so calling
                  these visits would overstate the audience by whatever the
                  asset-per-page ratio happens to be. The note below says so in
                  the interface, not only in the source. */}
              {traffic && (
                <div className="mt-4 pt-3 border-t dash-edge">
                  <p className="text-caption dash-muted mb-2">Site requests</p>
                  <div className="space-y-2 text-caption">
                    <div className="flex justify-between">
                      <span className="dash-body">Today</span>
                      <span className="dash-fg font-mono">{formatCount(traffic.today)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dash-body">Last 7 days</span>
                      <span className="dash-fg font-mono">{formatCount(traffic.last7Days)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dash-body">Last 30 days</span>
                      <span className="dash-fg font-mono">{formatCount(traffic.last30Days)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dash-body">Daily average</span>
                      <span className="dash-fg font-mono">{formatCount(traffic.dailyAverage30d)}</span>
                    </div>
                  </div>
                  <p className="text-caption dash-subtle mt-2">
                    HTTP requests, not unique visitors
                    {' · '}{(traffic.timezone ?? 'Europe/Riga').replace('Europe/', '')} days
                    {typeof traffic.ageMs === 'number' && ` · updated ${freshnessLabel(traffic.ageMs)}`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
