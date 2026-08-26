/**
 * The maritime arithmetic that can be wrong without looking wrong.
 *
 * Every case here is drawn from a real value in Eurostat's tables, because the
 * failures this guards against all render as plausible numbers:
 *
 *   - `THS_T` is *thousand tonnes* and `THS` is *thousand passengers*. Printed
 *     raw, Riga's 4,237 reads as four thousand tonnes rather than 4.24 million,
 *     and Estonia's 2,857 as under three thousand ferry passengers a quarter
 *     rather than 2.86 million. Both look like fine numbers on a dashboard.
 *   - Baltic port traffic is strongly seasonal, so a quarter-on-quarter
 *     comparison reports the summer as growth every single year. Only
 *     year-on-year says anything.
 *   - A port entering or leaving the table between two quarters would read as a
 *     collapse or a boom in traffic that never happened.
 */

import { describe, it, expect } from 'vitest';
import type { PortMeasure } from '../src/types';
import {
  formatMeasure,
  formatPct,
  sameQuarterLastYear,
  totalAt,
  valueAt,
  yearOnYear,
  periodsOf,
  dormantPorts,
  isDiscontinued,
  measureNoun,
} from '../src/portStats';

function measure(
  unit: PortMeasure['unit'],
  ports: { name: string; points: [string, number | null][] }[],
  latest: string | null,
): PortMeasure {
  return {
    unit,
    countryOnly: false,
    latest,
    ports: ports.map((p, i) => ({
      code: `X${i}`,
      name: p.name,
      series: p.points.map(([period, value]) => ({ period, value })),
      latest,
    })),
  };
}

describe('formatMeasure', () => {
  it('reads thousand tonnes as tonnes, not as a bare number', () => {
    // Riga, 2025-Q4. Four and a quarter million tonnes, not four thousand.
    expect(formatMeasure(4237, 'THS_T')).toBe('4.24 Mt');
    expect(formatMeasure(11602, 'THS_T')).toBe('11.60 Mt');
  });

  it('keeps a small port in thousand tonnes rather than rounding it to nothing', () => {
    // Skulte, 2025-Q4. As "0.16 Mt" this reads as a rounding artefact.
    expect(formatMeasure(162, 'THS_T')).toBe('162 kt');
  });

  it('reads thousand passengers as people', () => {
    // Estonia, 2025-Q4 — Tallinn–Helsinki. 2.86 million, not 2,857.
    expect(formatMeasure(2857, 'THS')).toBe('2.86M');
    expect(formatMeasure(56, 'THS')).toBe('56K');
  });

  it('leaves a vessel count alone, because it is already a count', () => {
    expect(formatMeasure(1690, 'NR')).toBe('1,690');
    expect(formatMeasure(25, 'NR')).toBe('25');
  });
});

describe('sameQuarterLastYear', () => {
  it('steps back exactly one year, keeping the quarter', () => {
    expect(sameQuarterLastYear('2025-Q4')).toBe('2024-Q4');
    expect(sameQuarterLastYear('2026-Q1')).toBe('2025-Q1');
  });

  it('returns null for anything it cannot align', () => {
    expect(sameQuarterLastYear(null)).toBeNull();
    expect(sameQuarterLastYear('2025-07')).toBeNull();
    expect(sameQuarterLastYear('2025')).toBeNull();
  });
});

describe('yearOnYear', () => {
  it('compares against the same quarter a year earlier, not the previous one', () => {
    // Seasonal shape: Q3 is the summer peak. Quarter-on-quarter would call the
    // Q4 figure a 40% collapse; year-on-year correctly calls it +10%.
    const m = measure('THS_T', [
      { name: 'Riga', points: [['2024-Q4', 1000], ['2025-Q3', 1833], ['2025-Q4', 1100]] },
    ], '2025-Q4');

    const yoy = yearOnYear(m)!;
    expect(yoy.previous).toBe(1000);
    expect(yoy.current).toBe(1100);
    expect(yoy.pct).toBeCloseTo(10, 5);
  });

  it('ignores a port missing from either quarter, so a new entrant is not growth', () => {
    // Ventspils reports in both quarters; Skulte only appears in the latest.
    // Counting Skulte would report +50% traffic that nobody actually moved.
    const m = measure('THS_T', [
      { name: 'Ventspils', points: [['2024-Q4', 200], ['2025-Q4', 200]] },
      { name: 'Skulte', points: [['2024-Q4', null], ['2025-Q4', 100]] },
    ], '2025-Q4');

    const yoy = yearOnYear(m)!;
    expect(yoy.current).toBe(200);
    expect(yoy.previous).toBe(200);
    expect(yoy.pct).toBe(0);
  });

  it('returns null rather than dividing by a zero baseline', () => {
    const m = measure('THS', [
      { name: 'Riga', points: [['2024-Q4', 0], ['2025-Q4', 0]] },
    ], '2025-Q4');
    expect(yearOnYear(m)).toBeNull();
  });

  it('returns null when there is no comparable quarter at all', () => {
    const m = measure('NR', [
      { name: 'Riga', points: [['2025-Q4', 568]] },
    ], '2025-Q4');
    expect(yearOnYear(m)).toBeNull();
  });
});

