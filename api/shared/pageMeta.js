// ─── What each non-article page says about itself, in the served bytes ───
//
// WHY THIS IS A MIRROR, AND WHY THAT IS NOT A CHOICE
// ---------------------------------------------------
// Measured, on 2026-08-28: `src/` cannot import from `api/shared/`.
// `tsconfig.app.json` has `"include": ["src"]`, so a probe importing one of
// these modules failed with `TS2307: Cannot find module`. The Function App is
// deployed from `api/` alone and never sees `src/` either. There is no shared
// build step in either direction, so the copy on this side is a mirror of the
// copy each component passes to `usePageMeta`.
//
// A mirror nobody checks is a second opinion waiting to disagree, which is why
// `tests/pageMetaParity.test.tsx` RENDERS each real component in jsdom, lets
// `usePageMeta` write the head, and requires the result to equal what this
// module produces for the same URL. That is behavioural rather than a parse of
// the source, and it is the pattern `tests/articleMetaParity.test.ts` already
// established for the article path — where writing the mirror the obvious way
// had already produced one real divergence.
//
// WHAT IS DERIVED RATHER THAN MIRRORED
// ------------------------------------
// `/indicator/:id` titles come from `indicators.js` — the same registry the
// dashboard renders from and the sitemap expands over — because `api/` CAN
// import that. Only the 24 editorial descriptions below are copied, and only
// because they live in `src/components/IndicatorPage.tsx` and nowhere else.
//
// That is the opposite of what was expected. `/indicator/:id` was the family
// predicted to need copy the injector could not compute; it is in fact the one
// family that needs almost none, and the STATIC routes are the ones whose words
// exist only in a React component.

'use strict';

const indicators = require('./indicators.js');
const articleMeta = require('./articleMeta.js');

const SITE_URL = 'https://portabaltica.naurolabs.com';

/**
 * Pages whose copy is written in a component and nowhere else.
 *
 * Keyed by pathname, exactly as a reader's URL spells it. Each value is what
 * the component passes to `usePageMeta`, verbatim — a difference of one
 * character is a failing parity test rather than a discrepancy nobody sees.
 */
const STATIC_PAGES = {
  '/': {
    title: 'portaBaltica | Baltic open data, reported',
    description:
      'Original data journalism from Baltic open data: economy, energy, maritime, environment and government, with every figure traceable to its dataset.',
  },
  '/follow': {
    title: 'Follow portaBaltica | portaBaltica',
    description:
      'Every way to keep up with portaBaltica: RSS, JSON Feed and the weekly review. No email list, no account, no tracking.',
  },
  '/briefings': {
    title: 'Business briefings | portaBaltica',
    description: 'Help shape a Baltic business briefing for costs, hiring and demand decisions. Explore the free evidence and the scope of our discovery pilot.',
  },
  '/weekly': {
    title: 'The weekly review | portaBaltica',
    description:
      'One piece a week reading back over what we reported from Baltic open data, published only when the week produced enough to review.',
  },
  '/corrections': {
    title: 'Corrections | portaBaltica',
    description:
      'Our corrections policy and the complete public log: what was wrong, what it now says, and when it changed.',
  },
  '/about/ai': {
    title: 'How portaBaltica uses AI',
    description:
      'What the AI does here, what it is not permitted to do, and who answers for it when something is wrong.',
  },
  '/newsroom': {
    // `CorrespondentPage` passes no description for the roster index, so
    // `usePageMeta` leaves the shell's in place. The mirror says the same by
    // omitting it rather than inventing one the page would not print.
    title: 'The newsroom | portaBaltica',
    description: null,
  },
  '/api-docs': {
    title: 'API documentation | portaBaltica',
    description:
      'Public JSON endpoints over Baltic data: Eurostat indicators for Latvia, Estonia and Lithuania, electricity prices, port statistics, and searchable Latvian business and address registers.',
  },
};

/**
 * The dashboard overview and its nine sections.
 *
 * Mirrors `OVERVIEW_META` and `SECTION_META` in `src/App.tsx`. The section keys
 * are checked against `DASHBOARD_SECTIONS` by the parity suite, so a section
 * added to the app without copy here is red rather than generic.
 */
