import { useEffect, useState } from 'react';
import type { PropertyData } from '../types';
import { useCountry } from '../CountryContext';
import { BalticCompareChart } from './BalticCompareChart';
import { TileHeader } from './TileHeader';
import { finite, list } from '../utils/payload';
import { fetchBalticCompare, type BalticCompareData } from '../api';
import { freshnessOf, formatPeriod } from '../dataFreshness';
import { changeDescription, sentimentColor, sentimentOf, signed } from '../utils/polarity';

/**
 * The permit composition, as a composition rather than as three more lines.
 *
 * `sts_cobp_q` publishes floor area permitted for all buildings and, inside
 * that, for residential and non-residential separately — so it can answer
 * *which half of construction is moving*, which no national aggregate can.
 * Three Baltic comparison charts would have shown the same numbers and asked
 * the reader to hold three cards in their head to get there.
 *
 * **It is deliberately not stacked.** Each series is an index rebased to its
 * own 2021 = 100, so residential 110.4 and non-residential 99.6 do not sum to
 * the total's 104.6 and never will. A stacked bar would assert an arithmetic
 * the data does not have — the part-to-whole claim is the one thing this shape
 * must not make.
 *
 * **The bars draw the year-on-year change, not the index level.** The first
 * version drew the level as a bar diverging from 100, and rendering it settled
 * the question: with Latvia at 104.6 / 110.4 / 99.6 the three bars were 8%,
 * 18% and 0.7% of half a track — a sliver, a stub and a stub — while the
 * numbers beside them read −28.9%, −1.9% and −43.5%. The bars were competing
 * for attention with the story and losing. The story is that Latvian permits
 * are down more than a quarter on a year earlier and it is almost entirely
 * non-residential, and a change is zero-anchored by nature, so §3.3's rule
 * applies without special pleading: bars start at zero, and zero is drawn.
 *
 * The index level stays as the primary figure because it is what the source
 * publishes and it says how far from normal the segment is. The bar is the
 * delta, and it takes its colour from the same `sentimentOf` call, so the row
 * reads as one statement rather than as a number and an unrelated stripe.
 *
 * Office permits are published too and are deliberately absent. Measured
 * across the full 106 quarters the series reaches **0** in Latvia and Estonia
 * and 618.8 in Lithuania; a fourth bar on this scale would be pinned to one
 * end most quarters, and a segment that legitimately sits at zero throws a
 * record extreme most times it moves.
 */
const PERMIT_SEGMENTS = [
  { id: 'building_permits', label: 'All buildings' },
  { id: 'building_permits_residential', label: 'Residential' },
  { id: 'building_permits_non_residential', label: 'Non-residential' },
] as const;

/**
 * Smallest half-width of the change scale, in percentage points.
 *
 * A quarter in which nothing moved would otherwise be drawn as though
 * something had: the longest bar always fills the track, whatever it is worth,
 * so a ±0.3% quarter and a ±40% one look identical. Ten points is roughly the
 * smallest move worth a bar at all.
 */
const MIN_CHANGE_SPAN = 10;

/**
 * The same quarter a year earlier, by **label**.
 *
 * Not by index. `sts_cobp_q` is contiguous today and the live contract asserts
 * it stays so across the newest eight observations, but a consumer that
 * subtracts 4 from a position is correct only while that holds, and it fails
 * silently by comparing against the wrong quarter rather than by comparing
 * against nothing. Addressing by label degrades to "no year-on-year figure
 * shown", which is what a reader should see when there is none.
 */
function quarterYearEarlier(period: string): string | null {
  const q = /^(\d{4})-?Q([1-4])$/.exec(period);
  return q ? `${+q[1] - 1}-Q${q[2]}` : null;
}

interface PermitRow {
  id: string;
  label: string;
  value: number;
  period: string;
  /** Percentage change on the same quarter a year earlier, or null if absent. */
  yoy: number | null;
}

function readSegment(
  payload: BalticCompareData | null,
  country: string,
  segment: (typeof PERMIT_SEGMENTS)[number],
): PermitRow | null {
  const series = (payload?.countries?.[country]?.series ?? []).filter((p) => p.value !== null);
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const earlierPeriod = quarterYearEarlier(latest.period);
  const earlier = earlierPeriod ? series.find((p) => p.period === earlierPeriod) : undefined;

  return {
    id: segment.id,
    label: segment.label,
    value: latest.value as number,
    period: latest.period,
    yoy:
      earlier && typeof earlier.value === 'number' && earlier.value !== 0
        ? ((latest.value as number) / earlier.value - 1) * 100
        : null,
  };
}

