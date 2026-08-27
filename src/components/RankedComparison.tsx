import { useEffect, useState } from 'react';
import { useTheme } from '../ThemeContext';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { formatValue } from '../utils/formatValue';
import { sentimentColor, signed, type Sentiment } from '../utils/polarity';
import { rank, COUNTRY_NAMES } from '../utils/rankBaltic';

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
  /**
   * Whether a larger number ranks first, and therefore whether a rise is good
   * news.
   *
   * Declared per use rather than inferred from `polarityOf`, because none of
   * the six indicators this replaces is registered there: `inequality` and
   * `gov_debt_gdp` both resolve to neutral, which would rank the *worst*
   * performer top and paint a rising Gini green. The polarity registry keys on
   * the dashboard's card ids — `gov_debt`, not `gov_debt_gdp` — so inferring
   * from the chart's id would be reading a map that does not cover it.
   *
   * An explicit flag is also the honest shape: which end is "best" is an
   * editorial judgement, and a caller that has to state it cannot forget to.
   */
  higherIsBetter: boolean;
}

/** Sentiment of a change, given which direction this indicator wants to go. */
function sentimentOfChange(change: number | null, higherIsBetter: boolean): Sentiment {
  if (change === null || !Number.isFinite(change) || change === 0) return 'none';
  const rose = change > 0;
  return rose === higherIsBetter ? 'positive' : 'negative';
}

/**
 * The change, spelled out for a screen reader.
 *
 * Colour is the third encoding here and never the first: the sign is in the
 * number, this carries the meaning, and the colour only confirms what both
 * already said. Measured under a Brettel deuteranopia simulation the positive
 * and negative tokens sit at ΔE 8, which is to say indistinguishable, so for
 * roughly 8% of men this sentence *is* the encoding.
 */
function describeChange(change: number, higherIsBetter: boolean): string {
  const direction = change > 0 ? 'up' : 'down';
  const good = (change > 0) === higherIsBetter;
  return `${direction}, which is ${good ? 'favourable' : 'unfavourable'} for this indicator`;
}

export function RankedComparison({ indicator, title, unit, higherIsBetter }: RankedComparisonProps) {
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
  const bestIsHigh = higherIsBetter;
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
  const periods = [...new Set(reading.ranked.map((r) => r.period))];

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {periods.length === 1 && (
          <span className="text-caption font-mono" style={{ color: 'var(--text-tertiary)' }}>
            {periods[0]}
          </span>
        )}
      </div>
      <p className="text-caption mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {bestIsHigh ? 'Highest first' : 'Lowest first'}
        {displayUnit ? ` · ${displayUnit}` : ''}
      </p>

      <div className="space-y-3">
        {reading.ranked.map((row, index) => {
          const sentiment = sentimentOfChange(row.change, bestIsHigh);
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
                    <span className="text-caption font-mono" style={{ color: sentimentColor(sentiment) }}>
                      {signed(formatValue(Math.abs(row.change), displayUnit), row.change)}
                      <span className="sr-only">
                        {' '}{describeChange(row.change, bestIsHigh)}
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
                  {row.period}
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
