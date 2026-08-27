/**
 * Types for `scripts/visit-stats.mjs`.
 *
 * The script stays plain JavaScript because the visit-stats workflow runs it
 * directly with `node`, and adding a build step to a job whose whole purpose is
 * to be small and dependable would be a poor trade. This declaration is what
 * lets `tests/visitStats.test.ts` typecheck against it without that build step.
 */

/** The summary published to the public stats blob and read by /api/system-status. */
export interface VisitStatsSummary {
  metric: string;
  /** Always `'requests'`. The metric counts HTTP requests, not people. */
  unit: string;
  today: number;
  last7Days: number;
  last30Days: number;
  dailyAverage30d: number;
  timezone: string;
  retentionDays: number;
  observedFrom: string | null;
  observedTo: string | null;
  generatedAt: string;
}

/** One hourly bucket as `az monitor metrics list` emits it. */
export interface MetricPoint {
  timeStamp: string;
  /** Absent — not zero — for an hour in which nothing was served. */
  total?: number;
}

export interface MetricPayload {
  value?: Array<{
    name?: { value?: string };
    timeseries?: Array<{ data?: MetricPoint[] }>;
  }>;
}

export declare const RETENTION_DAYS: number;

/** The Europe/Riga calendar date of an instant, as `YYYY-MM-DD`. */
export declare function localDate(instant: Date | string): string;

/** Step a `YYYY-MM-DD` string by whole calendar days. */
export declare function shiftDate(isoDate: string, days: number): string;

/** Collapse hourly buckets into Europe/Riga days, keyed `YYYY-MM-DD`. */
export declare function dailyTotals(payload: MetricPayload): Map<string, number>;

/** Reduce a metric payload to the published summary. */
export declare function summarise(payload: MetricPayload, now?: Date): VisitStatsSummary;
