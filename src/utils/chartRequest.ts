import { fetchBalticCompare, type BalticCompareData } from '../api';

/** An explicit retry must recheck even a cached, successful-but-empty response. */
export async function fetchChartComparison(
  indicator: string,
  years: number,
  refresh = false,
): Promise<BalticCompareData | null> {
  return fetchBalticCompare(indicator, years, { forceRefresh: refresh });
}
