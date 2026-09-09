import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');
const HANDLER_PATH = resolve(ROOT, 'api/article-feedback/index.js');

const fsModule = require('node:fs') as {
  promises: {
    appendFile: (path: string, body: string, encoding: string) => Promise<void>;
    mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  };
};
const realAppend = fsModule.promises.appendFile;
const realMkdir = fsModule.promises.mkdir;

let appended: { path: string; body: string; encoding: string }[] = [];

function loadHandler() {
  process.env.FEEDBACK_DB_PATH = '/tmp/feedback-test.ndjson';
  delete require.cache[HANDLER_PATH];
  return require(HANDLER_PATH) as (context: unknown, req: unknown) => Promise<void>;
}

beforeEach(() => {
  appended = [];
  fsModule.promises.mkdir = vi.fn().mockResolvedValue(undefined);
  fsModule.promises.appendFile = vi
    .fn()
    .mockImplementation(async (path: string, body: string, encoding: string) => {
      appended.push({ path, body, encoding });
    });
});

describe('/api/article-feedback', () => {
  it('accepts a feedback POST and stores it', async () => {
    const handler = loadHandler();
    const context: { res?: { status: number; body: string } } = {};
    await handler(context, {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.0.0.1', 'user-agent': 'vitest' },
      body: {
        slug: 'latvian-wage-growth-outpaces-inflation',
        kind: 'issue',
        message: 'This paragraph needs a source link.',
        contact: 'reader@example.com',
      },
    });

    expect(context.res?.status).toBe(202);
    expect(appended.length).toBe(1);
    expect(appended[0].path).toBe('/tmp/feedback-test.ndjson');
    expect(appended[0].encoding).toBe('utf8');

    const stored = JSON.parse(appended[0].body.trim());
    expect(stored.slug).toBe('latvian-wage-growth-outpaces-inflation');
    expect(stored.kind).toBe('issue');
    expect(stored.message).toBe('This paragraph needs a source link.');
    expect(stored.contact).toBe('reader@example.com');
  });

  it('rejects invalid payloads', async () => {
    const handler = loadHandler();
    const context: { res?: { status: number; body: string } } = {};
    await handler(context, {
      method: 'POST',
      headers: {},
      body: { slug: 'x', kind: 'comment', message: 'bad' },
    });

    expect(context.res?.status).toBe(400);
    expect(appended.length).toBe(0);
  });
});

afterEach(() => {
  fsModule.promises.appendFile = realAppend;
  fsModule.promises.mkdir = realMkdir;
});
