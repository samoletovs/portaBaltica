import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLivePage, waitForLiveRateWindow } from './liveHttp';

const pause = vi.hoisted(() => vi.fn<(ms: number) => Promise<void>>());
vi.mock('node:timers/promises', () => ({ setTimeout: pause, default: { setTimeout: pause } }));

const URL = 'https://portabaltica.example/article/canonical-check';
const request = vi.fn<typeof fetch>();

beforeEach(() => {
  request.mockReset();
  pause.mockReset();
  pause.mockResolvedValue();
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live HTTP checks respect the production rate limit without hiding failures', () => {
  it('waits out the complete request window before a new browser dashboard burst', async () => {
    await waitForLiveRateWindow();
    expect(pause).toHaveBeenCalledExactlyOnceWith(60_250);
    expect(request).not.toHaveBeenCalled();
  });

  it('waits through a full Retry-After window before checking the actual retried page', async () => {
    request
      .mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'Retry-After': '60' } }))
      .mockResolvedValueOnce(new Response('<link rel="canonical" href="https://source.example/">'));

    const page = await fetchLivePage(URL);

    expect(pause).toHaveBeenCalledExactlyOnceWith(60_250);
    expect(request).toHaveBeenCalledTimes(2);
    expect(pause.mock.invocationCallOrder[0]).toBeGreaterThan(request.mock.invocationCallOrder[0]);
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[1]);
    expect(page.status).toBe(200);
    expect(page.body).toContain('href="https://source.example/"');
  });

  it('does not retry before the cooldown has finished', async () => {
    let release = () => {};
    let entered = () => {};
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    pause.mockImplementation(() => {
      entered();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    request
      .mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response('ready'));
    const reading = fetchLivePage(URL);
    await waiting;

    expect(pause).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    release();
    expect((await reading).body).toBe('ready');
  });

  it('accepts an HTTP-date Retry-After within the same bounded window', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('Sat, 05 Sep 2026 06:00:00 GMT'));
    request
      .mockResolvedValueOnce(new Response('limited', {
        status: 429,
        headers: { 'Retry-After': 'Sat, 05 Sep 2026 06:00:02 GMT' },
      }))
      .mockResolvedValueOnce(new Response('ready'));

    await fetchLivePage(URL);

    expect(pause).toHaveBeenCalledExactlyOnceWith(2250);
  });

  it.each([null, '', 'invalid', '-1', '61', 'Infinity'])(
    'keeps a 429 visible when Retry-After is missing, invalid or excessive: %s',
    async (retryAfter) => {
      request.mockResolvedValue(new Response('still limited', {
        status: 429,
        headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
      }));

      const page = await fetchLivePage(URL);

      expect(page.status).toBe(429);
      expect(page.body).toBe('still limited');
      expect(request).toHaveBeenCalledOnce();
      expect(pause).not.toHaveBeenCalled();
    },
  );

  it('returns persistent throttling after exactly one retry', async () => {
    request.mockImplementation(async () => new Response('still limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    }));

    const page = await fetchLivePage(URL);

    expect(page.status).toBe(429);
    expect(page.body).toBe('still limited');
    expect(request).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledOnce();
  });

  it.each([404, 500, 503])('does not disguise HTTP %s as a transient rate limit', async (status) => {
    request.mockResolvedValue(new Response('real failure', {
      status,
      headers: { 'Retry-After': '1' },
    }));

    expect((await fetchLivePage(URL)).status).toBe(status);
    expect(request).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
  });

  it('propagates transport failures and gives every real request a deadline', async () => {
    request.mockRejectedValue(new Error('connection failed'));

    await expect(fetchLivePage(URL)).rejects.toThrow('connection failed');
    expect(request).toHaveBeenCalledExactlyOnceWith(URL, {
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    });
    expect(pause).not.toHaveBeenCalled();
  });
});
