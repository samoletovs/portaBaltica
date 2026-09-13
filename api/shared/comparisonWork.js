'use strict';

const MAX_ACTIVE = 8;
const MAX_QUEUED = 64;
const DEADLINE_MS = 20000;
let active = 0;
const queue = [];

function unavailable(message) {
  return Object.assign(new Error(message), { status: 503, code: 'COMPARISON_CAPACITY' });
}

function drainQueue() {
  while (active < MAX_ACTIVE && queue.length > 0) {
    const next = queue.shift();
    next();
  }
}

/**
 * Bound work across batches AND the legacy single route on this worker.
 * Queueing spends the same 20-second budget as HTTP, never another deadline.
 * Cache hits and coalesced readers do not occupy a slot.
 */
function run(fetcher) {
  if (active >= MAX_ACTIVE && queue.length >= MAX_QUEUED) {
    return Promise.reject(unavailable('Comparison capacity reached. Please retry.'));
  }
  return new Promise(function (resolve, reject) {
    const started = Date.now();
    let timer;
    const start = function () {
      clearTimeout(timer);
      const remaining = DEADLINE_MS - (Date.now() - started);
      if (remaining <= 0) {
        reject(unavailable('Comparison queue deadline exceeded. Please retry.'));
        return;
      }
      active++;
      Promise.resolve().then(function () { return fetcher(remaining); }).then(resolve, reject).finally(function () {
        active--;
        drainQueue();
      });
    };
    if (active < MAX_ACTIVE) start();
    else {
      queue.push(start);
      timer = setTimeout(function () {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(unavailable('Comparison queue deadline exceeded. Please retry.'));
      }, DEADLINE_MS);
    }
  });
}

module.exports = { run, MAX_ACTIVE, MAX_QUEUED, DEADLINE_MS };