const OVERVIEW = {
  title: 'The dashboard | portaBaltica',
  description:
    'Live Baltic open data: 71 indicators across economy, trade, energy, property, environment, government and maritime, for Latvia, Estonia and Lithuania. Every figure is traceable to the dataset it came from.',
};

const SECTIONS = {
  economy: {
    title: 'Economy | portaBaltica',
    description:
      'GDP, inflation, wages and retail trade for Latvia, Estonia and Lithuania, from Eurostat and the national statistics offices, with the source named beside every series.',
  },
  trade: {
    title: 'Trade | portaBaltica',
    description:
      'Exports, imports and the goods and services balance across the three Baltic states, quarterly, traceable to the Eurostat cube each figure came from.',
  },
  government: {
    title: 'Government | portaBaltica',
    description:
      'Government debt, revenue and expenditure for the Baltic states, alongside EU Recovery Fund projects and their status.',
  },
  labour: {
    title: 'Labour | portaBaltica',
    description:
      'Unemployment, hourly labour cost and minimum wage across Latvia, Estonia and Lithuania, with each series shown against its own basis.',
  },
  energy: {
    title: 'Energy | portaBaltica',
    description:
      'Nord Pool day-ahead electricity prices for all four Baltic-region bidding zones, the spread between them, and household and industrial energy prices.',
  },
  property: {
    title: 'Property | portaBaltica',
    description:
      'House prices, construction output and building permits for the Baltic states, with Latvian energy certificates and cadastral data underneath.',
  },
  environment: {
    title: 'Environment | portaBaltica',
    description:
      'Weather, air quality on the European AQI bands, greenhouse gas emissions and population for the Baltic region.',
  },
  business: {
    title: 'Business | portaBaltica',
    description:
      'Company registrations and bankruptcies across the Baltic states, with searchable Latvian beneficial-ownership and address registers.',
  },
  maritime: {
    title: 'Maritime | portaBaltica',
    description:
      'Cargo tonnage, sea passengers and vessel arrivals at Baltic ports from Eurostat, quarterly, with live sea state at the Latvian ports.',
  },
};

/**
 * The 24 editorial indicator entries, mirrored from `IndicatorPage.tsx`.
 *
 * Every one carries its title, not only the ten the registry does not name.
 * `IndicatorPage` resolves `info?.title ?? registered?.title`, so the editorial
 * title wins wherever there is one — and for **nine of the fourteen** ids that
 * exist on both sides the two disagree:
 *
 *   salary            "Hourly Labour Cost"        vs  "Hourly labour cost"
 *   industrial        "Industrial Production…"    vs  "Industrial production"
 *   exports           "Exports"                   vs  "Exports of goods"
 *   hotel_occupancy   "Hotel occupancy rate"      vs  "Net occupancy rate of bed places"
 *   trade_balance     "Trade balance"             vs  "Trade balance (goods & services)"
 *   … and four more
 *
 * A mirror that preferred the registry title would have served nine crawlers a
 * headline the page does not print. It was written that way first and the
 * parity suite caught it, which is the entire argument for having one.
 *
 * The other 47 need nothing here: their title and description are both derived
 * from the registry, which this module can read.
 */
