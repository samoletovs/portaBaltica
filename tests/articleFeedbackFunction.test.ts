import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/article-feedback/index.js') as (
  context: { res?: { status: number; body: string; headers: Record<string, string> }; log?: { error: (...args: unknown[]) => void } },
  req: { method: string; headers: Record<string, string>; body?: unknown; query?: Record<string, string> },
) => Promise<void>;
const limiter = require('../api/shared/rateLimit.js') as { reset: () => void; getStats: () => { limitPerMin: number } };
const binding = require('../api/article-feedback/function.json') as { bindings: { type: string; methods?: string[] }[] };
const fetcher = vi.fn<typeof fetch>();
const id = '485b4dad-b281-4a69-aab5-612ef5ab76ad';
const summary = { available: false, count: null, average: null };
const payload = { id, slug: 'test-article', kind: 'comment', rating: 5, message: 'Useful report.', contact: null };

async function call(body: unknown = payload, method = 'POST', contentType = 'application/json', query: Record<string, string> = {}) {
  const context = { res: undefined as undefined | { status: number; body: string; headers: Record<string, string> }, log: { error: vi.fn() } };
  await handler(context, { method, headers: { 'content-type': contentType }, body, query });
  if (!context.res) throw new Error('No response');
  return { ...context.res, value: JSON.parse(context.res.body) as Record<string, unknown>, log: context.log.error };
}

beforeEach(() => {
  limiter.reset();
  fetcher.mockReset().mockResolvedValue(Response.json({ ok: true, id, rating: 5, summary }, { status: 202 }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { limiter.reset(); vi.unstubAllGlobals(); });

describe('the feedback relay', () => {
  it('has a real POST binding and only acknowledges the matching durable receipt', async () => {
    expect(binding.bindings.find(item => item.type === 'httpTrigger')?.methods).toEqual(['get', 'post']);
    const result = await call({ ...payload, ip: 'do-not-forward', user_agent: 'do-not-forward' });
    expect(result.status).toBe(200);
    expect(result.value).toEqual({ ok: true, id, summary });
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.headers['X-Content-Type-Options']).toBe('nosniff');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://portabaltica-func.azurewebsites.net/api/article-feedback');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify(payload) });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns only a validated aggregate for a reader-facing article', async () => {
    const aggregate = { available: true, count: 5, average: 4.2 };
    fetcher.mockResolvedValue(Response.json(aggregate, { status: 200 }));
    const result = await call(undefined, 'GET', 'application/json', { slug: 'test-article' });
    expect(result.status).toBe(200);
    expect(result.value).toEqual(aggregate);
    expect(fetcher.mock.calls[0][0]).toBe('https://portabaltica-func.azurewebsites.net/api/article-feedback?slug=test-article');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it('rejects an incomplete public summary', async () => {
    fetcher.mockResolvedValue(Response.json({ available: true, count: 1, average: 5 }, { status: 200 }));
    const result = await call(undefined, 'GET', 'application/json', { slug: 'test-article' });
    expect(result.status).toBe(503);
  });

  it('never relays private fields alongside a rating summary', async () => {
    fetcher.mockResolvedValue(Response.json({
      available: true, count: 5, average: 4.2, message: 'private comment',
    }, { status: 200 }));
    const result = await call(undefined, 'GET', 'application/json', { slug: 'test-article' });
    expect(result.status).toBe(503);
    expect(result.body).not.toContain('private comment');
  });

  it.each([
    [202, { ok: true, id: 'wrong' }],
    [202, { ok: false, id }],
    [200, { ok: true, id }],
    [500, { error: 'internal detail' }],
  ])('refuses an unconfirmed receipt: HTTP %s, %j', async (status, body) => {
    fetcher.mockResolvedValue(Response.json(body, { status }));
    const result = await call();
    expect(result.status).toBe(503);
    expect(result.log).toHaveBeenCalledOnce();
  });

  it('does not accept HTML or a network failure as a receipt', async () => {
    fetcher.mockResolvedValueOnce(new Response('<html>fallback</html>', { status: 202 }));
    expect((await call()).status).toBe(503);
    fetcher.mockRejectedValueOnce(new Error('network failed'));
    expect((await call()).status).toBe(503);
  });

  it.each([400, 404, 409, 413, 415, 429, 503])('preserves a bounded service refusal: %i', async status => {
    fetcher.mockResolvedValue(Response.json({ error: 'Please retry later.' }, { status, headers: { 'Retry-After': '60' } }));
    const result = await call();
    expect(result.status).toBe(status);
    expect(result.headers['Retry-After']).toBe('60');
    expect(result.headers['Cache-Control']).toBe('no-store');
  });

  it.each([
    ['broken', 'POST', 'application/json', 400],
    [[], 'POST', 'application/json', 400],
    [payload, 'PUT', 'application/json', 405],
    [payload, 'POST', 'text/plain', 415],
    ['x'.repeat(16385), 'POST', 'application/json', 413],
  ])('rejects invalid envelope %# before forwarding', async (body, method, type, status) => {
    expect((await call(body, method as string, type as string)).status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('charges the existing per-client limit exactly once per attempt', async () => {
    for (let count = 0; count < limiter.getStats().limitPerMin; count++) {
      fetcher.mockResolvedValueOnce(Response.json({ ok: true, id, rating: 5, summary }, { status: 202 }));
      expect((await call()).status).toBe(200);
    }
    expect((await call()).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(limiter.getStats().limitPerMin);
  });
});
