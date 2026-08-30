import { useEffect, useState } from 'react';
import { useTheme } from '../ThemeContext';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { formatValue } from '../utils/formatValue';
import { changeDescription, polarityOf, sentimentColor, sentimentOf, signed } from '../utils/polarity';
import { rank, COUNTRY_NAMES } from '../utils/rankBaltic';
import { freshnessOf, formatPeriod, periodCoverage } from '../dataFreshness';
import { FreshnessNotice } from './FreshnessNotice';
import { freshnessLabelColor, judgementWithheld } from './freshnessStyle';

/**
 * Three countries, latest value, ranked.
 *
 * The dashboard draws fifty-odd comparison charts and ten of them plot annual
 * series over a five-year window — three lines through five points, carrying a
 * legend and two axes to deliver fifteen numbers. A line chart's job is to show
 * a shape over time, and five points have no shape. What a reader wants from an
 * annual indicator is who leads, by how much, and which way it is going, and
 * this answers those three directly.
 *
 * That makes it an addition rather than a smaller subtraction: it is a better
 * answer for a thin series than the chart it replaces, not merely a quieter
 * one. The dashboard is fifty-of-eighty-eight the same three-line component, so
 * a second *shape* of answer is worth more than its instance count suggests.
 *
 * **A country with no reading is not ranked** — see `rank` in
 * `utils/rankBaltic`, where that rule and the defect behind it are set out.
 *
 * Direction goes through the polarity module rather than the sign, so a fall in
 * inequality reads as good news and a rise in life expectancy does too. Rank,
 * value and change are all printed, so colour confirms what the text already
 * says rather than carrying it (WCAG 2.2 SC 1.4.1).
 */

interface RankedComparisonProps {
  indicator: string;
  title: string;
  unit?: string;
}

/**
 * Which end of the ranking goes first, and what a change means, read from the
 * polarity map rather than declared per call site.
 *
 * This used to be a `higherIsBetter: boolean` prop, with the component
 * computing its own sentiment from it. The comment defending that is preserved
 * here because it was *true when written* and is worth knowing why it stopped
 * being true:
 *
 *   > Declared per use rather than inferred from `polarityOf`, because none of
 *   > the six indicators this replaces is registered there […] The polarity
 *   > registry keys on the dashboard's card ids — `gov_debt`, not
 *   > `gov_debt_gdp` — so inferring from the chart's id would be reading a map
 *   > that does not cover it.
 *
 * That was a real constraint and the flag was the honest answer to it. `#248`
 * dissolved it rather than overruling it: all six chart ids are now *in* the
 * map, so it does cover them, and the prop was required to agree with it. This
 * removes the second copy now that the first one answers.
 *
 * The reason it matters is not tidiness. **A boolean has two states and the
 * map has three**, so for anything this component rendered, abstention was
 * unreachable by construction: a `DELIBERATELY_NEUTRAL` id passed here was
 * coloured and *spoken* as favourable, with nothing able to object. Measured
 * on master, `house_prices` — declined in writing as "good if you own, bad if
 * you are buying" — said *"up, which is favourable for this indicator"*. It
 * now says *"up"*, which is the abstention actually reaching a reader.
 */
function ordering(indicator: string): { bestIsHigh: boolean; label: string } {
  // `lower-better` is the only polarity that inverts the ranking. `neutral`
  // sorts high-to-low like everything else, and the label says exactly that —
  // "Highest first" describes the sort order and claims nothing about which
  // end is better, which is the correct thing to print for a series nobody has
  // graded.
  const bestIsHigh = polarityOf(indicator) !== 'lower-better';
  return { bestIsHigh, label: bestIsHigh ? 'Highest first' : 'Lowest first' };
}

