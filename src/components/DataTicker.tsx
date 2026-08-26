import { useState, useEffect } from 'react';
import { useCountry } from '../CountryContext';

interface TickerItem {
  label: string;
  value: string;
  change?: string;
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

        // Electricity
        tickers.push({
          label: 'Electricity',
          value: `€${d.electricityCurrent.toFixed(2)}/MWh`,
        });

        // Top exchange rates
        if (d.exchangeRates?.length > 0) {
          d.exchangeRates.slice(0, 4).forEach((r: { currency: string; rate: number }) => {
            tickers.push({ label: `EUR/${r.currency}`, value: r.rate.toFixed(4) });
          });
        }

        // Indicators
        d.indicators?.forEach((ind: { label: string; value: string; change?: string }) => {
          tickers.push({
            label: ind.label,
            value: ind.value,
            change: ind.change,
          });
        });

        // Registry counts — omitted entirely when the portal could not answer,
        // rather than scrolling past as a fabricated zero.
        if (typeof d.businessPulse?.activeVatPayers === 'number') {
          tickers.push({ label: 'VAT businesses', value: d.businessPulse.activeVatPayers.toLocaleString() });
        }
        if (typeof d.businessPulse?.suspendedBusinesses === 'number') {
          tickers.push({ label: 'Suspended', value: d.businessPulse.suspendedBusinesses.toLocaleString() });
        }

        setItems(tickers);
      })
      .catch(() => {});
  }, [country]);

  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden" style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div className="ticker-track flex items-center gap-8 py-2 whitespace-nowrap">
          {[...items, ...items].map((item, i) => (
            <span key={i} className="flex items-center gap-2 text-caption font-mono shrink-0">
              <span style={{ color: 'var(--text-tertiary)' }}>{item.label}</span>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
              {/* The delta carries its own sign, and the ticker cannot know
                  whether a rise in an arbitrary indicator is good news, so it
                  does not pretend to. It used to colour every `+` green — in a
                  light-theme green, on a dark background. See DESIGN.md §3.5. */}
              {item.change && (
                <span style={{ color: 'var(--text-secondary)' }}>{item.change}</span>
              )}
              <span aria-hidden="true" style={{ color: 'var(--border-card)' }}>·</span>
            </span>
          ))}
      </div>
    </div>
  );
}