function PermitComposition() {
  const { country, countryLabel, flag } = useCountry();
  const [rows, setRows] = useState<PermitRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const payloads = await Promise.all(
        PERMIT_SEGMENTS.map((segment) => fetchBalticCompare(segment.id).catch(() => null)),
      );
      if (cancelled) return;
      setRows(
        payloads
          .map((payload, i) => readSegment(payload, country, PERMIT_SEGMENTS[i]))
          .filter((row): row is PermitRow => row !== null),
      );
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [country]);

  if (loading) {
    return (
      <div className="dash-card border dash-edge rounded-xl p-4 animate-pulse">
        <div className="h-3 dash-skeleton rounded w-2/5 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-6 dash-skeleton rounded" />)}
        </div>
      </div>
    );
  }

  // Absent stays absent. A composition panel with no composition renders as a
  // stated gap rather than as three empty tracks, which would read as zero.
  if (!rows || rows.length === 0) {
    return (
      <div className="dash-card border dash-edge rounded-xl p-4">
        <p className="text-callout font-semibold dash-fg">Building permits by segment</p>
        <p className="text-ui dash-muted mt-2">No permit data available for {countryLabel} right now.</p>
      </div>
    );
  }

  // One scale for the three bars, symmetric about zero, so the lengths are
  // comparable with each other. Widened past the largest move so the longest
  // bar does not run to the edge and imply a maximum.
  const changes = rows.map((r) => r.yoy).filter((c): c is number => c !== null);
  const span = Math.max(MIN_CHANGE_SPAN, ...changes.map(Math.abs)) * 1.15;
  const oldest = rows.map((r) => r.period).sort()[0];
  const freshness = freshnessOf(oldest);

  return (
    <div className="dash-card border dash-edge rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <p className="text-callout font-semibold dash-fg">Building permits by segment</p>
        <p className="text-caption dash-subtle font-mono">
          <span aria-hidden="true">{flag} </span>{countryLabel}
        </p>
      </div>
      <p className="text-caption dash-subtle mb-4">
        Floor area permitted · index, 2021 = 100 · bars show the change on a year earlier
      </p>

      <div className="space-y-4">
        {rows.map((row) => {
          const sentiment = sentimentOf(row.id, row.yoy);
          const half = row.yoy === null ? 0 : (Math.abs(row.yoy) / span) * 50;

          return (
            <div key={row.id}>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-ui dash-body truncate">{row.label}</span>
                <span className="flex items-baseline gap-2 shrink-0 font-mono text-ui">
                  <span className="dash-fg">{row.value.toFixed(1)}</span>
                  {row.yoy !== null && (
                    <span className="text-caption" style={{ color: sentimentColor(sentiment) }}>
                      {/* Three encodings, none of them optional: the glyph, the
                          explicit sign, and a spoken description. Red and green
                          sit at about ΔE 8 under deuteranopia, so colour here
                          only confirms what the other two already said. */}
                      <span aria-hidden="true">{row.yoy > 0 ? '▲' : row.yoy < 0 ? '▼' : '■'} </span>
                      {signed(`${Math.abs(row.yoy).toFixed(1)}%`, row.yoy)}
                      <span className="sr-only"> year on year, {changeDescription(row.id, row.yoy)}</span>
                    </span>
                  )}
                </span>
              </div>

              {/* The rule down the middle is zero. A bar to the left of it is a
                  fall and a bar to the right is a rise, so direction is carried
                  by position before any colour is involved — which matters,
                  because the two sentiment colours are about ΔE 8 apart under
                  deuteranopia. No bar at all when there is no year-earlier
                  reading: an empty track is indistinguishable from no change,
                  which would be inventing the number this panel is missing. */}
              {row.yoy !== null && (
                <div className="relative h-2 dash-raised rounded-full" aria-hidden="true">
                  <div
                    className="absolute inset-y-0 w-px"
                    style={{ left: '50%', background: 'var(--text-tertiary)' }}
                  />
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      background: sentimentColor(sentiment),
                      left: row.yoy >= 0 ? '50%' : `${50 - half}%`,
                      width: `${Math.max(half, 0.5)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-caption dash-subtle mt-4">
        Eurostat (sts_cobp_q)
        {freshness && ` · ${formatPeriod(freshness.period)}, ${freshness.label}`}
      </p>
    </div>
  );
}

interface PropertyTileProps {
  data: PropertyData | null;
  loading: boolean;
}

export function PropertyTile({ data, loading }: PropertyTileProps) {
  const { country } = useCountry();
  if (loading) return <TileSkeleton />;

  // The permit composition and the house-price chart are Eurostat and cover
  // all three countries, so they no longer depend on the Latvia-only payload
  // arriving. The tile used to render `null` when data.gov.lv was unreachable
  // or the reader was on Estonia, taking two working Baltic-wide panels down
  // with the one national source.
  if (!data) {
    return (
      <section>
        <TileHeader title="Property & energy" />
        <BalticSection />
      </section>
    );
  }

  // `!data` above checks that something arrived, not that it has these two
  // arrays. A 404-shaped response from data.gov.lv resolves fine and has
  // neither, and `.map` on `undefined` threw in the render path.
  //
  // `list()` closes that hole but cannot close the next one: it validates the
  // *container* and casts the *contents*, so `{ count: number }` is a
  // compile-time claim about a runtime payload and an item with no `count`
  // passes straight through. That reached the arithmetic —
  //
  //     Math.max(undefined, 1) === NaN     Math.max(NaN, 1) === NaN
  //
  // — so one bad row made every width `NaN%`, CSS dropped all of them, and
  // every bar rendered at the container's default. Not a broken chart but a
  // **wrong** one, saying every municipality is equal. The `, 1` floor guards
  // division by zero and nothing else.
  //
  // So each count is resolved through `finite()` and a row that has none keeps
  // its name and renders a dash. It is not dropped, because we did hear about
  // that municipality, and it draws no track at all, because an empty track is
  // indistinguishable from a zero — which would be inventing the reading this
  // whole module exists to refuse. See DESIGN.md §3.8.
  const permits = list<{ municipality: string; count: unknown }>(data.constructionPermits)
    .map((p) => ({ municipality: p.municipality, count: finite(p.count) }));
  const certs = list<{ rating: string; count: unknown }>(data.energyCerts)
    .map((c) => ({ rating: c.rating, count: finite(c.count) }));
  const maxPermits = Math.max(...permits.flatMap((p) => (p.count === null ? [] : [p.count])), 1);
  const maxCerts = Math.max(...certs.flatMap((c) => (c.count === null ? [] : [c.count])), 1);
  const totalPermits = finite(data.totalPermits);
  const totalCerts = finite(data.totalCerts);

  return (
    <section>
      <TileHeader
        title="Property & energy"
        meta={country === 'LV' ? '🇱🇻 Latvia · data.gov.lv' : undefined}
      >
        {country !== 'LV' && <LvOnlyNotice />}
      </TileHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Construction permits */}
        <div className="dash-card border dash-edge rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-caption dash-muted">Construction Permits</p>
            <p className="text-lead font-semibold dash-fg font-mono">{totalPermits === null ? '—' : totalPermits.toLocaleString()}</p>
          </div>
          <div className="space-y-2">
            {permits.slice(0, 8).map((p) => (
              <div key={p.municipality}>
                <div className="flex items-center justify-between text-caption mb-0.5">
                  <span className="dash-body truncate max-w-[60%]">{p.municipality}</span>
                  <span className="dash-fg font-mono">{p.count === null ? '—' : p.count}</span>
                </div>
                {p.count !== null && (
                  <div className="h-1.5 dash-raised rounded-full overflow-hidden">
                    <div
                      className="h-full dash-fill-cat1 rounded-full"
                      style={{ width: `${(p.count / maxPermits) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-caption dash-subtle mt-2">BVKB via data.gov.lv</p>
        </div>

        {/* Energy profile by carrier */}
        <div className="dash-card border dash-edge rounded-xl p-6">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-caption dash-muted">Building Energy Profile</p>
            <p className="text-lead font-semibold dash-fg font-mono">{totalCerts === null ? '—' : totalCerts.toLocaleString()}</p>
          </div>
          {certs.length > 0 ? (
            <div className="space-y-2">
              {certs.map((cert) => (
                <div key={cert.rating}>
                  <div className="flex items-center justify-between text-caption mb-0.5">
                    <span className="dash-body truncate max-w-[65%]">{cert.rating}</span>
                    <span className="dash-fg font-mono">{cert.count === null ? '—' : cert.count}</span>
                  </div>
                  {cert.count !== null && (
                    <div className="h-1.5 dash-raised rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full dash-fill-cat2"
                        style={{ width: `${(cert.count / maxCerts) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ui dash-subtle">Awaiting energy data...</p>
          )}
          <p className="text-caption dash-subtle mt-2">Energy carrier distribution · data.gov.lv</p>
        </div>
      </div>

      {/* Baltic comparison — available for all three countries, unlike the two
          cards above. Permits lead completions and prices by quarters, so the
          composition sits beside the price it eventually moves. */}
      <div className="mt-4">
        <BalticSection />
      </div>
    </section>
  );
}

function BalticSection() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <PermitComposition />
      <BalticCompareChart indicator="house_prices" title="House price change (% YoY)" compact />
    </div>
  );
}

function LvOnlyNotice() {
  return (
    <div className="mt-3 px-3 py-2 rounded-lg text-caption" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
      🇱🇻 This section shows Latvia data only. Estonia and Lithuania property data coming soon.
    </div>
  );
}

function TileSkeleton() {
  return (
    <section>
      <TileHeader title="Property & energy" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="dash-card border dash-edge rounded-xl p-6 animate-pulse">
            <div className="h-3 dash-skeleton rounded w-1/3 mb-3" />
            <div className="h-6 dash-skeleton rounded w-1/4 mb-4" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-2 dash-skeleton rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
