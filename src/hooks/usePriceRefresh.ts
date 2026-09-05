import { useEffect } from 'react';
import { PRICE_INTERVAL_MS, priceInterval } from '../utils/priceFreshness';

/** Only foreground delivery boundaries and resume events trigger requests. */
export function usePriceRefresh(refresh: (signal: AbortSignal, initial: boolean) => Promise<void>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let pending = false;
    let requestedInterval = -1;
    let initial = true;

    function cancel() {
      clearTimeout(timer);
      controller?.abort();
    }

    async function run() {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') { cancel(); return; }
      timer = setTimeout(() => { void run(); }, PRICE_INTERVAL_MS - Date.now() % PRICE_INTERVAL_MS);
      if (pending && !controller?.signal.aborted && requestedInterval === priceInterval()) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      requestedInterval = priceInterval();
      pending = true;
      const first = initial;
      initial = false;
      try { await refresh(request.signal, first); }
      finally { if (controller === request) pending = false; }
    }

    function resume() { void run(); }
    void run();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [refresh]);
}
