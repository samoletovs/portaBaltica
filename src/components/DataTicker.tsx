import { useState, useEffect } from 'react';

interface TickerItem {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
}

export function DataTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    // Fetch economy data for ticker values
    fetch('/api/economy-data')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const tickers: TickerItem[] = [];

        // Electricity
        tickers.push({
          label: 'Electricity',
          value: `€${d.electricityCurrent.toFixed(2)}/MWh`,
          positive: d.electricityCurrent >= 0,
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
            positive: ind.change?.startsWith('+'),
          });
        });

        // VAT businesses
        tickers.push({ label: 'VAT businesses', value: d.businessPulse.newVatRegistrations.toLocaleString() });

        setItems(tickers);
      })
      .catch(() => {});
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden" style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div className="ticker-track flex items-center gap-8 py-1.5 whitespace-nowrap">
        {/* Duplicate items for seamless loop */}
        {[...items, ...items].map((item, i) => (
          <span key={i} className="flex items-center gap-1.5 text-xs font-mono shrink-0">
            <span style={{ color: 'var(--text-tertiary)' }}>{item.label}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.value}</span>
            {item.change && (
              <span style={{ color: item.positive ? '#059669' : '#dc2626', fontSize: '10px' }}>
                {item.change}
              </span>
            )}
            <span style={{ color: 'var(--border-card)', margin: '0 4px' }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
