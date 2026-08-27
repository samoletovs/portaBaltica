const rateLimit = require('../shared/rateLimit.js');
const INDICATORS = require('../shared/indicators.js');
const es = require('../shared/eurostat.js');
const { withSecurity } = require('../shared/securityHeaders.js');

const GEOS = ['LV', 'EE', 'LT'];

/**
 * GET /api/baltic-compare?indicator=gdp&years=5
 * GET /api/baltic-compare?list=1
 *
 * Latvia vs Estonia vs Lithuania, from the Eurostat dissemination API.
 *
 * The indicator definitions live in ../shared/indicators.js so the contract
 * test asserts against exactly what this handler serves. `assumptions` is
 * echoed back on every response: it is empty for a correctly pinned indicator,
 * and a non-empty value means the parser had to guess which slice of the cube
 * to read — the failure mode that previously produced blank and mislabelled
 * charts without anything going red.
 */
const handler = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const query = req.query || {};

  if (query.list) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify({
        indicators: Object.keys(INDICATORS).map(function (key) {
          return {
            id: key,
            title: INDICATORS[key].title,
            unit: INDICATORS[key].unit,
            dataset: INDICATORS[key].dataset,
            freq: INDICATORS[key].freq,
          };
        }),
      }),
    };
    return;
  }

  const indicator = query.indicator || '';
  const def = INDICATORS[indicator];
  if (!def) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown indicator. Available: ' + Object.keys(INDICATORS).join(', ') }),
    };
    return;
  }

  const years = parseInt(query.years, 10) || 5;

  try {
    const url = es.buildUrl(def, years, GEOS);
    const data = await es.httpJson(url, { deadlineMs: 20000 });
    const parsed = es.parseJsonStat(data, GEOS);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        indicator: indicator,
        title: def.title,
        unit: def.unit,
        countries: parsed.countries,
        assumptions: parsed.assumptions,
        source: 'Eurostat (' + def.dataset + ')',
        dataset: def.dataset,
        years: years,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: indicator,
        error: error.message,
        source: 'Eurostat (' + def.dataset + ')',
      }),
    };
  }
};

module.exports = withSecurity(handler);
