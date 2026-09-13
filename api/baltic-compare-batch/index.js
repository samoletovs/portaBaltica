'use strict';

const { MAX_BATCH_SIZE, MAX_YEARS, readComparison } = require('../shared/balticCompare.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

/**
 * GET ?indicators=gdp,inflation&years=5
 * Ordered, independent results; a failed item is never null data or cached.
 * Only named registry entries can reach upstream, at most eight per request.
 */
const handler = async function (context, req) {
  const query = req.query || {};
  const raw = query.indicators;
  const years = query.years === undefined ? 5 : Number(query.years);
  const ids = typeof raw === 'string' && raw.length <= MAX_BATCH_SIZE * 65 ? raw.split(',') : [];
  if (query.list !== undefined ||
      ids.length === 0 || ids.length > MAX_BATCH_SIZE ||
      ids.some(function (id) { return !/^[a-z][a-z0-9_]{0,63}$/.test(id); }) ||
      new Set(ids).size !== ids.length ||
      (query.years !== undefined && (typeof query.years !== 'string' || !/^[1-9]\d*$/.test(query.years))) ||
      !Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        error: 'Use 1–' + MAX_BATCH_SIZE + ' unique indicator IDs and integer years from 1–' + MAX_YEARS +
          '. Metadata is available at /api/baltic-compare?list=1.',
      }),
    };
    return;
  }
  const reads = await Promise.all(ids.map(async function (id) {
    const result = await readComparison(id, years);
    return { resolvedAt: Date.now(), result };
  }));
  const completedAt = Date.now();
  const results = reads.map(function (read) {
    const result = read.result;
    // A warm item can wait for a slow sibling. Include that wait in its age,
    // rather than extending its browser TTL by the batch's slowest fetch.
    if (result.status === 200) result.cache.ageSeconds += Math.floor((completedAt - read.resolvedAt) / 1000);
    return result;
  });
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ results }),
  };
};

// Rate-limit every HTTP request as before. TTL/grace zero prevent a successful
// envelope from freezing failures, stale ages, or its members' independent TTLs.
module.exports = withSecurity(withCache(handler, {
  name: 'baltic-compare-batch',
  keyOn: ['indicators', 'years', 'list'],
  ttlMs: 0,
  graceMs: 0,
}));
