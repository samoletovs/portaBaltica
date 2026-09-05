'use strict';

const cache = require('./cache.js');
const DELIVERY_INTERVAL_MS = 15 * 60 * 1000;

/** Cache the published schedule, not a price selected for a past interval. */
async function loadSchedule(url, fetcher, options) {
  // Date bounds roll forward at midnight; the named scope distinguishes a
  // two-day schedule from the insights endpoint's trailing-history window.
  const key = cache.requestKey('elering-schedule:' + options.scope, url, ['start', 'end']);
  const result = await cache.memo(key, DELIVERY_INTERVAL_MS, options.graceMs, async function () {
    const payload = await fetcher(url);
    const raw = payload && payload.data;
    if (!raw || payload.success === false || !Object.values(raw).some(function (rows) {
      return Array.isArray(rows) && rows.some(function (p) {
        return p && Number.isFinite(p.timestamp) && Number.isFinite(p.price);
      });
    })) {
      throw Object.assign(new Error('Elering returned no priced intervals'), { reason: 'no-reading' });
    }
    const data = {};
    Object.keys(raw).forEach(function (zone) {
      if (!Array.isArray(raw[zone])) return;
      data[zone] = raw[zone].filter(function (p) {
        return p && Number.isFinite(p.timestamp);
      }).map(function (p) {
        return { timestamp: p.timestamp, price: Number.isFinite(p.price) ? p.price : null };
      });
    });
    return { data: data, retrievedAt: new Date().toISOString() };
  });
  return {
    data: result.value.data,
    meta: { retrievedAt: result.value.retrievedAt, stale: result.servedAfterFailure },
  };
}

/** Elering's current delivery intervals are 15 minutes; a missing row is not a longer interval. */
function currentInterval(rows, nowMs) {
  const ordered = (rows || []).filter(function (p) {
    return p && Number.isFinite(p.timestamp);
  }).slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
  const at = nowMs === undefined ? Date.now() : nowMs;
  return ordered.find(function (p) {
    return p.timestamp * 1000 <= at && at < p.timestamp * 1000 + DELIVERY_INTERVAL_MS;
  }) || null;
}

module.exports = {
  currentInterval: currentInterval,
  loadSchedule: loadSchedule,
  DELIVERY_INTERVAL_MS: DELIVERY_INTERVAL_MS,
};
