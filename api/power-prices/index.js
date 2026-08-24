const rateLimit = require('../shared/rateLimit.js');
const es = require('../shared/eurostat.js');

const ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';

/** Estonia, Finland, Latvia and Lithuania are one Nord Pool market — when they
 *  are coupled their day-ahead prices are identical to the cent. They separate
 *  only when a cross-border link is congested, and the size of that gap is the
 *  clearest daily signal of Baltic grid stress there is. Elering returns all
 *  four zones in a single response, so this costs one upstream call. */
const ZONES = [
  { id: 'ee', label: 'Estonia', flag: '🇪🇪' },
  { id: 'lv', label: 'Latvia', flag: '🇱🇻' },
  { id: 'lt', label: 'Lithuania', flag: '🇱🇹' },
  { id: 'fi', label: 'Finland', flag: '🇫🇮' },
];

// Nord Pool clears to the cent, so anything at or below this is the same price.
const COUPLED_TOLERANCE_EUR = 0.01;

function summarise(prices) {
  if (prices.length === 0) return { min: null, max: null, avg: null };
  let min = prices[0];
  let max = prices[0];
  let sum = 0;
  for (const p of prices) {
    if (p < min) min = p;
    if (p > max) max = p;
    sum += p;
  }
  return { min: +min.toFixed(2), max: +max.toFixed(2), avg: +(sum / prices.length).toFixed(2) };
}

/**
 * GET /api/power-prices
 *
 * Day-ahead electricity prices for all Baltic bidding zones plus Finland,
 * with the spread between them and whether the market is currently coupled.
 */
module.exports = async function (context, req) {
  const rl = rateLimit.check(req);
  if (rl) { context.res = rl; return; }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);

  const url = ELERING_URL +
    '?start=' + encodeURIComponent(start.toISOString()) +
    '&end=' + encodeURIComponent(end.toISOString());

  try {
    const payload = await es.httpJson(url, { deadlineMs: 10000 });
    const raw = (payload && payload.data) || {};

    // Align every zone on a shared timeline so a spread is always computed
    // across zones within the same interval.
    const byTimestamp = new Map();
    for (const zone of ZONES) {
      for (const point of raw[zone.id] || []) {
        if (!byTimestamp.has(point.timestamp)) byTimestamp.set(point.timestamp, {});
        byTimestamp.get(point.timestamp)[zone.id] = point.price;
      }
    }

    const timeline = Array.from(byTimestamp.keys()).sort(function (a, b) { return a - b; });
    const nowSeconds = Math.floor(Date.now() / 1000);

    const series = [];
    let decoupledIntervals = 0;
    let widestSpread = { spread: 0, time: null };
    let currentInterval = null;

    for (const ts of timeline) {
      const row = byTimestamp.get(ts);
      const baltic = ['ee', 'lv', 'lt']
        .map(function (z) { return row[z]; })
        .filter(function (v) { return typeof v === 'number'; });
      if (baltic.length < 2) continue;

      const spread = +(Math.max.apply(null, baltic) - Math.min.apply(null, baltic)).toFixed(2);
      if (spread > COUPLED_TOLERANCE_EUR) decoupledIntervals++;
      if (spread > widestSpread.spread) widestSpread = { spread: spread, time: new Date(ts * 1000).toISOString() };

      const entry = {
        time: new Date(ts * 1000).toISOString(),
        ee: typeof row.ee === 'number' ? row.ee : null,
        lv: typeof row.lv === 'number' ? row.lv : null,
        lt: typeof row.lt === 'number' ? row.lt : null,
        fi: typeof row.fi === 'number' ? row.fi : null,
        spread: spread,
      };
      series.push(entry);
      if (ts <= nowSeconds) currentInterval = entry;
    }

    const zones = ZONES.map(function (zone) {
      const prices = series
        .map(function (s) { return s[zone.id]; })
        .filter(function (v) { return typeof v === 'number'; });
      return Object.assign({
        id: zone.id,
        label: zone.label,
        flag: zone.flag,
        current: currentInterval ? currentInterval[zone.id] : null,
      }, summarise(prices));
    });

    const currentSpread = currentInterval ? currentInterval.spread : null;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        unit: 'EUR/MWh',
        zones: zones,
        series: series,
        currentTime: currentInterval ? currentInterval.time : null,
        currentSpread: currentSpread,
        coupled: currentSpread !== null ? currentSpread <= COUPLED_TOLERANCE_EUR : null,
        decoupledIntervals: decoupledIntervals,
        totalIntervals: series.length,
        widestSpread: widestSpread.time ? widestSpread : null,
        source: 'Elering (Nord Pool day-ahead)',
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, source: 'Elering (Nord Pool day-ahead)' }),
    };
  }
};