describe('totalAt and valueAt', () => {
  it('sums only the ports that reported that quarter', () => {
    const m = measure('THS_T', [
      { name: 'Riga', points: [['2025-Q4', 4237]] },
      { name: 'Ventspils', points: [['2025-Q4', 1843]] },
      { name: 'Skulte', points: [['2025-Q4', null]] },
    ], '2025-Q4');
    expect(totalAt(m, '2025-Q4')).toBe(6080);
  });

  it('distinguishes a reported zero from an absent figure', () => {
    // Riga reports zero sea passengers because the Stockholm route ended.
    // That is a fact worth showing, and it must not be read as missing data.
    const m = measure('THS', [
      { name: 'Riga', points: [['2025-Q4', 0]] },
      { name: 'Ventspils', points: [['2025-Q4', 56]] },
    ], '2025-Q4');

    expect(valueAt(m.ports[0], '2025-Q4')).toBe(0);
    expect(valueAt(m.ports[0], '2024-Q4')).toBeNull();
    expect(totalAt(m, '2025-Q4')).toBe(56);
  });

  it('returns null when nothing reported, rather than a confident zero', () => {
    const m = measure('THS_T', [
      { name: 'Riga', points: [['2025-Q4', null]] },
    ], '2025-Q4');
    expect(totalAt(m, '2025-Q4')).toBeNull();
    expect(totalAt(m, null)).toBeNull();
  });
});

describe('periodsOf', () => {
  it('returns every quarter present, oldest first, without duplicates', () => {
    const m = measure('NR', [
      { name: 'Riga', points: [['2025-Q3', 1], ['2025-Q4', 2]] },
      { name: 'Liepāja', points: [['2025-Q4', 3], ['2026-Q1', 4]] },
    ], '2026-Q1');
    expect(periodsOf(m)).toEqual(['2025-Q3', '2025-Q4', '2026-Q1']);
  });
});

describe('formatPct', () => {
  it('signs the change and uses a real minus sign', () => {
    expect(formatPct(4.23)).toBe('+4.2%');
    expect(formatPct(-4.23)).toBe('\u22124.2%');
    expect(formatPct(0)).toBe('0.0%');
  });

  it('does not sign a change that rounds to nothing', () => {
    expect(formatPct(0.01)).toBe('0.0%');
  });
});

describe('dormantPorts and isDiscontinued', () => {
  /** A port with its own latest, independent of the block's. */
  function port(name: string, latest: string | null, points: [string, number | null][], discontinued?: boolean) {
    return {
      code: name.toUpperCase(),
      name,
      latest,
      series: points.map(([period, value]) => ({ period, value })),
      ...(discontinued === undefined ? {} : { discontinued }),
    };
  }

  const riga = port('Riga', '2021-Q4', [['2021-Q4', 0], ['2024-Q4', null], ['2025-Q4', null]]);
  const ventspils = port('Ventspils', '2025-Q4', [['2024-Q4', 53], ['2025-Q4', 56]]);

  const passengers: PortMeasure = {
    unit: 'THS', countryOnly: false, latest: '2025-Q4', ports: [ventspils, riga],
  };

  it('finds the port the bars silently drop', () => {
    // Riga has no value for the quarter on screen, so `PortBars` filters it
    // out. That is correct and it is invisible, which is the problem.
    expect(dormantPorts(passengers).map(p => p.name)).toEqual(['Riga']);
  });

  it('leaves a fully reporting measure alone', () => {
    const complete: PortMeasure = { ...passengers, ports: [ventspils] };
    expect(dormantPorts(complete)).toEqual([]);
  });

  it('finds nothing when there is no quarter to compare against', () => {
    expect(dormantPorts({ ...passengers, latest: null })).toEqual([]);
  });

  it('calls a port that has filed nothing for over a year discontinued', () => {
    // Riga: 2021-Q4 against a block at 2025-Q4 is 48 months.
    expect(isDiscontinued(riga, passengers)).toBe(true);
  });

  it('does not call a port a quarter or two behind discontinued', () => {
    // Eurostat's maritime tables run one to two quarters in arrears as normal
    // operation, and individual ports slip a quarter routinely. Labelling that
    // a closure would tell a reader a working port had shut.
    const late = port('Liepāja', '2025-Q2', [['2025-Q2', 12], ['2025-Q4', null]]);
    expect(isDiscontinued(late, passengers)).toBe(false);
  });

  it('draws the line at four quarters, exactly', () => {
    const onTheLine = port('Edge', '2024-Q4', [['2024-Q4', 1]]);
    const justInside = port('Inside', '2025-Q1', [['2025-Q1', 1]]);
    expect(isDiscontinued(onTheLine, passengers)).toBe(true);
    expect(isDiscontinued(justInside, passengers)).toBe(false);
  });

  it('trusts the API flag when the payload carries one', () => {
    // The server computes this too, so consumers that are not this UI get an
    // honest answer. Where both exist they must agree, and the payload wins.
    expect(isDiscontinued(port('Flagged', '2025-Q3', [['2025-Q3', 1]], true), passengers)).toBe(true);
    expect(isDiscontinued(port('Flagged', '2019-Q1', [['2019-Q1', 1]], false), passengers)).toBe(false);
  });
});

describe('measureNoun', () => {
  it('names each measure in a form that fits mid-sentence', () => {
    expect(measureNoun('THS_T')).toBe('cargo');
    expect(measureNoun('THS')).toBe('passengers');
    expect(measureNoun('NR')).toBe('vessel arrivals');
  });
});