const INDICATOR_COPY = {
  gdp: { title: "GDP Growth Rate", description: "Gross Domestic Product quarterly growth rate, seasonally adjusted. GDP measures the total economic output and is the broadest measure of economic activity." },
  salary: { title: "Hourly Labour Cost", description: "Average hourly labour cost across all sectors (Eurostat lc_lci_lev). Covers compensation of employees plus taxes minus subsidies, business economy excluding public administration." },
  cpi: { title: "CPI Inflation", description: "Consumer Price Index — 12-month average rate of change. Measures how fast prices are rising for goods and services purchased by households." },
  unemployment: { title: "Unemployment Rate", description: "Share of economically active population aged 15-74 that is unemployed, seasonally adjusted. A key indicator of labor market health." },
  house_prices: { title: "House Price Change", description: "Year-over-year change in residential property prices. A leading indicator for the real estate market and construction activity." },
  retail_sales: { title: "Retail Sales Growth", description: "Year-over-year change in retail trade turnover. Reflects consumer spending patterns and economic confidence." },
  industrial: { title: "Industrial Production Growth", description: "Year-over-year change in industrial output (mining, manufacturing, energy). A key indicator of the productive economy." },
  population: { title: "Population", description: "Total population. All three Baltic states have experienced population decline due to emigration and low birth rates since EU accession." },
  exports: { title: "Exports", description: "Total value of goods and services exported, seasonally adjusted. Key indicator of trade competitiveness and external demand." },
  imports: { title: "Imports", description: "Total value of goods and services imported, seasonally adjusted. Reflects domestic demand and trade dependency." },
  hotel_occupancy: { title: "Hotel occupancy rate", description: "Percentage of available hotel rooms occupied. A key indicator of tourism activity and service sector health." },
  tourist_arrivals: { title: "Tourist arrivals", description: "Number of tourists arriving at accommodation establishments. Tourism is a significant contributor to the Latvian economy." },
  gov_revenue: { title: "Government revenue", description: "Total general government revenue in million euros. Reflects tax collection effectiveness and economic activity." },
  gov_debt: { title: "Government debt", description: "Total general government consolidated debt. A key metric for fiscal sustainability and credit risk assessment." },
  biz_confidence: { title: "Economic sentiment", description: "Composite economic sentiment indicator (long-term average = 100). A leading indicator combining business and consumer surveys." },
  construction_output: { title: "Construction output", description: "Volume index of construction production (2021=100, seasonally adjusted). Tracks the health of the building sector." },
  building_permits: { title: "Building permits issued", description: "Number of building permits issued per quarter. A leading indicator for future construction activity." },
  new_vehicles: { title: "New car registrations", description: "New passenger car registrations per quarter. A proxy for consumer confidence and economic health." },
  wages_industry: { title: "Manufacturing Wages", description: "Labour cost index for the manufacturing sector (NACE C), base year 2020=100. Tracks how industrial labour costs evolve over time." },
  wages_it: { title: "IT Sector Wages", description: "Labour cost index for the information and communication sector (NACE J), base year 2020=100. The Baltics' fastest-growing wage sector." },
  energy_price_gas: { title: "Gas price (households)", description: "Average natural gas price for household consumers in EUR per gigajoule. A key cost-of-living indicator." },
  renewable_share: { title: "Renewable Energy Share", description: "Share of renewable energy in total energy consumption. The Baltics have above-EU-average shares thanks to hydropower (Latvia), biomass, and wind expansion." },
  ppi: { title: "Producer prices (PPI)", description: "Year-over-year change in producer prices for industrial products. A leading indicator for consumer inflation." },
  trade_balance: { title: "Trade balance", description: "Difference between exports and imports (seasonally adjusted). A negative balance means the country imports more than it exports." },
};

/** `Q` → "Quarterly". Mirrors `FREQ_WORD` in `IndicatorPage.tsx`. */
const FREQ_WORD = {
  A: 'Annual',
  S: 'Half-yearly',
  Q: 'Quarterly',
  M: 'Monthly',
  W: 'Weekly',
  D: 'Daily',
};

/**
 * The head for one indicator, derived from the registry wherever it can be.
 *
 * Ten of the 24 editorial entries name ids the registry does NOT hold — `cpi`,
 * `retail_sales`, `gov_debt`, `construction_output` and six more, which are the
 * PxWeb family `/api/historical-data` serves. Those carry their title here
 * because it exists nowhere else on this side. The other fourteen take their
 * title from the registry and contribute only prose.
 *
 * The composed description leads with the registry title, and that is
 * load-bearing rather than stylistic: measured across all 71, `freq`, `unit`
 * and `dataset` together are distinct for only 47 — eight inflation variants
 * share `M | % YoY | prc_hicp_minr` between them — so a description built from
 * those three alone would put one identical sentence on eight pages. `title` is
 * distinct 71 of 71.
 */
