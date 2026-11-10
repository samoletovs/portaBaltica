/**
 * Latvia's monthly goods trade by partner country and commodity chapter.
 *
 * The source is CSP's CN-8 dataset `ats_kn8_men` on data.gov.lv — 250,815 rows
 * in the 2026 imports resource alone, monthly, by partner country and by
 * eight-digit Combined Nomenclature code. The dashboard's Trade tile reads
 * Eurostat for headline exports and imports and has never had a partner or a
 * commodity breakdown, so this is new information rather than a fourth way of
 * saying the same thing.
 *
 * WHY THERE IS A MODULE HERE AND NOT JUST A HANDLER
 * -------------------------------------------------
 * `/api/system-status` has to probe the query the application actually makes.
 * `AGENTS.md` records three separate occasions where a probe restated its
 * subject's query instead of calling the builder, and every one of them drifted
 * silently — the maritime probe pinned one port while the app read four, and
 * the newsroom's collision guard rebuilt the collector's parameters while the
 * collector's default moved underneath it. So the builder lives here, the
 * handler calls it, the probe calls it, and the two cannot disagree.
 *
 * The SQL action was removed in November 2026. Read the newest row by year
 * AND month, then scan just that month's projected fields once for all three
 * aggregates. A partial scan must never become a plausible-looking total.
 */

'use strict';

const ckan = require('./ckan.js');

/** The CSP dataset. Imports and exports are separate resources, one pair per year. */
const DATASET = 'ats_kn8_men';

const DIRECTIONS = {
  exports: { namePrefix: 'ATS_eksports_KN8_', label: 'Exports' },
  imports: { namePrefix: 'ATS_imports_KN8_', label: 'Imports' },
};

/**
 * Resource name for one direction and year, e.g. `ATS_eksports_KN8_2025`.
 *
 * Year-on-year needs the *previous* year's resource, and `pickLatestActive`
 * only ever returns the newest. This is the one place the naming convention is
 * written down; both callers use it.
 */
function resourceNameFor(direction, year) {
  const spec = DIRECTIONS[direction];
  if (!spec) throw new Error('Unknown trade direction: ' + direction);
  return spec.namePrefix + String(year);
}

/**
 * How many rows to bring back for each ranking.
 *
 * Twelve partners and ten chapters, because the panel shows a handful and the
 * rest is a legible "everyone else" remainder. Asking for all 160 partner codes
 * would render a scrollable list nobody reads.
 */
const TOP_PARTNERS = 12;
const TOP_CHAPTERS = 10;

/** `202606` to `2026-06`. Returns null rather than guessing at anything else. */
function periodLabel(key) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 190001 || n > 999912) return null;
  const year = Math.floor(n / 100);
  const month = n % 100;
  if (month < 1 || month > 12) return null;
  return year + '-' + String(month).padStart(2, '0');
}

/** `2026-06` back to `202606`, for addressing a reading by its label. */
function periodKey(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 100 + month;
}

/**
 * The HS2 chapter of an eight-digit CN code, by division rather than by text.
 *
 * `Preces_KN_kods` is stored as a number, so `22042142` divided by a million is `22.042142` and the
 * chapter is the integer part. **`floor`, never `round`** — measured on
 * 2026-06 exports, `round` pulls the 84.5-and-above codes into chapter 85 and
 * reports 221.1m EUR where the truth is 191.3m. Both answers are well-formed
 * and only one is right, which is exactly the kind of wrong number nobody
 * queries.
 *
 * Chapters 1–9 are seven-digit numbers rather than eight, and the arithmetic
 * handles them without a special case: `3049000 / 1e6` floors to 3.
 */
function chapterOf(code) {
  const n = num(code);
  return n === null ? null : Math.floor(n / 1000000);
}

function checkResourceId(resourceId) {
  if (!/^[0-9a-fA-F-]{36}$/.test(String(resourceId || ''))) {
    throw new Error('Refusing a non-UUID resource id: ' + resourceId);
  }
}

function monthFilters(key) {
  const n = Number(key);
  if (periodLabel(n) === null) {
    throw new Error('Refusing a non-period key: ' + key);
  }
  return { Gads: Math.floor(n / 100), Menesis: n % 100 };
}

/** The newest period actually present in the data, not in the metadata. */
function newestPeriodParams(resourceId) {
  checkResourceId(resourceId);
  // Postgres sorts NULLs first in a descending sort; one blank row must not hide the newest month.
  return { resource_id: resourceId, fields: 'Gads,Menesis', sort: 'Gads desc nulls last, Menesis desc nulls last', limit: 1 };
}

