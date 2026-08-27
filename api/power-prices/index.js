const es = require('../shared/eurostat.js');
const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');

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
 *
 * The window is two days and that is deliberate: "day-ahead" means tomorrow,
 * Nord Pool publishes it around 13:00 CET, and a card that hid it would be
 * throwing away the only genuinely forward-looking number on the dashboard.
 *
 * What was wrong was the arithmetic on top of it. Every aggregate — the
 * decoupled share, each zone's min, max and average, the widest spread — was
 * computed across the whole 184-interval window while the card described it as
 * "today". Today alone is 96 of those intervals. So the summaries are now
 * scoped to a named day and tomorrow is reported separately, which also gives
 * the client something to draw a boundary with: Elering moved to 15-minute
 * resolution, so the series carries two days of quarter-hours whose `HH:mm`
 * labels repeat, and 00:00 appears twice with nothing to say which is which.
 */

const CACHE_SECONDS = 15 * 60;

/** Summary of one day's intervals for one zone. */
function summariseZone(rows, id) {
  return summarise(rows.map(function (r) { return r[id]; })
    .filter(function (v) { return typeof v === 'number'; }));
}

/** Decoupling over a named set of intervals, never over a window we then mislabel. */
function couplingOf(rows) {
  let decoupled = 0;
  let widest = { spread: 0, time: null };
  rows.forEach(function (r) {
    if (r.spread > COUPLED_TOLERANCE_EUR) decoupled++;
    if (r.spread > widest.spread) widest = { spread: r.spread, time: r.time };
  });
  return {
    intervals: rows.length,
    decoupledIntervals: decoupled,
    widestSpread: widest.time ? widest : null,
  };
}

const handler = async function (context, req) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);

  const todayKey = start.toISOString().slice(0, 10);
  const tomorrowKey = new Date(start.getTime() + 86400e3).toISOString().slice(0, 10);

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
    let currentInterval = null;

    for (const ts of timeline) {
      const row = byTimestamp.get(ts);
      const baltic = ['ee', 'lv', 'lt']
        .map(function (z) { return row[z]; })
        .filter(function (v) { return typeof v === 'number'; });
      if (baltic.length < 2) continue;

      const spread = +(Math.max.apply(null, baltic) - Math.min.apply(null, baltic)).toFixed(2);
      const iso = new Date(ts * 1000).toISOString();

      const entry = {
        time: iso,
        // The calendar day this interval belongs to, so the client can separate
        // two days of repeating quarter-hour labels without re-parsing dates.
        day: iso.slice(0, 10),
        ee: typeof row.ee === 'number' ? row.ee : null,
        lv: typeof row.lv === 'number' ? row.lv : null,
        lt: typeof row.lt === 'number' ? row.lt : null,
        fi: typeof row.fi === 'number' ? row.fi : null,
        spread: spread,
      };
      series.push(entry);
      if (ts <= nowSeconds) currentInterval = entry;
    }

    const todayRows = series.filter(function (s) { return s.day === todayKey; });
    const tomorrowRows = series.filter(function (s) { return s.day === tomorrowKey; });

    const today = couplingOf(todayRows);
    const tomorrow = couplingOf(tomorrowRows);

    const zones = ZONES.map(function (zone) {
      return Object.assign({
        id: zone.id,
        label: zone.label,
        flag: zone.flag,
        current: currentInterval ? currentInterval[zone.id] : null,
        // Tomorrow is published separately and is often not there yet, so it is
        // reported beside today rather than folded into one range that belongs
        // to neither day.
        tomorrow: tomorrowRows.length > 0 ? summariseZone(tomorrowRows, zone.id) : null,
      }, summariseZone(todayRows, zone.id));
    });

    const currentSpread = currentInterval ? currentInterval.spread : null;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_SECONDS },
      body: JSON.stringify({
        unit: 'EUR/MWh',
        zones: zones,
        series: series,
        // Which day every "today" figure below describes, so the client never
        // has to infer it from the server's clock.
        today: todayKey,
        tomorrow: tomorrowRows.length > 0 ? tomorrowKey : null,
        currentTime: currentInterval ? currentInterval.time : null,
        currentSpread: currentSpread,
        coupled: currentSpread !== null ? currentSpread <= COUPLED_TOLERANCE_EUR : null,
        // Scoped to `today`. These were previously computed across both days
        // and then described as today's, which overstated or understated the
        // decoupled share by however different tomorrow happened to be.
        decoupledIntervals: today.decoupledIntervals,
        totalIntervals: today.intervals,
        widestSpread: today.widestSpread,
        tomorrowOutlook: tomorrowRows.length > 0 ? {
          date: tomorrowKey,
          decoupledIntervals: tomorrow.decoupledIntervals,
          totalIntervals: tomorrow.intervals,
          widestSpread: tomorrow.widestSpread,
        } : null,
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

module.exports = withSecurity(withCache(handler, {
  name: 'power-prices',
  keyOn: [],
  ttlMs: 900000,
  graceMs: 3600000,
  staleWhileRevalidate: true,
}));
