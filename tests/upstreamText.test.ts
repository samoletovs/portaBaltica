import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const https: {
  get: (url: string, options: unknown, callback: (response: PassThrough & { statusCode: number }) => void) => EventEmitter;
} = require('node:https');
const es: {
  httpText: (url: string) => Promise<string>;
  httpJson: (url: string) => Promise<unknown>;
} = require('../api/shared/eurostat.js');
const newsroom: { jsonGet: (url: string) => Promise<unknown> } = require('../api/shared/newsroom.js');

const value = { label: 'R\u012bga \u20ac \u{1f9ed}', reading: 0, missing: null };
const text = JSON.stringify(value);
const bytes = Buffer.from(text, 'utf8');

function serve(chunks: Buffer[], statusCode = 200) {
  vi.spyOn(https, 'get').mockImplementation((_url, _options, callback) => {
    const request = Object.assign(new EventEmitter(), { destroy() {} });
    queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), { statusCode });
      callback(response);
      for (const chunk of chunks) response.write(chunk);
      response.end();
    });
    return request;
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe.each([
  { name: 'shared text', read: es.httpText, expected: text },
  { name: 'shared JSON', read: es.httpJson, expected: value },
  { name: 'published article JSON', read: newsroom.jsonGet, expected: value },
])('$name preserves the source across UTF-8 chunk boundaries', ({ read, expected }) => {
  it('reads a complete response as a positive control', async () => {
    serve([bytes]);
    expect(await read('https://fixture.invalid/source')).toEqual(expected);
  });

  it('preserves every possible two-chunk split, including inside a code point', async () => {
    for (let split = 1; split < bytes.length; split++) {
      serve([bytes.subarray(0, split), bytes.subarray(split)]);
      expect(await read('https://fixture.invalid/source'), `split at byte ${split}`).toEqual(expected);
      vi.restoreAllMocks();
    }
  });

  it('preserves a response arriving one byte at a time', async () => {
    serve(Array.from(bytes, byte => Buffer.from([byte])));
    expect(await read('https://fixture.invalid/source')).toEqual(expected);
  });
});

it('preserves the article reader 404 distinction', async () => {
  serve([], 404);
  expect(await newsroom.jsonGet('https://fixture.invalid/absent')).toBeNull();
  await expect(es.httpJson('https://fixture.invalid/absent')).rejects.toThrow('HTTP 404');
});

it('does not share an unfinished code point between simultaneous responses', async () => {
  const first = Object.assign(new PassThrough(), { statusCode: 200 });
  const second = Object.assign(new PassThrough(), { statusCode: 200 });
  vi.spyOn(https, 'get').mockImplementation((url, _options, callback) => {
    queueMicrotask(() => callback(url.endsWith('/first') ? first : second));
    return Object.assign(new EventEmitter(), { destroy() {} });
  });
  const one = es.httpText('https://fixture.invalid/first');
  const two = es.httpText('https://fixture.invalid/second');
  await Promise.resolve();
  first.write(Buffer.from([0xe2]));
  second.write(Buffer.from([0xc4]));
  first.end(Buffer.from([0x82, 0xac]));
  second.end(Buffer.from([0xab]));
  expect(await Promise.all([one, two])).toEqual(['\u20ac', '\u012b']);
});

it.each([
  { name: 'shared JSON', read: es.httpJson },
  { name: 'published article JSON', read: newsroom.jsonGet },
])('$name rejects a response stream error rather than parsing its partial body', async ({ read }) => {
  const response = Object.assign(new PassThrough(), { statusCode: 200 });
  vi.spyOn(https, 'get').mockImplementation((_url, _options, callback) => {
    queueMicrotask(() => {
      callback(response);
      response.write(bytes.subarray(0, 12));
      response.destroy(new Error('Interrupted source response'));
    });
    return Object.assign(new EventEmitter(), { destroy() {} });
  });
  await expect(read('https://fixture.invalid/interrupted')).rejects.toThrow('Interrupted source response');
});