async function newestPeriod(resourceId, options, runner) {
  const result = await (runner || ckan.ckan)('datastore_search', newestPeriodParams(resourceId), options);
  if (!result || !Array.isArray(result.records)) throw new Error('CKAN returned no trade records');
  const row = result.records[0];
  if (!row || !Number.isInteger(num(row.Gads)) || !Number.isInteger(num(row.Menesis))) return null;
  const key = Number(row.Gads) * 100 + Number(row.Menesis);
  return periodLabel(key) === null ? null : key;
}

function ranked(groups, field, limit) {
  return Array.from(groups, function (entry) {
    return { [field]: entry[0], value_eur: entry[1] };
  }).sort(function (a, b) { return b.value_eur - a.value_eur; }).slice(0, limit);
}

/** Statistical value in whole euros, grouped only after every page is read. */
async function readMonth(resourceId, key, options) {
  checkResourceId(resourceId);
  const rows = await ckan.scanFields(resourceId,
    ['Partnervalsts', 'Preces_KN_kods', 'Statistiska_vertiba_EUR'], monthFilters(key), options);
  const partners = new Map();
  const chapters = new Map();
  let total = null;
  for (const row of rows) {
    const value = num(row.Statistiska_vertiba_EUR);
    if (value === null) continue;
    total = (total === null ? 0 : total) + value;
    const partner = String(row.Partnervalsts || '').trim().toUpperCase();
    partners.set(partner, (partners.get(partner) || 0) + value);
    const chapter = chapterOf(row.Preces_KN_kods);
    if (chapter !== null) chapters.set(chapter, (chapters.get(chapter) || 0) + value);
  }
  return {
    totalEur: total,
    lines: rows.length,
    partners: ranked(partners, 'partner', TOP_PARTNERS),
    chapters: ranked(chapters, 'chapter', TOP_CHAPTERS),
  };
}

/**
 * How many resources of one direction to interrogate for their newest month.
 *
 * Metadata may narrow the candidate set; only the data may decide the winner.
 * That division is what makes the selection below both cheap and correct.
 *
 * `pickLatestActive` orders by `created`, which for `ats_kn8_men` puts the
 * per-year files first and the 2005–2020 archive last (created 2022-11-08,
 * after the 2024 file). Three therefore covers this year, last year and the
 * year before, and excludes an archive whose `MAX()` measured **1547ms**
 * across 3.7M rows against ~350ms for each of the others — while being
 * incapable of holding the newest month, since it ends at 2020-12.
 *
 * Three is also comfortably enough for the failure this defends against: on
 * `maksatnespejas-procesi` a live resource and its abandoned twin were created
 * thirty-one seconds apart, so any candidate set larger than one holds both and
 * the data separates them.
 */
const MAX_CANDIDATES = 3;

/**
 * The resource holding the newest month, chosen by ASKING THE DATA.
 *
 * WHY NOT `created`, AND WHY NOT `last_modified`
 * ----------------------------------------------
 * Because neither is right, and both counter-examples are live on this portal:
 *
 *   ATS_eksports_KN8_2026   created 2026-03-12   modified 2026-08-11   2026-06
 *   ATS_eksports_KN8_2025   created 2025-03-12   modified 2026-08-11   2025-12
 *
 * `last_modified` is IDENTICAL for both — CSP revised the two files in one
 * pass — so sorting by it is a coin flip between this year and last, and
 * `created` is the field that works.
 *
 *   maksatnespejas-procesi/8065ad80  created 11:47:43  modified 2026-08-31  live
 *   maksatnespejas-procesi/0f6587a0  created 11:48:14  modified (none)      dead
 *
 * Two resources sharing one name, and the ABANDONED one was created
 * thirty-one seconds later. `created` descending picks the corpse; only
 * `last_modified` separates them. That package was reported dead during the
 * survey for this endpoint on exactly that mistake, when its live resource had
 * been updated the previous evening.
 *
 * So "which resource is current?" has no metadata answer that holds in both
 * directions, and choosing either field means being wrong about some package.
 * The data has no such problem: sorting by year and then month in each
 * candidate orders them 202606 / 202512 / 202412, and the answer cannot
 * disagree with the period the caller then reports, because it IS that period.
 *
 * Both callers pass their own deadlines and retry policy to the shared client.
 * `runner` is the action-level test seam.
 */
