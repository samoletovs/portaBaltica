/**
 * Types for `scripts/source-alert.mjs`.
 *
 * The script stays plain JavaScript for the same reason `visit-stats.mjs`
 * does: the workflow runs it directly with `node`, and putting a build step in
 * front of a monitor whose whole job is to be dependable would be a poor
 * trade. This declaration is what lets `tests/sourceAlert.test.ts` typecheck
 * against it — `npm run typecheck` covers `tests/`, so without this the suite
 * would not compile.
 */

/** The words `/api/system-status` uses for one probe's state. */
export type CheckStatus = 'healthy' | 'stale' | 'unhealthy';

/**
 * The words it uses for one probe's freshness.
 *
 * A plain string, not an object. Reading `check.freshness.state` is a mistake
 * three sessions have now made against this endpoint, and it produces a
 * confident `undefined` rather than an error.
 */
export type CheckFreshness = 'fresh' | 'stale' | 'unknown';

/** The overall verdict, which folds in required sources only. */
export type OverallStatus = 'healthy' | 'stale' | 'degraded' | 'unhealthy';

/** One probe as the endpoint reports it. */
export interface StatusCheck {
  name?: unknown;
  status?: unknown;
  freshness?: unknown;
  latency?: unknown;
  /** Whether a failure here matters. Absence is an alert, never `false`. */
  required?: unknown;
  powers?: unknown;
  dataPeriod?: unknown;
  ageInCadenceUnits?: unknown;
  maxLag?: unknown;
  cadence?: unknown;
}

export interface DataSources {
  healthy?: unknown;
  stale?: unknown;
  total?: unknown;
  requiredHealthy?: unknown;
  requiredTotal?: unknown;
  optionalHealthy?: unknown;
  optionalTotal?: unknown;
  checks?: unknown;
}

/**
 * The endpoint's body.
 *
 * Every field is `unknown` on purpose. This script's entire job is to decide
 * whether a payload is trustworthy, so it must not be handed a type that
 * asserts the answer before it has looked.
 */
export interface StatusPayload {
  status?: unknown;
  version?: unknown;
  phase?: unknown;
  uptime?: unknown;
  dataSources?: unknown;
  apis?: unknown;
  selfSustaining?: unknown;
  traffic?: unknown;
  respondedIn?: unknown;
  fetchedAt?: unknown;
}

/** The counters, echoed back so a message can quote them. Null when unreadable. */
export interface VerdictSummary {
  overall: unknown;
  total: unknown;
  healthy: unknown;
  stale: unknown;
  requiredHealthy: unknown;
  requiredTotal: unknown;
  optionalHealthy: unknown;
  optionalTotal: unknown;
  fetchedAt: unknown;
}

export interface Verdict {
  /** True means notify. Reached only by failing a positive assertion. */
  alert: boolean;
  headline: string;
  /** Why it is alerting. Empty exactly when `alert` is false. */
  problems: string[];
  /** Optional-source trouble and unknown freshness. Context, never a trigger. */
  notes: string[];
  summary: VerdictSummary | null;
  source: string;
  checkedAt: string;
  /** The body that was read, present only on the network path. */
  payload?: StatusPayload;
}

export interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RunOptions extends FetchOptions {
  url?: string;
  /** Judge this body instead of fetching. Used by the tests. */
  payload?: unknown;
  source?: string;
  now?: Date | string | number;
}

export declare const STATUS_URL: string;
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const EXIT: { CLEAN: 0; ALERT: 1; USAGE: 2 };

/** Keys and types of a value, without its values. Printed before any verdict. */
export declare function describeShape(
  value: unknown,
  options?: { indent?: string; depth?: number },
): string;

/** Judge an already-parsed body. Pure: no network, no clock unless given one. */
export declare function evaluate(
  payload: unknown,
  options?: { source?: string; now?: Date | string | number },
): Verdict;

/** Read the endpoint with a deadline. Throws on anything but a parsed body. */
export declare function fetchStatus(url?: string, options?: FetchOptions): Promise<unknown>;

/** Fetch and judge. Never throws — a failure becomes a verdict with `alert: true`. */
export declare function run(options?: RunOptions): Promise<Verdict>;

/** The report as plain text, for both the issue body and the Telegram message. */
export declare function renderText(verdict: Verdict): string;

/** Where an alert issue lives, so a rehearsal cannot write into the real one. */
export interface AlertRouting {
  /** Issue label. `source-alert` live, `source-alert-rehearsal` for a fixture. */
  label: string;
  /** Issue title prefix, which is what arrives in a notification. */
  subject: string;
  /** `'true'` or `'false'` — a string, because it is read by a shell. */
  rehearsal: string;
}

/**
 * Which issue this verdict belongs in. Derived from `verdict.source`, so a run
 * given `--fixture` is routed as a rehearsal whatever the workflow input said.
 */
export declare function alertRouting(verdict?: Partial<Verdict>): AlertRouting;
