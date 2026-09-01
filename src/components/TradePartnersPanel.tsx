import { useEffect, useState } from 'react';
import { fetchTradePartners } from '../api';
import type { TradePartnersData, TradeDirection, TradePartnerRow, TradeChapterRow } from '../types';
import { useCountry } from '../CountryContext';
import { freshnessOf, formatPeriod } from '../dataFreshness';
import { FreshnessNotice } from './FreshnessNotice';
import { freshnessLabelColor } from './freshnessStyle';
import { formatValue } from '../utils/formatValue';
import { list, finite } from '../utils/payload';
import { sentimentOf, sentimentColor, changeDescription, signed } from '../utils/polarity';

/**
 * Who Latvia trades with, and in what.
 *
 * The Trade tile has carried headline exports and imports from Eurostat since
 * it existed, and could never answer the two questions a reader asks next: to
 * whom, and of what. This answers both, from CSP's CN-8 customs dataset on
 * data.gov.lv — one of 647 live datasets on that portal, of which this repo
 * previously read five.
 *
 * The answer is worth having because it is not the one most people would
 * guess. **Latvia's two largest export markets are Lithuania and Estonia**, at
 * 330m and 194m EUR a month against Germany's 120m — the Baltic states trade
 * with each other far more than a map of Europe suggests. And the single
 * largest export chapter is **wood**, at 249m, ahead of electrical machinery.
 *
 * WHY THIS PANEL DOES NOT FOLLOW THE COUNTRY SELECTOR
 * ---------------------------------------------------
 * The source is a Latvian national dataset. It does not become Estonian when
 * the selector moves, and pretending otherwise would be the "figures under the
 * wrong heading" failure this codebase has already shipped once. So the panel
 * states Latvia in its own header, reads `countryOnly` from the payload rather
 * than assuming it, and says so explicitly when the reader is looking at
 * another country — the pattern `BusinessTile` already uses for the registries.
 *
 * DRAWN AS BARS RATHER THAN A CHART
 * ---------------------------------
 * Each claim is one share, and a bar that *is* the share needs no axis. It also
 * sidesteps the colour problem: every share is printed as a number beside its
 * bar, so colour carries nothing on its own (WCAG 2.2 SC 1.4.1).
 */

/** How many rows to draw. The API ranks more than this; the rest is the remainder. */
const SHOWN = 6;

/**
 * A partner's label, falling back to the raw code.
 *
 * Six of the codes the cube uses are Eurostat geonomenclature rather than ISO
 * 3166 — the UK is split across `XU` and `XI` after Brexit, and the `Q` codes
 * are the aggregates a statistician uses when a destination cannot be
 * attributed. The API returns `name: null` for anything it cannot name, and
 * this shows the code in brackets rather than inventing a country. A reader
 * seeing `[ZZ]` knows it is a code; a reader seeing a fabricated country name
 * does not know anything.
 */
function partnerLabel(row: TradePartnerRow): string {
  return row.name ?? `[${row.code}]`;
}

/** Same contract for a commodity chapter: the code, never a guess. */
function chapterLabel(row: TradeChapterRow): string {
  if (row.name) return row.name;
  return row.code ?? 'Unclassified';
}

/** A share as a percentage, or null. Never a confident zero for a missing one. */
function sharePct(share: number | null): number | null {
  const value = finite(share);
  return value === null ? null : value * 100;
}

