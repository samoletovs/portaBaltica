import { describe, expect, it } from 'vitest';
import { describeComparison, describeSeries } from '../src/utils/chartAccessibility';

/**
 * What a chart's accessible name is allowed to claim.
 *
 * These exist because `describeComparison` shipped a measured falsehood: it
 * reported the **final** element of each series under the heading "Latest
 * readings", which is true of a historical series and false of any curve that
 * runs forward. On the day-ahead power chart it announced Finland at €1.83
 * while the panel showed €27.45 — a factor of fifteen, and audible only to a
 * screen-reader user, because a sighted reader sees the correct figure two
 * inches away.
 *
 * The fixtures below are the three real shapes, measured against production
 * rather than invented:
 *
 *     PowerMarketCard   184 points   "00:45"     88 duplicate labels
 *     GridStatePanel     48 points   "18:00"      0 duplicates
 *     an indicator       22 points   "2026-Q2"    0 duplicates
 */

const euro = (v: number | null) => (v === null ? 'no price' : `€${v.toFixed(2)}`);
const pct = (v: number | null) => (v === null ? 'no data' : `${v.toFixed(1)}%`);

/** A day-ahead curve: today then tomorrow, so every clock label occurs twice. */
function forwardCurve() {
  const slots = ['22:00', '23:00', '00:00', '01:00'];
  const points = [...slots, ...slots].map((period, index) => ({
    period,
    // Today's prices are ordinary; tomorrow's final slot is the cheap one that
    // produced the original error.
    value: index < slots.length ? 27 + index : index === 7 ? 1.83 : 20 + index,
  }));
  return [{ label: 'Finland', points }];
}

/** An ordinary historical series: labels ascend and never repeat. */
function historical() {
  return [
    {
      label: 'Latvia',
      points: [
        { period: '2025-Q3', value: 1.1 },
        { period: '2025-Q4', value: 1.4 },
        { period: '2026-Q1', value: 3.7 },
      ],
    },
    {
      label: 'Estonia',
      points: [
        { period: '2025-Q3', value: 0.4 },
        { period: '2025-Q4', value: 0.9 },
        { period: '2026-Q1', value: 2.2 },
      ],
    },
  ];
}

describe('describeComparison on a curve that runs forward', () => {
  it('does not announce tomorrow as the latest reading', () => {
    // The regression, stated as the defect rather than as the technique: the
    // value that broke it must not be presented as current.
    const label = describeComparison('Day-ahead price', forwardCurve(), euro);

    expect(label, 'the forward final slot must not be called a latest reading')
      .not.toMatch(/Latest readings.*€1\.83/);
    expect(label, 'and no single reading may be named at all when labels repeat')
      .not.toMatch(/Latest readings/);
  });

  it('still says something true and useful', () => {
    // Refusing to name a reading must not degrade into refusing to describe
    // the chart — a label that says nothing is its own defect.
    const label = describeComparison('Day-ahead price', forwardCurve(), euro);

    expect(label).toMatch(/Day-ahead price/);
    expect(label, 'the count of plotted points is true at any orientation').toMatch(/8 plotted points/);
    expect(label, 'and so is the range').toMatch(/Finland between €1\.83 and €30\.00/);
  });

  it('is decided by repeated labels, not by parsing the period', () => {
    // The check is structural. A date parser handles the formats its author
    // imagined and fails silently on the next one, in the direction that
    // reports success — and these labels are "00:45", which carries no date to
    // parse at all. Two identical labels cannot identify a point; that is the
    // whole test, and it holds for any format.
    const repeated = [
      { label: 'X', points: [{ period: 'anything', value: 1 }, { period: 'anything', value: 2 }] },
    ];

    expect(describeComparison('T', repeated, pct)).not.toMatch(/Latest readings/);
  });
});

describe('describeComparison on an ordinary historical series', () => {
  // The companion to every assertion above. Without these, a helper that
  // refused *everything* would pass the forward-curve tests completely.
  it('still names the latest reading', () => {
    const label = describeComparison('GDP growth', historical(), pct);

    expect(label).toBe(
      'GDP growth. Latest readings — Latvia 3.7% in 2026-Q1; Estonia 2.2% in 2026-Q1.',
    );
  });

  it('is unchanged by the forward-curve work', () => {
    // Pinned verbatim, because the value of this change depends on the sixty
    // existing chart labels not moving. A wording drift here is a regression
    // even though every assertion above would still pass.
    expect(describeComparison('T', historical(), pct)).toMatch(
      /^T\. Latest readings — Latvia 3\.7% in 2026-Q1; Estonia 2\.2% in 2026-Q1\.$/,
    );
  });

  it('reports a series with no observations rather than omitting it', () => {
    const withGap = [
      ...historical(),
      { label: 'Lithuania', points: [{ period: '2026-Q1', value: null }] },
    ];

    expect(describeComparison('T', withGap, pct)).toMatch(/Lithuania: no data/);
  });
});

describe('describeComparison when the caller declares which period is current', () => {
  it('reports the reading at that period, not the final one', () => {
    // `asAt` is the guarantee. The boundary is caller knowledge — measured
    // against production, `GridStatePanel` knows where measurement stops only
    // because its payload carries `meteredTo`, which never reaches this
    // function.
    const label = describeComparison('Day-ahead price', forwardCurve(), euro, (p) => p, {
      asAt: '01:00',
    });

    expect(label, 'the reading at the declared period').toMatch(/Finland €30\.00 at 01:00/);
    expect(label, 'and it may be called latest, because the caller said so').toMatch(/Latest readings/);
    expect(label, 'the forward slot is not presented as current').not.toMatch(/€1\.83 at/);
  });

  it('says the series continues past the declared period', () => {
    const label = describeComparison('Day-ahead price', forwardCurve(), euro, (p) => p, {
      asAt: '01:00',
    });

    expect(label).toMatch(/The series continues to /);
  });

  it('does not claim it continues when the declared period is the end', () => {
    // An "absent means success" guard: without this, the clause could be
    // unconditional and the test above would still pass.
    const label = describeComparison('GDP growth', historical(), pct, (p) => p, {
      asAt: '2026-Q1',
    });

    expect(label).not.toMatch(/continues to/);
    expect(label).toMatch(/Latvia 3\.7% at 2026-Q1/);
  });

  it('falls back to the last reading before the declared period', () => {
    // A quarter the series does not carry: the honest answer is the most
    // recent reading at or before it, not silence and not the final point.
    const label = describeComparison('GDP growth', historical(), pct, (p) => p, {
      asAt: '2025-Q4',
    });

    expect(label).toMatch(/Latvia 1\.4% at 2025-Q4/);
    expect(label).toMatch(/The series continues to 2026-Q1/);
  });
});

describe('describeSeries', () => {
  it('claims a count of observations and never a count of periods', () => {
    // The `AGENTS.md` rule that `detect_streak` broke and
    // `detect_record_extreme` got right: count observations, call them
    // observations, claim no time unit, and the sentence is true at any
    // cadence.
    const label = describeSeries(
      'Consumer prices',
      [
        { period: '2026-01', value: 3.4 },
        { period: '2026-03', value: null },
        { period: '2026-07', value: 2.5 },
      ],
      pct,
    );

    expect(label).toMatch(/2 readings from 2026-01 to 2026-07/);
    expect(label, 'the null must not be counted as a reading').not.toMatch(/3 readings/);
  });

  it('says so plainly when there is nothing to describe', () => {
    expect(describeSeries('T', [{ period: '2026-01', value: null }], pct)).toBe(
      'T: no data available.',
    );
  });
});
