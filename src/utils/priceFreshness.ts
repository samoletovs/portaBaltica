export const PRICE_INTERVAL_MS = 15 * 60_000;

export function priceInterval(at = Date.now()): number {
  return Math.floor(at / PRICE_INTERVAL_MS);
}

export function isCurrentPriceTime(time: unknown): boolean {
  if (typeof time !== 'string') return false;
  const start = Date.parse(time);
  const now = Date.now();
  return Number.isFinite(start) && start <= now && priceInterval(start) === priceInterval(now);
}
