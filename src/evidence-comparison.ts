import type { EvidenceComparison, EvidenceNormalized, EvidenceRow } from './evidence-types';
import { EvidenceError } from './evidence-validation';

const key = (row: EvidenceRow) => `${row.geo}/${row.period}`;
function same(left: EvidenceRow | null, right: EvidenceRow | null): boolean {
  return left === null || right === null ? left === right
    : left.geo === right.geo && left.period === right.period && left.value === right.value
      && left.status === right.status && left.missing === right.missing;
}

/** Compare verified coordinates, not a summary count or the publisher's mutable current response. */
export function categorizeEvidenceComparison(
  { comparison, before, after }: { comparison: EvidenceComparison; before: EvidenceNormalized; after: EvidenceNormalized },
): EvidenceComparison {
  const previous = new Map(before.rows.map(row => [key(row), row]));
  const current = new Map(after.rows.map(row => [key(row), row]));
  const changes = new Map(comparison.changes.map(change => [`${change.geo}/${change.period}`, change]));
  for (const coordinate of new Set([...previous.keys(), ...current.keys()])) {
    const left = previous.get(coordinate) ?? null;
    const right = current.get(coordinate) ?? null;
    const change = changes.get(coordinate);
    if (same(left, right) ? change !== undefined : !change || !same(left, change.before) || !same(right, change.after)) {
      throw new EvidenceError('integrity', 'Comparison rows do not reproduce the two verified captures.');
    }
  }
  if (comparison.changes.some(change => !previous.has(`${change.geo}/${change.period}`) && !current.has(`${change.geo}/${change.period}`))) {
    throw new EvidenceError('integrity', 'Comparison rows fall outside the verified captures.');
  }
  const maximum = before.rows.reduce((last, row) => row.period > last ? row.period : last, '');
  return {
    ...comparison,
    changes: comparison.changes.map(change => change.kind === 'new_period' && change.period <= maximum
      ? { ...change, kind: 'coverage_added' } : change),
  };
}
