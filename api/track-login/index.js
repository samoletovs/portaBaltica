const https = require('https');
const rateLimit = require('../shared/rateLimit.js');
const { withSecurity } = require('../shared/securityHeaders.js');

/**
 * POST /api/track-login
 *
 * Sends a notification when somebody opens the dashboard. Called from
 * `App.tsx` on mount, unauthenticated, from every visitor's browser.
 *
 * WHAT THIS ENDPOINT ACTUALLY IS
 * ------------------------------
 * Not a login tracker. Nobody can log in: `staticwebapp.config.json` answers
 * 404 for `/.auth/login/github`, `/aad` and `/twitter`, and `/.auth/me`
 * returns `{"clientPrincipal": null}` — verified against production. So
 * `x-ms-client-principal` is never populated, the branch below that reads it
 * has never once executed, and every notification this has ever sent said
 * `User: anonymous`.
 *
 * It is a page-view beacon that cannot identify anybody, fired once per
 * dashboard mount. The parsing is kept because it becomes correct the day an
 * auth provider is enabled, and deleting it would be a silent regression then
 * — but it is dead today, and is documented as dead rather than left looking
 * load-bearing.
 *
 * WHY A PER-IP LIMIT IS NECESSARY AND NOT SUFFICIENT
 * --------------------------------------------------
 * This was the only one of seventeen endpoints that never called
 * `rateLimit.check`, though `api/shared/rateLimit.js` says in as many words to
 * use it as the first thing in every public endpoint. Anonymous, POST-only,
 * and every request sent an outbound message to somebody's phone — so an
 * unlimited caller got unlimited notifications and spent the Free tier's
 * invocation quota doing it.
 *
 * But a per-IP limit does not protect a notification sink. It bounds one
 * caller to sixty a minute; a hundred callers still make six thousand, and the
 * limiter's state is per-instance, so scale-out multiplies it again. The thing
 * being protected is not this function's CPU. It is a person's attention and
 * Telegram's own rate limit, and neither of those is per-IP.
 *
 * So the notification carries a GLOBAL budget as well: at most one message per
 * NOTIFY_INTERVAL_MS, however many visits arrive and from wherever.
 *
 * Bursts are coalesced rather than dropped. A visit arriving inside the
 * interval increments a counter, and the next message carries it — "And 12
 * more in the last 4 minutes". Nothing is lost, because the count is the only
 * real information here: the identity is always `anonymous` and always will
 * be. A beacon that says "somebody visited" twelve times tells you less than
 * one that says twelve people did, so this is more informative than the
 * unbounded version as well as bounded.
 *
 * The reader never waits on any of it. The response does not depend on the
 * notification succeeding, and never did.
 */

const TELEGRAM_NOTIFY_URL = process.env.TELEGRAM_NOTIFY_URL || '';

/** The floor between two outbound notifications, across all callers. */
const NOTIFY_INTERVAL_MS =
  Number(process.env.PB_NOTIFY_INTERVAL_MS) > 0
    ? Number(process.env.PB_NOTIFY_INTERVAL_MS)
    : 5 * 60 * 1000;

/**
 * Process-wide notification state.
 *
 * In-process, so on a scaled-out plan the true ceiling is
 * `N_instances × 1 per interval`. That is the caveat `rateLimit.js` documents
 * for itself, and the same answer applies: a single instance still cannot
 * flood on its own, which is a large improvement on no ceiling at all.
 */
const notifyState = { lastSentAt: 0, suppressed: 0, suppressedSince: 0 };

function describeSuppressed(count, sinceMs, now) {
  if (count <= 0) return '';
  const minutes = Math.max(1, Math.round((now - sinceMs) / 60000));
  return '\nAnd ' + count + ' more in the last ' + minutes + ' minute' + (minutes === 1 ? '' : 's');
}

function postNotification(message) {
  return new Promise(function (resolve) {
    let parsed;
    try {
      parsed = new URL(TELEGRAM_NOTIFY_URL);
    } catch (error) {
      // No notifier configured. Not an error: the caller's contract is the
      // same either way, and this used to throw on every single request.
      return resolve();
    }

    const body = JSON.stringify({ message });
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    };
    const req = https.request(opts, function (res) {
      res.resume();
      resolve();
    });
    req.on('timeout', function () { req.destroy(); resolve(); });
    req.on('error', function () { resolve(); });
    req.write(body);
    req.end();
  });
}

/**
 * Decides whether this visit sends a message, and what it says.
 *
 * Exported for the tests, because what this endpoint emits and how often is
 * the whole of its behaviour — asserting on the response body would be
 * asserting on the one part that never varies.
 */
function planNotification(now, userInfo) {
  if (!TELEGRAM_NOTIFY_URL) return { send: false, reason: 'not-configured' };

  if (notifyState.lastSentAt !== 0 && now - notifyState.lastSentAt < NOTIFY_INTERVAL_MS) {
    if (notifyState.suppressed === 0) notifyState.suppressedSince = notifyState.lastSentAt;
    notifyState.suppressed += 1;
    return { send: false, reason: 'coalesced', suppressed: notifyState.suppressed };
  }

  const extra = describeSuppressed(notifyState.suppressed, notifyState.suppressedSince, now);
  const message =
    '\uD83D\uDC64 portaBaltica visit\n\nUser: ' +
    userInfo +
    '\nTime: ' +
    new Date(now).toISOString() +
    extra;

  notifyState.lastSentAt = now;
  notifyState.suppressed = 0;
  notifyState.suppressedSince = 0;
  return { send: true, message: message };
}

/** Test seam. The module holds process-wide state by design. */
function resetNotifyState() {
  notifyState.lastSentAt = 0;
  notifyState.suppressed = 0;
  notifyState.suppressedSince = 0;
}

const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  try {
    // Dead today — see the note above. Correct the day auth is enabled.
    const header = req.headers && req.headers['x-ms-client-principal'];
    let userInfo = 'anonymous';
    if (header) {
      try {
        const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
        userInfo = principal.userDetails || principal.userId || 'authenticated';
      } catch { /* ignore */ }
    }

    const plan = planNotification(Date.now(), userInfo);
    if (plan.send) await postNotification(plan.message);

    context.res = {
      status: 200,
      // This response used to carry no Content-Type at all, so the host chose
      // `text/plain` for a JSON body — the one place on this site where a
      // missing `nosniff` met a content type browsers actually sniff.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false }),
    };
  }
};

module.exports = withSecurity(handler);
module.exports.planNotification = planNotification;
module.exports.resetNotifyState = resetNotifyState;
module.exports.NOTIFY_INTERVAL_MS = NOTIFY_INTERVAL_MS;
