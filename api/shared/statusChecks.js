/**
 * Every upstream `/api/system-status` probes, and what "current" means for each.
 *
 * Kept apart from the endpoint so the registry itself can be asserted against.
 * The contract that matters is not any one threshold but that **a probe cannot
 * be added without deciding its cadence**: the whole reason a frozen HICP table
 * ran for eight months undetected is that nobody was ever asked the question.
 * `tests/freshness.test.ts` fails on an omission, so the next source added has
 * to answer it too.
 *
 * `cadence` is one of H, D, W, M, Q, A. `maxLag` is how many of those units the
 * newest observation may trail before the source is called stale rather than
 * merely in arrears. A source that genuinely cannot report when it last changed
 * sets `cadence: null` and must say why in `freshnessNote` — an explicit
 * "unknown" that appears on the status page, rather than a silent default to
 * fresh.
 *
 * The bounds are deliberately loose. Every one is at least double the worst lag
 * observed live, because this is a gate, and a gate that red-lights a healthy
 * source because Eurostat published a fortnight late teaches people to ignore
 * gates. They are sized to catch a source that has *stopped*.
 */

const es = require('./eurostat.js');
const ports = require('./ports.js');
const INDICATORS = require('./indicators.js');
const trade = require('./tradeStats.js');

function buildNordPoolProbeUrl() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return 'https://dashboard.elering.ee/api/nps/price?start=' +
    encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString());
}

/**
 * A short window ending now, for the grid-state probe.
 *
 * Deliberately narrow, and narrower than the consumer's own request on purpose.
 * `/api/live-grid` asks for thirty-six hours because it has to reach *solar*,
 * which Elering files a day at a time; this probe only needs to know whether
 * metering is still arriving, and six hours is four times the worst observed
 * metering lag while returning a couple of dozen rows rather than a couple of
 * hundred.
 *
 * It also has to reach *back*: asking for the last thirty minutes of a feed
 * that runs an hour behind would return nothing and read as an outage. That is
 * the same failure that made `/api/live-grid` state in its own docstring that
 * solar "is empty on actuals" — a window shorter than the field's publication
 * lag makes a live field indistinguishable from a dead one. **Any window here
 * must exceed the lag of the thing it is asking about**, which for metering is
 * 83 minutes and for solar would be a full day. This probe reads metering, so
 * six hours is right; it would be wrong for a probe that judged solar.
 */
function buildGridStateProbeUrl() {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 3600 * 1000);
  return 'https://dashboard.elering.ee/api/system/with-plan?start=' +
    encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString());
}

/**
 * Where the newsroom's own run report lives.
 *
 * The same blob container the site reads articles from — `deploy.yml` hands the
 * frontend this base as `VITE_ARTICLES_BASE_URL`, and the apex domain does not
 * proxy it, so the probe addresses the container directly. Overridable so the
 * Function App is not welded to one storage account.
 *
 * The pipeline runs on a timer and can stop publishing without anything
 * failing. On the 25 Aug run every tier A article it wrote was rejected, one
 * syndicated card went out, and the function reported success — so "1
 * published" was true and told nobody anything. That is why the report splits
 * `original_articles` from `counts.published`, and why this is checked in the
 * place a reader already looks.
 *
 * The stakes rose today: the newsroom Function App had no continuous deployment
 * at all until this afternoon, and App Insights holds no rows. This probe is
 * now the only thing that will say whether a deploy improved the newsroom or
 * killed it.
 */
const ARTICLES_BASE = (process.env.ARTICLES_BASE_URL ||
  'https://stportabalticabpmff5so.blob.core.windows.net/articles').replace(/\/$/, '');

const NEWSROOM_RUN_REPORT = ARTICLES_BASE + '/runs/latest.json';