async function selectNewestByData(pkg, direction, options, runner) {
  const spec = DIRECTIONS[direction];
  if (!spec) throw new Error('Unknown trade direction: ' + direction);

  const candidates = ckan.pickLatestActive(pkg, spec.namePrefix, MAX_CANDIDATES);
  if (candidates.length === 0) return null;

  const probed = await Promise.all(candidates.map(async function (resource) {
    try {
      return { resource: resource, key: await newestPeriod(resource.id, options, runner) };
    } catch (err) {
      // One unreadable resource must not take the direction down with it — an
      // abandoned twin that no longer answers is the case this exists for.
      return { resource: resource, key: null, error: err };
    }
  }));
  if (probed.every(function (p) { return p.error; })) {
    throw probed[probed.length - 1].error;
  }

  const usable = probed.filter(function (p) {
    return p.key !== null && periodLabel(p.key) !== null;
  });
  if (usable.length === 0) return null;

  usable.sort(function (a, b) { return b.key - a.key; });
  return usable[0];
}

/**
 * Partner codes that are not countries.
 *
 * 160 codes appear in a single month and six of them are Eurostat
 * geonomenclature rather than ISO 3166: the UK is split across `XU` and `XI`
 * after Brexit, and the `Q` codes are the aggregates a statistician uses when a
 * destination cannot be attributed. Rendering `XU` as "unknown" would drop 94m
 * EUR a month into a bucket labelled as a failure.
 */
const SPECIAL_PARTNERS = {
  XU: 'United Kingdom (excl. N. Ireland)',
  XI: 'Northern Ireland',
  XK: 'Kosovo',
  XS: 'Serbia',
  QR: 'Not specified (extra-EU)',
  QS: 'Not specified (intra-EU)',
  QU: 'Not specified',
  QV: 'Not specified',
  QW: 'Not specified',
  QY: 'Not specified',
  QZ: 'Not specified',
  EU: 'European Union',
};

/**
 * ISO 3166-1 alpha-2 names for every code the cube has been observed to use.
 *
 * Deliberately a lookup with an honest miss rather than a library: an unknown
 * code returns `null` and the caller renders the code itself. A partner list
 * that invents a country name for a code it does not recognise is worse than
 * one that admits it, and this repository has already shipped a confident
 * fabricated zero from the same instinct.
 */
const COUNTRY_NAMES = {
  AE: 'United Arab Emirates', AL: 'Albania', AM: 'Armenia', AO: 'Angola', AR: 'Argentina',
  AT: 'Austria', AU: 'Australia', AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina',
  BD: 'Bangladesh', BE: 'Belgium', BG: 'Bulgaria', BH: 'Bahrain', BR: 'Brazil',
  BY: 'Belarus', CA: 'Canada', CH: 'Switzerland', CL: 'Chile', CN: 'China',
  CO: 'Colombia', CR: 'Costa Rica', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia',
  EG: 'Egypt', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FR: 'France',
  GB: 'United Kingdom', GE: 'Georgia', GH: 'Ghana', GR: 'Greece', HK: 'Hong Kong',
  HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IL: 'Israel',
  IN: 'India', IQ: 'Iraq', IR: 'Iran', IS: 'Iceland', IT: 'Italy',
  JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KR: 'South Korea',
  KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LK: 'Sri Lanka', LT: 'Lithuania',
  LU: 'Luxembourg', LV: 'Latvia', MA: 'Morocco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MT: 'Malta', MX: 'Mexico', MY: 'Malaysia', NG: 'Nigeria',
  NL: 'Netherlands', NO: 'Norway', NZ: 'New Zealand', PA: 'Panama', PE: 'Peru',
  PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PT: 'Portugal', QA: 'Qatar',
  RO: 'Romania', RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', TH: 'Thailand', TN: 'Tunisia',
  TR: 'Türkiye', TW: 'Taiwan', UA: 'Ukraine', US: 'United States', UY: 'Uruguay',
  UZ: 'Uzbekistan', VN: 'Vietnam', ZA: 'South Africa',
};

/**
 * An English name for a partner code, or null when there is not one.
 *
 * Null is the whole point. The caller renders the raw code in that case, so a
 * reader sees `ZZ` and knows it is a code, rather than seeing a country that
 * does not exist.
 */
function partnerName(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return null;
  return SPECIAL_PARTNERS[key] || COUNTRY_NAMES[key] || null;
}

/**
 * Harmonised System chapter names, in English.
 *
 * The dataset codes commodities at CN-8 — roughly ten thousand headings, which
 * is a spreadsheet rather than a chart. The first two digits are the HS
 * chapter, of which there are 97, and a chapter is something a reader can
 * actually hold: "wood", "mineral fuels", "vehicles". That is the level this
 * aggregates to.
 */
