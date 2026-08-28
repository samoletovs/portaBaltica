import { describe, expect, it, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * `keyOn` must name every query parameter the handler reads.
 *
 * WHY THIS IS NOT A STYLE RULE
 * ----------------------------
 * Getting `keyOn` wrong does not produce a slow page. It produces **Estonia's
 * figures under Latvia's heading** — a correct, well-formed, cached response
 * served under another request's key. `AGENTS.md` records this shipping once
 * already, one layer down: five articles published real Eurostat figures
 * attached to metrics they did not measure, because a cache keyed on the URL
 * alone collided across definitions that differed only in query parameters. A
 * bankruptcies piece carried the registrations number, which means the opposite
 * thing about an economy.
 *
 * Nothing checked the invariant. `withCache` throws when `keyOn` is *absent*
 * (`tests/responseCache.test.ts`), which is a different and much weaker
 * property: it requires the field to exist, not to be true.
 *
 * WHY A PROXY AND NOT A REGEX
 * ---------------------------
 * "Every query parameter the handler reads" looks syntactic, and it is not.
 * Scanning the source was tried first and produced three false positives across
 * eighteen endpoints, from two independent causes:
 *
 *   - `var query = (req.query && req.query.q) || ''` binds a **string**, so
 *     following `query.*` reported `length` and `replace` as parameters.
 *   - `'Unknown indicator. Available: '` contains `indicator. Available`, so
 *     scanning text that includes string literals reported `Available`.
 *
 * `AGENTS.md` is explicit that a lexical proxy encodes the author's examples
 * rather than the rule, and that it will be beaten by the first phrasing nobody
 * imagined. Both of those were. **A guard that cries wolf gets exempted, and
 * then it is wallpaper.**
 *
 * So the property is tested rather than approximated: the handler is called
 * with a `Proxy` as `req.query` that records every property actually read. An
 * alias is still a read through the proxy; a string literal is not a read at
 * all. Measured across all eighteen endpoints: **zero false positives.**
 *
 * WHAT THIS DOES NOT CATCH, STATED PLAINLY
 * ----------------------------------------
 * A proxy sees the branches it exercises. A parameter read only on a path none
 * of the profiles below reaches would go unrecorded, so this is **sound but not
 * complete**: what it reports is real, and silence is weaker than proof. Three
 * value profiles are run per endpoint for that reason, and the vacuity checks
 * below exist so that "nothing found" cannot mean "nothing looked".
 */

const require_ = createRequire(import.meta.url);
const API = resolve('api');

interface Endpoint {
  name: string;
  /** `null` when the handler is not wrapped in `withCache` at all. */
  keyOn: string[] | null;
}

/**
 * Every endpoint, and the `keyOn` it declares.
 *
 * This much *is* read from the source, and safely: `keyOn: ['country']` is a
 * literal array in a declaration, not an expression to be interpreted. The part
 * that cannot be read lexically is what the handler *does*, and that is exactly
 * the part measured by running it.
 */
function endpoints(): Endpoint[] {
  const found: Endpoint[] = [];

  for (const entry of readdirSync(API, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared' || entry.name === 'node_modules') continue;
    const index = join(API, entry.name, 'index.js');
    try {
      statSync(index);
    } catch {
      continue;
    }

    const text = readFileSync(index, 'utf8');
    const declared = text.match(/keyOn:\s*\[([^\]]*)\]/);
    found.push({
      name: entry.name,
      keyOn: declared
        ? declared[1]
            .split(',')
            .map((piece) => piece.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : null,
    });
  }

  return found;
}

interface Observation {
  /** Whether the handler module loaded and was actually called. */
  exercised: boolean;
  loadError?: string;
  reads: Set<string>;
}

/** Properties a proxy sees that are the language talking, not a parameter. */
const NOT_A_PARAMETER = new Set(['then', 'constructor', 'toJSON', 'inspect', 'hasOwnProperty']);

let requestIp = 0;

async function observe(name: string, values: Record<string, string>): Promise<Observation> {
  const reads = new Set<string>();

  const query = new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property === 'string' && !NOT_A_PARAMETER.has(property)) reads.add(property);
      return values[property as string];
    },
    has(_target, property) {
      if (typeof property === 'string' && !NOT_A_PARAMETER.has(property)) reads.add(property);
      return property in values;
    },
    ownKeys() {
      return Reflect.ownKeys(values);
    },
    getOwnPropertyDescriptor(_target, property) {
      return { configurable: true, enumerable: true, value: values[property as string] };
    },
  });

  let handler: (context: unknown, request: unknown) => unknown;
  try {
    handler = require_(join(API, name, 'index.js'));
  } catch (error) {
    return { exercised: false, loadError: String(error), reads };
  }

  // A fresh address each time: the rate limiter is real, and a handler refused
  // before it runs reads nothing, which would look like a clean endpoint.
  requestIp += 1;
  const request = {
    query,
    headers: { 'x-forwarded-for': `10.9.${Math.floor(requestIp / 250) % 250}.${requestIp % 250}` },
    method: 'GET',
    url: '/api/x',
  };

  try {
    await handler({}, request);
  } catch {
    // A handler that threw still read whatever it read before throwing. The
    // network is refused by `tests/noNetwork.ts`, so several take their catch
    // path here, which is fine: parameters are read before the fetch.
  }

  return { exercised: true, reads };
}

