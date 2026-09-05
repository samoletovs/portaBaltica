import { useState, useCallback } from 'react';
import { useCountry } from '../CountryContext';
import { changeDescription, sentimentColor, sentimentOf } from '../utils/polarity';
import { finite, list } from '../utils/payload';
import { fetchEconomyData } from '../api';
import { usePriceRefresh } from '../hooks/usePriceRefresh';

interface TickerItem {
  label: string;
  value: string;
  /** The indicator id `polarity.ts` knows this series by, where we know it. */
  indicator?: string;
  /** The API's preformatted delta, e.g. "+0.3pp". */
  change?: string;
  retrievedAt?: string;
}

/**
 * The economy endpoint labels its four indicators for display and does not
 * send an id, so the ticker maps the labels it publishes back onto the ids
 * `polarity.ts` reasons about. A label it does not recognise simply gets no
 * colour, which is the safe direction to fail in: an unknown series is drawn
 * neutral rather than confidently miscoloured.
 */
const INDICATOR_BY_LABEL: Record<string, string> = {
  'GDP Growth': 'gdp',
  'Avg Salary': 'salary',
  'CPI Inflation': 'cpi',
  Unemployment: 'unemployment',
};

/** The signed magnitude inside a preformatted delta like "+0.3pp" or "-1.2%". */
function magnitudeOf(change: string): number | null {
  const parsed = Number.parseFloat(change.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A delta as the rest of the site writes one: a real minus sign rather than a
 * hyphen, which is narrower than a digit and breaks column alignment even in a
 * tabular face (DESIGN.md §3.7).
 */
function withRealMinus(change: string): string {
  return change.replace(/^-/, '\u2212');
}

/**
 * Build ticker items from a list, letting each entry fail on its own.
 *
 * The guard is here, at the boundary, rather than repeated at every read
 * inside every builder — which is the same conclusion the other sessions
 * reached with `withSecurity` and `valueAt` on the same day.
 *
 * `list()` validates the *container* and casts the *contents*, so an array
 * carrying a `null` reaches the builder and `entry.label` throws. Wrapping the
 * whole loop would still cost every later entry; wrapping each entry costs
 * exactly the one that could not be read.
 */
function tickerItems<T>(source: T[], build: (entry: T) => TickerItem | null): TickerItem[] {
  return source.flatMap((entry) => {
    try {
      const item = build(entry);
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}

export function DataTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  /**
   * Whether the fetch has finished, either way.
   *
   * `items.length === 0` used to mean two different things — *not asked yet*
   * and *nothing to show* — and the component collapsed for both. So on every
   * route the ticker was absent for the first ~800ms and 35px tall afterwards,
   * and the whole page below it moved down by 35px when the data landed.
   *
   * Measured against production at 2026-09-02T10:2xZ, the worst shift on
   * `/data/property` and `/data/energy` was `div.mx-auto.max-w-7xl` going
   * `100,800 -> 135,765` — the entire page container, 35px, at 850-919ms:
   *
   *     /data/property   CLS 0.3523  POOR
   *     /data/energy     CLS 0.1168
   *     every other route carried the same 0.0243 floor
   *
   * Separating the two states lets the strip hold its place while we do not
   * know, and still disappear once we do. Collapsing on a genuinely dead feed
   * is deliberate: a ticker with nothing in it is 35px of chrome asserting
   * that there is data.
   */
  const [settled, setSettled] = useState(false);
  const { country } = useCountry();

  const refresh = useCallback(async (signal: AbortSignal, initial: boolean) => {
    if (initial) { setItems([]); setSettled(false); }
    else setItems(previous => previous.filter(item => item.indicator !== 'electricity_price'));
    try {
        const d = await fetchEconomyData(country.toLowerCase(), signal);
        if (signal.aborted || !d) return;

        // One absent field used to cost the whole ticker. `electricityCurrent`
        // was read as `d.electricityCurrent.toFixed(2)` inside this `.then`,
        // so a payload without it threw, the `.catch` below swallowed the
        // throw, and every *other* item — the rates, the four indicators —
        // was silently dropped with it. The ticker did not look broken; it
        // looked like there was no data.
        //
        // #100 fixed those reads with `finite()` and `list()`. It did not
        // change the **scope**, and the scope is the defect: this one `.then`
        // still builds three independent things behind one `.catch`, so the
        // next unguarded read has the same blast radius. Measured, it still
        // did — a single `null` inside `d.indicators` emptied the entire
        // ticker, rates included.
        //
        // So the unit of failure is now the **item**. An entry that cannot be
        // read costs that entry and nothing else, which is what "independent"
        // meant all along. `Header` and `DataTicker` render above every route
        // including the newsroom (DESIGN.md §3.9), so this chain's blast
        // radius is the whole site.
        setItems([
          ...tickerItems<unknown>([d.electricityCurrent], (value) => {
            const electricity = finite(value);
            return electricity === null
              ? null
              : {
                label: d.priceSchedule?.stale ? 'Electricity (last-good schedule)' : 'Electricity',
                value: `€${electricity.toFixed(2)}/MWh`, indicator: 'electricity_price',
                retrievedAt: d.priceSchedule?.retrievedAt ?? d.fetchedAt,
              };
          }),
          ...tickerItems<{ currency: string; rate: unknown }>(
            list<{ currency: string; rate: unknown }>(d.exchangeRates).slice(0, 4),
            (r) => {
              const rate = finite(r.rate);
              return rate === null ? null : { label: `EUR/${r.currency}`, value: rate.toFixed(4) };
            },
          ),
          ...tickerItems<{ label: string; value: string; change?: string }>(
            list<{ label: string; value: string; change?: string }>(d.indicators),
            (ind) => ({
              label: ind.label,
              value: ind.value,
              indicator: INDICATOR_BY_LABEL[ind.label],
              change: ind.change,
            }),
          ),
        ]);

        // The registry counts used to scroll past here — "VAT businesses
        // 84,748", "Suspended 3,693" — with no unit, no direction and no
        // comparison. A ticker is for things that move, and those two are
        // steady-state totals that have been the same order of magnitude for
        // years. They are still on the Economy tile, in context and beside
        // their source, which is where a number without a delta belongs.
    } catch { /* Keep independent ticker items, never a previous-interval price. */ }
    finally { if (!signal.aborted) setSettled(true); }
  }, [country]);
  usePriceRefresh(refresh);

  if (items.length === 0) {
    // Nothing to show, and we know it: collapse rather than hold 35px of
    // chrome open around an empty strip.
    if (settled) return null;

    // Not known yet. Hold the place with the same box — same viewport, same
    // track, same `py-2`, same `text-caption font-mono` line — so the height
    // is whatever the real strip's height is, rather than a number copied out
    // of a measurement that will rot the first time the type scale moves.
    return (
      <div
        className="ticker-viewport edge-fade-x"
        style={{ borderBottom: '1px solid var(--border-card)' }}
        aria-hidden="true"
      >
        <div className="ticker-track flex items-center gap-8 py-2 whitespace-nowrap">
          <span className="text-caption font-mono">&nbsp;</span>
        </div>
      </div>
    );
  }

  return (
    /* The ticker duplicates its item list so the marquee can loop seamlessly,
       which means a screen reader would read every value twice. It is also
       purely decorative: every figure in it appears again, in context and with
       its source, in the tiles below. So it is hidden from assistive
       technology entirely rather than announced once. */
    <div
      className="ticker-viewport edge-fade-x"
      style={{ borderBottom: '1px solid var(--border-card)' }}
      aria-hidden="true"
    >
      <div className="ticker-track flex items-center gap-8 py-2 whitespace-nowrap">
          {[...items, ...items].map((item, i) => {
            // Direction is meaning, not arithmetic. The ticker used to render
            // every delta in flat grey because it could not tell whether a
            // rise was good news — true when it was written, and untrue since
            // `polarity.ts` arrived: the indicator cards have read direction
            // by meaning for some time and the ticker was simply never given
            // the same treatment. It flips on the `lower-better` series, so
            // rising inflation is red and falling unemployment is green.
            //
            // The colour is the third encoding and never the first. The arrow
            // and the sign carry the direction on their own, which matters
            // because our green and red sit ΔE 8 apart under a deuteranopia
            // simulation — indistinguishable for roughly 8% of men.
            const magnitude = item.change ? magnitudeOf(item.change) : null;
            const sentiment = item.indicator ? sentimentOf(item.indicator, magnitude) : 'none';
            return (
              <span key={i} className="flex items-center gap-2 text-caption font-mono shrink-0"
                title={item.retrievedAt ? `Schedule retrieved ${item.retrievedAt}` : undefined}>
                <span style={{ color: 'var(--text-tertiary)' }}>{item.label}</span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
                {item.change && (
                  <span style={{ color: sentimentColor(sentiment) }}>
                    {magnitude !== null && magnitude !== 0 && (
                      <span>{magnitude > 0 ? '▲' : '▼'}</span>
                    )}
                    {withRealMinus(item.change)}
                    {item.indicator && (
                      <span className="sr-only"> {changeDescription(item.indicator, magnitude)}</span>
                    )}
                  </span>
                )}
              </span>
            );
          })}
      </div>
    </div>
  );
}
