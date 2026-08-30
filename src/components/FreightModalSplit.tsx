import { useEffect, useState } from 'react';
import { useTheme } from '../ThemeContext';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { freshnessOf, formatPeriod } from '../dataFreshness';
import { FreshnessNotice } from './FreshnessNotice';
import { freshnessLabelColor } from './freshnessStyle';

/**
 * How much of each country's inland freight goes by rail.
 *
 * This replaces the goods-balance and services-balance charts, which were two
 * of five balance-of-payments series on one tile saying versions of the same
 * thing. This says something none of them did, and something most readers will
 * guess wrong: **Latvia is the most rail-dependent freight economy in the
 * Baltics**, moving 18.9% of its tonne-kilometres by rail against Lithuania's
 * 8.5% and Estonia's 7.3% — despite Lithuania moving four times the total
 * volume.
 *
 * Measured in tonne-kilometres, not tonnes. Both are published, and the choice
 * is not cosmetic: a tonne on a train travels far further than a tonne on a
 * lorry, so a split computed from tonnes lifted would flatter road enormously
 * and describe nothing. `road_freight` (tonnes) and `road_freight_tkm`
 * (tonne-km) are therefore separate indicators rather than one with a switch.
 *
 * Drawn as proportional bars rather than a charting library, because the whole
 * claim is one ratio per country and a bar that *is* the ratio needs no axis to
 * read. It also sidesteps the red/green problem: the share is printed as a
 * number beside every bar, so colour carries nothing on its own
 * (WCAG 2.2 SC 1.4.1).
 */

const COUNTRIES = ['LV', 'EE', 'LT'] as const;
const NAMES: Record<string, string> = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

interface Split {
  code: string;
  name: string;
  rail: number;
  road: number;
  share: number;
  period: string;
}

/** Newest period for which *both* series have a value, per country. */
function splitsFrom(rail: BalticCompareData, road: BalticCompareData): Split[] {
  const out: Split[] = [];

  for (const code of COUNTRIES) {
    const railSeries = rail.countries?.[code]?.series ?? [];
    const roadSeries = road.countries?.[code]?.series ?? [];
    const roadAt = new Map(roadSeries.map((p) => [p.period, p.value]));

    let best: Split | null = null;
    for (const point of railSeries) {
      const railValue = point.value;
      const roadValue = roadAt.get(point.period);
      // Both, or neither. A quarter where only one mode has reported would
      // produce a share that looks precise and is arithmetic on a gap.
      if (railValue === null || railValue === undefined) continue;
      if (roadValue === null || roadValue === undefined) continue;
      const total = railValue + roadValue;
      if (total <= 0) continue;
      if (best === null || point.period > best.period) {
        best = {
          code,
          name: NAMES[code] ?? code,
          rail: railValue,
          road: roadValue,
          share: (railValue / total) * 100,
          period: point.period,
        };
      }
    }
    if (best) out.push(best);
  }

  return out.sort((a, b) => b.share - a.share);
}

function formatTkm(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}bn`;
  return `${Math.round(value).toLocaleString('en-GB')}m`;
}

export function FreightModalSplit({ compact = false }: { compact?: boolean }) {
  const { chartColors } = useTheme();
  const [splits, setSplits] = useState<Split[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBalticCompare('rail_freight'), fetchBalticCompare('road_freight_tkm')])
      .then(([rail, road]) => {
        if (cancelled) return;
        setSplits(rail && road ? splitsFrom(rail, road) : null);
      })
      .catch(() => { if (!cancelled) setSplits(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className={`rounded-xl p-4 animate-pulse ${compact ? 'h-64' : 'h-80'}`}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/3 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-40 rounded" style={{ background: 'var(--border-card)' }} />
      </div>
    );
  }

  if (!splits || splits.length === 0) {
    return (
      <div className={`rounded-xl p-4 flex items-center justify-center ${compact ? 'h-64' : 'h-80'}`}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Freight modal split unavailable
        </p>
      </div>
    );
  }

  // Every country reports on its own schedule, so the quarters can differ.
  const periods = [...new Set(splits.map((s) => s.period))].sort();
  const dateline = periods.length === 1
    ? formatPeriod(periods[0])
    : `${formatPeriod(periods[0])} to ${formatPeriod(periods[periods.length - 1])}`;

  // Judged on the OLDEST period, not the newest, for the same reason
  // `MaritimeTile` does: a panel drawing three countries that publish
  // independently is only as current as the one furthest behind, and dating it
  // by the leader would give the laggard a quarter it never reached.
  //
  // The panel dated its figures and never judged them, which left the reader to
  // work out whether "Q1 2022" was a normal publication lag or a dead feed —
  // a judgement the dashboard already knows how to make everywhere else.
  const freshness = freshnessOf(periods[0]);

  const description = splits
    .map((s) => `${s.name} ${s.share.toFixed(1)} per cent by rail`)
    .join('; ');

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>
          Rail&apos;s share of inland freight
        </p>
        <span
          className="text-caption"
          style={{ color: freshnessLabelColor(freshness) }}
        >
          {dateline}
        </span>
      </div>
      <p className="text-caption mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Tonne-kilometres by rail as a share of rail plus road
      </p>

      <FreshnessNotice freshness={freshness} className="mb-4" />

      <div className="space-y-4" role="img" aria-label={`Rail share of inland freight: ${description}`}>
        {splits.map((s) => (
          <div key={s.code}>
            <div className="flex items-baseline justify-between text-caption mb-1 gap-2">
              <span style={{ color: 'var(--text-body)' }}>{s.name}</span>
              <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                {s.share.toFixed(1)}%
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-raised)' }}>
              <div
                className="h-full transition-[width] duration-500"
                style={{ width: `${s.share}%`, background: chartColors.series[s.code as 'LV' | 'EE' | 'LT'] }}
              />
            </div>
            <p className="text-caption mt-1 font-mono" style={{ color: 'var(--text-tertiary)' }}>
              rail {formatTkm(s.rail)} · road {formatTkm(s.road)} tonne-km
              {periods.length > 1 ? ` · ${formatPeriod(s.period)}` : ''}
            </p>
          </div>
        ))}
      </div>

      <p className="text-caption mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Source: Eurostat rail_go_quartal and road_go_tq_tott, quarterly
      </p>
    </div>
  );
}
