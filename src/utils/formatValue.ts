/** Format a numeric value based on its unit string (from Eurostat or PxWeb). */
export function formatValue(v: number | null, unit: string): string {
  if (v === null) return 'N/A';
  if (unit === 'EUR/month') return `€${Math.round(v).toLocaleString()}`;
  if (unit === 'EUR/hour') return `€${v.toFixed(1)}/h`;
  if (unit === 'persons') {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    return Math.round(v).toLocaleString();
  }
  if (unit === 'M EUR') {
    if (Math.abs(v) >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
    return `€${Math.round(v).toLocaleString()}`;
  }
  if (unit === 'MIO_EUR') return `€${Math.round(v).toLocaleString()}M`;
  if (unit === 'thousands') return Math.round(v).toLocaleString();
  if (unit.startsWith('index')) return v.toFixed(1);
  if (unit === 'per 1000') return Math.round(v).toLocaleString();
  if (unit === 'EUR') return `€${Math.round(v).toLocaleString()}`;
  if (unit === 'EUR/kWh') return `€${v.toFixed(4)}`;
  if (unit === 'GWh') return `${Math.round(v).toLocaleString()} GWh`;
  if (unit === 'years') return v.toFixed(1);
  if (unit.startsWith('%')) return `${v.toFixed(1)}%`;
  if (unit === 'balance') return v.toFixed(1);
  // Fallback
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  return v.toFixed(1);
}
