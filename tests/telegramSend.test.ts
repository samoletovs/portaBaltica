/** @vitest-environment node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, renderText } from '../scripts/source-alert.mjs';
import { sendTelegramMessage, splitTelegramMessage } from '../scripts/telegram-send.mjs';

const require = createRequire(import.meta.url);
const registry: { CHECKS: { name: string; powers: string; required: boolean }[] } =
  require('../api/shared/statusChecks.js');
const RUN_URL = 'https://github.com/samoletovs/portaBaltica/actions/runs/34028865632';

function fullOutage() {
  const checks = registry.CHECKS.map(check => ({
    ...check, status: 'unhealthy', freshness: 'unknown', latency: 6203,
    error: `Deadline 3000ms exceeded for ${check.name}: ${'x'.repeat(240)}`,
  }));
  const required = checks.filter(check => check.required).length;
  const verdict = evaluate({
    status: 'unhealthy',
    fetchedAt: '2026-09-07T07:30:00.000Z',
    dataSources: {
      total: checks.length, healthy: 0, stale: 0,
      requiredTotal: required, requiredHealthy: 0,
      optionalTotal: checks.length - required, optionalHealthy: 0,
      checks,
    },
  }, { now: '2026-09-07T07:30:00.000Z' });
  return { verdict, text: `${renderText(verdict)}\n\n${RUN_URL}\n` };
}

function reassemble(messages: string[]) {
  return messages.length === 1 ? messages[0]
    : messages.map(message => message.replace(/^\[\d+\/\d+\] /, '')).join('');
}

describe('plain-text Telegram delivery', () => {
  it('delivers every fleet outage problem, optional note, diagnostic and run link', async () => {
    const { verdict, text } = fullOutage();
    expect(text.length).toBeGreaterThan(4096);
    const sent: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string; parse_mode?: string };
      sent.push(body.text);
      expect(body.text.length).toBeLessThanOrEqual(4096);
      expect(body.parse_mode).toBeUndefined();
      return new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 });
    });

    expect(await sendTelegramMessage(text, { token: 'test-only', chatId: 'test-chat', fetchImpl }))
      .toBeGreaterThan(1);
    for (const [, init] of fetchImpl.mock.calls) expect(init?.redirect).toBe('error');
    expect(reassemble(sent)).toBe(text);
    for (const detail of [...verdict.problems, ...verdict.notes]) {
      expect(sent.some(message => message.includes(detail)), detail).toBe(true);
    }
    for (const check of registry.CHECKS) expect(reassemble(sent)).toContain(check.name);
    expect(sent.at(-1)).toContain(RUN_URL);
  });

  it.each([1, 4095, 4096])('leaves a short %i-character report unchanged', size => {
    const text = 'x'.repeat(size);
    expect(splitTelegramMessage(text)).toEqual([text]);
  });

  it('splits oversized lines without losing Unicode, whitespace, or the rehearsal heading', () => {
    const text = '*** REHEARSAL - NOT A REAL ALERT ***\n' + '🙂'.repeat(5000) + '\n\n';
    const messages = splitTelegramMessage(text);
    expect(messages[0].split('\n')[0]).toContain('REHEARSAL');
    expect(reassemble(messages)).toBe(text);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });

  it('fails rather than reporting delivery when a later part is rejected', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":false}', { status: 429 }));
    await expect(sendTelegramMessage('x'.repeat(5000), {
      token: 'test-only', chatId: 'test-chat', fetchImpl,
    })).rejects.toThrow('part 2/2: HTTP 429');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a success without a message receipt without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await expect(sendTelegramMessage('alert', {
      token: 'test-only', chatId: 'test-chat', fetchImpl,
    })).rejects.toThrow('message receipt');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, {}, { message_id: null }, { message_id: 0 }, { message_id: -1 },
    { message_id: 1.5 }, { message_id: '1' }, { message_id: true },
  ])('rejects malformed successful receipts without retrying: %j', async result => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    await expect(sendTelegramMessage('alert', {
      token: 'test-only', chatId: 'test-chat', fetchImpl,
    })).rejects.toThrow('message receipt');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops after a later part lacks a receipt without retrying or sending the remainder', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await expect(sendTelegramMessage('x'.repeat(9000), {
      token: 'test-only', chatId: 'test-chat', fetchImpl,
    })).rejects.toThrow('part 2/3: missing or invalid message receipt');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => Promise.resolve(new Response('{"ok":false}', { status: 200 })),
    () => Promise.resolve(new Response('not JSON', { status: 200 })),
    () => Promise.resolve(new Response('{"ok":true,"result":{"message_id":1}}', { status: 302 })),
    () => Promise.reject(new Error('network failure with secret-token in the URL')),
  ])('fails closed on a refused or unreadable send without exposing credentials', async fail => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(fail);
    await expect(sendTelegramMessage('alert', {
      token: 'secret-token', chatId: 'test-chat', fetchImpl,
    })).rejects.toThrow(/Telegram sendMessage failed for part 1\/1(?!.*secret-token)/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never calls the network with missing credentials or an empty message', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendTelegramMessage('alert', { token: '', chatId: '', fetchImpl }))
      .rejects.toThrow('credentials');
    await expect(sendTelegramMessage(' \n', { token: 'test-only', chatId: 'test-chat', fetchImpl }))
      .rejects.toThrow('empty');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
