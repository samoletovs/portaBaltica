'use strict';

const es = require('./eurostat.js');
const indicators = require('./indicators.js');

async function fetchEurostatSeries(key, years) {
  const def = indicators[key];
  if (!def || !Object.prototype.hasOwnProperty.call(indicators, key)) {
    throw new Error('No Eurostat definition for ' + key);
  }
  const data = await es.httpJson(es.buildUrl(def, years || 10, ['LV']), { deadlineMs: 20000 });
  const parsed = es.parseJsonStat(data, ['LV']);
  const lv = parsed.countries.LV;
  if (!lv || !lv.series.some(function (p) { return Number.isFinite(p.value); })) {
    throw new Error('Eurostat returned no data for ' + key);
  }
  return { series: lv.series, unit: def.unit, title: def.title, source: 'Eurostat (' + def.dataset + ')' };
}

function limitYears(series, years) {
  if (!(years > 0) || !series.length) return series;
  const indices = series.map(function (p) { return es.periodToMonthIndex(p.period); });
  const valid = indices.filter(function (index) { return index !== null; });
  if (!valid.length) return series;
  const cutoff = Math.max.apply(null, valid) - years * 12;
  return series.filter(function (_point, index) { return indices[index] !== null && indices[index] > cutoff; });
}

/** A single series may have time in any dimension; sparse indices still identify cells. */
function readPxWebSeries(data, transform) {
  if (!data || !data.value || !Array.isArray(data.id)) return null;
  const time = data.id.find(function (id) { return /^(time|tid)$/i.test(id); });
  if (!time || !data.dimension || !data.dimension[time]) return null;
  const category = data.dimension[time].category;
  if (!category || !category.index) return null;
  const labels = Array.isArray(category.index) ? category.index : Object.keys(category.index)
    .sort(function (a, b) { return category.index[a] - category.index[b]; });
  const sizes = data.id.map(function (id, i) {
    if (Array.isArray(data.size)) return data.size[i];
    const index = data.dimension[id] && data.dimension[id].category && data.dimension[id].category.index;
    return index ? Object.keys(index).length : 0;
  });
  if (!labels.length || sizes.some(function (size, i) {
    return size !== (data.id[i] === time ? labels.length : 1);
  })) return null;
  const series = labels.map(function (period, i) {
    const value = data.value[i];
    return { period: period, value: Number.isFinite(value) ? (transform ? transform(value) : value) : null };
  });
  return series.some(function (p) { return p.value !== null; }) ? series : null;
}

module.exports = { fetchEurostatSeries: fetchEurostatSeries, limitYears: limitYears, readPxWebSeries: readPxWebSeries };
