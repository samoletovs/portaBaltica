const STATUSES = new Set(['captured', 'unchanged', 'reused']);
const MAX_LAG_HOURS = 26;

function timestamp(value, field, now) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60 * 1000) {
    throw new Error('Evidence archive has an invalid ' + field);
  }
  return parsed;
}

function evidenceObservation(body, now = new Date()) {
  if (!body || body.version !== 1 || body.series_id !== 'baltic-unemployment-v1') {
    throw new Error('Evidence archive index is missing or unsupported');
  }
  const attempt = body.last_attempt;
  if (!attempt || typeof attempt !== 'object') {
    throw new Error('Evidence archive has no capture-attempt record');
  }
  if (attempt.status === 'failed') {
    throw new Error('The last evidence capture failed; earlier snapshots remain available');
  }
  if (!STATUSES.has(attempt.status)) {
    throw new Error('Evidence capture is incomplete or has an unknown outcome');
  }
  if (typeof body.latest_snapshot_id !== 'string' || !/^[a-f0-9]{32}$/.test(body.latest_snapshot_id)) {
    throw new Error('Evidence archive has no completed snapshot');
  }
  const current = new Date(now).getTime();
  const started = timestamp(attempt.attempted_at, 'attempt time', current);
  const finished = timestamp(attempt.finished_at, 'completion time', current);
  const observed = timestamp(body.last_success_at, 'source retrieval time', current);
  if (finished < started || observed > finished) {
    throw new Error('Evidence archive timestamps are inconsistent');
  }
  const declared = body.stale_after_hours;
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    throw new Error('Evidence archive has no valid freshness threshold');
  }
  // Replaying a cached response today does not prove we reached its source today.
  return {
    at: new Date(Math.min(finished, observed)).toISOString(),
    maxLag: Math.min(declared, MAX_LAG_HOURS),
  };
}

module.exports = { evidenceObservation, MAX_LAG_HOURS };