function Bars({
  rows,
  otherEur,
  total,
  unit,
  label,
  describe,
}: {
  rows: { key: string; label: string; valueEur: number; share: number | null }[];
  otherEur: number | null;
  total: number | null;
  unit: string;
  label: string;
  describe: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
        {label} unavailable
      </p>
    );
  }

  // Scaled against the largest row rather than the total, so the smaller bars
  // stay legible. The printed percentage is always of the total, so the number
  // and the bar answer different questions and the number is the one that
  // carries the claim.
  const widest = Math.max(...rows.map((r) => r.valueEur));
  const otherPct = sharePct(total && otherEur !== null ? otherEur / total : null);

  return (
    <div className="space-y-2" role="img" aria-label={describe}>
      {rows.map((row) => {
        const pct = sharePct(row.share);
        return (
          <div key={row.key}>
            <div className="flex items-baseline justify-between gap-2 text-caption mb-1">
              <span className="truncate" style={{ color: 'var(--text-body)' }}>{row.label}</span>
              <span className="font-mono font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>
                {formatValue(row.valueEur, unit)}
                {pct === null ? '' : ` · ${pct.toFixed(1)}%`}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
              <div
                className="h-full transition-[width] duration-500"
                style={{
                  width: `${widest > 0 ? (row.valueEur / widest) * 100 : 0}%`,
                  background: 'var(--data-neutral)',
                }}
              />
            </div>
          </div>
        );
      })}
      {otherEur !== null && otherEur > 0 && (
        <p className="text-caption pt-1" style={{ color: 'var(--text-tertiary)' }}>
          Everything else {formatValue(otherEur, unit)}
          {otherPct === null ? '' : ` · ${otherPct.toFixed(1)}%`}
        </p>
      )}
    </div>
  );
}

function DirectionBlock({ side, indicatorId, unit }: { side: TradeDirection; indicatorId: string; unit: string }) {
  const partners = list<TradePartnerRow>(side.partners).slice(0, SHOWN);
  const chapters = list<TradeChapterRow>(side.chapters).slice(0, SHOWN);
  const lines = finite(side.lines);

  const change = side.previous ? finite(side.previous.changePct) : null;
  const sentiment = sentimentOf(indicatorId, change);
  // Three encodings, none optional: the glyph, the explicit sign, and a
  // description a screen reader reads out. Colour is the third of them and
  // never the only one — `--data-positive` and `--data-negative` sit at ΔE 8
  // under a deuteranopia simulation, so for roughly 8% of men the arrow is the
  // encoding. DESIGN.md §3.5.
  const glyph = change === null || change === 0 ? '' : change > 0 ? '\u25b2' : '\u25bc';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>
          {side.label}
        </p>
        <p className="text-lead font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
          {formatValue(side.totalEur, unit)}
        </p>
      </div>

      {side.previous && change !== null ? (
        <p className="text-caption mb-4" style={{ color: sentimentColor(sentiment) }}>
          <span aria-hidden="true">{glyph} </span>
          <span className="font-mono">{signed(`${Math.abs(change).toFixed(1)}%`, change)}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {' '}on {formatPeriod(side.previous.period)}
          </span>
          <span className="sr-only">
            {' '}
            {changeDescription(indicatorId, change)} against the same month a year earlier
          </span>
        </p>
      ) : (
        /* Omitted rather than approximated: the previous year is a separate
           upstream resource, and comparing against a different month would be
           a confident wrong number rather than a missing one. */
        <p className="text-caption mb-4" style={{ color: 'var(--text-tertiary)' }}>
          No year-earlier figure published
        </p>
      )}

      <p className="text-caption mb-2 tracking-widest uppercase" style={{ color: 'var(--text-tertiary)' }}>
        Top partners
      </p>
      <Bars
        rows={partners.map((p) => ({
          key: p.code,
          label: partnerLabel(p),
          valueEur: p.valueEur,
          share: p.share,
        }))}
        otherEur={side.otherPartnersEur}
        total={side.totalEur}
        unit={unit}
        label="Partner breakdown"
        describe={`${side.label} by partner: ${partners
          .map((p) => `${partnerLabel(p)} ${formatValue(p.valueEur, unit)}`)
          .join('; ')}`}
      />

      <p className="text-caption mb-2 mt-4 tracking-widest uppercase" style={{ color: 'var(--text-tertiary)' }}>
        Top commodities
      </p>
      <Bars
        rows={chapters.map((c) => ({
          key: c.code ?? chapterLabel(c),
          label: chapterLabel(c),
          valueEur: c.valueEur,
          share: c.share,
        }))}
        otherEur={side.otherChaptersEur}
        total={side.totalEur}
        unit={unit}
        label="Commodity breakdown"
        describe={`${side.label} by commodity chapter: ${chapters
          .map((c) => `${chapterLabel(c)} ${formatValue(c.valueEur, unit)}`)
          .join('; ')}`}
      />

      {/* The granularity behind the total. Called lines, not anything
          time-shaped, because it counts customs declarations lines and claims
          no unit — the same care `detect_record_extreme` takes when it says
          "across 14 observations". */}
      {lines !== null && (
        <p className="text-caption mt-3" style={{ color: 'var(--text-tertiary)' }}>
          Aggregated from {lines.toLocaleString('en-GB')} CN-8 customs lines
        </p>
      )}
    </div>
  );
}