const CHECKS = [
  {
    name: 'Eurostat',
    // Built from the indicator the charts read, not restated here.
    //
    // The string this replaces was byte-identical to `buildUrl` output, which
    // sounds harmless and is the whole problem: the identity was maintained by
    // hand and nothing checked it. A probe that reproduces the query it is
    // probing is not a probe, it is a second implementation that can disagree
    // — and when it does, it says the source is fine while the app fails, or
    // the reverse.
    url: es.buildUrl(INDICATORS.unemployment, 2, ['LV']),
    type: 'eurostat-cube',
    cubeKey: 'geo',
    required: true,
    powers: 'All Baltic comparison charts',
    // Monthly, published around 60 days in arrears. Three months leaves a
    // month of slack on top of the worst normal lag.
    cadence: 'M',
    maxLag: 3,
  },
  {
    name: 'Eurostat maritime',
    // The same call `/api/port-data` makes, from the same builder.
    //
    // A window of quarters, never `lastTimePeriod=1`. That parameter asks the
    // Europe-wide cube for the newest quarter *any* port filed, which Riga is
    // routinely behind — it reported a healthy feed as dead for weeks.
    //
    // The hand-built string this replaces had drifted further than that
    // comment admits. It pinned `rep_mar=LV_0LVRIX` — **Riga alone** — while
    // the app asks for all four Latvian ports, and it asked for three years
    // where the app asks for eight. So the probe could not see a failure at
    // Ventspils, Liepāja or Skulte at all, and went red whenever Riga alone
    // was quiet: the exact false red this check has already produced once.
    //
    // Measured, the honest query is also the cheaper one — 37-60ms against
    // 53-110ms, for 104 cells instead of 12 — so there was never a cost
    // argument for the narrower slice either.
    url: ports.seriesUrls('LV').vessels,
    type: 'eurostat-cube',
    cubeKey: 'rep_mar',
    required: true,
    powers: 'Port cargo, passenger and vessel statistics',
    // Two quarters in arrears is normal operation for this collection. Measured
    // live at 2025-Q4 while the cube was padded to 2026-Q2 — an age of 2.7
    // quarters, so a bound of 3 would have left barely a month of headroom and
    // flapped the moment Eurostat published a fortnight late. Four quarters is
    // twelve months, which is `PORT_DATA_STALE_AFTER_MONTHS` in
    // `src/dataFreshness.ts`: the banner a reader sees and the probe now agree.
    cadence: 'Q',
    maxLag: 4,
  },
  {
    name: 'ECB Exchange Rates',
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    type: 'ecb-xml',
    required: true,
    powers: 'Currency ticker',
    // Published each working day around 16:00 CET, so before that the newest
    // set is yesterday's. A long weekend plus a holiday reaches four days.
    cadence: 'D',
    maxLag: 4,
  },
  {
    name: 'NordPool Electricity',
    url: buildNordPoolProbeUrl(),
    type: 'elering',
    required: true,
    powers: 'Day-ahead power prices',
    // Day-ahead, so the newest observation is normally in the *future* and the
    // age is negative. Six hours catches a feed that stopped overnight.
    cadence: 'H',
    maxLag: 6,
  },
  {
    name: 'Elering grid state',
    /**
     * The endpoint `/api/live-grid` actually calls.
     *
     * `NordPool Electricity` above probes `nps/price` — a different path on
     * the same host. If `system/with-plan` were withdrawn tomorrow,
     * `nps/price` would keep answering, this registry would report every
     * required source healthy, and the grid panel would sit empty behind a
     * green light. That is the failure AGENTS.md describes under "Adding a
     * data source", and #88 added the consumer without adding the probe.
     *
     * `required: false`, deliberately. The panel is one card, and — the
     * stronger reason — **the consumer is more resilient than the probe**:
     * `/api/live-grid` serves through a 5-minute TTL with grace, so a burst
     * of Elering's Cloudflare 503s never reaches a reader. Measured here:
     * five consecutive `HTTP 503 no available server` followed by 12 of 12
     * clean at 75–217ms. A required probe would report an outage during a
     * burst that nobody can experience, which is how a status page teaches
     * readers to ignore it.
     */
    url: buildGridStateProbeUrl(),
    type: 'elering-system',
    required: false,
    powers: 'Live grid state panel (production, renewable share, net balance)',
    note: 'Optional because the consumer is more resilient than the probe: ' +
      '/api/live-grid serves through a 5-minute cache with grace, so Elering ' +
      "503 bursts never reach a reader (measured: five consecutive 'no " +
      "available server', then 12 of 12 clean at 75-217ms)",
    /**
     * Metered actuals arrive in 15-minute intervals but land well behind the
     * wall clock: sampled at 74 and 77 minutes behind on two occasions, and
     * 29–83 minutes across the sampling done for #88. Four hours is nearly
     * three times the worst of those, so ordinary metering delay never trips
     * it, while a feed that genuinely stops is caught the same working day.
     *
     * Hours is the finest cadence the freshness module carries, which is
     * ample: nothing turns on whether this feed is 1.2 or 1.4 hours behind.
     */
    cadence: 'H',
    maxLag: 4,
  },
  {
    name: 'data.gov.lv CKAN',
    // `site_read` was removed from the portal's action list; `status_show` is
    // the supported liveness action.
    url: 'https://data.gov.lv/dati/api/3/action/status_show',
    type: 'ckan',
    required: true,
    powers: 'Business registry counts',
    /**
     * The action the app actually reads from, probed alongside the liveness
     * action rather than instead of it.
     *
     * `status_show` answering proves the portal is up; it does not prove
     * `datastore_search` still exists. That distinction is not hypothetical
     * here — `site_read` was removed from this very portal while everything
     * else kept answering, which is the precedent this whole registry was
     * rewritten around. Four endpoints read through `datastore_search`
     * (address-search, business-search, eu-funds, property-data, all via
     * `shared/ckan.js`), so its removal would break them while a liveness-only
     * probe stayed green.
     *
     * `limit=1` rather than `limit=0`: measured at 284ms against 515ms, so it
     * is both cheaper *and* stronger — it proves the datastore returns a row
     * rather than merely describing one. `total` is checked too, because a
     * datastore emptied by a failed ingestion answers perfectly well with
     * nothing in it.
     */
    datastoreUrl: 'https://data.gov.lv/dati/api/3/action/datastore_search' +
      '?resource_id=a510737a-18ce-400f-ad4b-04fce5228272&limit=1',
    // A liveness action, not data. The datasets behind it are checked for
    // freshness by `VID business registers` below, which is where the question
    // can actually be answered.
    cadence: null,
    freshnessNote: 'liveness action only; dataset freshness is checked separately',
  },
  {
    // Liveness of the portal is not the same as availability of the data we
    // read from it, and conflating the two hid a real outage: the Economy
    // tile asked for a dataset that had been renamed, the portal answered
    // 404, the tile printed "0 Suspended Activities", and this page stayed
    // green throughout because `status_show` on the same host still answered.
    //
    // So probe the datasets by name. `package_show` is 3–4 KB and answers in
    // well under a second, and it 404s for a dataset that no longer exists —
    // which is precisely the failure that went unnoticed.
    name: 'VID business registers',
    datasets: [
      'saimnieciskas-darbibas-apturesana',
      'pvn-maksataji',
    ],
    type: 'ckan-datasets',
    required: true,
    powers: 'Suspended activities and VAT-payer counts',
    // Both are re-uploaded daily — measured at 05:02 the morning this was
    // written. Eight days catches a publisher that stopped without flapping
    // over a holiday week.
    cadence: 'D',
    maxLag: 8,
  },
  {
    name: 'CSP CN-8 trade',
    /**
     * The dataset `/api/trade-partners` reads, probed through the *same*
     * builder the endpoint uses rather than a URL restated here.
     *
     * That is not tidiness. `AGENTS.md` names three occasions where a probe
     * rebuilt its subject's query and drifted: the maritime probe pinned Riga
     * alone while the app read four ports, so it was blind to Ventspils,
     * Liepāja and Skulte and went red whenever Riga was quiet. A probe that
     * reproduces the query it is probing is a second implementation that can
     * disagree — and when it does, it reports health while the app fails.
     *
     * So the resource is selected exactly as the handler selects it, and the
     * statement comes from `tradeStats.newestPeriodSql`. There is no string
     * here that could fall out of step, because there is no string here.
     *
     * Two steps, both cheap: `package_show` on a ten-resource package, then one
     * `MAX()` aggregate, measured together at well under a second. The portal's
     * liveness is a separate, cheaper question and the `data.gov.lv CKAN` check
     * above already answers it — this one exists to answer whether the action
     * and the dataset the app depends on are still there.
     */
    dataset: trade.DATASET,
    // The direction, not a name prefix. The probe resolves the resource through
    // `tradeStats.selectNewestByData` — the same function the endpoint uses —
    // rather than restating a prefix that could drift from it.
    direction: 'exports',
    type: 'ckan-trade-sql',
    // Required, and the reason is a measurement rather than a preference. The
    // two data.gov.lv checks above are already required because the portal is
    // reliably reachable from this egress address — unlike Open-Meteo, whose
    // failures are evidence about our network rather than about the source. A
    // failure here is real evidence, and it powers a panel a reader can see.
    required: true,
    powers: 'Latvian trade partners and commodity mix',
    /**
     * Monthly, and the freshness question is the entire reason this check
     * exists rather than being folded into the CKAN liveness probe above.
     *
     * `datastore_active` is true for datasets that stopped years ago — on this
     * same portal, `maksatnespejas-procesi` reports 15,660 rows, 23 fields and
     * a newest proceeding of 2020-10-28. Nothing about its metadata says so.
     * The only thing that can tell is reading the newest period out of the
     * rows, which is what this probe does and what the endpoint does.
     *
     * ON THE BOUND, WHICH IS NOT THE ONE THAT WAS FIRST WRITTEN HERE
     * --------------------------------------------------------------
     * Detailed trade statistics are compiled from customs declarations and run
     * about two months behind. Two months of elapsed time is where the estimate
     * started, and it was wrong about the number this check is judged on:
     * `freshness.judge` measures a period label in **period indices**, not in
     * days, so `2026-06` read on 2026-09-01 is age **3**, not 2.1. Measured,
     * not inferred — the probe reports `ageInCadenceUnits: 3`.
     *
     * At the four this originally carried, that is one month of slack on a
     * source whose age already oscillates between 2 and 3 across its own
     * publication cycle. `AGENTS.md` records exactly this trap costing an
     * indicator its freshness verdict: a series sitting *on* the boundary
     * rather than inside it, where one late publication reads as death.
     *
     * Six is double the worst age observed, per this registry's stated sizing
     * rule, and means CSP would have to miss roughly three consecutive monthly
     * releases before the source is called stale.
     */
    cadence: 'M',
    maxLag: 6,
  },
  {
    name: 'CSP PxWeb',
    // The catalogue root answers in ~80ms and says nothing about whether any
    // table still moves. A *table's* metadata is nearly as cheap — 351ms
    // measured — 404s if the table is renamed, and lists the periods it holds,
    // so the newest one comes free. That is the endpoint the app depends on
    // rather than the host it happens to live on.
    url: 'https://data.stat.gov.lv/api/v1/en/OSP_PUB/VEK/IS/ISI/ISI010c',
    type: 'pxweb-metadata',
    required: true,
    powers: 'Latvian national indicators',
    // Quarterly GDP. Measured at 2026Q1, which is roughly 1.7 quarters old.
    cadence: 'Q',
    maxLag: 4,
  },
  {
    name: 'Open-Meteo Weather',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&current=temperature_2m',
    type: 'open-meteo',
    // Not required, and the reason is a measurement rather than a preference.
    //
    // From the Static Web App's egress address roughly half of all calls hang
    // for the full deadline and about one in four hangs twice, while the same
    // endpoint answers a laptop in 110–302ms, six times out of six. The channel
    // is throttled; the source is fine. So a failure here is overwhelmingly
    // evidence about our egress address and only weakly evidence about
    // Open-Meteo, and a check that cannot tell those apart has no business
    // driving the one word that describes the whole site — it took the site to
    // `degraded` about a third of the time, for a source that was up.
    //
    // The check stays, and stays visible: it names what it powers and reports
    // unhealthy on the page when it cannot get through. And the Environment
    // tile draws its own honest empty state, so a genuine outage is still
    // legible where a reader would actually meet it.
    required: false,
    powers: 'City weather',
    note: 'Reached over a throttled shared egress address, so a failure here is not reliable evidence about the source',
    // Real-time. `current.time` measured at the current quarter-hour, and read
    // through a five-minute cache because the source publishes hourly.
    cadence: 'H',
    maxLag: 3,
    // A tighter deadline than the rest, because this one is *known* to hang
    // rather than to be slow: healthy replies measure 17–63ms, so a second is
    // sixteen to sixty times the observed latency and anything past it is a
    // socket that will never answer. It only matters on a cold cache, where
    // both attempts hanging cost 6.2s of a reader's time at 3000ms and 2.2s
    // here. Nothing legitimate is lost.
    deadlineMs: 1000,
  },
  {
    name: 'Open-Meteo Air Quality',
    url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=56.95&longitude=24.11&current=pm2_5',
    type: 'open-meteo',
    required: false,
    powers: 'Air quality',
    note: 'Reached over a throttled shared egress address, so a failure here is not reliable evidence about the source',
    cadence: 'H',
    maxLag: 3,
    deadlineMs: 1000,
  },
  {
    name: 'Newsroom pipeline',
    url: NEWSROOM_RUN_REPORT,
    type: 'newsroom-run',
    required: true,
    powers: 'Article publishing',
    // A daily source, so it fits the same model as everything else. But the
    // report carries its own `stale_after_hours` and that wins: the schedule
    // moved from one run a day to three the moment PR #82 merged, and a bound
    // copied into this file would have quietly become wrong. This is the
    // fallback for a report too old or too broken to declare one.
    cadence: 'H',
    maxLag: 26,
  },
  {
    name: 'Riga Open Data',
    // Entity sets return HTTP 500 upstream; only the service document responds.
    url: 'https://opendata.riga.lv/odata/service/',
    type: 'text',
    required: false,
    powers: 'Nothing — retained as an availability signal only',
    note: 'Entity sets return HTTP 500 upstream; no dashboard element depends on it',
    // The service document is a static capability listing with no timestamp,
    // and every endpoint that would carry one is broken upstream.
    cadence: null,
    freshnessNote: 'service document carries no timestamp and every data endpoint 500s',
  },
];

module.exports = {
  CHECKS: CHECKS,
  NEWSROOM_RUN_REPORT: NEWSROOM_RUN_REPORT,
  buildNordPoolProbeUrl: buildNordPoolProbeUrl,
};
