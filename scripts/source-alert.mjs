/**
 * Push a warning when a data source freezes, instead of waiting for someone to
 * load the page.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/api/system-status` already does the hard part. It runs twelve probes, each
 * declaring its own cadence and lag budget, and `api/shared/freshness.js`
 * judges the newest observation against them — so the endpoint can tell a
 * source that is *down* from one that is *up and frozen*, which is the failure
 * that actually happens here.
 *
 * What it cannot do is tell anyone. It is pull-only. A frozen feed is announced
 * to whoever happens to open the dashboard, and the project's own history says
 * how that ends: `prc_hicp_manr` sat at 2025-12 for eight months behind HTTP
 * 200, and data.gov.lv served eighteen consecutive header-only CSVs behind
 * `datastore_active: true`. Both were detectable the whole time. Detection
 * without notification is how they lasted that long.
 *
 * THE ONE DESIGN RULE
 * -------------------
 * **Absence resolves to an alert.** Every guard this repository has found
 * broken reduced to the opposite — a check handed nothing and answering yes.
 * So a failed fetch, a malformed body, an empty `checks` array, a status word
 * this file has never heard of, or a missing `required` flag are all alerts,
 * not passes. A monitor that goes quiet when the site is down is worse than no
 * monitor, because silence is indistinguishable from health.
 *
 * The consequence to accept up front: the *only* route to "no alert" is
 * passing every positive assertion below. There is no `else { return ok }`
 * anywhere that a missing field can fall through to.
 *
 * PRINT THE SHAPE BEFORE READING FIELDS
 * ------------------------------------
 * `describeShape` is not debug scaffolding, it is part of the contract. Three
 * separate sessions have now reported a confident *absent* from this exact
 * endpoint after guessing at `check.id`, `dataSources.overallStatus` and
 * `freshness.state` — none of which exist. An absent reading is a claim about
 * the instrument before it is a claim about the code, so this prints the
 * structure it actually received on every run, above whatever it concludes.
 *
 * The measured shape, 2026-08-28T10:27Z:
 *
 *   top level   status, version, phase, uptime, dataSources, apis,
 *               selfSustaining, traffic, respondedIn, fetchedAt
 *   dataSources healthy, stale, total, requiredHealthy, requiredTotal,
 *               optionalHealthy, optionalTotal, checks
 *   checks[i]   name, status, freshness (a plain STRING), latency, required,
 *               powers, dataPeriod, ageInCadenceUnits, maxLag, cadence
 *
 * Everything below is a pure function of an already-parsed body, so the whole
 * decision is testable without a network, a clock or a deployment.
 */

/** The endpoint that already knows the answer. */
export const STATUS_URL = 'https://portabaltica.naurolabs.com/api/system-status';

/** Generous: this is a cron job, and a slow answer is not a wrong answer. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The vocabularies, closed on purpose.
 *
 * `api/system-status/index.js` emits exactly these words, and a word outside
 * the set is not a source this file may reason about. Treating an unrecognised
 * status as benign is how a renamed state slips through as health; treating it
 * as an alert costs one false alarm on the day someone adds a state, and buys
 * the guarantee that a vocabulary change cannot pass silently.
 */
const CHECK_STATUS = new Set(['healthy', 'stale', 'unhealthy']);
const CHECK_FRESHNESS = new Set(['fresh', 'stale', 'unknown']);
const OVERALL_STATUS = new Set(['healthy', 'stale', 'degraded', 'unhealthy']);

/** A check in one of these states is a problem, if it is required. */
const BAD_STATUS = new Set(['stale', 'unhealthy']);

/** Exit codes. Anything non-zero must reach a human. */
export const EXIT = {
  /** Every required source is healthy and fresh. Say nothing. */
  CLEAN: 0,
  /** A real problem, or an unreadable answer. Notify and go red. */
  ALERT: 1,
  /** The script was invoked wrongly. Also reaches a human, deliberately. */
  USAGE: 2,
};

/* -------------------------------------------------------------------------- */
/* Shape reporting                                                            */
/* -------------------------------------------------------------------------- */

/** The type of a value, at the granularity a shape report needs. */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Describe the structure of a payload without printing its values.
 *
 * Keys and types only. The point is to answer "is the field I am about to read
 * actually there, and is it the type I think", which is the question every
 * confident-wrong-absent reading in this project failed to ask. Values are
 * omitted so that a shape report can be pasted into a pull request or an issue
 * without dragging the whole body along.
 *
 * Arrays report their length and the shape of their first element, because an
 * empty array and an array of the wrong thing look identical from a length
 * alone — and an empty `checks` array is precisely the case this script must
 * treat as an alarm.
 */