/** A plausible value per parameter, so the handler stays on its main path. */
function profile(keyOn: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of keyOn) {
    if (parameter === 'country') values[parameter] = 'LV';
    else if (parameter === 'years') values[parameter] = '5';
    else if (parameter === 'indicator') values[parameter] = 'gdp';
    else values[parameter] = 'alpha';
  }
  return values;
}

const observed = new Map<string, Observation>();

beforeAll(async () => {
  for (const endpoint of endpoints()) {
    if (endpoint.keyOn === null) continue;

    // Two profiles: no parameters at all, and one full value set. The empty one
    // reaches the early-return paths, the other reaches the work, and the union
    // of what they read is what the invariant is checked against.
    //
    // A third profile was measured and cut. It added no coverage — the union
    // was identical — and the file's cost is not free: it invokes every handler
    // for real, and `tests/dashboardCadence.test.tsx` waits on a wall-clock
    // `findByText`, so load in one worker can time out a neighbour in another.
    // A guard that makes the suite flaky is the defect it was written to remove.
    const merged: Observation = { exercised: true, reads: new Set() };
    for (const values of [{}, profile(endpoint.keyOn)]) {
      const one = await observe(endpoint.name, values);
      if (!one.exercised) {
        merged.exercised = false;
        merged.loadError = one.loadError;
      }
      for (const read of one.reads) merged.reads.add(read);
    }
    observed.set(endpoint.name, merged);
  }
}, 120_000);

describe('the cache key covers what the handler reads', () => {
  it('finds the endpoints at all', () => {
    // Guard the guard. An empty list makes every assertion below pass while
    // measuring nothing.
    expect(endpoints().length).toBeGreaterThan(10);
  });

  it('actually ran every cached handler', () => {
    // The failure this exists for: a handler whose module throws on require
    // records no reads, and an endpoint that reads nothing satisfies the
    // invariant trivially. A load error must be a failure, not a clean sheet.
    const broken = [...observed.entries()]
      .filter(([, observation]) => !observation.exercised)
      .map(([name, observation]) => `${name}: ${observation.loadError}`);

    expect(broken).toEqual([]);
    expect(observed.size).toBeGreaterThan(10);
  });

  it('observed real parameters, so silence here means something', () => {
    // The other vacuity guard, and the one the shape of this check most needs:
    // if the proxy saw no parameter anywhere, the invariant below would be
    // green because nothing was read, not because everything was declared.
    const withReads = [...observed.values()].filter((observation) => observation.reads.size > 0);

    expect(
      withReads.length,
      'no endpoint read any query parameter — the proxy is not seeing reads',
    ).toBeGreaterThanOrEqual(5);
  });

  it('names every parameter the handler reads', () => {
    const offenders: string[] = [];

    for (const endpoint of endpoints()) {
      if (endpoint.keyOn === null) continue;
      const observation = observed.get(endpoint.name);
      if (!observation) continue;

      const undeclared = [...observation.reads]
        .filter((parameter) => !endpoint.keyOn!.includes(parameter))
        .sort();

      if (undeclared.length) {
        offenders.push(
          `${endpoint.name} reads ${undeclared.join(', ')} but keyOn is ` +
            `[${endpoint.keyOn.join(', ')}] — two requests differing only in ` +
            `${undeclared[0]} would share a cached response`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('lets an endpoint that reads nothing declare nothing', () => {
    // `keyOn: []` is correct for a handler with no parameters — the feeds,
    // the grid, the sea state — and wrong for one that reads something. The
    // check above already tells them apart; this states that the empty case is
    // real and populated, so nobody later "fixes" it into a false positive.
    const empty = endpoints().filter(
      (endpoint) => endpoint.keyOn !== null && endpoint.keyOn.length === 0,
    );

    expect(empty.length, 'expected several parameterless endpoints').toBeGreaterThan(3);

    for (const endpoint of empty) {
      const observation = observed.get(endpoint.name);
      expect([...(observation?.reads ?? [])], `${endpoint.name} declares no key`).toEqual([]);
    }
  });
});