function indicatorMeta(id) {
  const definition = Object.prototype.hasOwnProperty.call(indicators, id) ? indicators[id] : null;
  const copy = Object.prototype.hasOwnProperty.call(INDICATOR_COPY, id) ? INDICATOR_COPY[id] : null;
  if (!definition && !copy) return null;

  const title = (copy && copy.title) || (definition && definition.title) || null;
  if (!title) return null;

  const description = (copy && copy.description) || (
    definition.title + ' for Latvia, Estonia and Lithuania. ' +
    (FREQ_WORD[definition.freq] || 'Periodic') + ' series in ' + definition.unit + ', ' +
    'from Eurostat dataset ' + definition.dataset + ', downloadable as CSV or JSON.'
  );

  return { title: title + ' | portaBaltica', description: description };
}

/**
 * What the page at `pathname` says about itself, or `null` when this module
 * has nothing to say about that URL.
 *
 * `null` is the important return. It means "leave the shell alone", which is
 * what the caller must do for `/article/*` — served by its own function — and
 * for anything unrecognised. Inventing a head for a URL that renders nothing is
 * the failure this whole line of work has been about, and it cannot be caught
 * by a status check: every route on this SPA answers HTTP 200.
 */
function metaFor(pathname) {
  if (typeof pathname !== 'string' || !pathname) return null;
  const path = pathname.replace(/\/+$/, '') || '/';

  if (Object.prototype.hasOwnProperty.call(STATIC_PAGES, path)) {
    return withCanonical(path, STATIC_PAGES[path]);
  }

  if (path === '/data') return withCanonical(path, OVERVIEW);

  const section = /^\/data\/([A-Za-z0-9_-]+)$/.exec(path);
  if (section) {
    const meta = Object.prototype.hasOwnProperty.call(SECTIONS, section[1])
      ? SECTIONS[section[1]]
      : null;
    // An unknown section renders the overview and declares `/data` as its
    // canonical — mirroring `App.tsx`, which falls back to 'all'. Emitting a
    // canonical of `/data/not-a-section` would invent a page.
    return meta ? withCanonical(path, meta) : withCanonical('/data', OVERVIEW);
  }

  const indicator = /^\/indicator\/([A-Za-z0-9_-]+)$/.exec(path);
  if (indicator) {
    const meta = indicatorMeta(indicator[1]);
    // An unknown indicator is a dead end the page marks `noindex`, and the
    // mirror says the same rather than leaving the shell's `index, follow`.
    //
    // It still carries a title. `IndicatorPage` sets `Indicator | portaBaltica`
    // on that branch, and an earlier version of this returned `null` — which
    // stripped the shell's title and put nothing back, leaving the document
    // with NO title at all. That is worse than the generic one it replaced, and
    // it was caught by reading the raw HTML rather than by any assertion.
    if (!meta) {
      return {
        title: 'Indicator | portaBaltica',
        description: null,
        canonical: SITE_URL + path,
        index: false,
      };
    }
    return withCanonical(path, meta);
  }

  const correspondent = /^\/newsroom\/([a-z0-9-]+)$/.exec(path);
  if (correspondent) {
    // The roster is already mirrored in `articleMeta.js`, where it is
    // load-bearing rather than defensive: every stored article carries a
    // persona name the newsroom has since changed, so the roster is what the
    // site actually prints. Reusing it means one mirror, not two.
    const person = articleMeta.CORRESPONDENT_ROSTER[correspondent[1]];
    // Same rule as an unknown indicator: mark it, but never leave the document
    // titleless. `CorrespondentPage` falls back to the roster heading.
    if (!person) {
      return {
        title: 'The newsroom | portaBaltica',
        description: null,
        canonical: SITE_URL + path,
        index: false,
      };
    }
    return withCanonical(path, {
      title: person.name + ', AI correspondent, ' + person.beat + ' | portaBaltica',
      description:
        person.name + " is an AI system that writes portaBaltica's " + person.beat +
        ' coverage from open data. Not a person.',
    });
  }

  return null;
}

function withCanonical(path, meta) {
  return {
    title: meta.title,
    description: meta.description,
    canonical: SITE_URL + path,
    index: true,
  };
}

module.exports = {
  SITE_URL,
  STATIC_PAGES,
  OVERVIEW,
  SECTIONS,
  INDICATOR_COPY,
  FREQ_WORD,
  indicatorMeta,
  metaFor,
};
