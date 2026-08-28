import { describe, expect, it } from 'vitest';
import net from 'node:net';
import https from 'node:https';
import { once } from 'node:events';

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
