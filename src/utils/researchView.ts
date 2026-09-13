import { YEAR_OPTIONS, type YearRange } from '../FilterContext';

export function researchYears(value: string | null): YearRange | undefined {
  return YEAR_OPTIONS.find(years => String(years) === value);
}

export function researchPermalink(id: string, country: string, years: YearRange, view: 'chart' | 'table', period?: string): string {
  const params = new URLSearchParams({ country, years: String(years), view });
  if (period) params.set('period', period);
  return `/indicator/${encodeURIComponent(id)}?${params.toString()}`;
}
