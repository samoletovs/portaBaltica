/**
 * The one parser for the ECB daily reference-rate XML.
 *
 * There used to be two, and they disagreed about what the document could look
 * like. `economy-data` extracted rates with
 *
 *     new RegExp("currency='" + code + "' rate='([\\d.]+)'")
 *
 * — single quotes only, `currency` before `rate`, exactly one space between
 * them — while `freshness.js` extracted the reference date with
 * `/time\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/`, which accepts either quote style
 * and any spacing. Both are valid XML for the same document, because attribute
 * quoting and spacing carry no meaning.
 *
 * **The two were not merely different, they were ordered**: the probe's
 * vocabulary was a strict superset of the consumer's. A disagreement between
 * them could therefore only ever fall one way — the status page reporting the
 * ECB healthy while the currency ticker rendered nothing, which is the
 * false-green this registry exists to remove. `AGENTS.md` states the general
 * form: a guard that reproduces the logic it guards is not a guard, it is a
 * second implementation that can disagree.
 *
 * The remedy is not a better regex. It is one parser, called by both, so that
 * neither side can fail to recognise a document the other accepts — if this
 * function stops reading the document, the probe and the ticker fail together.
 *
 * It reads `<Cube>` elements once and takes their attributes uniformly, so
 * there is no separate pattern for `time` and for `currency`/`rate` that could
 * drift apart again. `Cube` is matched with an optional namespace prefix
 * because the envelope carries one and a future document may put it on the
 * cubes too.
 *
 * ⚠️ **One parser is necessary and NOT sufficient, and the difference is why
 * `system-status` throws on an empty `rates` rather than trusting this.** A
 * shared parser removes *vocabulary* drift — disagreement about how the
 * document is spelled. It does nothing about *field* drift, because the two
 * callers read **different fields of the same parse**: `freshness.ecbXml`
 * reads `referenceDate`, and the currency ticker reads `rates`. Measured on a
 * document carrying a valid date and no rates at all:
 *
 *     parseDaily.referenceDate   2026-09-03
 *     parseDaily.rates           {}
 *     freshness.ecbXml           { at: '2026-09-03T23:59:59Z' }   <- STILL GREEN
 *
 * So the green outlives the ticker again, through one parser, with no
 * spelling disagreement anywhere. What closes that gap is the probe asserting
 * on **the field the consumer reads** rather than on the field the document
 * happens to carry — `api/system-status/index.js` refuses a parse whose
 * `rates` are empty. Both halves are load-bearing; removing either reopens
 * the fault from a different direction.
 */

const CUBE_ELEMENT = /<\s*(?:[\w.-]+:)?Cube\b([^>]*?)\/?>/gi;
const ATTRIBUTE = /([\w.-]+)\s*=\s*(["'])(.*?)\2/g;

/** Attributes of one element, as a plain object. */
function attributesOf(raw) {
  const out = {};
  let m;
  ATTRIBUTE.lastIndex = 0;
  while ((m = ATTRIBUTE.exec(raw)) !== null) out[m[1]] = m[3];
  return out;
}

/**
 * Parse the daily reference set.
 *
 * Returns `{ referenceDate, rates }` where `referenceDate` is the newest
 * `YYYY-MM-DD` the document carries (or null) and `rates` maps a currency code
 * to a finite number. A currency whose rate is not a finite number is dropped
 * rather than carried as `NaN`: a rate that cannot be read is not a rate, and
 * `NaN` would reach a reader as "NaN" beside a currency name.
 *
 * Never throws on shape. A document this cannot read yields
 * `{ referenceDate: null, rates: {} }`, and it is the caller's business to
 * decide what an empty answer means — which is the distinction
 * `fetchECBRates` and the status probe both now make explicitly.
 */
function parseDaily(xml) {
  const empty = { referenceDate: null, rates: {} };
  if (typeof xml !== 'string' || xml === '') return empty;

  const dates = [];
  const rates = {};
  let element;

  CUBE_ELEMENT.lastIndex = 0;
  while ((element = CUBE_ELEMENT.exec(xml)) !== null) {
    const attrs = attributesOf(element[1]);

    if (/^\d{4}-\d{2}-\d{2}$/.test(attrs.time || '')) dates.push(attrs.time);

    if (attrs.currency && attrs.rate !== undefined) {
      const value = Number(attrs.rate);
      if (Number.isFinite(value)) rates[attrs.currency.toUpperCase()] = value;
    }
  }

  dates.sort();
  return {
    referenceDate: dates.length > 0 ? dates[dates.length - 1] : null,
    rates: rates,
  };
}

module.exports = {
  parseDaily: parseDaily,
};
