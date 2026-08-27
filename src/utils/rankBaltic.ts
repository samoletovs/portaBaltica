import type { BalticCompareData } from '../api';

export const RANKED_COUNTRIES = ['LV', 'EE', 'LT'] as const;

export const COUNTRY_NAMES: Record<string, string> = {
  LV: 'Latvia',
  EE: 'Estonia',
  LT: 'Lithuania',
};

export interface RankedRow {
  code: string;
  name: string;
  value: number;
  period: string;
  /** Change from the oldest reading in the window, or null if there is only one. */
  change: number | null;
}

export interface Reading {
  ranked: RankedRow[];
  /** Countries the source published nothing for. Named, never ranked. */
  missing: string[];
}

/**
 * Latest and earliest readings per country, ordered best first.
 *
 * A country contributes a rank only if it has a usable latest value. Anything
 * else — absent from the payload, present with every point null, a value that
 * is not a finite number — lands in `missing`, because each of those means "we
 * do not know" and none of them means "lowest".
 *
 * That rule is the whole point of this function and it comes from a real
 * defect: `classifySeaState` compared a missing wave height with `<` in every
 * branch, every comparison was false for a non-number, and it fell through to
 * the last `return` — so a port with no data was labelled "Very Rough", in red,
 * as confidently as a real storm. A ranking has the same hazard in a sharper
 * form, because a missing value sorts *somewhere* whatever you do, and last
 * place is a claim about the world.
 */
export function rank(data: BalticCompareData, higherFirst: boolean): Reading {
  const ranked: RankedRow[] = [];
  const missing: string[] = [];

  for (const code of RANKED_COUNTRIES) {
    const series = data.countries?.[code]?.series ?? [];
    const points = series.filter(
      (p): p is { period: string; value: number } =>
        typeof p.value === 'number' && Number.isFinite(p.value),
    );

    if (points.length === 0) {
      missing.push(code);
      continue;
    }

    const latest = points[points.length - 1];
    const earliest = points[0];
    ranked.push({
      code,
      name: COUNTRY_NAMES[code] ?? code,
      value: latest.value,
      period: latest.period,
      change: points.length > 1 ? latest.value - earliest.value : null,
    });
  }

  ranked.sort((a, b) => (higherFirst ? b.value - a.value : a.value - b.value));
  return { ranked, missing };
}
