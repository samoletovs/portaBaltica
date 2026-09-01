/**
 * GET /api/trade-partners
 *
 * Latvia's goods trade for the newest month CSP has published, broken down by
 * partner country and by commodity chapter, in both directions.
 *
 * The Trade tile has carried headline exports and imports from Eurostat since
 * it existed. It has never been able to answer "to whom" or "of what", which
 * are the two questions a reader asks immediately afterwards. `ats_kn8_men`
 * answers both, and had 646 siblings on data.gov.lv that nothing in this repo
 * touched.
 *
 * WHERE THE PERIOD COMES FROM, AND WHY THAT IS THE WHOLE DESIGN
 * -------------------------------------------------------------
 * From `MAX("Gads" * 100 + "Menesis")` over the data — never from the
 * resource's `created`, never from the package's `metadata_modified`, never
 * from `datastore_active`.
 *
 * That is not defensive habit, it is the specific lesson this project paid for.
 * Three maritime datasets served header-only CSVs for eighteen consecutive
 * weeks with `datastore_active` true throughout, and the code kept returning
 * the last good resource without complaint. The same trap is live on this very
 * portal today: `maksatnespejas-procesi` reports `datastore_active: true`,
 * 15,660 real rows and 23 real fields, and its newest proceeding began
 * **2020-10-28**. Six years frozen, and completely invisible to anything that
 * reads the metadata.
 *
 * So the period this endpoint reports is a fact about the rows. If CSP stops
 * publishing, `dataAsOf` stops advancing, `/api/system-status` marks the source
 * stale against the cadence it declares, and a reader is told — rather than
 * being shown June's figures under September's heading for ever.
 *
 * WHY THE YEAR-ON-YEAR IS ADDRESSED BY LABEL
 * ------------------------------------------
 * Each year is a separate resource, so the comparison reads a different table.
 * It is addressed by period *label* — June 2026 against June 2025 — in the same
 * way `portStats.ts` resolves `sameQuarterLastYear`, and never by taking "the
 * previous N rows". When the prior year's resource is absent the comparison is
 * **omitted entirely**; there is no fallback to some other month, because a
 * comparison against the wrong period is worse than no comparison at all.
 */

const { withSecurity } = require('../shared/securityHeaders.js');
const { withCache } = require('../shared/responseCache.js');
const ckan = require('../shared/ckan.js');
const trade = require('../shared/tradeStats.js');

/** Deadline for every upstream call. Measured: aggregates answer in 250-450ms. */
const DEADLINE_MS = 20000;

/** The same-name resource for the previous year, or null if it was never published. */
function priorYearResource(pkg, direction, year) {
  const wanted = trade.resourceNameFor(direction, year - 1);
  const resources = (pkg && pkg.resources) || [];
  const found = resources.filter(function (r) {
    return r && r.datastore_active && r.name === wanted;
  });
  return found.length > 0 ? { id: found[0].id, name: found[0].name } : null;
}

/** Rank rows into the shape the panel renders, with a remainder it can state. */
function rankPartners(records, totalEur) {
  const rows = [];
  let ranked = 0;
  for (const record of records || []) {
    const value = trade.num(record.value_eur);
    if (value === null) continue;
    ranked += value;
    const code = String(record.partner || '').trim().toUpperCase();
    rows.push({
      code: code,
      // Null when the code is not one we can name. The panel renders the code
      // itself in that case rather than inventing a country.
      name: trade.partnerName(code),
      valueEur: value,
      share: totalEur ? value / totalEur : null,
    });
  }
  return { rows: rows, rankedEur: ranked };
}

function rankChapters(records, totalEur) {
  const rows = [];
  let ranked = 0;
  for (const record of records || []) {
    const value = trade.num(record.value_eur);
    if (value === null) continue;
    const chapter = trade.num(record.chapter);
    if (chapter === null) continue;
    ranked += value;
    rows.push({
      code: trade.chapterCode(chapter),
      name: trade.chapterName(chapter),
      valueEur: value,
      share: totalEur ? value / totalEur : null,
    });
  }
  return { rows: rows, rankedEur: ranked };
}

