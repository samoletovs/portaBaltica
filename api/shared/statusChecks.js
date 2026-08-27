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

function buildNordPoolProbeUrl() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return 'https://dashboard.elering.ee/api/nps/price?start=' +
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
    url: es.EUROSTAT_BASE + '/une_rt_m?geo=LV&unit=PC_ACT&s_adj=SA&age=TOTAL&sex=T&freq=M' +
      '&sinceTimePeriod=' + es.sincePeriod('M', 2),
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
    // A window of quarters, never `lastTimePeriod=1`. That parameter asks the
    // Europe-wide cube for the newest quarter *any* port filed, which Riga is
    // routinely behind — it reported a healthy feed as dead for weeks.
    url: es.EUROSTAT_BASE + '/mar_tf_qm?format=JSON&lang=EN&freq=Q&tonnage=TOTAL' +
      '&vessel=TOTAL&unit=NR&rep_mar=LV_0LVRIX&sinceTimePeriod=' + es.sincePeriod('Q', 3),
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
    name: 'data.gov.lv CKAN',
    // `site_read` was removed from the portal's action list; `status_show` is
    // the supported liveness action.
    url: 'https://data.gov.lv/dati/api/3/action/status_show',
    type: 'ckan',
    required: true,
    powers: 'Business registry counts',
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