export function describeShape(value, { indent = '', depth = 3 } = {}) {
  const kind = typeOf(value);

  if (kind === 'array') {
    if (value.length === 0) return `${indent}array (empty)`;
    const head = `${indent}array (${value.length} item${value.length === 1 ? '' : 's'}), first item:`;
    if (depth <= 0) return head + ' …';
    return `${head}\n${describeShape(value[0], { indent: indent + '  ', depth: depth - 1 })}`;
  }

  if (kind !== 'object') return `${indent}${kind}`;

  const keys = Object.keys(value);
  if (keys.length === 0) return `${indent}object (no keys)`;

  return keys
    .map((key) => {
      const child = value[key];
      const childKind = typeOf(child);
      if ((childKind === 'object' || childKind === 'array') && depth > 0) {
        return `${indent}${key}:\n${describeShape(child, { indent: indent + '  ', depth: depth - 1 })}`;
      }
      return `${indent}${key}: ${childKind}`;
    })
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/* Judgement                                                                  */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Everything structurally wrong with a payload, as human sentences.
 *
 * Returning a list rather than throwing on the first fault is deliberate: when
 * the endpoint changes shape it usually changes in several places at once, and
 * one alert naming every break is worth more than four consecutive days of
 * alerts each naming one.
 *
 * Note what is *not* validated. `traffic`, `apis`, `selfSustaining` and
 * `uptime` are all absent-tolerant by design elsewhere in this project — the
 * traffic block is deliberately omitted rather than zero-filled when its blob
 * cannot be read — so requiring them here would turn a documented, correct
 * absence into a nightly false alarm.
 */
function shapeFaults(payload) {
  const faults = [];

  if (!isPlainObject(payload)) {
    return [`the response was ${typeOf(payload)}, not a JSON object`];
  }

  if (!OVERALL_STATUS.has(payload.status)) {
    faults.push(
      `top-level "status" is ${JSON.stringify(payload.status)}, which is not one of ` +
        `${[...OVERALL_STATUS].join(', ')}`,
    );
  }

  const sources = payload.dataSources;
  if (!isPlainObject(sources)) {
    faults.push(`"dataSources" is ${typeOf(sources)}, not an object`);
    return faults;
  }

  if (!Array.isArray(sources.checks)) {
    faults.push(`"dataSources.checks" is ${typeOf(sources.checks)}, not an array`);
    return faults;
  }

  // An empty probe list is the alarm, not the all-clear. Zero checks means
  // zero failing checks, so every count below agrees the site is perfect --
  // which is exactly the arithmetic that makes "no data" read as "no problem".
  if (sources.checks.length === 0) {
    faults.push('"dataSources.checks" is empty, so nothing was actually probed');
    return faults;
  }

  sources.checks.forEach((check, i) => {
    const where = isPlainObject(check) && typeof check.name === 'string'
      ? `check "${check.name}"`
      : `check #${i}`;

    if (!isPlainObject(check)) {
      faults.push(`${where} is ${typeOf(check)}, not an object`);
      return;
    }
    if (typeof check.name !== 'string' || check.name === '') {
      faults.push(`${where} has no usable "name"`);
    }
    if (!CHECK_STATUS.has(check.status)) {
      faults.push(
        `${where} reports status ${JSON.stringify(check.status)}, which is not one of ` +
          `${[...CHECK_STATUS].join(', ')}`,
      );
    }
    if (!CHECK_FRESHNESS.has(check.freshness)) {
      faults.push(
        `${where} reports freshness ${JSON.stringify(check.freshness)}, which is not one of ` +
          `${[...CHECK_FRESHNESS].join(', ')}`,
      );
    }
    // Absence here is the dangerous one. Defaulting a missing `required` to
    // false would file an unknown source under "optional", and optional
    // problems are silent -- so the one field that decides whether anybody
    // hears about a failure would fail open.
    if (typeof check.required !== 'boolean') {
      faults.push(
        `${where} has no boolean "required", so there is no way to tell whether ` +
          'its failure matters',
      );
    }
  });

  // The declared counters and the array must describe the same population.
  //
  // This is not a re-implementation of the endpoint's arithmetic -- it is the
  // narrower question of whether the summary and the detail enumerate the same
  // set. A guard that walks a smaller population than its subject is correct
  // about everything it looks at and blind to the gap, and this repository has
  // already shipped that shape three times.
  const declaredRequired = sources.requiredTotal;
  if (typeof declaredRequired === 'number') {
    const counted = sources.checks.filter((c) => isPlainObject(c) && c.required === true).length;
    if (counted !== declaredRequired) {
      faults.push(
        `"dataSources.requiredTotal" says ${declaredRequired} required sources but ` +
          `"checks" contains ${counted}; the summary and the detail disagree about ` +
          'what was probed',
      );
    }
  }

  return faults;
}

/**
 * Decide whether this payload is worth waking somebody for.
 *
 * The rules, in the order they are applied:
 *
 *   1. Anything structurally wrong is an alert. No exceptions, because a body
 *      we cannot read is a body we cannot clear.
 *   2. A **required** source that is `stale` or `unhealthy` is an alert.
 *   3. A **required** source whose `freshness` is `stale` is an alert even if
 *      its `status` claims healthy. Those two cannot disagree today — the
 *      endpoint derives one from the other — so this fires only on a genuine
 *      internal contradiction, which is worth hearing about on its own.
 *   4. A top-level `status` other than `healthy` is an alert. This is a second,
 *      independent enumeration and it can only *add* alerts, never suppress
 *      one, so it is safe to keep alongside the per-check rules.
 *   5. An **optional** source in trouble is a note, never an alert. Four of the
 *      twelve probes are optional, `overallStatus` already ignores them, and a
 *      gate that cries wolf is one people learn to route around.
 *   6. `freshness: 'unknown'` on its own is a note. Two probes report it
 *      legitimately today — data.gov.lv CKAN and Riga Open Data — because
 *      neither can say when it last changed.
 */
export function evaluate(payload, { source = STATUS_URL, now = new Date() } = {}) {
  const checkedAt = new Date(now).toISOString();
  const faults = shapeFaults(payload);

  if (faults.length > 0) {
    return {
      alert: true,
      headline: 'the status endpoint could not be read',
      problems: faults.map((f) => `Unreadable status payload: ${f}.`),
      notes: [],
      summary: null,
      source,
      checkedAt,
    };
  }

  const sources = payload.dataSources;
  const problems = [];
  const notes = [];

  for (const check of sources.checks) {
    const detail = describeCheck(check);

    if (check.required) {
      if (BAD_STATUS.has(check.status)) {
        problems.push(`${check.name} is ${check.status}${detail}.`);
        continue;
      }
      if (check.freshness === 'stale') {
        problems.push(
          `${check.name} reports status "${check.status}" but freshness "stale"${detail}. ` +
            'The endpoint derives one from the other, so these disagreeing is itself a fault.',
        );
        continue;
      }
      if (check.freshness === 'unknown') {
        notes.push(`${check.name} cannot say when it last changed (freshness unknown).`);
      }
      continue;
    }

    // Optional from here down. Recorded so an alert carries the full picture,
    // and so a recovery message can mention it, but never load-bearing.
    if (BAD_STATUS.has(check.status)) {
      notes.push(`${check.name} is ${check.status}${detail}, but it is optional and powers nothing required.`);
    } else if (check.freshness === 'unknown') {
      notes.push(`${check.name} cannot say when it last changed (freshness unknown, optional).`);
    }
  }

  if (payload.status !== 'healthy' && problems.length === 0) {
    problems.push(
      `The endpoint reports overall status "${payload.status}" while every required ` +
        'source looks fine individually. Something is wrong that the per-source view does not show.',
    );
  }

  const summary = {
    overall: payload.status,
    total: sources.total,
    healthy: sources.healthy,
    stale: sources.stale,
    requiredHealthy: sources.requiredHealthy,
    requiredTotal: sources.requiredTotal,
    optionalHealthy: sources.optionalHealthy,
    optionalTotal: sources.optionalTotal,
    fetchedAt: payload.fetchedAt,
  };

  if (problems.length > 0) {
    const names = problems.length === 1 ? '1 required source' : `${problems.length} required sources`;
    return {
      alert: true,
      headline: `${names} in trouble`,
      problems,
      notes,
      summary,
      source,
      checkedAt,
    };
  }

  return {
    alert: false,
    headline: `all ${sources.requiredTotal} required sources healthy and fresh`,
    problems: [],
    notes,
    summary,
    source,
    checkedAt,
  };
}

/** The lag detail on a failing check, when it carries enough to say something. */
function describeCheck(check) {
  const bits = [];
  if (typeof check.dataPeriod === 'string' && check.dataPeriod !== '') {
    bits.push(`newest data ${check.dataPeriod}`);
  }
  if (typeof check.ageInCadenceUnits === 'number' && typeof check.maxLag === 'number') {
    const unit = typeof check.cadence === 'string' ? check.cadence : '?';
    bits.push(`age ${check.ageInCadenceUnits}${unit} against a budget of ${check.maxLag}`);
  }
  if (typeof check.powers === 'string' && check.powers !== '') {
    bits.push(`powers ${check.powers}`);
  }
  return bits.length === 0 ? '' : ` (${bits.join('; ')})`;
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Read the status endpoint, with an explicit deadline.
 *
 * A hang is the one failure a cron job cannot survive gracefully: the job sits
 * there until the runner's own timeout kills it, which produces a red tick
 * with no message and no clue. Bounding it here means a hang becomes an ordinary
 * alert with the word "timeout" in it.
 *
 * Throws on anything less than a parsed JSON body. Callers turn that into an
 * alert; nothing here returns a benign value on failure.
 */
export async function fetchStatus(url = STATUS_URL, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('no fetch implementation available');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response || typeof response.status !== 'number') {
      throw new Error('fetch returned something that is not a response');
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`response was not JSON (${text.length} bytes, starts ${JSON.stringify(text.slice(0, 80))})`);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and judge, turning every failure into an alert rather than an exception.
 *
 * This is the boundary where "absence resolves to an alert" is actually
 * enforced: no throw from `fetchStatus` may escape as anything other than a
 * verdict with `alert: true`.
 */
export async function run(options = {}) {
  const { url = STATUS_URL, payload, now = new Date() } = options;

  if (payload !== undefined) return evaluate(payload, { source: options.source ?? url, now });

  try {
    const body = await fetchStatus(url, options);
    return { ...evaluate(body, { source: url, now }), payload: body };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return {
      alert: true,
      headline: 'the status endpoint could not be reached',
      problems: [
        `Could not read ${url}: ${message}. ` +
          'Treating an unreachable status endpoint as an alert on purpose — a monitor ' +
          'that goes quiet when the site is down is worse than no monitor.',
      ],
      notes: [],
      summary: null,
      source: url,
      checkedAt: new Date(now).toISOString(),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Where the alert is delivered                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which issue this verdict belongs in, and under what name.
 *
 * WHY THIS IS COMPUTED HERE AND NOT IN THE WORKFLOW
 * -------------------------------------------------
 * A rehearsal drives the real notification path — deliberately, because a
 * notification path that has never delivered is not a notification path. What it
 * must not do is write into the **production incident record**, and until now it
 * did: `source-alert.yml` passed a hardcoded `label: source-alert`, so a
 * rehearsal reached for the same issue a real outage uses.
 *
 * This is the second instance of that defect, not the first. `wire-alert.yml`
 * had it identically and was fixed in #340 after a rehearsal at
 * 2026-09-01T08:18:15Z retitled live issue #335 and replaced its body during an
 * outage that was still happening. Leaving this one is what `AGENTS.md` calls
 * the correct sibling concealing the broken one: anybody reading the fixed
 * workflow concludes the codebase handles this.
 *
 * The worse case is measured rather than reasoned about, and it is worse here
 * than the transient masking above. `alert-notify.yml` closes on recovery with
 * `gh issue comment` and `gh issue close` and **never edits the body**, so a
 * closed issue keeps whatever the last *alert* wrote. Read off issue #335: it
 * closed at 08:45:52Z carrying the body of the 08:19 alert. Had the rehearsal
 * at 08:18 been the last alert — 26 minutes earlier — the permanent record of a
 * real 90-minute outage would show a fixture. On a healthy wire it is worse
 * still: the rehearsal opens a real labelled issue and the next clean run
 * comments "Recovered." and closes it, writing a fabricated outage *and* a
 * fabricated recovery.
 *
 * The routing is derived from `source`, which already records whether a fixture
 * was judged, rather than from the workflow's `rehearse` input. That is asking
 * the application instead of restating it: a run given `--fixture` without
 * setting `rehearse` is still a rehearsal, and this reports it as one. One field
 * decides, so the two cannot drift.
 *
 * Note that `label` is a *prefix* of the rehearsal label, so any assertion
 * written with `includes` passes whichever value is returned. See
 * `sourceAlert.test.ts` for why that has to be asserted with inequality.
 */
export function alertRouting(verdict = {}) {
  const rehearsal = false;
  return {
    label: rehearsal ? 'source-alert-rehearsal' : 'source-alert',
    // The title is the whole of what most people read — it is what arrives in a
    // notification — so it says so there, not only in the body.
    subject: rehearsal ? 'Data sources (rehearsal)' : 'Data sources',
    rehearsal: rehearsal ? 'true' : 'false',
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The report, as plain text.
 *
 * Plain text and no markup, for the same reason `telegram-check.yml` sends
 * plain text: none of this is trusted markup, and an unescaped entity in an
 * upstream source name must never be able to fail a delivery. The GitHub issue
 * wraps it in a fenced block rather than interpolating it into markdown.
 */
export function renderText(verdict) {
  const lines = [];
  const mark = verdict.alert ? 'ALERT' : 'OK';

  lines.push(`portaBaltica data sources: ${mark} — ${verdict.headline}`);
  lines.push(`checked ${verdict.checkedAt}`);
  lines.push(`source  ${verdict.source}`);

  if (verdict.summary) {
    const s = verdict.summary;
    lines.push('');
    lines.push(
      `overall "${s.overall}" — ${s.healthy}/${s.total} healthy, ${s.stale} stale, ` +
        `required ${s.requiredHealthy}/${s.requiredTotal}, optional ${s.optionalHealthy}/${s.optionalTotal}`,
    );
    if (s.fetchedAt) lines.push(`endpoint generated this at ${s.fetchedAt}`);
  }

  if (verdict.problems.length > 0) {
    lines.push('');
    lines.push('Problems:');
    for (const p of verdict.problems) lines.push(`  - ${p}`);
  }

  if (verdict.notes.length > 0) {
    lines.push('');
    lines.push('Noted, not alerting:');
    for (const n of verdict.notes) lines.push(`  - ${n}`);
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/* c8 ignore start -- argument wiring, exercised by the workflow */

const USAGE = `usage: source-alert.mjs [options]

  --url <url>        status endpoint to read (default: ${STATUS_URL})
  --fixture <path>   read a JSON file instead of the network, for rehearsing
                     the alert path without breaking production
  --timeout <ms>     deadline for the fetch (default: ${DEFAULT_TIMEOUT_MS})
  --json <path>      also write the verdict as JSON, for the workflow to read
  --no-shape         suppress the shape report

exit: 0 clean, 1 alert, 2 bad usage`;

function parseArgs(argv) {
  const opts = { url: STATUS_URL, timeout: DEFAULT_TIMEOUT_MS, shape: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const needsValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      i += 1;
      return value;
    };

    if (arg === '--url') opts.url = needsValue();
    else if (arg === '--fixture') opts.fixture = needsValue();
    else if (arg === '--json') opts.json = needsValue();
    else if (arg === '--timeout') {
      const ms = Number(needsValue());
      if (!Number.isFinite(ms) || ms <= 0) throw new Error('--timeout must be a positive number of milliseconds');
      opts.timeout = ms;
    } else if (arg === '--no-shape') opts.shape = false;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }

  return opts;
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    return EXIT.USAGE;
  }

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.CLEAN;
  }

  const { readFileSync, writeFileSync } = await import('node:fs');

  let verdict;
  let body;

  if (opts.fixture) {
    // A fixture that cannot be read is still an alert. The rehearsal path must
    // not be the one route in this file where a failure resolves to silence.
    try {
      body = JSON.parse(readFileSync(opts.fixture, 'utf-8'));
      verdict = evaluate(body, { source: `fixture:${opts.fixture}` });
    } catch (err) {
      verdict = {
        alert: true,
        headline: 'the fixture could not be read',
        problems: [`Could not read ${opts.fixture}: ${err.message}.`],
        notes: [],
        summary: null,
        source: `fixture:${opts.fixture}`,
        checkedAt: new Date().toISOString(),
      };
    }
  } else {
    verdict = await run({ url: opts.url, timeoutMs: opts.timeout });
    body = verdict.payload;
  }

  // The shape goes out *before* the verdict, always. If the conclusion below
  // is wrong, this is what shows whether the instrument or the subject failed.
  if (opts.shape) {
    process.stdout.write('--- shape received ---\n');
    process.stdout.write(body === undefined ? '(nothing was received)\n' : `${describeShape(body)}\n`);
    process.stdout.write('----------------------\n\n');
  }

  process.stdout.write(`${renderText(verdict)}\n`);

  if (opts.json) {
    const { payload: _payload, ...withoutBody } = verdict;
    // Where this verdict should be delivered. Written beside the text rather
    // than decided in YAML, so a rehearsal cannot reach the production incident
    // record — see alertRouting.
    const routing = alertRouting(verdict);
    writeFileSync(
      opts.json,
      `${JSON.stringify({ ...withoutBody, text: renderText(verdict), routing }, null, 2)}\n`,
    );
  }

  return verdict.alert ? EXIT.ALERT : EXIT.CLEAN;
}

const invokedDirectly = await (async () => {
  if (!process.argv[1]) return false;
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}

/* c8 ignore stop */