/** Everything one direction needs, for the month the selection already found. */
async function readDirection(pkg, direction, selection) {
  const options = { deadlineMs: DEADLINE_MS };
  const resource = selection.resource;
  const key = selection.key;
  const period = trade.periodLabel(key);
  if (period === null) {
    throw new Error('No period in ' + resource.name + ': the resource carries no readable month');
  }

  const results = await Promise.all([
    trade.runSql(trade.totalSql(resource.id, key), options),
    trade.runSql(trade.partnersSql(resource.id, key), options),
    trade.runSql(trade.chaptersSql(resource.id, key), options),
  ]);
  const totalRows = results[0];
  const partnerRows = results[1];
  const chapterRows = results[2];

  const totalEur = trade.num(totalRows[0] && totalRows[0].value_eur);
  const lines = trade.num(totalRows[0] && totalRows[0].lines);

  // Same month, previous year, from the previous year's own resource. Omitted
  // rather than approximated when that resource does not exist.
  let previous = null;
  const year = Math.floor(key / 100);
  const prior = priorYearResource(pkg, direction, year);
  if (prior) {
    const priorKey = key - 100;
    const priorRows = await trade.runSql(trade.totalSql(prior.id, priorKey), options);
    const priorEur = trade.num(priorRows[0] && priorRows[0].value_eur);
    if (priorEur !== null && priorEur !== 0) {
      previous = {
        period: trade.periodLabel(priorKey),
        valueEur: priorEur,
        changePct: totalEur === null ? null : ((totalEur - priorEur) / priorEur) * 100,
      };
    }
  }

  const partners = rankPartners(partnerRows, totalEur);
  const chapters = rankChapters(chapterRows, totalEur);

  return {
    label: trade.DIRECTIONS[direction].label,
    period: period,
    totalEur: totalEur,
    // How many CN-8 lines the month contains. Named as lines rather than as
    // anything time-shaped: it is a count of rows, and claims no unit.
    lines: lines,
    partners: partners.rows,
    // What the ranked partners leave out, so the panel can say "and the rest"
    // rather than implying the top twelve are everything.
    otherPartnersEur: totalEur === null ? null : Math.max(0, totalEur - partners.rankedEur),
    chapters: chapters.rows,
    otherChaptersEur: totalEur === null ? null : Math.max(0, totalEur - chapters.rankedEur),
    previous: previous,
  };
}

const handler = async function (context, req) {
  try {
    const pkg = await ckan.ckan('package_show', { id: trade.DATASET }, { deadlineMs: DEADLINE_MS });

    // Both directions resolved by reading each candidate's newest month, not
    // by trusting a metadata timestamp. The selection lives in
    // `tradeStats.selectNewestByData` so `/api/system-status` can call the
    // same one rather than keeping a second copy that could disagree.
    const selections = await Promise.all([
      trade.selectNewestByData(pkg, 'exports', { deadlineMs: DEADLINE_MS }),
      trade.selectNewestByData(pkg, 'imports', { deadlineMs: DEADLINE_MS }),
    ]);
    const chosen = { exports: selections[0], imports: selections[1] };

    const missing = Object.keys(chosen).filter(function (d) { return !chosen[d]; });
    if (missing.length > 0) {
      throw new Error('No resource with a readable month for: ' + missing.join(', '));
    }

    const sides = await Promise.all([
      readDirection(pkg, 'exports', chosen.exports),
      readDirection(pkg, 'imports', chosen.imports),
    ]);
    const exportsSide = sides[0];
    const importsSide = sides[1];

    // The two directions are separate resources and can be published a month
    // apart. Stating one period for both would date half the panel to a month
    // it has not reached, so the older of the two is what the panel is headed
    // with — the same reasoning as `/api/port-data`'s `dataFrom`.
    const periods = [exportsSide.period, importsSide.period].filter(Boolean).sort();
    const dataAsOf = periods.length > 0 ? periods[0] : null;

    const balanceEur = exportsSide.totalEur === null || importsSide.totalEur === null
      ? null
      : exportsSide.totalEur - importsSide.totalEur;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' },
      body: JSON.stringify({
        country: 'LV',
        // Said out loud in the payload, not left to the component. This is a
        // Latvian national source on a dashboard with a country selector, and a
        // consumer must be able to tell that without reading the tile.
        countryOnly: true,
        exports: exportsSide,
        imports: importsSide,
        balanceEur: balanceEur,
        unit: 'EUR',
        // The month the statistics describe, read from the rows. Not when we
        // fetched them, and not when the file was uploaded.
        dataAsOf: dataAsOf,
        periodsDiffer: exportsSide.period !== importsSide.period,
        source: 'Centrala statistikas parvalde, ats_kn8_men (data.gov.lv, CC BY 4.0)',
        // Read by the panel's stale story rather than by the panel's markup:
        // `withCache` may serve this body past its TTL when upstream fails, and
        // `AGENTS.md` is emphatic that an INSTANT survives caching where a
        // duration does not. So this is the retrieval moment, and any age is
        // subtracted at the point of render.
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

module.exports = withSecurity(withCache(handler, {
  name: 'trade-partners',
  // The handler reads no query parameters at all — there is one Latvian
  // dataset and it always serves its newest month. An empty list is therefore
  // the true declaration rather than an omission, and `responseKey` namespaces
  // by endpoint name, so no other endpoint can land on this key.
  keyOn: [],
  // Six hours. The upstream is monthly, so this could be far longer; six hours
  // bounds how long a *publication* goes unnoticed while still costing four
  // upstream reads a day rather than one per visitor.
  ttlMs: 21600000,
  graceMs: 86400000,
  staleWhileRevalidate: true,
}));

// Exported for tests, which drive the ranking and the year-on-year selection
// without a network.
module.exports.__internals = {
  priorYearResource: priorYearResource,
  rankPartners: rankPartners,
  rankChapters: rankChapters,
};
