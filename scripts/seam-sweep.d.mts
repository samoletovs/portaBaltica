/**
 * Types for `scripts/seam-sweep.mjs`.
 *
 * The script stays plain JavaScript for the same reason `source-alert.mjs` and
 * `visit-stats.mjs` do: it is run directly with `node`, and putting a build step
 * in front of a diagnostic is a poor trade. This declaration is what lets
 * `tests/seamSweep.test.ts` typecheck against it — `npm run typecheck` covers
 * `tests/`, so without it the suite does not compile.
 */

/** How a field is classified once its readers are counted. */
export type Verdict = 'app' | 'test-only' | 'orphan';

/**
 * One field of one endpoint's response.
 *
 * `path` is the full dotted route with `[]` marking an array step, so
 * `countries.LV.series[].period` reads as what it is. `depth` counts from 1 at
 * the top level — the population the original sweep stopped at.
 */
export interface SweepField {
  endpoint: string;
  name: string;
  path: string;
  depth: number;
  type: string;
  srcReaders: number;
  /**
   * Of those, how many read it by a dot or bracket access.
   *
   * A dot access is a read *of a field*. A destructuring or a type member is a
   * **binding of a name**, which is exactly as consistent with a local object
   * that happens to share it — measured on `0dd4770`, `freshness` had zero of
   * the first and five of the second, all of them `FreshnessNotice` props
   * carrying a client-computed value.
   */
  srcStrongReaders: number;
  testReaders: number;
  srcWhere: string[];
  testWhere: string[];
  /** How many endpoints declare this leaf name. >1 makes a match ambiguous. */
  declaredBy: number;
  verdict: Verdict;
  ambiguous: boolean;
  /**
   * Matched in `src/`, but never by a dot or bracket access — so every match is
   * a binding of the name rather than a read of the field. Evidence of nothing,
   * reported rather than resolved.
   */
  srcNamedOnly: boolean;
  /**
   * The nearest ancestor on this path that nothing in `src/` reads, or `null`.
   * A field under such an ancestor cannot be reached by the app however many
   * times its own name appears elsewhere.
   */
  unreachableVia: string | null;
  /** `verdict` after ancestor reachability. This is the one to report. */
  effective: Verdict;
}

/** `typeof`, except that `null` is reported as `null` rather than `object`. */
export declare function typeOf(value: unknown): string;

/**
 * How one file refers to a name: by reading a field, by binding the name, or
 * not at all.
 *
 * `strong` is a dot or bracket access. `weak` is a destructuring or a type
 * member, which cannot be told from a local of the same name. Comments are
 * stripped first.
 */
export declare function classifyRead(src: string, name: string): 'strong' | 'weak' | 'none';

/**
 * Whether a field's only evidence in `src/` is a bound name — matched, but
 * never by a dot or bracket access. Evidence of nothing.
 */
export declare function namedOnly(src: { n: number; strong: number }): boolean;

/**
 * Strip comments so a field name in prose is not counted as a reader.
 *
 * Leaves `//` inside a URL alone; treating that as a comment deletes the rest
 * of the line, including any field access on it.
 */
export declare function stripComments(src: string): string;

/**
 * Walk a parsed response, appending one entry per field to `out`.
 *
 * Arrays are walked through their first element only: a homogeneous array
 * declares the same names in every entry, so walking all of them turns a field
 * count into a row count.
 */
export declare function walk(
  node: unknown,
  prefix: string,
  depth: number,
  out: Array<{ name: string; path: string; depth: number; type: string }>,
): void;

/**
 * Demote any field whose ancestor is unread in `src/`, in place.
 *
 * Without this the recursive sweep is worse than the top-level one it replaces,
 * because a leaf-name match cannot tell a payload's `stale` from the client's
 * own computed `stale`.
 */
export declare function applyReachability<T>(rows: T[]): T[];

/** Attach reader counts and a verdict to one field row, in place. */
export declare function annotateRow<T extends object>(
  row: T,
  src: { n: number; strong: number; where: string[] },
  test: { n: number; where: string[] },
  declaredBy: number,
): T & Record<string, unknown>;
