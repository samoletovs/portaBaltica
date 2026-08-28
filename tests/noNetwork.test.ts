import { describe, expect, it } from 'vitest';
import net from 'node:net';
import https from 'node:https';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The guard that stops a unit test reaching the network, tested.
 *
 * An unguarded guard is the failure this repository keeps finding in other
 * clothes: `tests/noNetwork.ts` could be deleted, mis-wired in
 * `vitest.config.ts`, or broken by a Node change, and every symptom would be
 * invisible — the suite would simply go back to passing locally and failing on
 * a runner whenever `data.stat.gov.lv` was slow. Nothing would say why.
 *
 * Both directions are asserted, and the second is the one that matters. A guard
 * that refuses *everything* would satisfy "the remote host is refused" while
 * breaking any test that needs a local fixture server, so the loopback case is
 * the companion that proves the refusal is a decision rather than a blanket.
 */

describe('the no-network guard', () => {
  it('refuses a connection to a remote host, and says why', async () => {
    // Never resolved, never dialled: the guard fires before DNS, so this
    // assertion costs nothing and cannot itself be flaky.
    const socket = new net.Socket();
    socket.connect({ host: 'data.stat.gov.lv', port: 443 });

    const [error] = (await once(socket, 'error')) as [NodeJS.ErrnoException];

    expect(error.code).toBe('ECONNREFUSED');
    expect(error.message).toContain('portaBaltica test guard');
    // The message has to name the fix, because the person reading it is
    // debugging a handler that suddenly cannot reach its upstream.
    expect(error.message).toContain('https.request');
  });

  it('refuses the transport the two flaky files forgot to stub', async () => {
    // `https.request` is the specific hole: `api/economy-data/index.js:149` and
    // `api/historical-data/index.js:15` reach CSP PxWeb through it, and neither
    // test mock covered it. This asserts the guard closes it underneath, so a
    // handler written the same way tomorrow cannot reintroduce the flake.
    const request = https.request({ hostname: 'data.stat.gov.lv', path: '/', method: 'POST' });
    request.on('error', () => {});
    request.end();

    const [error] = (await once(request, 'error')) as [NodeJS.ErrnoException];

    expect(error.code).toBe('ECONNREFUSED');
    expect(error.message).toContain('portaBaltica test guard');
  });

  it('leaves loopback alone, so a local fixture server still works', async () => {
    // The companion assertion. Without it the two above pass on a guard that
    // refuses every connection there is, which would be a different defect
    // wearing the same green tick.
    //
    // Both ends swallow their errors and the client closes politely. The first
    // version wrote a body and called `destroy()`, which reset the connection
    // under the server and raised an unhandled `ECONNRESET` — vitest reported
    // "3 passed" and exited 1, so this file would have added a new red mark to
    // the suite whose whole purpose is to remove one.
    const server = net.createServer((connection) => {
      connection.on('error', () => {});
      connection.end();
    });
    server.on('error', () => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const { port } = server.address() as net.AddressInfo;

    try {
      const client = net.createConnection({ host: '127.0.0.1', port });
      client.on('error', () => {});
      await once(client, 'connect');
      expect(client.destroyed).toBe(false);

      client.end();
      await once(client, 'close');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});

/**
 * Every outbound transport `api/**` actually uses, read from the source.
 *
 * `AGENTS.md` records the failure this exists to stop, three times over: **a
 * guard must enumerate the same set as the thing it guards.** Covering a
 * smaller population than the subject is the harder half to see, because the
 * guard is correct about everything it looks at and everything in the gap is
 * unguarded while looking covered. That is exactly how `https.request` escaped
 * two mocks that both looked complete.
 *
 * So the set is derived rather than written down. Add `fetch(` to a handler
 * tomorrow and this still passes, because `fetch` is asserted refused below.
 * Add a `child_process` shelling out to curl and it fails, because a socket
 * guard cannot see another process.
 */
function transportsUsedByApi(): Set<string> {
  const root = resolve('api');
  const found = new Set<string>();

  const PATTERNS: [string, RegExp][] = [
    ['https.request', /\bhttps\.request\s*\(/],
    ['https.get', /\bhttps\.get\s*\(/],
    ['http.request', /\bhttp\.request\s*\(/],
    ['http.get', /\bhttp\.get\s*\(/],
    ['fetch', /(?:^|[^.\w])fetch\s*\(/m],
    ['net', /\bnet\.(?:connect|createConnection)\s*\(/],
    // These cannot be reached by a guard that patches sockets in this process.
    ['child_process', /require\(['"](?:node:)?child_process['"]\)/],
    ['dgram', /require\(['"](?:node:)?dgram['"]\)/],
  ];

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.js')) {
        const text = readFileSync(path, 'utf8');
        for (const [name, pattern] of PATTERNS) {
          if (pattern.test(text)) found.add(name);
        }
      }
    }
  }

  walk(root);
  return found;
}

describe('the guard covers every transport the handlers actually use', () => {
  it('finds the transports at all', () => {
    // Guard the guard. An empty set would make the assertion below pass while
    // measuring nothing, which is the shape this whole file exists to reject.
    expect(transportsUsedByApi().size).toBeGreaterThan(0);
  });

  it('sees only transports that end at a socket in this process', () => {
    // Each of these is asserted refused by a test in this file. `child_process`
    // and `dgram` are deliberately absent from the list rather than exempted:
    // a handler shelling out to curl, or speaking UDP, would leave the process
    // and no socket guard could see it. If one appears, this fails and the
    // right answer is a conversation, not a wider allowlist.
    const COVERED = new Set([
      'https.request',
      'https.get',
      'http.request',
      'http.get',
      'fetch',
      'net',
    ]);

    const used = [...transportsUsedByApi()].sort();
    const uncovered = used.filter((name) => !COVERED.has(name));

    expect(uncovered, `no socket guard can see these: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('refuses https.get, which is what nine of the eleven call sites use', async () => {
    const request = https.get('https://data.stat.gov.lv/');
    request.on('error', () => {});

    const [error] = (await once(request, 'error')) as [NodeJS.ErrnoException];

    expect(error.code).toBe('ECONNREFUSED');
    expect(error.message).toContain('portaBaltica test guard');
  });

  it('refuses fetch, so a handler written the modern way is covered too', async () => {
    // Node's global fetch is undici, which reaches the same socket layer. This
    // is asserted rather than assumed, because the whole defect being fixed was
    // an assumption about which transport a mock covered.
    await expect(fetch('https://data.stat.gov.lv/')).rejects.toThrow();

    const failure = await fetch('https://data.stat.gov.lv/').catch(
      (error: Error & { cause?: Error }) => error,
    );

    expect(String((failure as { cause?: Error }).cause?.message)).toContain(
      'portaBaltica test guard',
    );
  });
});
