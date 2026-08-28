import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Which outbound transports `api/**` actually uses, read from the source.
 *
 * One enumeration, imported by everything that needs it. Two suites ask this
 * question — `noNetwork.test.ts` asks whether the socket guard can see each
 * transport, and `functionSecurityHeaders.test.ts` asks whether its own mock
 * patches each — and `AGENTS.md` is emphatic about what happens when a guard
 * keeps its own copy of the set it guards: *"a shared enumeration cannot drift;
 * two enumerations always will, and the drift is silent in the direction that
 * reports success."*
 *
 * That is not hypothetical here. The flake this file exists downstream of was
 * exactly a mock covering a smaller set than the handlers used: both
 * `api/economy-data` and `api/historical-data` reach CSP PxWeb through
 * `https.request`, and every mock patched `https.get` and stopped.
 */

/**
 * `child_process` and `dgram` are listed so they can be *found*, not because
 * they are supported. A handler that shells out to curl leaves the process, and
 * a handler speaking UDP never touches a stream socket, so neither an
 * in-process socket guard nor an `https.get` mock could see it. Callers are
 * expected to treat their presence as a failure.
 */
const PATTERNS: [string, RegExp][] = [
  ['https.request', /\bhttps\.request\s*\(/],
  ['https.get', /\bhttps\.get\s*\(/],
  ['http.request', /\bhttp\.request\s*\(/],
  ['http.get', /\bhttp\.get\s*\(/],
  ['fetch', /(?:^|[^.\w])fetch\s*\(/m],
  ['net', /\bnet\.(?:connect|createConnection)\s*\(/],
  ['child_process', /require\(['"](?:node:)?child_process['"]\)/],
  ['dgram', /require\(['"](?:node:)?dgram['"]\)/],
];

/** Every transport name above that appears somewhere under `api/`. */
export function transportsUsedByApi(): Set<string> {
  const found = new Set<string>();

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

  walk(resolve('api'));
  return found;
}
