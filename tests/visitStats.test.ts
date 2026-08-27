import { describe, it, expect } from 'vitest';
import { summarise, dailyTotals, localDate, shiftDate } from '../scripts/visit-stats.mjs';

/**
 * The visit counter is one number on a dashboard, which is exactly why it needs
 * a test: a traffic figure that is wrong is indistinguishable from one that is
 * right, because nobody knows the true value independently. There is no
 * "obviously absurd" reading to catch it.
 *
 * Two things can go wrong and neither shows up by inspection. The first is the
 * day boundary — Riga is UTC+2 or UTC+3 and Azure reports UTC, so a naive
 * bucketing misfiles the small hours into the previous day, every day, for as
 * long as the feature exists. The second is treating an hour Azure omitted as
 * an hour with zero traffic, which silently converts "no data" into "no
 * visitors" and would make an outage look like a quiet afternoon.
 *
 * These fixtures are hand-built rather than captured, so the expected answer is
 * arithmetic a reader can verify in their head.
 */

/** Shape one hourly bucket the way `az monitor metrics list` emits it. */
function payload(points: Array<{ timeStamp: string; total?: number }>) {
  return {
    value: [
      {
        name: { value: 'SiteHits' },
        timeseries: [{ data: points }],
      },
    ],
  };
}

describe('local date resolution', () => {
  it('files a late-evening UTC reading into the next Riga day in summer', () => {
    // Riga is UTC+3 in August, so 21:30Z is 00:30 the following morning.
    // Bucketing this in UTC would put a visitor who arrived just after local
    // midnight on the previous day's tally.
    expect(localDate('2026-08-26T21:30:00Z')).toBe('2026-08-27');
  });

  it('uses the winter offset when the date falls outside DST', () => {
    // Riga is UTC+2 in January, so the boundary moves: 21:30Z is still the
    // 15th locally, and only 22:30Z crosses. A fixed +3 would get this wrong.
    expect(localDate('2026-01-15T21:30:00Z')).toBe('2026-01-15');
    expect(localDate('2026-01-15T22:30:00Z')).toBe('2026-01-16');
  });

  it('keeps a daytime reading on its own day', () => {
    expect(localDate('2026-08-26T12:00:00Z')).toBe('2026-08-26');
  });
});

describe('calendar arithmetic', () => {
  it('steps back whole days without skipping across a DST transition', () => {
    // Riga moved its clocks on 2026-03-29. Anchoring this arithmetic in local
    // time would make one of these steps 23 or 25 hours and drop or repeat a
    // date; anchoring in UTC keeps it a pure calendar operation.
    expect(shiftDate('2026-03-30', -1)).toBe('2026-03-29');
    expect(shiftDate('2026-03-29', -1)).toBe('2026-03-28');
  });

  it('steps across a month boundary', () => {
    expect(shiftDate('2026-09-02', -6)).toBe('2026-08-27');
  });
});

describe('daily aggregation', () => {
  it('sums the hours belonging to the same local day', () => {
    const totals = dailyTotals(
      payload([
        { timeStamp: '2026-08-26T10:00:00Z', total: 100 },
        { timeStamp: '2026-08-26T11:00:00Z', total: 50 },
      ]),
    );

    expect(totals.get('2026-08-26')).toBe(150);
  });

  it('splits a UTC day across two local days at the Riga boundary', () => {
    const totals = dailyTotals(
      payload([
        { timeStamp: '2026-08-26T20:00:00Z', total: 7 }, // 23:00 local, 26th
        { timeStamp: '2026-08-26T21:00:00Z', total: 5 }, // 00:00 local, 27th
      ]),
    );

    expect(totals.get('2026-08-26')).toBe(7);
    expect(totals.get('2026-08-27')).toBe(5);
  });

  it('does not record a day for hours Azure omitted', () => {
    // Azure sends the bucket with no `total` when nothing was served. Counting
    // it as a zero-traffic day would make the observed range claim coverage
    // Azure never gave us.
    const totals = dailyTotals(
      payload([
        { timeStamp: '2026-08-26T03:00:00Z' },
        { timeStamp: '2026-08-26T04:00:00Z' },
      ]),
    );

    expect(totals.has('2026-08-26')).toBe(false);
  });
});

describe('published summary', () => {
  const now = new Date('2026-08-27T12:00:00Z'); // 15:00 in Riga

  const fixture = payload([
    { timeStamp: '2026-08-27T09:00:00Z', total: 10 }, // today
    { timeStamp: '2026-08-26T09:00:00Z', total: 20 }, // yesterday
    { timeStamp: '2026-08-22T09:00:00Z', total: 30 }, // 5 days ago, inside 7d
    { timeStamp: '2026-08-21T09:00:00Z', total: 40 }, // 6 days ago, inside 7d
    { timeStamp: '2026-08-20T09:00:00Z', total: 50 }, // 7 days ago, outside 7d
    { timeStamp: '2026-07-01T09:00:00Z', total: 90 }, // outside 30d
  ]);

  it('counts today as the current Riga day only', () => {
    expect(summarise(fixture, now).today).toBe(10);
  });

  it('counts seven inclusive days, so today plus the six before it', () => {
    // 10 + 20 + 30 + 40 = 100. The 20th is the seventh day back and is
    // excluded; if the window were a 168-hour slide it would leak in.
    expect(summarise(fixture, now).last7Days).toBe(100);
  });

  it('excludes anything older than the thirty-day window', () => {
    expect(summarise(fixture, now).last30Days).toBe(150);
  });

  it('reports the window it actually observed rather than the one requested', () => {
    const summary = summarise(fixture, now);
    expect(summary.observedFrom).toBe('2026-07-01');
    expect(summary.observedTo).toBe('2026-08-27');
  });

  it('names its unit as requests, never as visits', () => {
    // SiteHits counts assets as well as documents. The label is the only thing
    // stopping a dozen asset requests being read as a dozen readers.
    expect(summarise(fixture, now).unit).toBe('requests');
  });

  it('survives an empty payload rather than publishing a wrong zero range', () => {
    const summary = summarise({ value: [] }, now);
    expect(summary.today).toBe(0);
    expect(summary.observedFrom).toBeNull();
    expect(summary.observedTo).toBeNull();
  });
});
