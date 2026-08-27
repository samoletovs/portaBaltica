import { useState, useEffect } from 'react';
import { useCountry } from '../CountryContext';
import { changeDescription, sentimentColor, sentimentOf } from '../utils/polarity';
import { finite, list } from '../utils/payload';

interface TickerItem {
  label: string;
  value: string;
  /** The indicator id `polarity.ts` knows this series by, where we know it. */
  indicator?: string;
  /** The API's preformatted delta, e.g. "+0.3pp". */
  change?: string;
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

export function DataTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const { country } = useCountry();

  useEffect(() => {
    // Fetch economy data for ticker values
    fetch(`/api/economy-data?country=${country.toLowerCase()}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const tickers: TickerItem[] = [];

        // One absent field used to cost the whole ticker. `electricityCurrent`
        // was read as `d.electricityCurrent.toFixed(2)` inside this `.then`,
        // so a payload without it threw, the `.catch` below swallowed the
        // throw, and every *other* item — the rates, the four indicators —
        // was silently dropped with it. The ticker did not look broken; it
        // looked like there was no data.
        const electricity = finite(d.electricityCurrent);
        if (electricity !== null) {
          tickers.push({ label: 'Electricity', value: `€${electricity.toFixed(2)}/MWh` });
        }

        // Top exchange rates
        for (const r of list<{ currency: string; rate: unknown }>(d.exchangeRates).slice(0, 4)) {
          const rate = finite(r.rate);
          if (rate !== null) tickers.push({ label: `EUR/${r.currency}`, value: rate.toFixed(4) });
        }

        // Indicators
        for (const ind of list<{ label: string; value: string; change?: string }>(d.indicators)) {
          tickers.push({
            label: ind.label,
            value: ind.value,
            indicator: INDICATOR_BY_LABEL[ind.label],
            change: ind.change,
          });
        }

        // The registry counts used to scroll past here — "VAT businesses
        // 84,748", "Suspended 3,693" — with no unit, no direction and no
        // comparison. A ticker is for things that move, and those two are
        // steady-state totals that have been the same order of magnitude for
        // years. They are still on the Economy tile, in context and beside
        // their source, which is where a number without a delta belongs.

        setItems(tickers);
      })
      .catch(() => {});
  }, [country]);

  if (items.length === 0) return null;

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
              <span key={i} className="flex items-center gap-2 text-caption font-mono shrink-0">
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
