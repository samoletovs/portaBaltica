/**
 * What a data handler answers when it cannot build its payload.
 *
 * Two failures look alike from the outside and must not be answered alike:
 *
 *   - An upstream outage (data.gov.lv down, a partial scan, a missing
 *     resource). Not our fault, so it answers 200 `{unavailable: true}` with
 *     `no-store`: the page says "temporarily unavailable", `withCache` keeps
 *     serving its last good body, and the deployment stays green.
 *   - A bug in our own handler. That must stay a 5xx. The deploy gate's
 *     `status < 500` check is the only thing that notices a broken handler,
 *     and answering 200 here would let a regression ship green and render
 *     "No data" with no alert anywhere.
 *
 * Upstream failures reach a handler as plain `Error`s: `eurostat.httpText`
 * uses the `https` module, whose transport errors are plain, and `ckan.js`
 * throws plain errors for every portal failure. The engine's own error
 * subclasses are therefore a reliable sign of a code fault.
 */

const CODE_FAULTS = [TypeError, ReferenceError, SyntaxError, RangeError, EvalError, URIError];

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function isCodeFault(error) {
  return CODE_FAULTS.some(function (Fault) { return error instanceof Fault; });
}

function failureResponse(context, error) {
  if (isCodeFault(error)) {
    if (context && context.log && typeof context.log.error === 'function') context.log.error(error);
    // The message of a runtime error describes our internals, not the data.
    return { status: 500, headers: NO_STORE, body: JSON.stringify({ error: 'Internal error' }) };
  }
  return {
    status: 200,
    headers: NO_STORE,
    body: JSON.stringify({ unavailable: true, error: (error && error.message) || String(error) }),
  };
}

module.exports = { failureResponse, isCodeFault };