const CHAPTER_NAMES = {
  1: 'Live animals', 2: 'Meat', 3: 'Fish and seafood', 4: 'Dairy, eggs and honey',
  5: 'Other animal products', 6: 'Live plants and flowers', 7: 'Vegetables',
  8: 'Fruit and nuts', 9: 'Coffee, tea and spices', 10: 'Cereals',
  11: 'Milling products', 12: 'Oil seeds', 13: 'Gums and resins', 14: 'Vegetable plaiting materials',
  15: 'Animal and vegetable fats', 16: 'Prepared meat and fish', 17: 'Sugar',
  18: 'Cocoa', 19: 'Cereal preparations', 20: 'Prepared vegetables and fruit',
  21: 'Miscellaneous edible preparations', 22: 'Beverages and spirits',
  23: 'Animal feed', 24: 'Tobacco', 25: 'Salt, stone and cement', 26: 'Ores and ash',
  27: 'Mineral fuels and oils', 28: 'Inorganic chemicals', 29: 'Organic chemicals',
  30: 'Pharmaceuticals', 31: 'Fertilisers', 32: 'Tanning and dyeing extracts',
  33: 'Perfumery and cosmetics', 34: 'Soap and waxes', 35: 'Albuminoids and glues',
  36: 'Explosives and matches', 37: 'Photographic goods', 38: 'Miscellaneous chemicals',
  39: 'Plastics', 40: 'Rubber', 41: 'Raw hides and leather', 42: 'Leather articles',
  43: 'Furskins', 44: 'Wood and wood articles', 45: 'Cork', 46: 'Basketware',
  47: 'Wood pulp', 48: 'Paper and paperboard', 49: 'Printed books and newspapers',
  50: 'Silk', 51: 'Wool', 52: 'Cotton', 53: 'Other vegetable textile fibres',
  54: 'Man-made filaments', 55: 'Man-made staple fibres', 56: 'Wadding and nonwovens',
  57: 'Carpets', 58: 'Special woven fabrics', 59: 'Coated textile fabrics',
  60: 'Knitted fabrics', 61: 'Knitted apparel', 62: 'Woven apparel',
  63: 'Other made-up textiles', 64: 'Footwear', 65: 'Headgear', 66: 'Umbrellas',
  67: 'Prepared feathers and artificial flowers', 68: 'Stone and plaster articles',
  69: 'Ceramics', 70: 'Glass and glassware', 71: 'Precious stones and metals',
  72: 'Iron and steel', 73: 'Iron and steel articles', 74: 'Copper',
  75: 'Nickel', 76: 'Aluminium', 78: 'Lead', 79: 'Zinc', 80: 'Tin',
  81: 'Other base metals', 82: 'Tools and cutlery', 83: 'Miscellaneous metal articles',
  84: 'Machinery and mechanical appliances', 85: 'Electrical machinery',
  86: 'Railway vehicles', 87: 'Vehicles', 88: 'Aircraft', 89: 'Ships and boats',
  90: 'Optical and medical instruments', 91: 'Clocks and watches',
  92: 'Musical instruments', 93: 'Arms and ammunition', 94: 'Furniture and bedding',
  95: 'Toys, games and sports equipment', 96: 'Miscellaneous manufactured articles',
  97: 'Works of art',
};

/** An English chapter name, or null. Same contract as `partnerName`. */
function chapterName(chapter) {
  const n = Number(chapter);
  if (!Number.isInteger(n)) return null;
  return CHAPTER_NAMES[n] || null;
}

/** `44` to `HS44`, the code a reader can look up. Chapters below ten are padded. */
function chapterCode(chapter) {
  const n = Number(chapter);
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  return 'HS' + String(n).padStart(2, '0');
}

/**
 * A number from the datastore, or null.
 *
 * Numeric fields can arrive as strings or null. Both have to become a number or an honest absence
 * here, because a `null` reaching arithmetic downstream becomes `NaN`, and
 * `NaN` compares false against everything — which is how a missing wave height
 * once rendered as "Very Rough" in this codebase.
 */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  DATASET: DATASET,
  DIRECTIONS: DIRECTIONS,
  TOP_PARTNERS: TOP_PARTNERS,
  TOP_CHAPTERS: TOP_CHAPTERS,
  SPECIAL_PARTNERS: SPECIAL_PARTNERS,
  COUNTRY_NAMES: COUNTRY_NAMES,
  CHAPTER_NAMES: CHAPTER_NAMES,
  resourceNameFor: resourceNameFor,
  periodLabel: periodLabel,
  periodKey: periodKey,
  chapterOf: chapterOf,
  monthFilters: monthFilters,
  newestPeriodParams: newestPeriodParams,
  newestPeriod: newestPeriod,
  readMonth: readMonth,
  selectNewestByData: selectNewestByData,
  MAX_CANDIDATES: MAX_CANDIDATES,
  partnerName: partnerName,
  chapterName: chapterName,
  chapterCode: chapterCode,
  num: num,
};
