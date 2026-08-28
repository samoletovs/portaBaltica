import net from 'node:net';

/**
 * The unit suite may not reach the network. Enforced, not asked for.
 *
 * WHAT WAS BROKEN
 * ---------------
 * Two of the last five pushes to master went red for a reason unrelated to
 * their content — one of them a commit that added a single PowerShell script,
 * which cannot break vitest. Every failure was a 5000ms timeout in
 * `economyPriceAbsence.test.ts` or `functionSecurityHeaders.test.ts`.
 *
 * Both files believe they have stubbed the network. Both stub `https.get`;
 * `functionSecurityHeaders` also stubs `http.get` and `globalThis.fetch`.
 * Neither stubs **`https.request`** — and `api/economy-data/index.js:149` and
 * `api/historical-data/index.js:15` both reach CSP PxWeb through exactly that,
 * with their own 12s and 15s client timeouts sitting above the 5000ms the test
 * gets. `AGENTS.md` records PxWeb as "slow (1–12s per table)", which straddles
 * the test timeout: whether a run is green depends on how `data.stat.gov.lv`
 * felt that morning, from an Azure-hosted runner, which `AGENTS.md` separately
 * records as reaching some hosts far more slowly than an ordinary connection.
 *
 * Measured before writing this, by wrapping `net.Socket.prototype.connect` and
 * `https.request` and running the suite: **33 real requests to
 * `data.stat.gov.lv` and 2 real socket connections**, from two files that had
 * both declared the network stubbed. Across all 88 files those were the only
 * escapes, so this guard has a blast radius of two.
 *
 * WHY THIS RATHER THAN THE OBVIOUS FIXES
 * --------------------------------------
 * *Not a raised `testTimeout`.* The three failures sat at 5001ms, 5004ms and
 * 5023ms — they were waiting on a socket, not starving for CPU. A larger
 * timeout would have made a genuine, silent network dependency wait longer and
 * report nothing, which is the "check that cannot fail" this repository keeps
 * finding in other clothes.
 *
 * *Not only adding `https.request` to the two mocks.* That is the right local
 * fix and it is made too, because `breakTheNetwork` claims in a comment that
 * "every outbound call fails immediately" and that claim was false. But it is a
 * per-file remedy for a class defect: the class is that a unit test can open a
 * socket to the internet and nothing says so. The next handler written with
 * `request` instead of `get` reintroduces it, in a file nobody thinks to check.
 *
 * So the connection is refused here, once, for every test file. Loopback and
 * IPC are untouched, because vitest's own machinery uses them.
 *
 * `vitest.live.config.ts` deliberately does **not** load this. The live smoke
 * tests exist precisely to make real requests against the deployed site.
 */

/** Hosts a unit test may legitimately talk to: itself. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '']);

/**
 * Where a `connect` call is actually pointed.
 *
 * `net.Socket.prototype.connect` takes either an options object or the
 * `(port[, host][, listener])` positional form, and either may name a unix
 * socket or a Windows named pipe instead of a host. `null` means "not a TCP
 * connection to a remote host", which is the case this guard must let through
 * rather than guess about.
 */
function remoteTarget(args: unknown[]): { host: string; port: number } | null {
  const first = args[0];

  if (typeof first === 'string') {
    // A path: unix socket or named pipe. Local by construction.
    if (!/^\d+$/.test(first)) return null;
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { host, port: Number(first) };
  }

  if (typeof first === 'number') {
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { host, port: first };
  }

  if (first && typeof first === 'object') {
    const options = first as { host?: string; port?: number; path?: string };
    if (options.path) return null;
    if (typeof options.port !== 'number') return null;
    return { host: options.host ?? 'localhost', port: options.port };
  }

  return null;
}

const realConnect = net.Socket.prototype.connect;

// Patched at module scope rather than in a `beforeAll`, so it is in place
// before a test file's own top-level code runs.
net.Socket.prototype.connect = function patchedConnect(
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  const target = remoteTarget(args);

  if (target === null || LOOPBACK.has(target.host)) {
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  }

  // Refused the way a real refusal arrives — asynchronously, as an `error` on
  // the socket — so the code under test takes the same branch it would take
  // against a dead upstream. Returning synchronously or throwing here would
  // exercise a path that cannot happen in production.
  const error = Object.assign(
    new Error(
      `connect ECONNREFUSED ${target.host}:${target.port} — refused by the ` +
        'portaBaltica test guard. A unit test may not reach the network; stub ' +
        'it (https.request as well as https.get) or move it to a *.live.test.ts.',
    ),
    {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: target.host,
      port: target.port,
    },
  );

  queueMicrotask(() => {
    this.destroy(error);
  });

  return this;
};
