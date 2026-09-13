const INDICATORS = require('../shared/indicators.js');
const comparison = require('../shared/balticCompare.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

/** GET /api/baltic-compare?indicator=gdp&years=5 or ?list=1. */
const handler = async function (context, req) {
  const query = req.query || {};
  if (query.list) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify({
        indicators: Object.keys(INDICATORS).map(function (key) {
          return {
            id: key, title: INDICATORS[key].title, unit: INDICATORS[key].unit,
            dataset: INDICATORS[key].dataset, freq: INDICATORS[key].freq,
          };
        }),
      }),
    };
    return;
  }
  context.res = await comparison.buildResponse(query.indicator || '', parseInt(query.years, 10) || 5);
};

const cached = withCache(handler, {
  ...comparison.CACHE_OPTIONS,
  keyOn: ['indicator', 'years', 'list'],
});

module.exports = withSecurity(async function (context, req) {
  const query = req.query || {};
  // Preserve the legacy parsing, but default/explicit years share the batch
  // item's exact key. List mode remains a separate response and cache identity.
  try {
    await cached(context, {
      ...req, query: { ...query, years: String(parseInt(query.years, 10) || 5) },
    });
  } catch (error) {
    // A shared in-flight item may have been started by the batch reader.
    if (!error.response) throw error;
    context.res = error.response;
  }
});
module.exports.GEOS = comparison.GEOS;
module.exports.REFERENCE_GEO = comparison.REFERENCE_GEO;
module.exports.buildReference = comparison.buildReference;
module.exports.referenceIsComparable = comparison.referenceIsComparable;
