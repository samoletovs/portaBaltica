import { setTimeout as sleep } from 'node:timers/promises';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 60_000;
const WINDOW_MARGIN_MS = 250;

// Two bounded requests plus one full rate-limit window. Do not replay a whole
// population sweep on assertion failure: the reader handles its own one retry.
export const LIVE_HTTP_TEST_OPTIONS = { timeout: 95_000, retry: 0 } as const;

export interface LivePage {
  status: number;
  headers: Headers;
  body: string;
}

function retryDelay(value: string | null): number | null {
  if (value === null) return null;
  const header = value.trim();
  let delay: number;
  if (/^\d+$/.test(header)) {
    delay = Number(header) * 1000;
  } else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) {
    delay = Math.max(0, Date.parse(header) - Date.now());
  } else {
    return null;
  }
  return Number.isFinite(delay) && delay <= MAX_RETRY_AFTER_MS ? delay : null;
}

/**
 * Read the real response, allowing one server-directed rate-limit cooldown.
 * All other HTTP failures, bad payloads and transport errors remain failures
 * for the caller's assertions; persistent throttling remains a visible 429.
 */
export async function fetchLivePage(url: string): Promise<LivePage> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const page = {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
    if (page.status !== 429 || attempt === 1) return page;

    const delay = retryDelay(page.headers.get('retry-after'));
    if (delay === null) return page;
    console.warn(`[live-http] ${url}: HTTP 429; retrying once after ${delay + WINDOW_MARGIN_MS}ms`);
    await sleep(delay + WINDOW_MARGIN_MS);
  }
}