export function TradePartnersPanel() {
  const { country } = useCountry();
  const [data, setData] = useState<TradePartnersData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTradePartners()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl p-4 animate-pulse h-96"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="h-3 rounded w-1/3 mb-4" style={{ background: 'var(--border-card)' }} />
        <div className="h-64 rounded" style={{ background: 'var(--border-card)' }} />
      </div>
    );
  }

  // A direction is only a direction if it names the month it describes.
  // `!data.exports` alone catches null and undefined and passes `{}` straight
  // through, which renders a block with an empty heading, `N/A` for a total and
  // two "unavailable" lists — a panel that looks broken rather than one that
  // says it has nothing. `list()` and `finite()` already make every inner read
  // safe; this decides whether there is anything worth drawing at all.
  const hasDirection = (side: TradeDirection | undefined | null) =>
    !!side && typeof side.period === 'string' && side.period.length > 0;

  if (!data || !hasDirection(data.exports) || !hasDirection(data.imports)) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center h-40"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Trade partner data unavailable
        </p>
      </div>
    );
  }

  // Judged on the period the API already chose — the older of the two
  // directions, which are separate upstream resources and can be a month
  // apart. Dating the panel by the leader would give the laggard a month it
  // never reached, which is the same reasoning `MaritimeTile` uses.
  const freshness = freshnessOf(data.dataAsOf);
  const balance = finite(data.balanceEur);
  // Read from the payload rather than restated here. Both were literals a
  // moment ago — `'EUR'` at five call sites and `'LV'` in the notice below —
  // which is two enumerations of one fact, and `AGENTS.md` is unambiguous that
  // two always drift. The API is the one that knows.
  const unit = typeof data.unit === 'string' && data.unit ? data.unit : 'EUR';
  const sourceCountry = typeof data.country === 'string' ? data.country : 'LV';

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <p className="text-callout font-semibold" style={{ color: 'var(--text-primary)' }}>
          Who Latvia trades with, and in what
        </p>
        <span className="text-caption" style={{ color: freshnessLabelColor(freshness) }}>
          {data.dataAsOf ? formatPeriod(data.dataAsOf) : 'period unknown'}
        </span>
      </div>
      <p className="text-caption mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Goods only, by partner country and Harmonised System chapter
        {data.periodsDiffer ? ' · the two directions have reached different months' : ''}
      </p>

      {/* This source is Latvia's, and says so rather than silently ignoring the
          selector. The same shape BusinessTile uses for the registries. */}
      {data.countryOnly && country !== sourceCountry && (
        <div className="mb-4 px-3 py-2 rounded-lg text-caption"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
          🇱🇻 Latvian customs data. This panel does not follow the country selector.
        </div>
      )}

      <FreshnessNotice freshness={freshness} className="mb-4" />

      {balance !== null && (
        <p className="text-caption mb-4" style={{ color: 'var(--text-body)' }}>
          Goods balance{' '}
          <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatValue(balance, unit)}
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {' '}· exports minus imports
            {/* Not graded. `trade_balance` abstains in src/utils/polarity.ts
                because it is derived from imports, which is not graded either:
                a deficit is consumption or it is investment. */}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DirectionBlock side={data.exports} indicatorId="exports" unit={unit} />
        <DirectionBlock side={data.imports} indicatorId="imports" unit={unit} />
      </div>

      <p className="text-caption mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Source: {data.source} · monthly
      </p>
    </div>
  );
}