export function RankedComparison({ indicator, title, unit }: RankedComparisonProps) {
  const { chartColors } = useTheme();
  const [data, setData] = useState<BalticCompareData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchBalticCompare(indicator)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [indicator]);

  if (loading) {
    return (
      <div className="rounded-xl p-4 animate-pulse h-48"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/2 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-24 rounded" style={{ background: 'var(--border-card)' }} />
      </div>
    );
  }

  // Which end is "best" is declared by the caller, so `top` means best rather
  // than merely largest: inequality and government debt rank the smallest
  // number first.
  const { bestIsHigh, label: orderLabel } = ordering(indicator);
  const reading = data ? rank(data, bestIsHigh) : null;
  const displayUnit = unit ?? data?.unit ?? '';

  if (!reading || reading.ranked.length === 0) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center h-48"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          {title} unavailable
        </p>
      </div>
    );
  }

  const widest = Math.max(...reading.ranked.map((r) => Math.abs(r.value)), 1);
  const periods = [...new Set(reading.ranked.map((r) => r.period))].sort();

  // Three faults in one line, all of them about the date.
  //
  //   - the period was printed raw, `2022-Q1`, where every other surface on the
  //     dashboard writes `Q1 2022` through `formatPeriod`;
  //   - it was rendered only when all three countries agreed on a period, so a
  //     ranking whose members report on different schedules carried **no date at
  //     all** — and that is the case most in need of one;
  //   - nothing judged it, so a ranking frozen in 2022 read as current.
  //
  // `periodCoverage` answers the first two: one period when they agree, a span
  // when they do not, formatted either way. The judgement is made on the OLDEST
  // period, as `MaritimeTile` does, because a comparison is only as current as
  // the member furthest behind — dating it by the leader gives the laggard a
  // quarter it never reached.
  const coverage = periodCoverage(periods[0], periods[periods.length - 1]);
  const freshness = freshnessOf(periods[0]);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {coverage && (
          <span
            className="text-caption font-mono"
            style={{ color: freshnessLabelColor(freshness) }}
          >
            {coverage.label}
          </span>
        )}
      </div>
      <FreshnessNotice freshness={freshness} className="mb-1" />
      <p className="text-caption mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {orderLabel}
        {displayUnit ? ` · ${displayUnit}` : ''}
      </p>

      <div className="space-y-3">
        {reading.ranked.map((row, index) => {
          const sentiment = sentimentOf(indicator, row.change);
          return (
            <div key={row.code}>
              <div className="flex items-baseline justify-between gap-2 text-ui mb-1">
                <span style={{ color: 'var(--text-body)' }}>
                  <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{index + 1}.</span>{' '}
                  {row.name}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatValue(row.value, displayUnit)}
                  </span>
                  {row.change !== null && row.change !== 0 && (
                    <span
                      className="text-caption font-mono"
                      style={{ color: judgementWithheld(freshness) ? 'var(--text-secondary)' : sentimentColor(sentiment) }}
                    >
                      {signed(formatValue(Math.abs(row.change), displayUnit), row.change)}
                      <span className="sr-only">
                        {' '}
                        {judgementWithheld(freshness)
                          ? `${row.change > 0 ? 'up' : 'down'} as of ${formatPeriod(row.period)}, the last reading published`
                          : changeDescription(indicator, row.change)}
                      </span>
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
                <div
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max((Math.abs(row.value) / widest) * 100, 2)}%`,
                    background: chartColors.series[row.code as 'LV' | 'EE' | 'LT'],
                  }}
                />
              </div>
              {periods.length > 1 && (
                // The three countries do not always report the same year, and
                // ranking figures from different periods against each other
                // without saying so would be the shared-as-of problem again.
                <p className="text-caption font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {formatPeriod(row.period)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {reading.missing.length > 0 && (
        // Named, never ranked. A country with no reading placed last would be
        // a claim the data does not make.
        <p className="text-caption mt-3" style={{ color: 'var(--data-warning)' }}>
          No reading published for {reading.missing.map((c) => COUNTRY_NAMES[c] ?? c).join(' or ')}, so
          {reading.missing.length === 1 ? ' it is' : ' they are'} not ranked.
        </p>
      )}

      <p className="text-caption mt-3" style={{ color: 'var(--text-tertiary)' }}>
        Change is against {periods.length === 1 ? 'the start of the window' : 'each series\u2019 own earliest reading'}.
        Source: {data?.source ?? 'Eurostat'}
      </p>
    </div>
  );
}
