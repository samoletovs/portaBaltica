# portaBaltica — Agent Instructions

## Project overview

Baltic open data intelligence dashboard. Evolving from a maritime-only dashboard to a full Bloomberg-style data platform covering 44+ Latvia government APIs across economy, property, energy, environment, transport, and business intelligence.

## Tech stack

- **Frontend:** React 19, TypeScript 5.9, Tailwind CSS 4.2, Vite 8
- **Backend:** Azure Static Web App managed functions (JavaScript)
- **Data sources:** Eurostat dissemination API (JSON-stat 2.0), data.gov.lv CKAN API v3, Open-Meteo, Elering (NordPool), ECB, CSP PxWeb
- **Hosting:** Azure Static Web Apps (free tier) at portabaltica.naurolabs.com
- **Theme:** Light and dark themes driven by CSS custom properties in
  `src/index.css`; components use the named `dash-*` / `news-*` classes

### Known-dead sources

- `opendata.riga.lv` OData — every entity set returns HTTP 500 and `$format=json`
  is rejected; only the service document responds. Nothing depends on it. It is
  still probed by `/api/system-status` as an optional source so that a recovery
  is noticed.
- CSP PxWeb `RUI020m` (industrial production) and `RCI020m` (producer prices) —
  the five `MIG_*` codes answer HTTP 200 with an all-null series, and the **35
detailed NACE codes** (`B`, `C`, `C10` …) are the ones rejected
  with HTTP 400. Both indicators fall back to Eurostat.
- data.gov.lv maritime — the three port datasets
  (`ar-juras-parvadajumiem-...`, `pasazieru-parvadajumu-...`,
  `parvadajamo-juras-kravu-...`) have published **header-only CSVs since
  2026-03-08**: `REJVESLS` at 64 bytes, `PSNGFERRY` at 146, `LOADCRG` at 106,
  eighteen weeks running. The datastore correctly refuses to ingest them, so
  `datastore_active` never advances past the 2026-03-01 snapshot. This is a
  discontinued feed, not a lagging one — no amount of waiting recovers it.
  The maritime tile reads Eurostat instead (see below). Do not "fix" the port
  panels by pointing them back at these datasets.

## Architecture

```
portaBaltica/
├── src/                    # React frontend
│   ├── main.tsx            # Routes: / news feed, /data dashboard
│   ├── App.tsx             # The dashboard tile layout, now served at /data
│   ├── api.ts              # All dashboard API fetch functions
│   ├── news-api.ts         # Reads published article JSON (no credentials)
│   ├── news-types.ts       # Article contract + isServable() render gate
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── newsroom/
│   │   ├── correspondents.ts  # Mirrors newsroom/personas.yaml; builds bylines
│   │   ├── editorial.ts       # Accountable editor + byline suffix
│   │   ├── markdown-parse.ts  # Block parser for the policy documents
│   │   ├── markdown.tsx       # Renders those blocks as React (never as HTML)
│   │   ├── sections.ts        # Section display names
│   │   ├── structured-data.ts # JSON-LD NewsArticle (tier A only)
│   │   └── usePageMeta.ts     # Per-route title, description, canonical
│   └── components/
│       ├── news/
│       │   ├── NewsroomLayout.tsx  # Masthead with the standing AI disclosure
│       │   ├── NewsFeed.tsx        # The front page
│       │   ├── ArticleView.tsx     # Applies isServable() before rendering
│       │   ├── ArticlePage.tsx     # Loads one article by slug
│       │   ├── LinkOutCard.tsx     # Tier C — link out only, never a rewrite
│       │   ├── Byline.tsx          # Always contains "AI correspondent"
│       │   ├── ProvenanceBlock.tsx # The passport: data, model, checks
│       │   ├── ChartEmbed.tsx      # Lazy recharts; the article → /data round trip
│       │   ├── CorrespondentAvatar.tsx # Abstract marks only, never a face
│       │   ├── CorrespondentPage.tsx, AiPolicyPage.tsx, CorrectionsPage.tsx
│       │   ├── NewsCard.tsx, TierBadge.tsx, JsonLd.tsx, PolicyFooter.tsx
│       ├── Header.tsx       # Dashboard header
│       ├── InsightsBanner.tsx # AI-generated insights
│       ├── EconomyTile.tsx  # Economy & Business data
│       ├── PropertyTile.tsx # Property & Energy data
│       ├── EnvironmentTile.tsx # Weather, air quality, population
│       ├── MaritimeTile.tsx # Port statistics (Eurostat) + live sea state
│       ├── PortCard.tsx     # Individual port card (marine weather)
│       ├── PortPanelParts.tsx   # Shared chrome for the three port panels
│       ├── VesselTrafficPanel.tsx # Vessel arrivals, mar_tf_qm
│       ├── PassengerPanel.tsx     # Sea passengers, mar_pa_qm
│       └── CargoPanel.tsx         # Cargo tonnage + type mix, mar_go_qm
├── newsroom/               # Newsroom contracts (schema, personas, sources)
│   └── policy/             # Published AI-use and corrections policy —
│                           # authoritative text, rendered at /about/ai and
│                           # /corrections. Never restate it in JSX.
├── api/                    # Azure SWA managed functions (JS)
│   ├── shared/
│   │   ├── eurostat.js     # Deadline-bounded HTTP + strict JSON-stat parsing
│   │   ├── indicators.js   # Every Baltic comparison indicator, fully pinned
│   │   ├── cache.js        # TTL + grace, request coalescing, LRU
│   │   ├── responseCache.js# withCache: one computed response per key per TTL
│   │   └── ports.js        # Baltic port registry + Eurostat maritime cubes
│   ├── baltic-compare/     # LV vs EE vs LT from Eurostat
│   ├── historical-data/    # Latvian series: CSP PxWeb, Eurostat fallback
│   ├── power-prices/       # Nord Pool day-ahead + zone spread
│   ├── port-data/          # Baltic port statistics from Eurostat (?country=)
│   ├── sea-state/          # All three ports' marine + surface weather, in one
│   ├── economy-data/       # ECB, NordPool, CSP, business registries
│   ├── property-data/      # Construction, energy certs, cadastral
│   ├── environment-data/   # Weather, air quality, population
│   ├── system-status/      # Health probes for every upstream + published traffic counts
│   ├── news-rss/           # /rss.xml — our own articles only
│   └── news-sitemap/       # /sitemap.xml
├── scripts/
│   └── visit-stats.mjs     # Azure Monitor hourly series → Riga-day request counts
└── infrastructure/
    ├── main.bicep          # SWA + monitoring + newsroom Functions/Storage/RBAC
    ├── modules/
    │   └── foundry-role-assignment.bicep  # cross-RG grant to foundryLab
    └── verify/             # managed-identity smoke test (see below)
```

## Azure infrastructure

### What is deployed where

| Resource | Name | RG | Region |
|---|---|---|---|
| Static Web App (Free) | `portabaltica-swa` | **`era-rg`** ⚠️ | westeurope |
| Function App (Flex Consumption, Python 3.12) | `portabaltica-func` | `portabaltica-rg` | northeurope |
| App Service plan (FC1) | `portabaltica-plan` | `portabaltica-rg` | northeurope |
| Storage (`articles`, `raw-feeds`, `approvals`, `deployment`) | `stportabaltica<suffix>` | `portabaltica-rg` | northeurope |
| Log Analytics (0.1 GB/day cap) | `portabaltica-law` | `portabaltica-rg` | northeurope |
| Application Insights | `portabaltica-ai` | `portabaltica-rg` | northeurope |
| AI models | `foundrylab-aiservices` (**shared, reused**) | `foundrylab-rg` | swedencentral |

Create the resource group once — `infrastructure/main.bicep` is
resourceGroup-scoped and does not create its own RG:

```powershell
az group create -n portabaltica-rg -l northeurope
az deployment group create -g portabaltica-rg --template-file infrastructure/main.bicep
```

### Region decisions

- **`northeurope`** for everything new, per the PLATFORM.md default. Flex
  Consumption and Python 3.10–3.14 are both available there (verified with
  `az functionapp list-flexconsumption-locations`), so there was no reason to
  deviate.
- The Function App calls `foundrylab-aiservices` in **`swedencentral`**
  cross-region. memex colocates in swedencentral to cut latency; portaBaltica
  does not, because generation is a batch timer job where tens of milliseconds
  of extra round-trip are invisible. Colocation would have bought nothing and
  cost the northeurope default.

### Auth: managed identity, no keys

The Function App's **system-assigned managed identity** is the only credential
in the system. There is no API key, connection string or `@secure()` parameter
anywhere in `infrastructure/`, and adding one would be a regression.

| Grant | Scope |
|---|---|
| Storage Blob Data Contributor | own storage account |
| Storage Queue Data Contributor | own storage account |
| Storage Table Data Contributor | own storage account |
| **Cognitive Services OpenAI User** | **`foundrylab-aiservices` in `foundrylab-rg`** |

Two settings make this enforceable rather than aspirational: the storage
account sets `allowSharedKeyAccess: false`, and `foundrylab-aiservices` has
`disableLocalAuth: true`. A key would not work even if someone added one.

Queue and Table Data Contributor are not decoration. Once
`AzureWebJobsStorage` is identity-based, the Functions host itself needs them
to create `azure-webjobs-hosts` / `azure-webjobs-secrets` and take timer
singleton locks. Without them the app starts and the timer never fires.

This closes portaBaltica's entry as an anti-pattern in
[`.github/wiki/insights/foundrylab-shared-account.md`](../.github/wiki/insights/foundrylab-shared-account.md):
the project now reuses the shared Foundry account with no new AI resource.

### Granting Foundry access out of band

The cross-resource-group grant is made by
`infrastructure/modules/foundry-role-assignment.bicep` as part of the normal
deployment. It only needs doing by hand if the deploying principal lacks
`Microsoft.Authorization/roleAssignments/write` on `foundrylab-rg` — in which
case deploy with `-p grantFoundryAccess=false` and run:

```powershell
$mi = az deployment group show -g portabaltica-rg -n portabaltica-newsroom-infra `
  --query properties.outputs.functionAppPrincipalId.value -o tsv

# Resolve the scope rather than hardcoding a subscription id — this repo is public.
$scope = az cognitiveservices account show -n foundrylab-aiservices -g foundrylab-rg `
  --query id -o tsv

az role assignment create `
  --assignee-object-id $mi `
  --assignee-principal-type ServicePrincipal `
  --role "Cognitive Services OpenAI User" `
  --scope $scope
```

Do **not** copy role GUIDs from memory. Read them from Azure —
`az role definition list --name "Storage Blob Data Contributor" --query "[0].name"`.
A wrong GUID fails the deployment with the unhelpful `RoleDefinitionDoesNotExist`,
which is exactly how the first attempt at this template failed.

### Verifying the identity actually works

`infrastructure/verify/` is a managed-identity smoke test that calls
`gpt-4o-mini` on `foundrylab-aiservices` and round-trips a blob, both via
`DefaultAzureCredential`, from inside the deployed app. Run it after any change
to the identity or the role assignments:

```powershell
cd infrastructure/verify
func azure functionapp publish portabaltica-func --python

$key = az functionapp keys list -n portabaltica-func -g portabaltica-rg `
  --query "functionKeys.default" -o tsv
irm "https://portabaltica-func.azurewebsites.net/api/identity-check?code=$key"
```

A role assignment that exists in a template but was never exercised is
indistinguishable from one that does not work. `what-if` proves the shape; this
proves the behaviour.

**RBAC propagation lags in both directions, by minutes.** Measured during this
verification: after deleting the Foundry grant the data-plane call kept
succeeding for ~13 minutes before Azure's cached authorization caught up, and
after re-creating it the call kept failing for ~7 minutes. So do not read a
passing probe straight after a revocation as evidence the revocation failed,
do not read a failing probe straight after a deployment as evidence the
template is broken, and do not treat a just-deleted grant as an effective
security boundary.

### Known deviation: the SWA lives in `era-rg`

`portabaltica-swa` is in **`era-rg`**, not `portabaltica-rg`. That is wrong and
it is deliberately not fixed in the newsroom infrastructure change.

- It serves `portabaltica.naurolabs.com`, custom domain status `Ready`, and the
  site returns 200 today.
- ARM's `validateMoveResources` API was called for real against
  `era-rg → portabaltica-rg` and returned **204**, so the move is *permitted*.
  The blocker is not ARM.
- The residual risk is the custom-domain rebind and the `AZURE_SWA_TOKEN` /
  workflow references, neither of which `validateMoveResources` covers. A
  resource move also cannot change region, so the SWA would stay `westeurope`
  inside a `northeurope` RG — cosmetic tidiness at the cost of a production
  domain outage window.

So `main.bicep` does **not** create the SWA by default
(`manageStaticWebApp: false`) and records where it actually lives via the
`staticWebAppResourceGroup` parameter. Deploying with `manageStaticWebApp: true`
while the `era-rg` copy exists would create a *second* Static Web App.

Fix it as scheduled maintenance with the domain rebind planned, not as a side
effect of a feature PR.

### Counting traffic, and why there is no counter

The status panel reports **request volume, not visitors**, and the distinction is
load-bearing. `SiteHits` counts every HTTP request the SWA serves; a single-page
app serves one document plus a dozen assets per arrival, so the figure overstates
the audience by whatever that ratio happens to be. It is labelled `requests` in
the published JSON, in the API response, in the UI, and in a test that fails if
the word "visits" appears in the rendered panel. Relabelling it without changing
where the data comes from would be the same class of error as the cache collision
above: a real number under a name that means something else.

**The site cannot count its own traffic, and the reason is structural.** The SWA
is Free tier, so it has no managed identity (`identity: null`, verified against
the live resource), and its storage account sets `allowSharedKeyAccess: false`,
so there is no connection string it could hold instead. A Function therefore has
no durable store, and anything it counted would live in process memory and reset
on every cold start — several times a day on an app that idles out in minutes.
A total that silently returns to zero is worse than no total, because a reader
cannot tell a quiet morning from a restart.

So nothing is instrumented. Azure Monitor already records this traffic durably
for 93 days at no cost. `.github/workflows/visit-stats.yml` reads it hourly with
the repository's existing **OIDC federated identity** — no stored secret —
reduces it with `scripts/visit-stats.mjs`, and writes `visits.json` to the public
`stats` container. `/api/system-status` fetches that with no credential, exactly
as `api/shared/newsroom.js` already fetches finished articles, and omits the
block entirely when the read fails. **Absent must stay absent all the way to the
UI**: substituting zeros would render as "nobody came today" on the strength of
a missing file.

Two things that look like details and are not. The day boundary is Europe/Riga,
not UTC, because bucketing UTC timestamps into UTC days misfiles every request
between local midnight and 02:00 or 03:00 — a plausible figure, one day out, for
three hours out of twenty-four, which no eyeball would ever catch. And
`az monitor metrics list` **requires `--end-time`**: given only `--start-time` it
clamps the window to one hour and returns an empty bucket, which aggregates to a
confident zero rather than an error. Measured while building this, the same
command without an end time reported no traffic on a day with 2,407 requests.
The workflow refuses to publish a reading with no observations for that reason.

The `stats` container is the one container deliberately declared `publicAccess:
'Blob'` in `main.bicep`. Note that `articles` is public in the live account while
the template says `'None'` — undeclared drift a redeploy would revert. The stats
file does not build on that; its access level is stated in the IaC.

The metric read needs one grant: **`Monitoring Reader` on `portabaltica-swa`**
for the CI service principal (`portabaltica-github-deploy`), which already held
`Storage Blob Data Contributor` on the storage account for the write. It is
scoped to the single Static Web App resource — not `era-rg`, not the
subscription — and the role is read-only, so it cannot deploy or reconfigure the
site.

Because the SWA is in `era-rg` and `main.bicep` is scoped to `portabaltica-rg`,
that grant is a cross-RG module, exactly like the Foundry one:
`modules/swa-metrics-role-assignment.bicep`. It is opt-in, since the principal is
GitHub's rather than one this template creates:

```powershell
$sp = az ad sp show --id (az ad app list --display-name portabaltica-github-deploy `
  --query "[0].appId" -o tsv) --query id -o tsv

az deployment group create -g portabaltica-rg --template-file infrastructure/main.bicep `
  -p ciPrincipalId=$sp
```

Deploy without `ciPrincipalId` and nothing is granted. If the deploying principal
cannot write role assignments in `era-rg`, make it out of band instead — and read
the GUID from Azure rather than copying one:

```powershell
$scope = az staticwebapp show -n portabaltica-swa -g era-rg --query id -o tsv

az role assignment create `
  --assignee-object-id $sp `
  --assignee-principal-type ServicePrincipal `
  --role "Monitoring Reader" `
  --scope $scope
```

### Cost

Target is €3–5/mo for the newsroom. Flex Consumption's free grant is
**per subscription**, and memex is also on Flex Consumption — if the lab adds
more Flex apps, the grant is shared and this number moves. Watch it there
rather than assuming it stays free.

The SWA stays **Free**. It never gets a managed identity, because it does not
need one: articles are generated on a timer by the Function App and the browser
only ever reads finished static JSON. See
[`.github/wiki/insights/swa-free-tier-constraints.md`](../.github/wiki/insights/swa-free-tier-constraints.md).

### Noted, not wired

There is an unused free **Translator F0** (`translator-agents-s6vbks3oteo4y`,
northeurope) available for the future multi-language phase. It is deliberately
not referenced in `main.bicep` yet.

Free-tier Cosmos is **already consumed by golazo** — a subscription allows only
one — so the newsroom uses blob storage for state, not Cosmos.

### The `AZURE_OPENAI_KEY` repo secret is still live — do not delete it

The newsroom pipeline uses managed identity and holds no key. That does **not**
make the `AZURE_OPENAI_KEY` repo secret redundant:

- It is consumed by `.github/workflows/copilot-triage.yml` for AI issue triage.
  That runs on a GitHub Actions runner, which has no managed identity to use
  instead.
- It targets a **different account** — `gpt-4.1-nano` on
  `oai-agents-s6vbks3oteo4y` (`rg-personal-agents`), not `foundrylab-aiservices`.
  It could not target foundryLab: `disableLocalAuth: true` blocks keys there.

The workflow fails **soft** (`if (!endpoint || !apiKey) { ...skipping...; return }`),
so deleting the secret leaves the workflow green while triage silently stops.
Retiring it properly means migrating that workflow to OIDC federated credentials
first, and turning the soft-fail into a hard failure so a bad migration is
visible.

## Conventions

- Follow NauroLabs TypeScript + React conventions (see .github/instructions/)
- Colour comes from the named classes and custom properties in `src/index.css`
  — `dash-*` on the dashboard, `news-*` in the newsroom — and `DESIGN.md` is
  authoritative. **Not `ocean-*`.** That instruction stood here for months
  after it stopped being true: measured 2026-08-28, `ocean-` appears in exactly
  two files, `src/index.css` (11 `@theme` definitions) and this one, and in
  **zero** components. The control that makes that reading trustworthy is
  `dash-`, which the same grep finds in eight components and counting. A
  session briefed with this line dutifully ignored it and used the real system,
  which is the good outcome; the bad one is a session that obeys it and
  hand-rolls a palette the contrast tests cannot see, because
  `design-system.test.ts` computes ratios against the declared custom
  properties and an undeclared class is invisible to it.
- All API data goes through SWA managed functions (CORS proxy)
- Cache aggressively: data.gov.lv datasets update daily/biweekly, not per-request
- No hardcoded text — but i18n is not required yet (English only for now)
- Maritime port statistics come from Eurostat, not data.gov.lv. `PortCard` (live
  marine weather) is Latvia-only because the forecast is fetched per coordinate;
  the three statistics panels cover LV, EE and LT.

## Typography and design

**[`DESIGN.md`](DESIGN.md) is the design book and it is authoritative.** Read it
before changing anything visual. It covers spacing, radius, surfaces, colour,
contrast floors, focus, motion and — most importantly for this project — the
chart rules, including why a rise is not automatically good news. What follows
here is the type scale only; everything else lives there.

Two suites enforce it: `tests/typography.test.ts` and
`tests/design-system.test.ts`. Contrast is computed rather than asserted, so a
colour change tells you the ratio you actually shipped.

**Every component on the site** — the newsroom under `src/components/news/**` and
`src/newsroom/markdown.tsx`, *and* the dashboard under `src/components/**` —
sizes text from the named scale in `src/index.css`. Never Tailwind's default
ramp, never an arbitrary value:

| Step | Size | Job |
|---|---|---|
| `text-caption` | 12px | eyebrows, badges, meta, footnotes, axis labels |
| `text-ui` | 14px | nav, controls, labels, table cells, dense prose |
| `text-callout` | 16px | card and panel titles, deks, secondary prose |
| `text-prose` | 18px | article and policy prose |
| `text-lead` | 22px | standfirsts, feed item headlines, port names |
| `text-title` | 28px | section headings, news and dashboard alike |
| `text-headline` | 34px | page headlines |
| `text-display` | 40px | the lead story, article `h1`, page `h1` |

One family for the whole site, resolving to the platform's own UI face. An
earlier pass set articles in Source Serif 4 and left the dashboard on the UI
face, on the theory that a reader should be able to tell journalism from an
interface. That is right for a newspaper and wrong here: this is a dashboard
with a newsroom attached, readers cross between the two constantly, and two
families across that boundary read as inconsistency rather than as register.
Hierarchy is carried by size, weight and colour instead.

Two weights only — regular and `font-semibold`. Nothing between them. The book
claimed this before it was true: `font-medium` appeared thirty-two times and an
inline `fontWeight: 500` four more, and on a system UI face 400 → 500 is barely
a change, which costs a weight and buys nothing legible. Small-caps labels are
always `tracking-widest`; `tracking-wider` on the same kind of label is the
near-miss that makes a page look assembled rather than designed.

Every page opens the same way: an `h1` at `text-display`, sections at
`text-title` beneath it. The dashboard used to have no page heading at all and
headed each tile with a 14px uppercase label — smaller than the cards under it.
An `h2` is never `text-caption`: a section heading set smaller than its own
content stops reading as a heading. Reading columns use `max-w-measure`, ~68
characters at 18px.

Charts draw outside the DOM, so recharts sizes live in
`src/utils/chartType.ts` (`chartTick`, `chartTooltip`) and recharts *colours* in
`src/ThemeContext.tsx`, rather than inline at each call site. Sizes had drifted
to four values for two jobs, and `#1e293b` was hardcoded as a gridline in three
components while `chartColors.grid` sat unused two lines away — so the light
theme drew near-black gridlines on white.

`tests/typography.test.ts` enforces all of it across every `.tsx` in `src/`: it
fails on an arbitrary `text-[13px]`, a raw `text-sm` anywhere, an inline
px `fontSize`, a third weight, mixed tracking, a heading no larger than its
prose, an `h2` at caption size, a dashboard section heading that is not
`text-title`, and a font family set outside the tokens.

**Three traps.** Tailwind v4 reads `--text-*` as the font-size namespace, but
`:root` in `index.css` also defines `--text-primary`, `--text-body` and friends
as *colours*, and those are emitted later so they win — which is why the prose
step is `--text-prose` and not `--text-body`. `@theme` entries are also
tree-shaken, so a token no utility uses may not reach the built stylesheet at
all — anything hand-written CSS reads by `var()` belongs in `:root`, which is
why the radius steps are `--corner-*` there rather than `--radius-*` up here.
And nothing may fetch a font from a third party: the CSP is
`font-src 'self' data:`, and a remote font would disclose every reader's IP
address to whoever serves it.

## Data source patterns

- **Eurostat:** every Baltic comparison indicator is defined in
  `api/shared/indicators.js` and fetched through `api/shared/eurostat.js`.
  **Pin every dimension of the cube.** An unpinned dimension makes the parser
  choose a slice on your behalf; it reports that choice in the response's
  `assumptions` array, and `tests/indicators.live.test.ts` fails on it. Give
  each indicator a `sanity` band describing what the statistic *means* — that
  band is what catches a definition pointing at the wrong dataset, which is how
  "Income inequality (Gini)" spent months plotting foreign direct investment.
- **Eurostat maritime:** port statistics live in `api/shared/ports.js`, keyed on
  `rep_mar` (reporting port) rather than `geo` — use `parseJsonStatDim`, not
  `parseJsonStat`. Three cubes: `mar_go_qm_{cc}` goods (thousand **tonnes**),
  `mar_pa_qm_{cc}` passengers (**thousands**, and `unit=THS` — `THS_PASF` looks
  more precise and is almost entirely null), `mar_tf_qm` vessel arrivals
  (Europe-wide, so `rep_mar` must be pinned or it answers HTTP 413). The
  `cargo` dimension interleaves levels — `LBK_ROIL` sits inside `LBK` — so only
  the six codes in `CARGO_MIX` may be summed. Estonia publishes goods and
  passengers at national level only; the API reports that as `countryOnly`
  rather than faking a port breakdown.
- **CKAN Datastore:** `fetch('https://data.gov.lv/dati/api/3/action/datastore_search?resource_id=ID&limit=N')`.
  The portal answers HTTP 200 with `success: false` for an unknown action, so
  check `success` rather than the status code.
- **Open-Meteo:** proxied, never called from the browser. `/api/sea-state`
  serves all three ports' marine and surface weather from one cached response,
  and `connect-src` no longer permits the page to reach Open-Meteo at all. It
  used to be a direct client-side fetch — two calls per port on every load of
  `/data`, for fixed coordinates, from every visitor independently.
- **ECB rates:** `fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')` — parse XML
- **NordPool/Elering:** `fetch('https://dashboard.elering.ee/api/nps/price?start=...&end=...')` —
  returns all four bidding zones (EE, LV, LT, FI) in one response
- **CSP PxWeb:** POST JSON query to `https://data.stat.gov.lv/api/v1/lv/OSP_PUB/`.
  Slow (1–12s per table) and its json-stat2 `value` array is only safe to read
  flatly when the query pins every dimension but time.

## Adding a data source

Give every outbound call an explicit deadline via `api/shared/eurostat.js`'s
`httpJson`/`httpText`. Probe it in `/api/system-status` at an endpoint that is
*cheap* — a catalogue root, not a table query — and at the endpoint the app
actually uses, so a removed action shows up as an outage rather than passing
because some other path on the same host still answers.

**Ask the application for that URL; do not restate it.** Both Eurostat probes
used to be hand-built strings that said the same thing as `buildUrl` and
`ports.seriesUrls`. The unemployment one was byte-identical, which sounds
harmless and is the whole problem — the identity was maintained by hand and
nothing checked it. The maritime one had already drifted: it pinned
`rep_mar=LV_0LVRIX`, Riga alone, over three years, while `/api/port-data` asks
for all four Latvian ports over eight. So the probe was blind to Ventspils,
Liepāja and Skulte, and went red whenever Riga alone was quiet — the false red
that check has already produced once. Measured, the honest query is also the
cheaper one, 37–60ms against 53–110ms, so there was never a cost argument for
the narrower slice.

The newsroom's collision guard failed the same way on the same day, rebuilding
the collector's query parameters with a hardcoded geography list while the
collector's default moved underneath it — and changing no outcome, which is
exactly why nobody noticed. **A guard that reproduces the logic it guards is
not a guard, it is a second implementation that can disagree.** Same family as
an instrument that cannot fail: it stops measuring the thing and says nothing
about having stopped.

**And its quieter sibling: a guard must enumerate the same set as the thing it
guards.** Reproducing the logic is one failure; covering a *smaller population*
than the subject is another, and it is harder to see because the guard is
correct about everything it looks at. Everything in the gap is unguarded while
looking covered.

Three instances, all the same shape:

```
#149     maritime probe   rep_mar=LV_0LVRIX, since 2023-Q1
         the app          4 Latvian ports,   since 2018-Q1

#178     wiring guard     readdirSync(TESTS_DIR)          flat
         the live runner  glob('tests/**')                recursive

389d1f9  vacuity guard    ast.parse(Path(__file__))       one file
         its subject      the invariants, wherever they live
```

Each was found only when someone asked what the *subject* enumerates and
compared it. That is the check: **write down the set the guard walks and the
set the behaviour walks, and require them to match** — or, better, have the
guard call the same builder, as `statusChecks.js` now does with `buildUrl` and
`ports.seriesUrls`. A shared enumeration cannot drift; two enumerations always
will, and the drift is silent in the direction that reports success.

**And a search space is an enumeration.** Reconstructing an unstated counting
rule, I searched three binary choices, found exactly one combination matching
all four subjects, and reported that *"one of eight, therefore not
curve-fitting."* The search held a **fourth** choice fixed — *which* parameter
to drop — so it could only ever return the one I had already assumed:

```
drop corrected_at   [(8,4),(6,0),(8,0),(6,3)]   MATCH
drop claim          [(8,4),(6,0),(8,0),(6,3)]   MATCH
drop series_start   [(8,4),(6,0),(8,0),(6,3)]   MATCH
```

Three rules match, not one, because all three parameters appear exactly once in
every subject — so the per-subject rows constrain no more tightly than the
total did.

The conclusion was still right, on an argument made before any search: dropping
`claim` or `series_start` changes what is being counted, and `corrected_at` is
bookkeeping. **But the search added confidence without adding evidence**, which
is worse than not running it — an unmeasured claim invites challenge, and
*"one of eight"* does not. Twice in one afternoon a check was cited as decisive
while being satisfiable by every candidate it was meant to separate: this, and
a sum over cohort counts that any partition satisfies. Both were produced in the
act of correcting someone else.

So before quoting a search as evidence of uniqueness, **write down what it held
fixed.** That list is the population, and it is not the one the search reports.

**Declare its cadence.** Every probe carries a `cadence` and a `maxLag` in
`api/shared/statusChecks.js`, and `api/shared/freshness.js` judges the newest
observation against them. A registry test fails if a probe omits them, because
liveness and freshness are different questions: `prc_hicp_manr` answered HTTP 200
with valid JSON-stat and plausible values while frozen at 2025-12 for eight
months, and data.gov.lv served eighteen consecutive header-only CSVs behind
`datastore_active: true`. `stale` is a distinct state from `unhealthy` — a source
that is reachable but frozen is a different message to a reader than one that is
down.

**Read the observation the app reads, not the newest row.** A feed that carries a
forecast alongside its actuals will always look fresh if the probe takes the
newest timestamp in the payload, because the forecast runs into the future and a
reading ahead of the wall clock has a negative age. Elering's
`system/with-plan` is the live example: sampled together, `data.real` ended 77
minutes in the past while `data.plan` ran 178 minutes ahead. A probe reading the
whole payload could never go stale — and a probe that cannot fail is not a probe.
`freshness.extract.eleringMetered` reads `data.real` only, and matches what
`/api/live-grid` itself treats as a reading.

**A series can be published in advance, which makes its age negative.** The
same trap as the forecast, arriving from a direction that looks like good news:
`earn_mw_cur` carries `2026-S2` today, four months ahead of the wall clock,
because a minimum wage is legislated before it takes effect. Anything that
judges freshness by subtracting the newest period from now will read that as
"fresher than fresh" and can never mark it stale — so a cadence check has to
clamp at zero and reason about the *previous* period, not just the newest one.
Two of the sources here are now known to publish ahead; assume more are.

**The aggregate can be the emptiest code in the cube.** `TOT_KWH` reads as the
safe default in a consumption dimension — it is the total, so it should be the
best populated thing there. In `nrg_pc_205` it is the *worst*: measured across
the ten half-years to 2025-S2 it carries LV=3, EE=9, LT=4 observations while all
six numbered consumption bands carry 10/10/10. So "Electricity price (industry)"
drew Latvia with three points in ten beside a nearly complete Estonia, which a
reader parses as Latvia having stopped reporting rather than as us having asked
the wrong question.

Nothing about this is detectable from the latest value: the newest period *is*
populated for all three, so the sanity band passes, the freshness check passes
and the live contract passes. **Coverage across the window is a third question,
separate from liveness and from freshness**, and the only one that catches it.
And the lesson is per-cube rather than per-code — `TOT_KWH` in `nrg_pc_204`
(households) is complete for all three and is the correct pick there. Check the
code you are about to pin against its siblings rather than reasoning about what
it ought to contain.

`tests/indicators.live.test.ts` now asserts it: the newest eight observations
must be contiguous, read back from each country's *own* last observation. All
sixty-six definitions pass it today, which is the useful half of the result —
one bad pin, not a class of them.

**Where a gap is data rather than a defect**, because the sweep found both and
the difference is not obvious. Sparseness has a shape:

| Shape | Reading |
|---|---|
| **Leading** run of nulls | The country began reporting later. Data. Estonia's long-term interest rate starts seventeen months into the window. |
| **Trailing** null | Ordinary publication lag; the freshness check already owns this. |
| **Interior** hole between two real readings | Usually the pin. This is the signature. |

Interior holes are only *usually* the pin, so the test that settles it is:
**can it be fixed by repinning without changing what the number means?**

- `elec_price_industry` — yes. A sibling code measured the same statistic and
  was complete 10/10/10, so the gap was ours.
- `tourism` — no. Estonia is missing eleven months of `tour_occ_nim`, all of
  them historical and clustered in the off-season. The components `I551` and
  `I552` carry those months but the aggregate `I551-I553` does not, because
  `I553` is suppressed and Eurostat will not publish a total without it. The
  only available "fixes" are hotels-only, which is a different statistic, or
  summing components, which fabricates the suppressed one. So the gap is real
  and the pin is right.

**And a gap can be invisible to a null-based check**, because the missing
period is not represented at all. `sdg_04_70` offers the time coordinates
`2021, 2023, 2025` — there is no 2022 or 2024 to be null. The contiguity
assertion above sees a perfectly contiguous series, and it is right to: the
cube is not withholding anything.

What that breaks is the assumption underneath `freq`. **`freq` is the cube's
dimension code, not the publication cadence**, and for exactly one of the
sixty-six they disagree — the query genuinely needs `freq=A` while publication
runs every twenty-four months. Everything downstream that reads `freq` as a
cadence inherits the mismatch, and the sharpest is the freshness allowance: the
newest observation's age oscillates from about 8 months just after publication
to **30** just before the next, which is precisely `MAX_AGE_MONTHS.A`. It sat
on the boundary rather than inside it, so a one-month slip would have marked a
healthy series stale, and tightening the annual default to a perfectly sensible
18 would have broken it for over half of every cycle. It carries an explicit
`maxAgeMonths` now, so the allowance travels with the fact that explains it.

`tests/indicators.live.test.ts` asserts this too, and **not as an exception
list**: an indicator whose observed publication interval differs from its
declared `freq` must carry an explicit `maxAgeMonths`. The override *is* the
declaration. A definition that publishes off its stated frequency has to say
so in the one field that makes the freshness check correct anyway, which means
the next off-cadence series is caught when it is added rather than when it
breaks.

**Keep both checks. Neither subsumes the other.** The contiguity assertion
finds a pin selecting a code a country barely populates — holes *between* real
readings. The cadence assertion finds a frequency the definition does not
actually have — a gap with no null to find, because the period is not
represented. Each is blind to the other's shape, and running only one of them
looks like coverage.

**Neither belongs on `api/shared/ports.js`, and the reason generalises.** The
obvious next move after writing a guard is to point it at every registry, and
here that is wrong. Measured across the twelve maritime series: cadence passes,
and contiguity **fails on four of them** — Kunda, Pärnu, Sillamäe and Tallinn
are missing all four quarters of 2024 in `mar_tf_qm`, with data on both sides.
That is not a pin. Checked against every one of the 25 × 14 × 2 tonnage,
vessel and unit combinations the cube offers, Tallinn has 486 non-null cells in
2023 and 494 in 2025 and **zero** in 2024: Estonia did not file that year.

So the guard would red-light correct work, and it does not need to run there
anyway — because **the consuming code decides whether a hole is dangerous**.
`portStats.ts` addresses every reading by period *label*: `sameQuarterLastYear`
turns `2025-Q4` into `2024-Q4` and `valueAt` matches on `p.period ===`, with no
index arithmetic anywhere. A missing quarter therefore degrades to "no
year-on-year comparison shown", which is what a reader sees for Estonian
vessels today, rather than to a comparison against the wrong quarter.

The rule is: **a hole needs a guard where the consumer indexes by position, and
is self-limiting where the consumer addresses by label.** Structure beats a
test wherever you can have it — and that is the same choice as counting periods
rather than observations, one layer down.

Applied across this repo's consumers, the split is:

| Consumer | How it addresses a reading | |
|---|---|---|
| `portStats.ts` — `valueAt`, `sameQuarterLastYear` | period label | safe by construction |
| `PortBars`, `MeasureHeadline` | via `valueAt` | safe by construction |
| `IndicatorCard`, `IndicatorTable` — `values[length - 2]` | **position** | safe only by a guard elsewhere |

That last row is the one to know about. `previous` is the second-newest
*non-null value*, not the previous *period*, because the array is filtered
before it is indexed. It is correct today for two independent reasons: no time
word is attached to it anywhere — the label is "Previous" and
`changeDescription` says "up" or "down", never "since last quarter" — and the
contiguity assertion in `tests/indicators.live.test.ts` makes a hole inside the
newest eight observations impossible, so the second-newest reading *is* the
preceding period.

**The second reason lives in a different file and nothing connects them.**
Weaken the contiguity assertion, or exempt one indicator from it, and `previous`
silently becomes "some earlier reading" with an arrow and a sentiment colour
attached to a change that spans more than one period. If a time word is ever
added to that label, it must be computed from the period rather than assumed.

The newsroom hit the same mismatch from the prose side on the same day: its
streak detector walked the deltas between *readings* and stated the result as a
claim about *periods*, so five readings across ten months would have read as
"four consecutive monthly moves". Same root, two different lies — **count the
periods, not the observations**. Its `detect_record_extreme` had the answer all
along and says *"across 14 observations since 1999"*: it counts observations,
calls them observations, claims no time unit, and is true at any cadence.

**An optional probe must never make a reader wait.** `overallStatus` reads only
the required checks, so an optional result cannot change the verdict by
construction. Riga Open Data — `required: false`, powering nothing — was measured
hanging for 6202ms on eight consecutive live requests inside a 6206ms page:
99.9% of the response spent on the one answer that is discarded. Optional checks
now get `OPTIONAL_RESPONSE_BUDGET_MS` and no more; the probe is not cancelled, so
it still files its result in the cache and a recovery still surfaces on the next
request. Measured under the same conditions the page went 6209ms → 765ms cold and
→ 359ms once the abandoned probe landed.

That source is also less dead than this file used to imply. Its *entity sets*
return HTTP 500, which is why nothing reads it — but the service document the
probe actually calls answers HTTP 200 in 145–350ms from an ordinary connection,
four times out of four. Its 6.2s is our egress failing to reach it, the same
signature as Open-Meteo, not the source being down.

**Never let two definitions share a cache key.** Several indicators legitimately
read the same cube — `bop_c6_q` backs seven balance-of-payments series,
`sts_rb_q` backs registrations and bankruptcies, `mar_go_qm_{cc}` backs total
throughput and each cargo category — and they differ *only in query params*. A
cache keyed on the URL alone therefore collides: the first request is fetched and
archived, and every later one inside the TTL is served that payload under a
different metric's label.

That shipped. Five articles published real Eurostat figures attached to metrics
they did not measure — three separate trade series printed the identical
`1088.6`, and a piece headlined "business bankruptcy declarations" carried the
*registrations* value, which means the opposite thing about an economy.

It is worth understanding why nothing caught it. Every editorial gate passed:
the figures were genuine, traceable to their signal fields, and correctly
compared against their own basis. The validator confirmed the number came from
the signal — and it had; the signal was built from the wrong cube. **The
contract protects figures, not subjects.** It surfaced only because two articles
published byte-identical figures under different names on consecutive days,
which no per-article check can see.

So the key must cover the request as actually made, and a registry test must
assert that no two dataset definitions can collide. The same rule applies on both
sides of the repo: `api/` is currently correct, and its own caching (added for
Open-Meteo, extended to the live grid) is keyed per source rather than per
request — fine today, and exactly how the newsroom acquired this.

A cheap invariant catches it either way: `goods_balance + services_balance`
equals `trade_balance`, so if the three ever agree exactly, they are the same
series wearing three names.

## Caching, and why it is not a database

Every endpoint is wrapped in `withCache` from `api/shared/responseCache.js`,
which remembers the **finished response** — body, headers and all — for a TTL
chosen from how often the upstream can actually change. Read that file before
changing any of it; what follows is the shape and the reasoning.

Applied at the boundary, once, for the same reason `withSecurity` is: adding
`cache.memo(...)` around each fetch inside each handler is a change that is
*finished* only if every call site was found, and a miss is invisible because
the endpoint keeps working. Caching the response rather than the fetches also
buys the parsing and assembly — `/api/port-data` reduces four Eurostat cubes to
12KB of JSON, and remembering the four fetches still leaves that work per
request.

**`keyOn` is mandatory and there is no default.** It names every query parameter
the handler reads. This is the same rule as `requestKey`, for the same reason,
and the consequence of getting it wrong is not a slow page but Estonia's figures
under Latvia's heading — correct, well-formed, and wrong. Declaring the
parameters rather than hashing the whole query string also means an unknown
parameter cannot be used to walk past the cache and drive upstream load at will.

Only a `200` is remembered. A `400` is an answer about the request and costs
nothing to repeat; a `502` would turn a blip into a fixed outage for the length
of the TTL. When upstream fails and a good answer is still inside its grace, the
reader gets the last good data with `Age` and `X-Cache: stale` rather than a
502 — the body carries its own `fetchedAt`, so it degrades to "here is what we
knew, and when" rather than to a lie or a blank page. `system-status` is the
deliberate exception at `graceMs: 0`: a remembered "healthy" during a real
outage is exactly the false green this codebase exists to remove.

### An instant survives caching. An age does not.

That `fetchedAt` is load-bearing, and the reason generalises into the one rule
that decides **what kind of value may go in a cached body**:

> A value computed against `Date.now()` is a fact about *when it was computed*.
> Freeze it into a body that is then served for a TTL and it describes a moment
> that has passed — wrong for every reader after the first, and wrong by more
> the longer the cache works.

`fetchedAt` is an **instant** and stays true however long the body is held. A
duration measured from now is **relative** and starts decaying the moment it is
serialised. The two look alike in a payload and are not the same kind of thing.

Three fields have now been found this way, all in `/api/live-grid`, and the
sequence is the point — the first was found by a seam sweep, and the other two
by applying the same test to the rest of the same response:

```
readAgoMs        header  X-Cache: hit   Age: 209
                 body    servedFromCache: false   readAgoMs: 0

minutesBehind    Age 561s  minutesBehind 72     <- built when the lag was 72
                 Age  20s  minutesBehind 81     <- rebuilt; the truth had moved
                 Age 101s  minutesBehind 81     <- frozen for five more minutes
```

`readAgoMs` was the sharpest, because it existed *specifically* to let the UI
say "here is when we last got through" — so a banner built on it would have
announced a live read for a response three and a half minutes old, failing in
exactly the case it was added for.

**And the client cache compounds it.** `src/api.ts` caches responses again in
the browser, so the error a reader sees is the server's TTL *plus* the client's,
and neither layer knows the body contains a number that was only true at the
start of the first one. A key with no entry in `CACHE_TTL` falls to the default,
which is how a panel headed "Estonian grid" came to hold a quarter-hourly feed
far longer than the feed's own period and still date it as freshly arrived.

So: **ship the instant, subtract at the point of render.** The subtraction is
free, it cannot be stale, and it removes a field rather than adding one. Where
an age is genuinely wanted per-response rather than per-body — how old *this*
delivery is — it belongs in a header the cache layer sets itself, which is what
`Age` and `X-Cache` already are.

The check is one question, and it is worth asking of any value before it is
cached: **would this still be true if the body were served an hour from now?**
An instant, a period label, a measured quantity — yes. A duration measured from
the moment of writing — no.

That is a question about the value's *definition*, not about its name, and the
distinction matters because the names are the unreliable part: `readAgoMs`,
`minutesBehind` and `servedFromCache` share no vocabulary at all, and the third
is a boolean rather than a duration. What they share is that each recorded the
state of a clock or a cache at the moment of writing. Executed rather than
asserted — a case-insensitive grep for `ago|behind` over the three names finds
**two of the three**, and the one it misses is the one that was found first and
that shipped the worst error.

Three defects were measured in the layer underneath, and all three got worse in
proportion to the audience — which is the shape of bug that matters here:

| Measured | Was | Now |
|---|---|---|
| 20 concurrent requests for one key | 20 upstream calls | 1 |
| A key read every round, under cache pressure | re-fetched 4× (FIFO evicts hot keys) | survives (LRU) |
| 50,000 distinct client addresses | 50,000 permanent rate-limiter entries | bounded at 10,000 |

The stampede is the important one. Without in-flight coalescing a cache miss is
not one upstream call, it is one *per concurrent visitor* — so a hundred readers
on a cold key means a hundred simultaneous calls to Eurostat from one address,
which is how a shared egress address gets throttled. A remedy for "we ask too
often" cannot multiply asking by the number of readers.

The rate limiter's map is bounded by **hit count**, not by how recently an
address was seen. Evicting the quietest sounds right and is backwards: a caller
rotating forged `X-Forwarded-For` values arrives *after* the client actually
hammering us, so a flood of forged entries all look more recent and evict the
record of the abuser. Eviction is also done in bulk to a headroom mark — the
first version sorted the whole map on every request once full, and 50,000
requests took 33 seconds. A guard against heavy traffic that degrades under
heavy traffic is worse than the leak it replaced: a leak costs memory, that cost
latency on every request.

**`/api/sea-state` exists because the browser was the one uncacheable caller.**
The dashboard fetched marine and surface weather straight from Open-Meteo, two
requests per port across three ports, on every load of `/data`. The ports are
fixed coordinates, so every visitor fetched the same six payloads independently
for data republished hourly. It is now six upstream calls per TTL — twenty-four
an hour whether one person is reading or ten thousand — and `connect-src` no
longer permits the page to reach Open-Meteo, Eurostat, data.gov.lv, Elering or
the ECB at all. That turns "all upstream data goes through the proxy" into
something the browser enforces rather than something a reviewer has to notice.

### A TTL is a sampling rate, so requests are not observations

The rule above governs what may go **in** a cached body. This one governs what
may be concluded **from sampling** one, and it was broken twice in a day by two
people measuring the same fix from opposite sides.

A cached endpoint answers most requests from one stored body. Count those
requests as samples and the denominator is not a number of observations, it is
a number of *reads of the same observation* — inflated by exactly the cache's
hit rate, which is to say by however well the cache is working.

```
api/ai-insights   withCache(..., { ttlMs: 900000 })   Cache-Control: max-age=900
  => at most 4 distinct readings an hour

measured, one pass, 26 requests over 8.7 minutes:
  distinct ai-insights readings     1        (deduped on generatedAt)
  distinct system-status readings   9        (60s TTL, same 26 requests)
```

Nine against one, from identical sampling, because the TTLs differ by 15×. **The
faster endpoint is not healthier or noisier; it is simply sampled more often**,
and any rate computed across both without deduplication is comparing two
different sample sizes wearing one denominator.

The two failures, both self-reported:

```
"8 unhealthy of 8"   system-status, 60s TTL   -> 4 distinct readings
"5 of 53"            ai-insights, 15min TTL   -> 53 distinct would need 13 HOURS
                                                 both windows were one morning
```

The second is mine, and it was the denominator of a Fisher test whose
`p = 0.00055` I used to declare a causal question settled — against a session
who had declined to claim causality and was right to. A wrong `n` does not make
a p-value approximately right; it makes it uninterpretable.

**Two rules follow, and the first is mechanical.** Dedupe on the response's own
timestamp — `generatedAt`, `fetchedAt`, whatever the body already carries for
this purpose — and report distinct readings, never requests. The field is
usually there, because a body that survives caching has to carry an instant
anyway.

**And derive your window from the TTL before you choose it.** At 15 minutes an
endpoint yields ~96 readings a day, so an afternoon is single digits and a week
is ~670. If the effect you are testing needs hundreds of observations, no amount
of polling this morning will produce them, and polling harder produces only a
larger wrong denominator. `Age` and `X-Cache` tell you which reading you are
holding; there is no excuse for counting it twice.

⚠️ **Treat that figure as an order of magnitude, not a schedule.** The TTL says
when revalidation *may begin*, not how long a body is served: `ai-insights`
carries `graceMs: 3600000` and `staleWhileRevalidate: true`, so one body can be
served for up to an hour past its TTL while a replacement is fetched behind it,
and the replacement lands whenever it lands. The count is therefore bounded
below by neither and above by neither — see the revalidation paragraphs below,
which is where that was measured rather than assumed. **Plan for the order of
magnitude; count what you actually got.**

⚠️ **The distinct count is not fixed, and assuming it is repeats the error one
level down.** The number moves between runs of the *same* loop:

```
18 requests over ~90s, LV/EE/LT, deduped on generatedAt
  first run    3 distinct     ee|08:12:54 x6  lt|08:12:55 x6  lv|08:12:54 x6
  35 min later 5 distinct     same loop, same cadence
```

That variation is the finding. **The sentence that stood here attributed it to
separate Function instances holding separate caches, and nothing measured
established that** — the two paragraphs below are the record of two people
reaching for a mechanism neither had evidence for, and the reason the claim is
now stated as the observation rather than as its cause.

⚠️ **That reading is true and the evidence above does not establish it**, which
is worth more than either. `ai-insights` declares `keyOn: ['country']`, so
LV/EE/LT are three cache *entries* by design — three distinct readings from
three countries is exactly what one cache predicts, and five is what a
fifteen-minute TTL predicts when a loop straddles an expiry. Neither figure
needs a second instance to explain it.

The discriminating test is one key hammered inside one TTL:

```
24 requests · country=LV only · 75 seconds · TTL 15 minutes

  distinct generatedAt : 2
    2026-09-01T10:58:17.305Z  x6
    2026-09-01T10:58:30.646Z  x18
  Age seen: 0 .. 61

CONTROL  one request per country -> 3 distinct, so the probe can see several
```

⚠️ **And that reading does not establish separate instances either — I
committed the claim that it did, an hour after writing this section, in the act
of correcting someone else for insufficient evidence.** Re-run, the same test
gave **1** distinct reading, not 2, and the `Age` values say why:

```
run 1   Age  0 ..  61     a regeneration happened DURING the loop
run 2   Age 715 .. 789     no expiry crossed -> one reading
```

`api/shared/responseCache.js` passes a `graceMs` into `cache.memo` and emits
`X-Cache: revalidating` — `ai-insights` declares `ttlMs: 900000` and
`graceMs: 3600000`, an hour of grace behind a fifteen-minute TTL. **A single
cache with stale-while-revalidate serves the old body while regenerating and
the new one once it lands** — which is exactly two instants a few seconds
apart, from one cache. So the second generation instant was a revalidation
completing, not a second instance.

**Neither proposed measurement discriminates.** Three readings across three
countries is what `keyOn` predicts; two instants seconds apart is what
revalidation predicts. What is actually established is weaker and sufficient:
**the distinct count varies for reasons you do not control — expiry, grace,
revalidation — so it must be counted on every run and cannot be calibrated
once.** That was the operative conclusion all along, and it never needed the
mechanism either of us reached for.

The rule below is unchanged. What changed is that it now rests on something
measured.

So the ratio of requests to readings is not knowable in advance and cannot be
divided out afterwards. **Assuming 18 and assuming 1 are both wrong; only
deduping tells you**, and it has to be done on every run rather than calibrated
once.

**Fixing the denominator would not, on its own, have saved the analysis that
produced this section** — which is the part worth carrying furthest, because a
reader who corrects only the counting will still get a wrong answer. The same
argument computed its expected post-fix rate from a failure probability measured
in the **pre-fix** window. That silently assumed the host had not changed, which
was the exact proposition in dispute, so the agreement between prediction and
observation was circular and no `n` would have disturbed it. **Ask what the
parameters of a prediction were estimated on, and whether that period is the one
you are trying to make a claim about.**

### Why not Cosmos DB

The instinct — stop asking upstream on every page load — is right, and it is
what the above implements. Cosmos is the wrong instrument for it, on four counts:

- **The free tier is already spent.** A subscription allows one, and golazo has
  it, so this would be a new paid dependency for a site whose whole cost target
  is €3–5/mo.
- **It would reintroduce a key.** SWA managed functions on the Free tier have no
  managed identity, so reaching Cosmos means a connection string in app
  settings. This project has no key anywhere and `disableLocalAuth` /
  `allowSharedKeyAccess: false` are set so that one could not be used. That is a
  security posture worth more than the cache.
- **It replaces memory I/O with network I/O.** A cache exists to avoid a round
  trip; serving it over one is backwards. A Cosmos read is 5–15ms against ~0 for
  a Map.
- **The data is tiny.** All 65 indicators are a few hundred kilobytes. It fits in
  memory with room to spare.

The in-process cache is also *better* under the growth this was meant to
address, not worse: cold starts hurt when traffic is low, and hit rate rises as
traffic rises. If a shared cache is ever genuinely needed — several instances
each paying their own miss — the answer is the blob storage the newsroom already
uses under managed identity, not a database.

## What was surveyed and deliberately not added

A full survey of candidate new sources was run on 2026-08-27, measured against
the live APIs rather than read from documentation. **Its conclusion was that
nothing new beat reading what we already hold against the standard it claims to
implement**, and this section records the measurements so the question is not
re-opened from scratch.

The evidence for that conclusion is five defects found in data we already had,
none of them visible to any numeric test:

| Found | In data we already held |
|---|---|
| `classifySeaState` named every band one WMO degree too alarming | 92% of 8928 readings |
| `european_aqi` banded on US EPA thresholds | 76% of 6696 readings understated, 0% overstated |
| `total > 0 ? share : '0.0'` printing a confident zero for a measured category | every row, whenever one was absent |
| `EU27_2020` listed by `rail_go_quartal` and populated with nothing | would have drawn an empty benchmark |
| four endpoints keying lower-case maps with an unnormalised parameter | Latvia returned under another country's heading |

**Candidates measured and rejected**, with the reason, so each is a settled
question rather than an open one:

| Candidate | Measured | Verdict |
|---|---|---|
| `irt_st_m` short-term rates | returns only `LV, LT` for the Baltics and **zero non-null cells** across both — euro-area members do not publish national short rates | Dead. Killed the yield-curve-inversion idea outright. |
| `hlth_cd_asdr2` causes of death | 31.9-month lag, 3647ms, 93 ICD codes | Permanently retrospective |
| `crim_off_cat`, `env_wat_cat`, `nrg_ind_id` | 19.9-month lag | Permanently retrospective |
| `isoc_ci_ifp_iu` internet use | 182 `ind_type` values, 7.9-month lag | Unpinnable at reasonable cost |
| `migr_asyappctzm` monthly asylum | **RESOLVED 2026-08-29** — see below | Codes resolved, definition measured. Needs one pass across four files. |
| Statistics Estonia (`andmed.stat.ee`) | HTTP 200, 224–518ms, **PxWeb** — the protocol `api/historical-data` already speaks | Technically cheap, strategically wrong: buys depth in one country and manufactures the asymmetry the Baltic grid exists to avoid |
| Statistics Lithuania (`osp-rs.stat.gov.lt`) | HTTP 200, 2386ms, **SDMX 2.1**, 7.3 MB dataflow catalogue | Different protocol entirely, for the same strategic cost |

**`migr_asyappctzm` — the recorded blocker is resolved, and the recorded
*symptom* no longer reproduces.** Both halves matter, because a session testing
for the old symptom will not find it and may conclude the whole note is wrong.

```
recorded    "HTTP 413 unpinned, 400 pinned"
measured 2026-08-29
  unpinned citizen   HTTP 200, 2370ms, 461,984 bytes,  assumptions = 1
  fully pinned       HTTP 200,  506ms,  12,462 bytes,  assumptions = 0
```

**Pinning still matters — but for a different reason than the note implies.** The
query is not refused; the parser silently *chooses a nationality on our behalf*
and confesses it in `assumptions`. That is a worse failure than a 413, because a
refusal stops you and a guess does not.

The blocker was `citizen`, which carries **206 values** — every nationality plus
five aggregates. **Asking the cube for its own dimension codes settles it in one
metadata call**; they were never going to be guessed. That move generalises to
any oversized dimension.

```
freq=M unit=PER citizen=TOTAL sex=T applicant=FRST age=TOTAL
79 observations over sinceTimePeriod=2020-01 · newest READING 2026-06
5 of 5 paced runs OK, assumptions 0 every run, 47/56/164ms min/med/max
```

`FRST` over `TOTAL`: repeat applications track case processing, not arrivals.

⚠️ **`2026-07` exists as a coordinate and is null.** A tail read of the time
dimension reports it and overstates freshness by a month — the `demo_r_mwk_ts`
trap again. `eurostat.js` already skips nulls, so nothing downstream is wrong;
the hazard is in probes written to check it.

**Candidates measured and worth adding** — ~~in order~~ **all three shipped in
`#189` on 2026-08-28.** Kept because re-measuring them on the way in corrected
the survey three times, and each correction is a trap that will recur:

- **`demo_r_mwk_ts` — weekly deaths.** The one exception to the conclusion,
  and it held: it is the *only* candidate that adds articles without either
  rewriting detectors or publishing stale news, because every other source
  here is monthly or slower — **cadence is the one lever mining cannot
  supply**. LV really does run a week ahead of EE/LT, so per-country `latest`
  must drive display. ⚠️ **The lag is 47 days, not the 18 stated here.** The
  original survey read the newest *coordinate* — the cube offers `2026-W32` —
  when the newest *observation* is `2026-W28`. **Reading the time dimension
  instead of the values understated a lagging feed by 2.5×**, which is the
  same shape as the forecast trap recorded above: a period that exists is not
  a reading that exists.
- **`sts_cobp_q` building permits.** `indic_bt=BPRM_SQM` with any of nine
  `cpa2_1` codes is **106/106/106**, confirmed. Carries a composition, so it
  is a different *shape* of answer rather than three more lines. ⚠️
  `indic_bt=PSQM`, the obvious guess, returns **zero for all three countries**
  while answering HTTP 200 — re-confirmed, 0 of 42 quarters. **Office permits
  were deliberately left out**: 106/106 for all three, but the series sits at
  **0** in LV and EE, so a sanity band wide enough to be true catches nothing
  and a segment resting on zero throws a record extreme almost every time it
  moves.
- **`nrg_pc_202` gas prices.** ⚠️ **The 37/37/37 is true of a consumption
  *band*, not of the total.** `TOT_GJ` carries **LV=1, EE=1, LT=3** of twenty
  and stops at `2024-S1`, while every numbered band carries 20/20/20 through
  `2025-S2`. This is the `TOT_KWH` trap from `nrg_pc_205` again and worse: the
  aggregate is not merely sparse, it is **eighteen months more stale than its
  own components**, so a freshness check reading the total would call the
  series dead while the data it should be reading is current. Pinned to band
  D2 and named in the title.

**And the rung that was missing was not where it looked.** `freshness.js`
already knew `W` in `UNIT_MS` and `CADENCE_NAME`. The gap was in
`eurostat.js`, whose own comment had described this exact case before any
weekly series existed. Measured on master immediately before the fix:

```
maxAgeMonths({ freq: 'W' })      -> 30      the ANNUAL fallback, ~130 missing weeks
periodCadence('2026-W28')        -> null
monthsSincePeriod('2026-W28')    -> null
```

So an unknown frequency resolved to the most permissive allowance in the
table — **absence resolving to success**, in the one function whose job is to
say when something has gone quiet. Teaching the label to `periodToMonthIndex`
without teaching `ageInUnits` precision would have been worse than leaving it:
`2026-W28` and `2026-W30` share July, so a month index would have swapped an
honest `null` for a *confident* number 36% too small.

**Why "more periods" is not the cheap lever it appears to be.** The dashboard
caps history at `years=5` and `?years=30` already works — 3.3× to 5.8× more
observations for one query parameter, and 4.9× the data yields 5.2× the
findings. But all seven newsroom detectors read `series.latest`, a single
accessor, so passing more periods changes nothing without rewriting them and
re-keying suppression from tens of keys to thousands — and `editor.py` is
written to reject the stale findings that would produce. Measured directly:
across 18 indicator/country pairs, deeper history changed the verdict on the
latest observation **zero times**. Depth buys *significance* — "highest since
2009" rather than "highest in five years" — not volume.

## A word list encodes your examples; a structure encodes your rule

Four checks were written as lexical proxies in a single day and **all four were
beaten by ordinary prose the author had not thought of**. The pattern is
reliable enough to plan around.

| Check | The proxy | What beat it |
|---|---|---|
| Empty closings | a blacklist of phrases | paraphrase, in 10 of 10 articles |
| Empty closings, v2 | `will` as the promise marker | the model wrote `would`, 3 of 3 |
| The analyst's seed | the same modal patterns | *"to see if"* uses no modal at all |
| The wrap's period gate | the words `period` and `week` | *"in the same **quarter**"* |

And a fifth of the same family: `[^.]{0,60}` as "within one sentence" stopped
dead at the decimal point in *"the next 2.4 percent release"*, so the sentences
carrying figures — the ones a numeric check can least afford to miss — were
exactly the ones it skipped. The fix, `(?:[^.]|\.(?=\d))`, is still lexical but
at least it now means what it was trying to say.

The structural replacements have held. The wrap's period gate no longer reads
the prose for time words: it resolves each paragraph's figures back to the
corpus and asks whether they *actually* share a period. That version cannot be
beaten by a synonym, because it is not looking at words.

So: **when a check is about a property, test the property.** Reach for a word
list only when the thing genuinely is a vocabulary — house style's banned
change-words are a real word list, because the rule really is about those
words. Everything else is a structure wearing a vocabulary's clothes, and it
will be beaten by the first phrasing you did not imagine.

The corollary is about how you find out. Every one of the four was caught by a
human reading the output, never by the suite — a lexical check's tests are
written from the same imagination as the check, so they agree with it. **Read
the artefact.**

## An example in guidance is a claim about behaviour — execute it

Guidance that teaches by example makes a testable assertion every time it says
*this is rejected* or *this passes*. Nothing checked those assertions, and one
of them was false.

The writer's system prompt taught the bare-numeral rule like this:

> `"fell from 2025 levels"` contains the numeral 2025 and **is rejected**. So is
> `"9 of the 10 categories"`.

Run both through the scanner the sentence is describing:

```
  "9 of the 10 categories"    -> 2 tokens   ['9', '10']     rejected, as claimed
  "fell from 2025 levels"     -> 0 tokens                   NOT rejected
```

`numeric_scan` ignores a bare four-digit year by design — a period label says
*when* and claims nothing about magnitude. The prompt's own next sentence said
so, three lines below. **One example true, the next false, adjacent, in
permanent contradiction with the paragraph containing it.**

**A false example is worse than an unenforced rule**, and the asymmetry is
what makes it worth a section. An unenforced rule fails loudly the first time
someone relies on it. A false example fails *silently and in the safe
direction*: it steers a writer away from correct work. Here it discouraged the
single most informative construction available — naming when a series last did
this — which is the phrasing `detect_record_extreme` itself models. Nothing
would ever have reported that loss, because **a draft that avoids a good
phrasing is indistinguishable from one that never thought of it.**

The fix is not to check the wording. It is to **resolve every example the
guidance presents through the thing it describes, and assert it behaves as
claimed** — `newsroom/tests/pipeline/test_prompt_numeral_examples.py`. A
rephrasing cannot beat that, because it is running the scanner rather than
reading prose. Each example is *also* asserted to appear verbatim, which is
what stops the table drifting into a second, disagreeing copy of the
guidance — the `#142` failure, where a guard rebuilt the thing it was meant to
check and reported success while checking nothing.

Two things generalise. **Prophylactic guidance is allowed to be stricter than
the contract, but it must not be wrong about the contract**: the standfirst
digit ban is deliberately tighter than the validator and that is fine, because
it forbids something permitted rather than claiming something permitted is
forbidden. And this arrived as a *correction to a brief* — the ruling was to
enforce the dek rule deterministically in house style; measuring first found
the rule already obeyed 17/18 with zero untraceable digits, so the cut would
have fired once and destroyed correct work. **That is the #172 trap exactly:
an instrument aimed at a fault that was not there.**

## A fixture is guidance that executes

The section above is about an example in prose. This is the same fault one
level more binding, because **a fixture does not document what good looks
like, it defines it** — and every test importing it silently agrees.

An example in prose misleads a reader, who may read critically. An example in
a fixture misleads a test suite, **and a suite does not read critically at
all**.

Two instances, two languages, two subsystems, two authors, one day.

**`GOOD_PAYLOAD`, `newsroom/tests/pipeline/test_generation.py`.** It stands
for a draft that passes everything first time. Both its headline and its body
made unbounded record claims — the exact fault `#257` was written to catch:

```
    "Latvian unemployment reaches the highest level in the monthly series"
    "...above the previous record of 6.5% and the highest in the series."
```

Fixed in `#257` (`0844f90`). **Six tests failed the moment the standard was
corrected**, in `test_generation.py` and `test_rejection_causes.py`, and that
number is the measure of how far the wrong standard had spread. None of the
six is about record claims; they broke because the pipeline correctly began
spending a revision attempt on prose the fixture asserted was clean.

**`tests/panelFreshness.test.tsx`.** Its *positive control* asserted the
rendered output contains `"favourable"`, and passed for the wrong reason.
Fixed in `#261` (`ea5ddef`):

```diff
-  <RankedComparison indicator="x" title="Test ranking" unit="%" higherIsBetter />
+  <RankedComparison indicator="gdp_per_capita" title="Test ranking" unit="%" />
```

`indicator="x"` is not in the registry, so nothing knew its polarity — and
`higherIsBetter` **manufactured the very claim the assertion checked**. A
positive control that could not have failed, which is the one thing a positive
control exists not to be.

Its author's own account, arriving from a different session in a different
language with no knowledge of the `GOOD_PAYLOAD` case, is the mechanism in five
words:

> **It was proving its own fixture, not the component.**

Two authors reaching the same description of the same shape independently is
better evidence than one person noticing the resemblance.

**The operational form**, and it is one assertion:

> A fixture named `GOOD_`/`VALID_`/`CLEAN_`, or serving as a positive control,
> **is a standard. Run it through the checks it claims to satisfy.**

Instance 1 fails `apply_house_style`. Instance 2 fails *"is this id in the
registry"*. Neither needed a new instrument — only pointing an existing one at
the fixture instead of at the code.

**The sweep for further instances was run**, because an unmeasured claim of
cleanliness in an entry about fixtures that lie would be a poor joke. The
population was enumerated twice — once by fixture NAME (`GOOD_`/`VALID_`/
`CLEAN_`/`CORRECT_`…) and once by surrounding PROSE claiming fitness ("clean",
"control condition", "passes every") — because a fixture can assert a standard
either way, and the name axis alone misses the `conftest` three, whose names
claim nothing. Both axes give the same four: `GOOD_PAYLOAD` and those three
articles the validator suite calls "the control condition".

The name axis also returned a fifth, `CORRECTION`, which is an
`EditorialCorrection` object and claims nothing — the alternative `CORRECT`
matched inside the word. **Read what an enumeration returns before sweeping
it**; a population is a measurement too. Through `check_prose` and
`record_claim_problems`:

```
  tier A / tier B / tier C / GOOD_PAYLOAD     0 violations
  POSITIVE CONTROL, pre-#257 GOOD_PAYLOAD     2 violations
  NEGATIVE CONTROL, its corrected text        0 violations
```

The control is the load-bearing row. A clean sweep from an instrument that
cannot fail is exactly the defect this entry is about, so the same scan was
pointed at the known-bad text and had to find it.

Two things it does **not** cover, stated rather than implied: the TSX suites,
where "the checks it claims to satisfy" differ per fixture and there is no
single scan; and fixtures that are *deliberately* malformed. The sibling at
`test_generation.py:154` looks identical — `"the highest in the series"`,
unbounded — and is correct, because it is the payload for
`test_should_reject_when_a_dropped_figure_leaves_an_unverifiable_number`. **A
negative fixture claims nothing and owes nothing.** Only a fixture asserting
it is fit is a standard.

## The correct sibling that conceals the broken one

A departure from a pattern **already present in the file** is harder to spot
than a missing idea, and for a reason worth naming: the file demonstrably knows
the answer, so a reader who goes to check finds the correct pattern and stops
looking.

Both of the last two faults found in this repo were that shape.

`detect_streak` claimed *consecutive periods* from a count of *readings*, so
five readings across ten months printed as "four consecutive monthly moves".
Two functions above it, `detect_record_extreme` says *"across 14 observations
since 1999"* — counts observations, calls them observations, claims no time
unit, and is true at any cadence. The correct pattern was in the same file, and
reading it is what reassured the author that the file was sound.

`api/shared/statusChecks.js` hand-built a Eurostat query while importing `es`
at line 24 — **and using it for `sincePeriod` two lines into the very string
that should have been `buildUrl`.** The probe drifted to `rep_mar=LV_0LVRIX`
over three years while the app read four Latvian ports over eight, so it could
not see a Ventspils, Liepāja or Skulte failure at all and went red whenever
Riga alone was quiet — which the check's own comment already described as
routine.

So when something is wrong, **check whether the file already contains the right
version of it.** If it does, that is not reassurance; it is the thing that hid
the fault. And the same concealment happens in prose: a note that answers the
question you were about to ask, with an answer to a different question, closes
the enquiry just as effectively — `NOT_COMPARED = {"freq"}` read as *"not
comparable"* while meaning *"compared elsewhere"*, and nowhere else compared it.

`newsroom/README.md` carries the newsroom-side version and the practical rule
that both sides reached independently: **when you audit the consumers, audit the
input they share.**

### And the sibling can be in the other half of the repo

The published sentence *"Latvia recorded 4653 thousand rail passengers in
2026-Q1"* is the widest instance so far: the correct rendering existed **twice**,
and both copies helped hide it.

`detect_seasonal_deviation` was the one detector already routing its basis
through `units`, with a comment explaining why — so the file looked handled,
while the other five interpolated `{value:g}` and the raw unit. And the
dashboard's `src/utils/formatValue.ts` renders the identical figure as
`4.65m passengers`; its docstring makes this exact argument, about `M EUR`, in
almost the same words. Measured on the same number, on master before the fix:

```
formatValue(4653, 'k passengers')     ->  "4.65m passengers"     the dashboard
the newsroom's seasonal basis         ->  "4653 thousand ..."    published
```

Two halves of one repository, one Eurostat cube, two answers. Nothing compares
them, because nothing has ever needed both — and that is the general shape:
**a sibling in another subsystem cannot be found by reading the file you are
fixing.** The cheap habit is to ask whether anything else in the repo already
renders, parses or judges this same input, and to run both on one value.
`test_readable_magnitude.py` now pins the newsroom side; the two renderers
still answer independently, so this is a habit rather than a shared seam.

The reason no gate saw it belongs here too, because it generalises past
rendering. The newsroom's numeric contract protects that a figure is *real*,
*traced* and *precise enough* — three properties of the number. It has nothing
to say about how the number **reads**, so a correct figure in an unreadable
scale passes every check by construction, exactly as a correct figure under the
wrong *subject* did when two definitions shared a cache key. The pattern is
worth stating plainly: **the contract protects figures, not what surrounds
them** — not their subject, and not their rendering. Both failures reached
readers; neither is reachable from any test of the figure.

### The sibling need not be someone else's, and need not be old

The sharpest instance measured so far is one where the concealing sibling was
written **by the same author, in the same commit, three lines away**.

`2a60e8b` added the weekly cadence. It edited `isSeriesStale` — the hunk header
says so — and in the same diff added a docstring immediately below the function
naming the exact collision:

> *"**Fractional for a week**, where it cannot: … share July, so a month index
> reports the same age for observations three weeks apart"*

The collision was therefore written down, in prose, by the person editing the
loop, in the change that created the case. It was applied to **age** and not to
**ordering**, which kept `periodToMonthIndex` and a strict `>` — so the newest
observation of a weekly series was whichever the array happened to list first.
Live: LV's `weekly_deaths` newest reading is `2026-W28` and the verdict reported
`2026-W27`; reversing two elements changed the answer.

Their own account of why, and it is the part to keep:

> **Having articulated a fact is what made it feel discharged.** I had *dealt
> with* the week/month collision, so the enclosing function read as handled.

**And the example in that docstring was itself wrong**, which is this file's
*"an example in guidance is a claim about behaviour — execute it"* rule
collecting on the very sentence that describes the defect. It originally read
*"`2026-W28` and `2026-W31` share July"*. Measured:

```
2026-W27  24319    2026-W29  24319    2026-W31  24320   <- August
2026-W28  24319    2026-W30  24319    2026-W32  24320
```

Four weeks do share July's index, so the phenomenon is real and the fractional
age is right. The pair chosen to illustrate it was not, and nothing checked a
claim sitting three lines from the loop it was about. It now names `W27` and
`W30`, which is executable and true.

**And correcting one copy did not correct the other. Or the third.** The same
false pair was written three times: into the `monthsSincePeriod` docstring, into
the weekly-rung paragraph above (stated there as fact rather than as a
quotation), and into `api/shared/freshness.js`. Fixing the docstring left two
live. The session that had written them searched `AGENTS.md`, found the second,
and reported it; **a repo-wide grep found the third.** So each pass over this one
sentence found exactly the copies it thought to look for.

**Two copies of a fact drift, and these drifted the instant one was corrected, by
the person correcting it.** That is this file's own rule about enumerations
arriving in its own prose: a fact stated three times is three enumerations, and
prose is not exempt. Execute *every* copy — and search the repository, not the
file you are editing.

**And the population rule has a form specific to this.** When you add a member
to a vocabulary — a fifth cadence, a sixth tier, a new status — the population
is *every consumer of that vocabulary*, and the dangerous ones are the consumers
you do **not** change: they were written when the new case did not exist and are
correct for every case that did. `isSeriesStale`'s `>` was right for M, Q, S and
A. It became wrong the moment `W` existed, and nothing about it changed.

So the sweep to run is not *"does the new member work?"* — that is a test of the
feature. It is *"which existing code branches on this vocabulary, and does each
still hold with one more label in play?"* Only the second finds this. In the
author's words: **the tests enumerated the functions I edited, not the
invariants I disturbed.**

## A count is safe or unsafe according to what the sentence does with it

The section above treats `detect_record_extreme` as *the* right version of a
count in prose. It is *a* right version, and reading it that way costs you the
other two — and hides the one shape that is actually dangerous.

Every detector that puts a count into prose was read for one question: **does
this sentence claim something a hole falsifies?** Seven detectors, six of which
emit a count, and the answer separates into three mechanisms rather than a rule
about counting:

| Detector | The count | What the sentence claims | Why it holds |
|---|---|---|---|
| `detect_threshold_cross` | none | — | nothing to be wrong |
| `detect_record_extreme` | `len(series)` | *"across 14 **observations** since 1999"* | **no time unit** |
| `detect_sharp_move` | `len(deltas)` | *"across 15 **readings** since ⟨first period⟩"* | **no time unit** |
| `detect_seasonal_deviation` | `len(baseline)` | *"the **four-year** average"* | **cardinality** |
| `detect_divergence` | `len(historical)` | *"the 21 earlier **quarters all of them report**"* | **cardinality** |
| `detect_structural_divergence` | `window` | *"the 8 earliest **quarters all of them report, from 2010-Q1 to 2014-Q2**"* | **cardinality + range** |
| `detect_streak` | `run` | *"four **consecutive monthly** moves"* | **contiguity, enforced** |

The three are not equally cheap. Claiming no unit and claiming a cardinality are
true *by construction* — a hole cannot falsify "14 observations" or "four years
contributed". `detect_streak` makes the one claim a hole does falsify, and pays
for it: `_adjacent` breaks the run rather than counting across a gap. **That is
the only entry here where the guarantee lives in the loop instead of in the
wording**, and it is the expensive way to be right.

Four of the seven have been wrong at some point, all in the same direction —
understating — and all by asserting a span or a position from a count of
whatever survived a filter. Two of the four reached readers; two were caught
before they could:

```
SHIPPED  detect_streak                "four consecutive monthly moves"     5 readings / 10 months
SHIPPED  detect_sharp_move            "over the preceding 14 quarters"     15 readings / 19 quarters
LATENT   detect_structural_divergence "the first 8 quarters of the series" 8 readings / 17 years
LATENT   detect_divergence            "the 9 earlier years in the series"  9 of the series' 18
```

The two marked LATENT never rendered those sentences: neither detector fires on
a gapped group today, so the figures beside them are what the corpus *would*
have produced, measured from the intersections rather than from an article.

**Cardinality is the better repair, not the defensive one.** "Claim no unit" is
always available and always true, and it is why `detect_record_extreme` was
held up as the model — but it forfeits the informative sentence. *"The four-year
average"* tells a reader more than *"the average of four observations"*, and it
is exactly as true. Reach for the neutral noun when the count really is of rows;
reach for a cardinality when the count really is of years, and say what
qualified them.

Two measurements, because the interesting half is which of these were live:

| Swept | Result |
|---|---|
| `len(baseline)` ≠ distinct contributing years | **0 of 10,558** (period, baseline) pairs, 282 series |
| Published seasonal articles with a false count | **0 of 10** |
| Multi-country intersections that are gapped | **4 of 78** groups, 288 series |
| …gapped enough to misstate the window | **3** — worst `hourly_labour_cost`, 8 readings spanning **17 years** |
| Published divergence articles that are wrong | **0 of 84** |

So both divergence faults were latent. That is the normal case for this fault
and the reason it survives: the corpus has to be gapped *at the point the
sentence indexes*, which is rarer than being gapped at all.

**That row said 5 until the sweep was checked against the code it was
sweeping.** `weekly_deaths` was counted as gapped — 72 readings across a
73-week span — and it is not gapped at all. The sweep computed a week ordinal
as `year * 53 + week`, which inflates the span by exactly one at every new
year, and 72 weeks crosses exactly one. `_period_weeks` in `detectors.py`
converts through the real ISO calendar for precisely this reason, and its
docstring names the error: *"2026-W01 follows 2025-W52, and subtracting the
suffixes gives -51"*.

So the sweep hunting sentences that miscount periods was itself miscounting
periods, in a file that already contained the correct arithmetic two hundred
lines above the detector it was auditing. **Ask the application, do not restate
it** applies to the measurement as much as to the probe — and the tell was
available without knowing anything: a "gap" of exactly one, in the only weekly
series, is the shape of a boundary error rather than a missing observation.

### A lexical sweep for this cannot find it

The first pass swept with `ast` for a time-unit word in an f-string
interpolating a `len()`. It reported **one** hit — and that hit turned out to be
one of the safe ones, while both genuinely broken sentences were invisible to
it:

- `detect_structural_divergence` interpolates `window`, a **parameter** with a
  default of 8. There is no `len()` to match.
- Both divergence bases get their time word from **`reading_word(...)` at
  runtime**. There is no literal `"quarters"` in the source to match.

That is *a word list encodes your examples; a structure encodes your rule*, one
level up in the tooling: the sweep encoded the two instances this file already
described, so it found a third of that shape and missed two of another. The
property has to be **read for**, across every site, and seven functions is an
afternoon. Do not trust the one-liner — it is in the programme log precisely so
the next person does not.

**And the file's own rule predicted the worse of the two.** `common[:window]`
indexes a *filtered* list by position, which is the case *a hole needs a guard
where the consumer indexes by position* names as dangerous. That rule had never
been pointed at the detectors.

## The answer was already computed, and the seam dropped it

Three faults found on 2026-08-28 were the same shape, and it is not one any
section above catches. Nothing was missing, nothing was absent, no guard was
vacuous. **The right answer existed, was correct, and the next layer did not use
it** — so every stage passed its own tests and the site still shipped a
confident wrong statement, or nothing at all.

| The producer | The consumer | What shipped |
|---|---|---|
| `api/historical-data/index.js:522` ships `freshness` from `es.isSeriesStale` | `IndicatorCard` read the series and never named the field | a series last observed `2022-Q1`, server saying `stale: true, age: 54`, rendered as `2.2%` under **Latest** with a green `▲ +0.3% … favourable` |
| `write/generator.py:482` stamps `provenance.rejection = {gate, checks, detail}` | `runreport.py:191`, at `8d1727a~1`, took `.slug` off those objects | six rejected slugs, no reason, `errors: 0` — a run that destroyed six of eight articles, byte-identical to one that caught six bad drafts |
| `GridStatePanel` plots three `dataKey`s: `generated`, `metered`, `planned` | its hand-written label recited generation, demand, net flow and **renewable share** | a screen-reader user heard the three stat boxes a second time, and never heard the one thing the chart carries — where measurement stops and forecast begins |

**The shape, and it is greppable in both directions: take the field names one
side of a seam writes, take the names the other side reads, and diff them.**
Read the producer's field list off the response body — no grep isolates that
cleanly — then ask the consumer about each one:

```powershell
foreach ($k in @("indicator","title","unit","source","series","summary","freshness","fetchedAt")) {
  $n = (Select-String -Path "src\*.ts","src\*.tsx","src\**\*.ts","src\**\*.tsx" -Pattern "\.$k\b").Count
  "{0,-12} {1,3} reader(s)" -f $k, $n
}
# series 47, unit 31, title 26, source 17, indicator 5, summary 4, fetchedAt 1, freshness 0
```

A name on only one side is the finding, and **which side tells you which fault
it is**. Producer-only is an answer nobody uses. Consumer-only is a description
of something that is not there — and its twin, the thing that *is* there going
undescribed, which is the half nobody looks for because the sentence reads
fine. `GridStatePanel`'s `dataKey`s are `label` (the x axis), `generated`,
`metered` and `planned`; the label recited a `renewableShare` that is not among
them.

**A field with no reader is a question, not a verdict**, and the section is
worth little without that. `freshness` is still the only field of the eight with
no reader in `src/` — not read, not even declared in the client's type — and it
is *not* a defect: the client recomputes the verdict itself because only one of
the two upstreams sends one, and a rule that applies to Latvia and not to
Estonia is worse than no rule. It is also not unread. `historicalData.live.test.ts`
asserts on its `period`, `age`, `cadence` and `stale`, so the field is a live
contract with CI even though no component touches it.

But run the grep and then read both sides, because the answer is more
interesting than "fine". The producer, at `api/historical-data/index.js:513`:

> How current the served series actually is, **so a consumer never has to parse
> period labels to find out.** […] `src/dataFreshness.ts` deliberately computes
> port-data staleness at render time instead […] **The reasoning does not carry
> here**[…]

The consumer, at `IndicatorCard.tsx:96`:

> The verdict is **recomputed here rather than read from the payload** […]
> `freshnessOf` **reads the cadence off the period label's own shape**.

**Two careful comments, each individually right, in permanent contradiction.**
The producer anticipated the render-time alternative and ruled it out; the
consumer chose it anyway for a reason the producer had no way to know. What the
grep found was not an unused field but an unreconciled disagreement — and a
producer comment that is now simply false about what its consumer does.

So the rule is not *every field must have a reader*. It is: **for every name on
only one side, read both sides and say out loud whether it is a decision or a
defect.** The same grep fires on `rejections` and `rejected_checks`, added by the
pull request that produced this section; the answer there is that the consumer
is a person reading `runs/latest.json` after a bad afternoon, and `runreport.py`
says so at the field, so the next sweep gets its answer from the code instead of
reconstructing it. That is the cheap habit worth copying — **answer the question
where the field is defined, before someone has to ask it.**

**And a test is a consumer.** Running this across all fourteen endpoints —
107 top-level fields, of which **75 are read by the app, 8 only by a test, and
24 by nothing** — the first version reported `assumptions` as dead on both
`/api/baltic-compare` and `/api/port-data`. It is not: `indicators.live.test.ts`
and `portData.live.test.ts` fail when it is non-empty, so a guessed cube slice
is caught in CI rather than shown to a reader, which is the better design and
exactly what this repo argues for elsewhere. Same for `freshness`, and for
`sea-state.unavailable`, and for `power-prices.today`/`tomorrow`. A sweep of
`src/` alone calls all eight dead, and the obvious tidy-up deletes a guard.

The sweep under-counted four more times before it settled, and every one was the
same fault it hunts — an enumeration the wrong size for its subject. `src/api.ts`
in every endpoint's closure made one endpoint's `.source` look like every
endpoint's. Reading types from `types.ts` only reported three response types as
"not found" when they are declared in `api.ts`. Matching test files by literal
name missed `portData.live.test.ts` for `port-data`, because the filename is
camelCase. And globbing `tests/**/*.ts` silently excluded every `.tsx`. **Each
one moved the headline number, and every one failed toward "no finding here".**

### The sweep's own population was one level too shallow

Every under-count above is a *consumer* enumeration that was too small. The
fifth was in the **producer** enumeration, and it is the largest: the sweep
walked each response's top level and stopped. Re-run recursively against
production at **2026-08-30T07:29Z, master `10c24b1`**, three runs, population
identical in all three:

```
depth 1   110      <- the entire swept population, recorded above as 107
depth 2   149
depth 3    58
depth 4    45
          ---
deeper    252      = 70% of served fields, never examined
```

`#231` is what made this visible: it attached `freshness` to
`/api/baltic-compare` under `countries.<CC>`, at depth 3, where a top-level
sweep cannot see it. The rule this file states three instances of — **write
down the set the guard walks and the set the behaviour walks, and require them
to match** (`#149`, `#178`, `389d1f9`) — has a fourth instance, in the method
that found the first three, and a fifth in the **hunt for instances of a
class**: searching `tests/` for clock-derived arithmetic found 1 of 19, when
the class was anything environment-derived. `#324` already records a search
adding confidence to a *positive* claim, which invites challenge. **A false
empty does not** — there is no claim to attack, only an absence, so it closes
the enquiry instead of opening it.

**Two corrections to the instrument, both found by reading its output.**

The matcher counted a field name appearing **inside a comment** as a reader:
`\{[^}]*\bname\b[^}]*\}` for destructuring spans newlines, and in a repo whose
files carry more prose than code that matches almost anything.
`freshness.allowed` was classified `test-only` on the strength of three files
in which `.allowed` never appears — the word occurred in a comment about CSV
export, one about the spacing scale, and one about the rate limiter.

And a name match cannot tell the payload's `countries.LV.freshness.stale` from
the client's **own computed** `stale`, because `freshnessOf()` returns an object
with the same field names. So the sweep reported `freshness.period` as read by
19 files while nothing in `src/` reads `.freshness` at all. A field is
app-reachable only if every ancestor on its path is: without that the recursive
sweep is *worse* than the top-level one, adding hundreds of deep names and
marking them read on a collision with a sibling module. It moved 24 fields.

Both errors inflate readers, which deflates orphans — **the direction that fails
toward "no finding here", in the instrument built to find exactly that.**

And a third, found only because a number moved while the population did not:
**the sweep consumed its own subject.** Once `tests/seamSweep.test.ts` existed,
the three `warnAfterMonths` orphans flipped to `test-only`, because that file
names the field in a fixture string and the matcher counted it as a reader —
so the sweep reported *fewer* orphans the more thoroughly its own findings were
written down. Its own files are excluded now, as an equality so a fourth fails
rather than being absorbed.

```
                app   test-only   orphan
name only       310          36       16
+ reachability  286          60       16     <- 24 fields moved
                                       ^ 13 of the 16 are below depth 1
```

**The conclusion about `freshness` survives, and that is the interesting part.**
The passage above decided it was a decision rather than a defect because the
client recomputes the verdict. That is still true, and it now covers the nested
copy as well: `.freshness` has **zero** readers in `src/` on either endpoint,
and is declared in neither `src/api.ts` nor `src/types.ts`. The grep this file
ships still returns `freshness 0`, verbatim, at `10c24b1`. **What was wrong was
not the answer but the reach of the evidence** — the passage generalised from a
population that excluded the instance a reader would have asked about.

Two of the nested orphans were new and nobody had reasoned about them:
`countries.<CC>.freshness.warnAfterMonths` and `.staleAfterMonths`, shipped by
`api/shared/freshness.js` and read by nothing, not even a test. **`#270`
deleted them**, along with `property-data.permitsTrend` and
`system-status.selfSustaining.subscribers` — and that is a fourth disposition
worth naming beside render, annotate and delete-as-tidying. `permitsTrend: 0`
and `subscribers: {free: 0, pro: 0, enterprise: 0}` were **hardcoded**, so a
comment saying "this is not measured" would have left a number on the wire that
reads like one. Some orphans are not a decision, a defect or a test-only
contract: they are a field that should not exist, and a comment is a way of
keeping it.

Re-measured after those removals, on master `0dd4770`, 2026-08-31: **339 fields,
1 orphan** — `environment-data.airQuality.bandCount`, which is still served and
still read by nothing.

**And the same reading exposed a defect in this instrument, at the level the
reachability fix cannot reach.** `#256` added `FreshnessNotice`, a component
whose prop is named `freshness` and which carries the value `freshnessOf()`
computes on the client:

```
.freshness         dot-reads in src/    0     <- what the grep above finds
{ freshness, | :   weaker matches       5     <- props and type members
```

So the sweep reported the payload's `freshness` as read by five files while
nothing in `src/` reads it, promoting **26 of the 28** fields in a `freshness`
subtree to `app`. Reachability demotes children of an unread parent; here the
*parent itself* was falsely marked read, so it did nothing. **The sweep
contradicted this file's own grep, and the sweep was wrong** — found only
because the two disagreed.

The fix is not a better pattern, because there is not one: `const { series } =
await fetchPortData()` is a genuine payload read in the weak form. A dot access
reads a *field*; a destructuring binds a *name*, and a name is exactly as
consistent with a local that happens to share it. The sweep now reports both
counts and flags the one combination that is evidence of nothing — matched in
`src/`, never by an access. **33 fields across 18 names** carry that flag today.

`scripts/seam-sweep.mjs` runs it; `tests/seamSweep.test.ts` guards the
instrument, each assertion pinning a defect it actually had.

And note where all three defects were found: **at the reporting layer, by
reading the output.** Not one is reachable from a test of the producer, because
the producer was right every time.

## A name that lies about its population

The seam sweep above compares the *names* two sides use. This is the failure it
cannot see: **the name is on both sides, spelled identically, and the two sides
mean different populations by it.** No grep finds that, because nothing is
missing and nothing is misspelled.

Three instances, all measured on 2026-08-30, and the shape is worth more than
any of them:

| The name | Asserts | Actually |
|---|---|---|
| `validator.is_servable` | this article is servable | it would pass validation *if written today* |
| `readings_in_series` | *"how many readings this series contains **in total**"* | how many we retrieved |
| `series_start_value` | *"where this **series begins**, in {period}"* | where our `lastTimePeriod` window begins |

**Each returns exactly what it computes.** The value is right; the name claims a
scope the computation never had. That is why none of the three is reachable by a
numeric check — there is no wrong number anywhere in any of them.

### Two functions called `is_servable`, and the stricter one is not the safer one

```python
# newsroom/validator.py:1519            the PUBLISH-time gate
    if set(CHECK_NAMES) - names: return False      # every current check must be present

# newsroom/pipeline/publish.py:66       the SERVE-time gate
    return bool(verdict.get("passed")) and article.status == "published"
```

The frontend's `isServable` mirrors the second. So the first answers *would this
pass validation today* and the second answers *is this being served*, and adding
a name to `CHECK_NAMES` retroactively makes every older article fail the first
while changing nothing about the second.

Measured across the whole archive:

```
articles                     84
SERVE-time gate passes       84
PUBLISH-time gate passes     62
served but strict-False      22   (26%)
  missing no_unsupported_mechanism  22
  missing no_repeated_findings       4
```

**A quarter of the archive fails a function named `is_servable` and is served
normally**, surviving only because `write_index` re-validates *fresh* articles
and merges stored entries unchecked. So the strict gate cannot health-check
anything but a fresh article — roughly the opposite of what its name suggests.

This was found by using it as a pre-flight check before correcting a live false
headline, where it **failed closed**:

```
estonia-s-annual-consumer-price-inflation: not servable BEFORE — refusing to touch it
  status published · validator.passed True · all its own checks passed True
  MISSING ['no_unsupported_mechanism']
```

It would have refused to correct a false headline **on the strength of a check
invented after the article was written**, which is the one direction that leaves
the error standing. And the reason the wrong one was reached for is mundane and
will recur: *it was the one that could be imported*.

The fix is not to pick the right gate once. It is to assert the **serve-time**
gate holds and the **publish-time** verdict is *unchanged* — a correction
annotates, it does not re-validate. That second assertion is only expressible
once the two are distinguished, which is the general remedy: **when one name
answers two questions, the code cannot state the invariant that matters.**

### The digit-free claim no numeric gate can see

```python
# newsroom/pipeline/context.py, in _placement
line 565  readings_in_series   "how many {series.frequency} readings this
                                series contains in total"     <- the window count
line 586  note                 "This is the highest reading anywhere in the series."
line 591  note                 "Only a handful of readings in the series have
                                ever been higher; this is the {Nth} on record."
line 629  series_start_value   "where this series begins, in {period}"
                                                              <- the window start
```

`context.py`'s `_placement` hands the writer finished sentences, not just
fields, and computes all of them over the window. Its own comment says why the
notes were thought safe:

> *"Every observation must be free of digits. The writer is told it may state
> these as fact without declaring a figure, and that is only safe if there is no
> numeral in them to declare."*

**Digit-free by design, and therefore exempt from `no_invented_numbers` and
`figures_traceable` — every numeric gate in the pipeline.** The reasoning is
sound about numerals and silent about scope, so the one class of claim no
numeric check can see is exactly the class that was false. Thirteen of 84
published articles carry one, all thirteen on a windowed fetch, and the sentence
appears verbatim in the context pack for eight of them.

Eight of those articles stated a falsehood a reader could check. **Two were true
by luck** — `lithuania-s-crude-birth-rate` says *"the lowest reading in the
series"* over 19 observations of a 66-observation cube and is correct, because
2025 genuinely is the lowest since 1960. Nothing the pipeline did made that
true. **The prose is identical in the true cases and the false ones**, which is
why no prose guard can separate them and why the fix has to be where the window
is named.

### What to do with this

The question is cheap and mechanical: **for every name that asserts a scope —
`total`, `series`, `all`, `ever`, `record`, `servable` — ask what population the
code behind it actually walks, and whether the two are the same set.** It is the
enumeration rule this file already states, applied to a name rather than to a
guard, and it has the same tell: the mismatch is invisible from the reading,
because the reading is correct about the population it used.

## A shape is defined by what it refuses to say

The newsroom's correction machinery has four note shapes, and reading them
back, **each is distinguished less by what it says than by one sentence it
will not say.** Executed against the builders on 2026-08-31, rather than read
off the source:

| Shape | Refuses | Because |
|---|---|---|
| record, scope error | *"It was not the highest"* | it **was**, over the window we held |
| record, beaten in-window | *"only in the … we had retrieved"* | it did not lead the window either |
| record, rank claim | *"describing it as a record"* | it claimed a **placing**, not a record |
| origin only | *"only in the … we had retrieved"* | the record is **genuine** over all history |
| span misattribution | *"the figures are unchanged"* | the sign **inverts** |

**Every one of those refused sentences is true of at least one of the other
shapes.** *"The figures are unchanged and correct"* is the reassurance the
first four owe a reader and the fifth must not offer. *"The record itself
stands"* is the whole point of the origin shape and would be a lie in the
first three.

So they are not four templates with different wording. They are **four
different things that survive**, and the closing sentence is where that
difference lives.

### Why this matters more than tidiness

Forcing one shape through another is not a formatting compromise. **It
publishes another shape's truth as this one's** — inside a correction notice,
on the one page a reader visits already doubting us. It was nearly done three
times in one week, and each time the note had been *approved* on its wording
before anyone measured what it asserted:

```
rail   the approved note said the figure "was the highest only in the 39
       observations retrieved" -- 15 of those 39 were higher

cars   the same builder would have said the record was only ours -- 629 is
       the genuine maximum of all 36 readings

elec   the origin shape would have said "the figures are unchanged" -- the
       article reports a 41.75% fall over a span in which the price rose 48.8%
```

All three were caught by building the note and **measuring what it claimed**,
not by reviewing its prose. A sentence that is true of the general case reads
perfectly well in the specific one where it is false.

### The tell, and it is cheap

When a correction, an error message, or any other explanatory artefact does
not quite fit its template, **the mismatch is almost always in the closing
sentence — the part that says what still holds.** The body describes the
specific fault and is usually adaptable; the reassurance is a general claim,
and a general claim is exactly what a specific exception breaks.

So: read the sentence that says *what survives*, and ask whether it survives
**here**. If it does not, the shape is wrong and no amount of editing the rest
will fix it.

## Prose is where the unmeasured number hides

Two people arrived at this from opposite directions on the same day, which is
why it is here rather than in the programme log.

**From the failures.** Three figures were passed on rather than measured — a
verbatim quotation that was not verbatim, a PR count that was one too high, an
interval of "a day" that was seventeen minutes. All three landed in a **pull
request description or a status line**, never in a code block:

> A number inside a fenced block reads as measured and invites *"measured
> how?"*. The same number in a sentence reads as known.

**From the artefact.** A correction notice published this:

```
"...it is the change since 2022-S2, four and a half years later"
                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2016-S1 -> 2022-S2 = 13 semesters = SIX and a half years
```

Every other figure in that notice was re-derived from the cube in the run that
composed it. **That one was typed by hand**, because it read as connective
prose rather than as a measurement — inside a correction whose entire subject
is a figure attached to the wrong interval.

The offenders are the same in both cases and they are not the numbers anyone
checks: an **interval**, an *"as are the peer figures"*, a *"four-year average
of 7.88%"*. Nobody asks how a linking clause was derived.

### It has a shape, and the shape is the type

**Key**, stated once and used for every column: each parameter the four
correction builders declare, classified by its annotated type and by whether
its value reaches an f-string — that is, whether a reader ever sees it.

```
builder                      printed str   printed num   never printed
record_correction_note              8            3             2
origin_correction_note              6            0             1
span_correction_note                8            0             1
comparison_correction_note          6            2             2
                                   --           --            --
                                   28            5             6   = 39 declared

of the 33 a reader sees, free text                          28   (85%)
distinct printed string params that have carried a figure   17 of 17
never printed: claims_low, which selects wording; corrected_at, metadata
```

The `17 of 17` is measured across the eight fixtures in
`test_scope_correction.py`, each of which reproduces a notice that was actually
published. **Every string parameter a reader can see has at some point been
handed a number.** A `str` cannot say whether it was measured.

Now compare where the invariants live. **Seven value checks, four string
checks**, and the split is total: every value check is on a numeric parameter —
`beaten_in_window > beaten_in_series` is refused because the window is a subset
of the series; `rank > 1 and beaten_in_window != rank - 1` is refused because
fourth-highest means exactly three are higher; `beaten >= observations` is
refused because a reading cannot be beaten by its own population. Every string
check is presence-only: `if not str(value).strip()`.

So the guard rails are exactly where the type is a number, and **the wrong
figure entered through a string** — past all of them, in a builder that
refuses four different kinds of arithmetic nonsense.

### What to do

**Promote a figure to a typed argument when you want it checked.**
`beaten_in_window` was made a required `int` precisely so a caller had to go
and measure it; the same move is available for anything else that matters.
An assumption living in a sentence cannot be checked; the same assumption
living in a parameter must be.

And where it must stay prose — a `still_stands` clause is a sentence, not a
field — **derive it in the same run that writes it, and say so.** The test is
not whether the number is right. It is whether you can name the command that
produced it. Both of the day's errors would have failed that question
instantly, and neither would have been caught by reading.

### A count is not a key

Both figures above were wrong when this section was first written, and neither
of them was inside the fenced block:

```
shipped                 measured             where it sat
"28 str / 7 numeric"    28 / 5 / 6 = 39      prose introducing the table
"eight of them"         17 of 17             prose following the table
```

The first used **two different keys in one table** — *interpolated into the
prose* for the string column, *every `int` and `bool`* for the numeric one — so
it summed to 35 where the four signatures declare 39, and could be reconciled
against nothing. The second was low by a factor of two. The cells were right
both times; the sentences on either side of them were not.

**Then the reconciliation itself went wrong, and that is the part worth
keeping.** A reader who could not reproduce `28` derived a rule that does —
*every string parameter except `claim`* — and reported the figure sound. It is
a different population from the one the prose describes:

```
                              record  origin   span  comparison
str-like AND interpolated          8       6      8           6
str-like MINUS claim               8       6      8           6
same SET?                      False   False  False       False

  only in "interpolated" : claim          printed in all 4
  only in "minus claim"  : corrected_at   printed in none
```

Every builder declares exactly one `claim` and exactly one `corrected_at`, both
string-typed, so swapping which is excluded leaves all four counts untouched.
The recovered rule drops the parameter a reader *does* see and keeps the one
they never do — the exact opposite selection — and arrives at the same number
four times running.

So **a count does not identify its population, and reproducing a number is not
recovering what was counted.** That is worse than an unkeyed figure, because it
closes the question: the reader reports the count sound and stops. It is the
same shape as *the correct sibling that conceals the broken one*, arriving in
arithmetic rather than in code.

The remedy is not to write more carefully — the author had written the rule
minutes earlier and was standing inside the example. It is the one this repo
reaches for everywhere else: `test_agents_parameter_table.py` derives all three
figures from the AST and fails when the document and the code disagree. A
derivation states its key by being executable.

And an instrument note, pointing the other way. A throwaway classifier written
to check the 7/4 split reported **9/2**, because `not str(value).strip()` binds
a loop variable rather than a parameter, so looking the name up among the
signatures found nothing and filed both as numeric. The document was right and
the probe was wrong — a *plausible* wrong reading, which is the row of the
taxonomy above that does not defend itself.

## Two states that produce the same artefact

Everything below this line is one idea. A session that spent a run inside the
newsroom's rejection machinery put it better than the rules it generates:

> Every defect came down to **two states that produce the same artefact** — a
> rejection with no reason, a probe that cannot fail, a tally that looks like a
> measurement, a silence that might be a session with nothing to say or a session
> that could not speak. The work was never fixing the fault; it was making the two
> states distinguishable, after which the fault was obvious to whoever looked
> next.

That reframes the whole taxonomy. The sections that follow are each a *shape* the
collapse takes — absence resolving to success, an absent reading, a plausible one,
a bare number, a moving branch name. They are worth reading as instances rather
than as a list, because the list will never be complete and the question that
generates it is short:

**What second state would produce this same artefact, and can a reader tell them
apart?**

It is answerable *before* anything has failed, which none of the rules below are.
And it explains why so many fixes in this repository are a **new field** rather
than new logic — the behaviour was already right, and only the report was
ambiguous:

| The artefact | Looked like | Was also consistent with | Separated by |
|---|---|---|---|
| an article that did not publish | judged unfit | a broken check eating the wire | `rejected_checks` |
| a gate returning no | the gate said no | the gate never ran | `gate_unavailable` |
| a served page | the new build | the old build, byte-identical | a build id the server echoes |
| a published article | generated by current code | generated by anything | `provenance.revision` |
| ...with no revision | a known revision | never recorded | `revision_unavailable` |
| "0 stories from other outlets" | nobody published | **the fetch failed** | `4d24dc8` |
| a number on the grid | a reading | **a forecast** | `1b3628f` |
| "published nothing newer" | this series is stale | the *slowest* one is | `4cfefa5` |
| a source answering 200 | healthy | frozen for eight months | `stale` ≠ `unhealthy` |
| `42` | a measurement | a tally someone incremented | the window beside it |
| a merged PR | the session that announced it | any other session | see below — **partly** |

Three of those rows were already in this file, praised individually, with nothing
naming what they have in common. The principle is what makes them teachable
instead of memorable — and it is why the highest-yield activity in two
consecutive runs was **reading the artefact**: an artefact is exactly where two
states collapse into one appearance, so it is the only place the collapse is
visible.

The trap in applying it is that the fix is *not* usually to pick the right state.
It is to stop producing an artefact that cannot distinguish them. A guard
hardened against an unreachable state, a default that resolves absence to
success, a counter that cannot say it counted nothing — each is a choice to emit
one symbol for two facts, and each is cheaper to fix at the emitting end than to
diagnose at the reading end for ever after.

### Two instruments of opposite polarity beat one of either

The last row is the one worth reading slowly, because both parties got it
wrong in opposite directions and the *shape* of the correction generalises.

Several sessions push to this repo as the same GitHub account, so a merged PR's
`author` is `samoletovs` whichever session wrote it. A manager thanked the wrong
session for `#310`; the session checked its own reflog, found the branch absent,
and concluded **"a PR carries no evidence of which session wrote it."** That is
an over-generalisation from two fields — `author` and branch prefix — to all of
them, and it is false. Measured across every PR on master at `bd96024`, keyed
on trailer name:

```
n=182  Copilot App + Dmitrijs Andrejevs
n= 78  Copilot                            <- that session's five live here
n= 72  dependabot[bot]
n= 11  Copilot App + samoletovs           <- #310 lives here
 ...   7 more
```

`Co-authored-by` trailers vary by configuration, so `#310` is demonstrably
**not from that session's setup**. But note what each instrument can and cannot
do, because it is the whole lesson:

| | polarity | proves | cannot prove |
|---|---|---|---|
| the session's own reflog | **positive-only** | this branch *is* mine | that one is *not* mine — it is per-worktree |
| the trailer cohort | **negative-only** | a *name* absent from all of yours is a different configuration | that a matching signature is mine — 78 PRs share one |

⚠️ **Signature *inequality* is not evidence, and I shipped the claim that it
was.** Used in anger a few hours later, the instrument contradicted itself: my
own three PRs carry **two** signatures, all three verified mine by reflog.

```
#311  1 trailer   Copilot
#313  1 trailer   Copilot
#315  3 trailers  Copilot + Copilot App      <- same session, same config
```

The signature tracks the number of source commits, because GitHub's squash
emits a `Co-authored-by` for the commit author and the commit bodies carry one
of their own; with a single commit they collapse and with two they do not. So
**the squash confound survives the dedup that was presented as its fix** — one
level quieter than the raw count, and in the same direction.

What survives is a **set** test rather than an equality: a name appearing in a
signature that appears in *none* of yours. `Dmitrijs Andrejevs` and
`samoletovs` never appear in mine, so `#310`, `#317` and `#319` are all
demonstrably not from my configuration — and a superset like `Copilot`
→ `Copilot + Copilot App` is consistent with being mine, which is exactly the
case an equality gets wrong.

**Neither settles authorship; together they bracket it.** That is a shape worth
looking for whenever an artefact is ambiguous: not a better single instrument,
but a second one that fails in the *opposite* direction.

And the proposed fix — *"use the branch name"* — is **mostly** circular, with
one exception worth stating because it is the case that caught me out. 211 of
219 branches here are `samoletovs-<topic>`, since the prefix is the repo owner,
so `samoletovs-one-period-formatter` and `samoletovs-sweep-name-collision` are
indistinguishable in form: what discriminates is knowing which topics you chose,
which **is** the routing record the artefact was supposed to replace.

The other **8** carry no owner prefix at all — `equality-or-property`,
`newsroom-depth`, `signal-already-on-the-wire` — and for those the form alone
is discriminating, because it is not a form you use. A convention followed by
96% of branches is not a rule you can reason from, but its *violations* are
evidence, which is the opposite of how a convention usually helps.

**Two controls, and the reading says something else without either.**

*The squash confound.* A squash concatenates one trailer per source commit, so
the raw signature is a **commit count wearing an identity's clothes** —
`Copilot App + Copilot App + Dmitrijs Andrejevs` is one configuration, not
three. Deduping collapses **24 raw signatures to 11 when keyed on name** — and
that qualifier is load-bearing, for the reason below. Skip the dedup entirely
and you report that this repo has twenty-four kinds of contributor.

⚠️ **The dedup hides a second decision, and it changes the answer.** Two
readers measured this and got **11 cohorts and 10**; a third derivation gave
10 again. None of them was wrong, and the argument ran three rounds because
the question was **under-specified**: the count is a property of the *key*, and
nobody had stated one.

Measured on one tree, all of master, four reasonable keys:

```
case-folded name        10 cohorts
name, case-sensitive    11
name + email            12
email only               9
```

**Every one accounts for all 373 PRs.** So the sum — used three times as the
control that settled it — separates none of them: *a total is satisfied by any
partition*, which makes it far weaker evidence than it looks and is why it
endorsed each reader in turn.

Case folding is what moves 11 to 10: it merges `Copilot + Copilot App` with
`Copilot App + copilot`. The emails show those are different configurations —

```
Copilot   223556219+Copilot@users.noreply.github.com
copilot   copilot@github.com
```

— but following that argument all the way gives **12**, not 11, because two
`Copilot` trailers carry different account ids (`223556219` and `223556019`).
So *"the emails settle it"* was itself under-specified, in the same way and by
the same reader.

The rule is therefore not a number. **When a dedup decides identity, the key is
a judgement rather than a formatting step — so state the key beside the count,
or the next reader inherits a figure with no way to check it and no way to
reproduce it.** Here the section's subject is *configurations*, so name+email
is the honest key and the answer is 12.

⚠️ **And the wrong key can be applied without anyone choosing it.** The `10`
reached master because PowerShell folds case in the two places a dedup
naturally goes through, neither of which announces it:

```powershell
$h = @{}; $h['Copilot'] = 1; $h['copilot'] = 2
$h.Keys.Count                                      # 1   <- silently merged
('Copilot','copilot' | Sort-Object -Unique).Count   # 1   <- and again

[Collections.Generic.Dictionary[string,int]]::new([StringComparer]::Ordinal)
                                                   # 2   <- what was meant
```

Fixing only the sort still gave `10`, because the hashtable folded it back. So
this is the shell silently altering the computation and returning a number that
looks like an answer — the same family as `node -e` in PowerShell mangling the
`$` in `/\(#\d+\)\s*$/`, which reported `PRs: 0` for a repository with 373 of
them. **Both read as findings rather than as broken instruments**, and in a
comparison of identities the case-fold is not a formatting detail: it is the
judgement, made for you, by a default.

*The temporal control.* The obvious alternative is a convention that changed
over time, which would make this a clock rather than a signature. Cohorts
interleave within the hour — `#302` at 10:25Z and `#310` at 12:45Z sit either
side of **seven consecutive PRs from a single third cohort** — so it is not
temporal.

⚠️ **Those two timestamps were three hours wrong in the first draft**, and the
mechanism outlives the fix. `git log --format=%aI` renders
`2026-08-31T13:25:46+03:00`; taking `slice(11, 16)` and appending a literal
`Z` yields `13:25Z`, which is Riga local time wearing UTC's clothes.

**`%cI` is not the remedy, and it was the first thing suggested.** Measured on
the same two commits, the committer date carries the identical offset:

```
#302   %aI 13:25:46+03:00   %cI 13:25:46+03:00   gh mergedAt 10:25:46Z
```

Parse the offset, or read `mergedAt` from `gh`, which is genuinely UTC. **A
hand-typed `Z` is an assertion about a conversion that never happened** — and
the file's own rule applies to the fix as much as to the fault: an example in
guidance is a claim about behaviour, so run it before recommending it.

**State the population.** Two sessions measured this an hour apart and got
`110` PRs and `370`; neither is wrong, and they never disagreed. One counted a
recent window, the other all of master. A cohort table without its window is
the bare number this file already warns about, one level up from the code.

### A mutation control has two outputs, and the pass count is the second one

A planted fault that never applied is indistinguishable from a test that failed
to fire: both print a green suite. And it fails toward **"guarded"**, which is
the reassuring direction — the one nobody re-checks.

Four instances across two sessions in a single day, every one caught by the
applied-flag rather than by the result:

```
plant anchored on 6-space indentation, file uses 4   -> "26 passed"   never applied
anchor moved by a refactor between runs              -> silent no-op
anchor matched twice, replaced both                  -> wrong subject
anchor absent because the phrase wrapped a line      -> silent no-op
```

So read the applied-flag *before* the pass count, and make it a **comparison,
not a size**: `12` → `99` is byte-identical in length, so a length check reports
a plant that landed when it did not. Compare the content, and require the
anchor to occur exactly once — a harness that reports `INVALID / anchor x0`
rather than a verdict is what stops a moved anchor reading as a passing test.

The same rule one layer out: `git diff --stat` is empty for an untracked file,
after `git checkout --`, and when an edit lands on an already-dirty line.
**Verify a plant and its restore by content, never by the diff.**

### A green that is a fact about the environment, not about the code

A check that *cannot* fail is inert, and its greens say nothing. The worse case
is a check that **can** fail and has not, because the environment has been
kind — because those greens are read as evidence about the code while being
facts about when you ran it. It accrues a passing record it has not earned.

Two instances, found the same day by two people, neither noticing the other was
the same shape:

```
LATE_QUARTER fixture      derives a period from the clock
  green iff the month is kind        red in Mar Jun Sep Dec — 4 of 12
  undetected since written, because those months had not come round

sanity band, pre-#252     reads the newest live observation
  green iff the newest reading is benign
  simulated over 296 months of EE `admin_prices` against the old [-30, 60]:
  RED on correct data in 7 of them — 2021-12 and 2022-04..09, the energy crisis
  CONTROL: same simulation against the corrected [-30, 150] is 0 red
```

The mechanisms are unrelated — one manufactures a fixture, one reads a live
feed — and the failure is identical: **the verdict depends on the date of the
run, and the run happened on a good date.** Neither check was wrong about
anything it examined. Both were silent about the thing they existed to catch.

It is also why neither was found by review. There is no artefact: for eight
months a year the fixture's own comment was already false while the assertion
passed, and the band was already wrong while the tip was ordinary. **A wrong
check with no failing run leaves nothing to read.**

The remedy in both cases was the same, and it is the actionable form: **assert
the property across the range, not at a point.** `af3c394` runs the fixture
through `freshnessOf` for twenty-four months; `#252` reads every observation in
the window instead of the newest. Neither needed a new instrument — only a
larger population, which is this file's own rule arriving at the *inputs* of a
check rather than at its enumeration.

The tell, when writing one: **ask what would have to be true of the world for
this to go red, and whether that is a property of the code.** If the answer
mentions a date, a live feed, or anything else you do not control, the check is
sampling rather than asserting.

⚠️ **And "across the range" means every point, not a dense-looking sample of
them — which I got wrong in the first application of this rule, hours after
writing it.** I verified `af3c394` on a grid of the 1st, 15th and 28th of every
month across three years: 108 dates, a control that fired 36 times on the old
fixture, and a clean zero on the new one. Measured per day instead:

```
grid  108 dates, 3 per month     old fixture bad  36
day   730 dates, every day       old fixture bad 246
months my grid called CLEAN that contain a bad day:  2   (2025-05, 2026-05)
```

Both are May, and the mechanism is one no grid on the 1st/15th/28th can see:
`setUTCMonth(month - 8)` on **May 31** asks for 31 September, JavaScript rolls
it to 1 October, and the fixture lands a quarter *later* still. Measured, all
five failures are identical in kind:

```
2026-03-15  -> 2025-Q3  behind 6   late(>6) false
2026-06-15  -> 2025-Q4  behind 6   late(>6) false
2026-09-15  -> 2026-Q1  behind 6   late(>6) false
2026-12-15  -> 2026-Q2  behind 6   late(>6) false
2026-05-31  -> 2025-Q4  behind 5   late(>6) false   <- the grid cleared May
```

**Two mechanisms, one symptom.** Quarter rounding anchors the label to the
quarter's last month; day overflow pushes it a whole quarter further. Both make
the fixture more recent than the comment claims, and every one fails the same
way — not old enough for the notice to fire. There is no over-old failure mode
to be the opposite of, because the assertion is that the notice *fires*.

That is the stronger version of the point, not a weaker one: a sample missing a
*differently-shaped* failure is unremarkable, while a sample missing the **same**
failure arriving by a second route is the case nobody plans for.

So a sample can be large, evenly spaced, control-backed and still blind, and
the blindness is worst where the domain has **irregular boundaries** — month
ends, leap days, DST, week 53. The cost of enumerating every day here was one
loop. **When the range is small enough to walk, walk it**; when it is not, the
sample needs a reason to believe it covers the boundaries, and "3 per month for
36 months" is not one.

Verifying that table produced one more instance of it. The build-identity row
originally cited `/__which`, and a probe found it returning **HTTP 200** in
production — which reads as *the endpoint exists*:

```
git grep -l __which      AGENTS.md, PROGRAMME.md      <- prose only, never built
GET /__which             200, 11408 bytes, <!doctype html>
```

The 200 is the SPA fallback answering `index.html` for an unknown route, the same
mechanism that made a reload counter report 84 further down this file. **A status
code cannot distinguish "this route exists" from "nothing matched, have the
app"** — so the row named a shipped endpoint that was only ever a local preview
instrument. Fixed to describe the property rather than a URL.

**Two limits, from the session that wrote the sentence, and they belong beside it
because its position at the head of this file overstates it.**

It is a **reformulation, not a discovery.** It could only be written because the
sections below had already collected the instances and praised each one; noticing
they rhymed is cheap next to finding them. The question summarises two runs of
people reading artefacts and writing down what they saw — it does not replace that
labour, and **asked of a system you have not looked at it yields nothing.** It
aims attention; it supplies no evidence.

And it is answerable **only where you can enumerate the second state.** Every row
in the table above is a case where someone already knew what the alternative was:
a broken check, a failed fetch, a forecast, a tally. The failure it cannot reach
is the one where you **cannot imagine the second state** — which is precisely the
class *reading the artefact* exists for, because an artefact shows you an
alternative you had not conceived of rather than confirming one you had.

So the two are complements and the newer does not supersede the older. Use the
question to audit a mechanism you understand; use the artefact to find out that
you did not understand it.

**And the artefact has a limit of its own, which is the third leg and the one
neither of the other two names.** Reading the artefact has been the
highest-yield habit in this programme by a wide margin — it found the analyst
who does not exist, the false superlative eleven checks passed, the wrong
subject behind a shared cache key. Every one of those was a thing somebody
could look at.

It cannot reach a check that **can** fail and has not, because there is nothing
to look at. *"A wrong check with no failing run leaves nothing to read"* is
stated above as a local fact about two checks; it is also a bound on the
technique. Both defects existed continuously and were visible almost never:
the `LATE_QUARTER` fixture went red in **4 months of 12**, and the sanity band
would have gone red on **7 readings of 296** — one in 2021-12 and six running
2022-04 to 2022-09, so outside the energy crisis it was silent for years at a
stretch. No amount of reading closes either, because between those dates the
reading material is a green.

So the three fail in different places, and knowing which you are in is the
whole of the choice:

```
the question          fails when you cannot enumerate the second state
read the artefact     fails when the defect produced no artefact
assert across a range reaches what never produced one -- and is the only
                      one of the three that needs no imagination at all
```

The last is why the remedy above is structural rather than diligent. A larger
population over the *inputs* does not require anyone to have suspected
anything: `af3c394` would have caught its own defect in March whether or not
its author had thought about calendars.

### Sometimes the artefacts differed and the probe threw one away

The remedy above — emit a new field — is right when the collapse is real, and it
is expensive: a code change, a schema change, a deploy. Two failures on
2026-08-31, by two people about five hours apart, needed **none** of it, because
the two states were never one artefact. Git distinguished them perfectly. Both
probes discarded the distinction.

Measured on `e2de3d9`:

```
INSTANCE 1   git checkout master --quiet 2>&1 | Out-Null
             exit 128 · fatal: 'master' is already used by worktree at '...'
             probe read neither; concluded from the branch label afterwards

INSTANCE 2   git show origin/master:src/polarity.ts 2>&1      (real path: src/utils/)
             exit 128 · stderr MERGED INTO STDOUT
             a probe reading length gets 63 -- a plausible non-zero reading
```

In both, **the exit code was correct, available and unread.** The first is the
one worth internalising: `$LASTEXITCODE` *survives* `| Out-Null`, because the
pipe discards the output stream and not the status. The signal was not even
suppressed — it was sitting in a variable nobody read. The second is worse than
silence: `2>&1` moves the error onto the channel the probe is reading, and an
error message has a length, matches a regex, and is truthy.

So the discriminating question is one word from the section's own, and the outer
question cannot separate these because it answers the same way for both:

> not *what second state produces this same artefact* —
> **did the artefact ever differ before my probe got to it?**

| | the fix | the cost |
|---|---|---|
| genuinely collapsed | emit a new field — `rejected_checks`, `gate_unavailable`, `revision_unavailable` | code, schema, deploy |
| **discarded signal** | read `$LASTEXITCODE` | nothing; no code changes anywhere |

**Misclassifying the second as the first builds machinery nobody needs**, and
that is the easy direction to fail in. What decides it is the kind of thing that
produced the artefact. Data carries no second channel unless someone adds one,
which is why separating those states costs a field at all. A command is not like
that: in this environment a native command **always** carries a status beside
its output. So the burden for a failing command is to show the signal was
*absent*, not merely unread.

The shape, and it is greppable: **a verdict computed from text where a status
was available.** `2>&1` followed by a length, a match or a truthiness test; a
native command piped to `Out-Null`; any probe that concludes from output while
`$LASTEXITCODE` sits beside it.

And where you can, ask the question so that a failure *stays* a failure.
`git show` answers "give me this blob" and reports a missing path as a message;
`git cat-file -e` answers "does this exist" and reports it as a status:

```
git show      origin/master:src/polarity.ts        exit 128, 63 chars of "content"
git cat-file -e origin/master:src/polarity.ts      exit 128, no output
git cat-file -e origin/master:src/utils/polarity.ts exit 0        <- CONTROL, it can say yes
```

The control is not decoration: without it, `exit 128` twice is also what a
broken invocation looks like. **A command that returns text has to be asked
whether it failed. A command that returns a status has already said.**

### A record that carries a duration was written at the end

The dispositions above assume you are consulting the right record. This one
survives review because its remedy looks like an escalation rather than a
repetition.

The question was *did the 14:00Z newsroom run happen?* The obvious artefact is
the run report the pipeline writes — but that is written when the run
**finishes**, so during a run it still shows yesterday's, and three states share
that one appearance: never fired, still running, fired and failed. Measured
live, while a healthy run was mid-flight:

```
14:02:23Z   runs/latest.json -> finished_at 08/30      cache-busted
14:06:18Z   runs/latest.json -> finished_at 08/30      second signal agreed
14:08:22Z   the run finished and wrote the blob
```

**The natural remedy fails for the same reason.** Reaching past the application
to the platform — Application Insights — and asking its `requests` table looks
like a different instrument entirely: another system, another tool, another
credential. It is not:

```
requests | where name == 'newsroom_edition'
  timestamp  2026-08-31T14:00:00.008382Z     <- the START
  duration   502514.28 ms
  success    True

  14:00:00.008 + 502514ms  ==  14:08:22.5Z  ==  the blob's own finished_at
```

A request row carries `duration` and `success`. Both are facts about how the
thing **ended**, so the row cannot exist until it has. At 14:02Z there was no
row, and a probe reading *no row* as *never fired* would have declared the
pipeline dead about a run it was watching succeed.

So the property to check is not which system a record comes from. It is
**when the record was written**, and there is a one-line test for it:

> **If a record carries a duration or an outcome, it was written at the end.
> It cannot answer whether something started.**

The trap is that `requests.timestamp` **is** the start instant — `14:00:00.008`,
8 ms after the cron — so the row reads exactly like a start-time record. Nothing
in it announces that it did not exist for another eight minutes.

The record that can answer is the execution log, because it is emitted at both
ends and says which end it is:

```
14:00:00.0106Z  Executing 'Functions.newsroom_edition' (Reason='Timer fired at ...', Id=ada01823-...)
14:08:22.5222Z  Executed  'Functions.newsroom_edition' (Succeeded, Id=ada01823-..., Duration=502513ms)
```

Same `Id`, one at each end, so the states separate **positively** rather than by
absence — which is what *"which way does absence resolve?"* asks for, one layer
out:

```
Executing, no Executed         still running
Executing + Executed(Failed)   fired and failed
no Executing at all            never fired
```

Two things generalise past telemetry. **A margin computed from a maximum is a
likelihood about the next sample, not a measurement**: the check above allowed
20 minutes against a worst-ever 425.8 s, and the very next run took 502.5 s —
still inside, but the figure the allowance rested on was stale when it was
written. And **a control must assert a property that cannot decay.** The same
check named an article "carrying 1 correction" as its positive control; nine
hours later it carried 2, so an equality against the recorded reading would have
called a working probe broken. *Non-empty* survives; `== 1` does not.

**And a control's value survives its own probe failing, which nothing else in the
instrument does.** The defensive reading — *a control stops you filing a false
finding* — is true and undersells it. Measured today: a session's bundle probe
returned `0 chunks`, and because its control also returned nothing they reported
*"I could not see"* rather than *"the fix is not deployed"*. That handed the next
reader a **bounded problem** — fix an extraction, do not doubt a fact — and it
was closed in one pass. A bare `not found` would have cost a full re-derivation,
or worse, been believed.

So the question that decides whether to bother is not *how likely am I to be
wrong*. It is: **if this probe fails, will anyone be able to tell?**

⚠️ **A count that reproduces under several rules cannot validate any of them.**
Two readers independently recovered the "rule" behind the parameter table above,
agreed on the number, and named **different** excluded parameters — one said
`claim`, the other `corrected_at`. Measured: `claim`, `corrected_at` *and*
`series_start` each appear in all four builders, so excluding any one of the
three yields 28. The figure is consistent with all of them and evidence for
none, which is the sum-control failure one level up: *a total is satisfied by
any partition, and a count is satisfied by any exclusion of the same size.*
Both of us said "I derived the rule" when we had derived *a* rule that fits.

That last rule reads as the opposite of *write an exemption as an assertion, not
a filter*, and the collision is real rather than apparent: both are about
asserting against a value **someone else controls**, and they prescribe opposite
treatments. An exemption belongs in an equality precisely *so that* it breaks
the day the contingency lapses; a control must not, because the day the article
gained a second correction nothing about the probe had changed.

What separates them is not the value. It is **what a failure would tell you**:

| | a failure means | so |
|---|---|---|
| exemption | the thing you were excusing is fixed | the equality **is** the finding |
| control | the world moved, orthogonally | the equality is noise wearing a finding's clothes |

So the question to ask of any assertion pinned to a recorded reading is *would I
want to be woken up when this number changes?* If yes, pin it exactly, and let
it fail. If a change is expected and says nothing about the subject, assert the
**weakest property that still discriminates** — for a positive control that is
almost always non-emptiness, because a control's whole job is to prove the probe
can see anything at all.

The file already contains the deciding half of this and states it about
exemptions only: *an exemption that rests on someone else's code is never
permanent, because you are not the one who decides*. Controls rest on someone
else's code too. The difference is that an exemption **wants** to hear about it.

### Four dispositions, told apart by their remedies

The symptoms are identical in every case — a probe that answered, and answered
wrongly. What separates them is what it costs to fix, and the spread is a
deploy at one end and an admission at the other:

| The separator | The remedy | The cost |
|---|---|---|
| none exists | **emit** one | a code change, a schema change, a deploy |
| one was already in the probe's hand | **read** it | nothing |
| one exists, but the record consulted cannot answer | **re-time** it — ask what was written when | one query |
| each exists and is individually insufficient | **bracket** it — pair opposite polarities, report a bound | an admission |

Two of these are worth keeping apart deliberately, because the fourth reads as
a weaker version of the second and is not. Reading harder terminates the
second; it does not terminate the fourth. *"Two instruments of opposite
polarity beat one of either"* is where that case lives, and it is exact: a
reflog proves a branch **is** mine and can never prove another is not, because
it is per-worktree; a trailer cohort proves a signature is a **different**
configuration and can never prove a matching one is mine, because 76 pull
requests share it. Read both, fully, and the honest output is a bound.

So the fourth is the only one of the four whose remedy ends in an admission
rather than in a fact — and that, rather than any property of the artefact, is
the reason it needs its own name.

## Which way does absence resolve?

Every "guard that cannot fail" found in this repo reduces to one sentence:
**absence resolves to success.** Not a missing guard — a present one, handed
nothing, and answering yes.

```
a field the payload does not carry   -> the check is skipped   -> passes
`dist/` absent, so indexOf gives -1  -> -1 < any position      -> ordering passes
smoke fails under continue-on-error  -> success() stays true   -> the tick is sent
required.length === 0                -> "healthy"
maxLag undefined, so age > undefined -> always false           -> "fresh"
React.lazy catches its own rejection -> no unhandledrejection  -> the handler idles
```

The last one is the widest form: the *trigger* was absent rather than a value,
and a test that synthesised the event proved the handler worked while the
feature was dead.

So the place to look is not "guards" in general. It is **every point where a
missing value feeds a boolean**, and the question is always *which way does
absence resolve*. That is mechanically searchable in a way "is this check
correct?" is not — comparisons whose operand can be absent, membership tests
against a collection that can be empty, and any `success()` downstream of
something allowed to fail.

The codebase already gets this right in at least one place, unprompted.
`ProvenanceBlock.tsx` reads:

```tsx
passedCount === checks.length && checks.length > 0
```

The `&& > 0` is load-bearing: the schema puts no `minItems` on `checks`, so an
empty array is valid and would otherwise render as "all checks passed".

**Two rules follow.**

When absence is possible, say what it means rather than letting a comparison
decide. `judge` documents that it returns `unknown` and never `fresh` when it
cannot tell — so a path where a missing `maxLag` yields `fresh` contradicts the
function's own stated contract, and fixing it is not defensive programming, it
is making the code do what it says. Where there is no such contract and the
state is genuinely unreachable, leave it: hardening against a state no test can
produce is the belt-and-braces this book warns about elsewhere.

And **an assertion that something is absent needs a companion proving it could
have been present.** Otherwise the assertion passes on a fixture that never had
the thing at all, which is the same fault one level up.

**And the companion is not enough, because a filter that never fires is
indistinguishable from a filter that is not there.** Two probes, same afternoon,
built by two people to check each other's work on precisely this class of
defect, and both had it:

```
theirs   "tracked files scanned : 537"     counted files LISTED
mine     "tracked files checked : 536"     counted entries TRACKED
```

Neither number was wrong. Both **labels** were, and only conditionally — the
moment one tracked entry is not an openable file, the count silently means
something else. The direction is the reassuring one every time: a larger
denominator over the same zero hits.

The positive control does **not** save you here, which is what separates this
from the paragraph above. Re-measured on master, the filter inside my probe had
never once excluded anything — `539 tracked entries, Test-Path False: 0` — while
`Test-Path` on a path that cannot exist does return `False`, so it demonstrably
*could* fire. That control tells you the mechanism works and says nothing about
whether it ever ran. **A validated filter that excluded nothing and an absent
filter produce the same denominator.**

So report the filter's work, not just its result: `537 listed, 537 openable, 0
skipped` rather than `537 checked`. A hit count of zero is information; a label
asserting the check happened is not. This is *absence resolving to success*
wearing a denominator's clothes — and both of us wrote it into the probe we were
using to reassure the other about a name that lied about its population.

### When a probe reports "absent", check the probe can see anything

The reading `refLines: 0` is true on master, true on a fixed branch, and true
for a chart that does not exist. jsdom gives `ResponsiveContainer` no size, so
recharts draws nothing at all — and every query against it returns zero.

What broke the tie was not looking harder at the markers. It was noticing that
`lines: 0` came back too: the chart's four ordinary series were missing as well.
**Had the harness drawn those four and no markers, the zero would have been
believed.** The instrument's failure was legible only because something that
should certainly have been present was also absent.

So: **an absent result is a claim about the instrument before it is a claim
about the code.** Before reporting "not there", confirm the probe can see a
thing you already know is there — a control that must be present, measured the
same way, **on the same object**.

That last clause is not decoration, and it was added after someone fell into it
while writing the section below about controls. A negative control on a
*different* file proves the phrase is absent from that file **or** that the read
failed — the same `False` either way, and the positive half, being elsewhere,
cannot notice. So the pair proves the read happened rather than that the thing is
missing. The `refLines` story above has the property and never states it: the
four ordinary series that were also absent were on the **same chart**, which is
the only reason the zero was disbelieved. This costs one extra assertion and it is the only thing standing
between a tooling failure and a confident wrong bug report.

The manager did this twice in one evening, both times against merged and
working code: probing an endpoint for a field named `electricity` when it was
`electricityPrices`, and testing a JavaScript bundle for a hex colour after a
regex matched three `.js` assets and no stylesheet. Both returned a clean,
reproducible *absent*. Both were caught only because the result contradicted
something already verified — which is luck, not method.

**The method, and it is cheap: when a probe returns nothing, print the shape
before printing a conclusion.**

This is the most-reproduced failure in the programme — six times in one day
across two participants, every one of them against code that was merged and
working. Twice more by the manager (`checks` and `overallStatus` on
`/api/system-status`, whose real path is `dataSources.checks`; then grepping
master's stylesheet for `--surface-*`, a token that exists in neither branch it
was comparing), and twice consecutively by a session probing the same endpoint —
`checks` returning an empty array, then `dataSources` indexed as an array and
raising a `TypeError`.

That session also found why the rule has to be procedural rather than a
reminder to read field names carefully:

> An empty array is suspicious in a way a plausible value is not. If `checks`
> had happened to exist and carry something else, I would have believed it.

**A rule that fires only once you suspect you are wrong is not available at the
moment you need it.** "Print the structure after the second wrong guess" needs
no suspicion — it is triggered by the guessing, which you can always observe.
Had that session stopped at its first guess it would have reported *"the
maritime probe is missing from production"*: a confident false regression
against its own merged work.

All six of those were an *absent* result rather than a wrong value, and an
earlier draft of this section generalised that into a rule. **Two cases the
same evening falsified it**, so here is the actual taxonomy — three kinds of
bad reading, three different responses:

| The reading is | Likely cause | What to do |
|---|---|---|
| **absent** — nothing, empty, null | wrong field, wrong selector | print the shape before the conclusion |
| **plausible** — a value you'd believe | right probe, wrong subject | confirm which tree you measured |
| **absurd** — obviously impossible | broken instrument | suspect the probe, not the code |

The third is the session that built the modulepreload recovery, counting
reloads three ways before getting one that meant anything. `framenavigated`
made a healthy page look reloaded, because it fires for SPA history
navigation. Counting document *responses* then reported **84** reloads, because
the SPA fallback answers `index.html` for the app's own `/api/*` calls.
`Sec-Fetch-Dest: document` was the question actually being asked.

Their rule, and it is a good one:

> When a measurement disagrees with a mechanism you have just reasoned through,
> suspect the measurement first if the disagreement is large. A subtle wrong
> answer is usually the code; an absurd one is usually the probe.

They came one assertion from filing *"the fix causes a reload loop"* against a
working fix, **and what stopped them was that 84 was too absurd to believe.**
That is the row's saving grace: an absurd reading defends itself. A plausible
one does not, which is why the middle row is the dangerous one and needs a
mechanical check rather than an instinct.

That claim got an illustration the day it was written, by accident. Two people
verified the *same entry* in the *same file* within an hour, and both probes were
wrong:

```
they    two identical section lengths across a commit that added 21 lines
        -> ABSURD    disbelieved instantly, re-derived, correct answer

me      a search widened from the section to the whole file
        -> PLAUSIBLE believed, diagnosed as the wrong cause, SHIPPED into this file
```

Same taxonomy, same evening, same subject, and the only variable was **whether the
wrong answer happened to look ridiculous.** Their reading defended itself and mine
did not, and **no difference in care is needed to explain that** — which is the
claim the argument actually requires. It does not need care to have been equal;
it needs care to be something you cannot *rely* on, and a reader who ships a
plausible wrong number has no signal telling them they are less careful than the
one who catches an absurd one.

**Stated precisely, because this paragraph's whole subject is a claim outrunning
its evidence: n=2, one probe each, and care was never measured — only unaccounted
for.** That is an illustration, not a controlled result, and the distinction is
the difference between *this justifies a mechanical check* and *this settles it*.

**And the absurdity can live between the readings rather than in any of them.**
The pair above already shows it without naming it: what made their reading
absurd was not either section length — it was that the two **matched** across a
commit that added 21 lines. Each length on its own was perfectly ordinary.

A second instance, from the same evening, with the same shape:

```
two sentences of ONE paragraph reported missing, the rest present
  each zero is exactly what an absent sentence looks like
  but no merge lands half a paragraph
```

That probe was defeated by a line break and an inline `**`, and every individual
zero was believable. The set was not.

So the question is worth asking of a result *set* and not only of a result:
*could the world have produced this combination?* If it could not, the
instrument is wrong however plausible each row looks — and you know that
**before** you know which row is the lie. That reaches a population the middle
row cannot: readings individually unremarkable and jointly impossible. Both of
the above would have been believed one at a time.

### The better you document a removal, the more present it looks

A content check for a deleted symbol reads the prose explaining the deletion and
reports the thing as still there. That is not a caution about carelessness —
it is a **positive correlation between doing the work well and the check
lying**, and the ratio is worst exactly where someone took the trouble to say
why the thing is gone.

`#261` deleted three symbols from `RankedComparison` in one commit. Measured on
master afterwards, across `src/`, `tests/` and `api/`:

```
                     naive grep   comments stripped   wrong
higherIsBetter            8              1             88%
sentimentOfChange         3              0            100%
describeChange            0              0              0%
```

**`describeChange` is the control and it is the whole argument.** All three were
removed by the same change, on the same day, by the same person. The only
variable is how much explanatory prose each earned: the prop was contentious and
got seven sentences, the sentiment function got two, and `describeChange` was
deleted without comment. The naive check is 88% wrong about the first, 100%
wrong about the second, and **exactly right about the one nobody bothered to
explain**.

So the naive check is least trustworthy on precisely the changes a reviewer most
wants to verify, and its accuracy is a measure of the documentation rather than
of the code.

There is a second instance, from a different session the same day, running the
other way. A seam sweep counted a field name **inside a comment** as a reader,
and reported `freshness.allowed` as `test-only` on three files where `.allowed`
never appears in code — the word was in comments about CSV export, the spacing
scale and the rate limiter.

```
a comment mentioning a REMOVED thing   ->  reported PRESENT
a comment mentioning an UNREAD thing   ->  reported READ
```

Same mechanism, opposite subjects, and **both fail toward "no finding here"** —
one hides a completed deletion, the other hides a dead field.

**So: strip comments on both sides before any content check**, and when the
subject is a change someone explained carefully, treat the naive count as
evidence about the prose until you have separated them. The stripped read is
one line:

```js
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
```

Four instances across two people in two days, and the tell is always the same:
**print the matching lines, not the count.** A count cannot distinguish a symbol
from a sentence about a symbol; the lines can, instantly, and every one of the
four was resolved that way the moment someone looked.

**This entry is itself an instance, which is the cheapest possible proof.**
Writing it added mentions of all three symbols to `AGENTS.md` — and the most to
`describeChange`, the control that was clean precisely because nobody had
written about it. Its naive count across the repository is no longer zero, and
the only reason the table above still holds is that it states its scope:
`src/`, `tests/` and `api/`, which is where code lives. **A content check needs
a stated population as much as a stripped input**, or documenting the finding
falsifies the finding.

This has a sibling one level up that the same sweep found and this file already
records: prose can also describe *live* code as though it were gone, or gone
code as though it were live. `tests/polarityAdmission.test.ts` closes that half
structurally — an identifier named in backticks in `src/utils/polarity.ts`'s
comments must exist in the code or be declared removed. Measured before it was
written, that rule fires on 1 name in 15, which is what makes it a filter rather
than a complaint about writing.

**Do not widen that guard past one file, and the reason is measured.** The
obvious next move is to point it at the repository. Run first:

```
425 files · 16081 code tokens
backticked identifiers in comments          798
   of those, absent from all code            32
scoped to src/utils/polarity.ts               0 of 15
```

Thirty-two firings and **not one is a defect.** They are Python symbols the
TypeScript describes, Eurostat codes (`LBK_ROIL`, `mar_pa_qm_LV`), TypeScript
error codes (`TS2307`), env vars (`PLAYWRIGHT_BROWSERS_PATH`), Node and recharts
APIs (`ECONNRESET`, `connectNulls`), a commit SHA. *"Every backticked name
exists in this codebase"* is only true inside a file that talks exclusively
about itself, and `polarity.ts` is one — which is why 15 of 15 resolve there and
766 of 798 do not repo-wide.

**Read the zero, not the totals.** Those counts are a property of how you
tokenise, and a second reader measuring honestly will get different ones — which
looks like drift and is not. Measured three ways, varying only the minimum
identifier length and the directories globbed:

```
                        named   absent   polarity.ts absent
4+ chars, five dirs       798      32            0
5+ chars, five dirs       754      32            0
4+ chars, src+tests       538      52            0
```

Everything moves except the number the argument rests on. **The zero is
invariant under the choices that move the denominators**, which is what makes it
evidence rather than an artefact of one extraction — and is the reason the
scoping conclusion survives whatever a re-measurement reports.

**The sharpest entry on that list is the correct fix to the last instance of
this very problem.** A comment in `tests/indicatorFreshness.test.tsx` had named
`sentimentOfChange` as a live member of the sentiment vocabulary; it was
repaired to say *"It listed `sentimentOfChange` too until `#261` deleted that
second polarity implementation"* — history reading as history, which is exactly
what this section asks for. A repo-wide version of the guard flags it.

So the detector cannot tell a **stale** reference from a **deliberate
historical** one; both are a name in prose with no code behind it. That is not a
flaw to be tuned away — it is why the rule carries a `REMOVED` declaration and
why it is scoped to a file whose vocabulary is closed. **A guard whose false
positives include the correct outcome must be narrow, or the exemption list
becomes the guard.**

### A control validates the mechanism, not the mapping from question to measurement

Everything above assumes a control tells you whether to trust a reading. It does
not. **A control proves the probe discriminates on the axis it varies — and says
nothing about whether that axis is the one you were asking about.** Both halves
can be perfect while the answer is irrelevant.

Two instances, and the first is the sharper because its controls were *present
and blind*:

```
QUESTION  which session created this branch?
PROBE     git reflog show <branch>
CONTROL+  HEAD                  exit 0     fires
CONTROL-  zz-no-such-branch     exit 128   fires
```

Both controls correct, and they prove reflog-lookup discriminates **existence**
flawlessly. Existence was never in doubt: sessions share one clone, so every
session's branches are locally present. Measured from a worktree on
`final-state`, which never touched either branch:

```
samoletovs-tab-stop-names     RESOLVES
samoletovs-colour-migration   RESOLVES
zz-no-such-branch             absent      <- the read works
```

The probe answered a question nobody asked, and the controls certified it.
(An earlier draft cited the *count* of local refs — 541. It was 542 an hour
later. **A branch count is a moving reference**, and the fact that matters is
not how many resolve but that another session's does.)

⚠️ **And the instrument that answers the question was one command away**, which
is what makes this worth more than a caution. Git keeps *two* reflogs, with
opposite properties:

```
                              HEAD reflog     branch reflog
                              (per-worktree)  (shared)
  mine, created here             YES            exit 0
  another session's              no             exit 0
  another session's              no             exit 0
  no such branch                 no             exit 128
```

**Both instruments work.** The left column discriminates authorship, the right
discriminates existence — and `git reflog show <branch>`, which is what anyone
types when told to check the reflog, is the right-hand column. Proven rather
than inferred, since an example is a claim about behaviour:

```
$GIT_COMMON_DIR/logs/refs/heads/<b>   exists      True
$GIT_DIR/logs/refs/heads/<b>          exists      False
git reflog show <b>                   exit        0
=> it succeeds while only the shared copy exists
```

So the row above calling the session's own reflog **positive-only** is correct,
and is true of `$GIT_DIR/logs/HEAD` alone. **The property was named accurately
and the obvious way to implement it has the inverse property** — which is this
section's own subject, occurring inside it: *"check the reflog"* names one
question that two different files answer differently, and no control on either
file can report that.

```
QUESTION  is #310 live on the Static Web App?
PROBE     git merge-base --is-ancestor 1ca9aa8 56554c8
```

Run correctly, and it answers *"is it in the newsroom Function App's
revision"* — a different pipeline. `deploy.yml` ships the SWA and has **no
paths filter**; `newsroom-ci.yml` ships the Function App and filters on
`newsroom/**`. Ancestry in one revision says nothing about the other.

**Why this is not just "check your subject" again.** That rule fires when a
reading looks wrong. This fires when everything looks right: the probe ran, the
controls discriminated, the answer was well-formed. There is no artefact to
disbelieve, which is the whole difficulty — a control converts *"can I trust
this number"* into *"yes"*, and that is precisely the conversion that stops the
next question being asked.

So the check is one sentence, and it is about the **mapping** rather than the
instrument:

> Write down the question in words. Write down what the probe varies. If a
> reading could come out the same for a reason unrelated to the question, the
> control cannot tell you.

For the reflog case: *"which session"* versus *"does this ref resolve"*. For the
ancestry case: *"live on the SWA"* versus *"contained in a Function App
revision"*. Both differences are visible the moment the two are written side by
side, and invisible while only one of them is written down.

This is the same family as *a total is satisfied by any partition* one level
out: there, a number was consistent with several methods; here, a *validated
probe* is consistent with several questions. **Comparing methods rather than
answers is what shows the first; comparing the question to what the probe varies
is what shows the second.**

**And the sharpest form: a planted fault is the control on a check, and it has
no control of its own.** This file tells you to plant a fault and prove a check
fires before believing it passes. Nothing tells you to prove the plant *applied*
— and a plant that silently did not apply produces `exit 0`, which is the same
artefact as a check that cannot fail.

Twice in one hour, independently, both while verifying a guard:

```
PowerShell .Replace()   did not match on line endings   -> reported "guard is dead"
[IO.File] + relative    Set-Location moves PS's cwd but NOT
                        [Environment]::CurrentDirectory -> edited a SIBLING WORKTREE
                           PS=pb-326  NET=samoletovs-friendly-sniffle
                           "substitution applied : True"   <- of the wrong file
                           vitest ran the untouched file   -> 8 passed, exit 0
```

The second is the nastier one and the reason this is not paranoia: in a repo
with worktrees the wrong path **exists and contains the same code**, so the read
succeeds, the substitution matches, and every intermediate signal reports
success. The reading was *"the new control does not catch a blinded scanner"* —
a confident, reproducible, false regression against the pull request's central
claim, which was in fact sound.

The remedy is one assertion and it is mechanical: **after mutating, read the
object under test back and assert the mutation is there** — at the level the
check reads it, not at the level you wrote it. Text said `applied: True`; the
AST is what said `REVISION reads in _revision_stamp: 1`, which is the thing the
guard actually inspects. Both instances were caught this way and neither was
caught by care.

**A third instance the same afternoon supplies the operational form, and a
nastier property: the failure can be selective, which reads as partial success
rather than as a broken instrument.** A harness ran 13 mutations against
`api/ai-insights/index.js` and reported 8 applied, 5 invalid — measured, the
split is exactly single-line anchors against multi-line ones:

```
the file          CRLF=416   bare-LF=0        (at 89048a1)
same anchor, two spellings:
  'temperature_2m || 0;\n'      occurrences: 0
  'temperature_2m || 0;\r\n'    occurrences: 1

single-line anchors applied   8 of 8
multi-line  anchors INVALID   5 of 5
```

So most plants work, and the ones that silently do not are the *structural*
mutations — the ones testing the most. `8 of 13` looks like five badly written
anchors; it is one broken instrument. The plant that vanished was the one for
the very defect that harness had been pointed at.

⚠️ **This paragraph used to blame the file, and the file is not the variable.**
It read *"a script writing `\n` in a multi-line anchor matches nothing in a CRLF
file"*, which is true only of a **byte-mode reader**. Another session ran
multi-line `\n` anchors against these same files and all of them landed.
Measured on one file, one anchor, two readers:

```
newsroom/pipeline/context.py      CRLF=993  bare-LF=0

                          contains CR   \n-anchor matches
  read_bytes().decode()      True              0
  read_text()                False             1
```

Python's text mode does universal-newline translation, so `read_text` hands you
`\n` whatever is on disk. **The variable is how you read, not what you read** —
and the remedy the old wording implies, normalising the anchor, is work you do
not need and a complication that hides the real rule: *match your reader to your
writer.*

The file already contained that fact and applied it to the wrong half. Three
lines below, the checking side is warned that `read_text` translates newlines —
correct, and never carried across to the matching side directly above it. The
concealing sibling, inside the entry about broken instruments.

⚠️ **And the obvious repair opens a worse hole.** Reading text-mode for the
mutation while snapshotting bytes for the restore is symmetric only while the
file is *pure*:

```
pure CRLF   before CRLF=3 bareLF=0   after CRLF=3 bareLF=0   unchanged
mixed       before CRLF=2 bareLF=1   after CRLF=3 bareLF=0   ALL ENDINGS REWRITTEN
```

One bare LF anywhere and a mutation silently rewrites every line ending in the
file. A byte-exact restore hides it **while the run completes** — interrupt
between mutate and restore and the tree carries a whole-file ending change that
no `git diff --stat` count would explain. That harness passed because both files
happened to be pure, which is a property of the environment rather than of the
harness.

So: **byte-mode on both sides, or text-mode on both sides. Never one of each.**

So state the assertion as a count, not a boolean: **a plant harness must count
its anchor's occurrences and refuse to report a verdict on anything but exactly
1** — zero is a no-op wearing a result's clothes, and more than one is a
mutation you did not intend. Normalise line endings on both sides before
matching. And note the sibling trap on the checking side: Python's `read_text`
translates newlines, so a CRLF-preservation check written with it reports
`False` on a file that was never touched. Compare bytes.

**And the same harness, one hour later, produced the two remaining failures —
both of which report success rather than an error, and neither of which the
anchor count can see.** They are worth stating because they are the last two
places a plant harness can lie.

**A plant's verdict must be a named assertion, not an exit code.** The harness
was run with `--reporter=basic`, which vitest 4 does not have. That is a
*startup error*, so every run exited non-zero — and every plant assertion is
"the suite fails". It reported **CAUGHT fifteen times while executing no tests
at all**:

```
15 plants   verdict CAUGHT   named failing assertions: 0
                             Error: Failed to load custom Reporter from basic
```

*The suite failed* and *the suite never ran* are the same exit code, so this is
a check that cannot fail arriving **inside the instrument built to prove checks
can fail**. The tell was in the output the whole time: zero named assertions
across fifteen plants is not a slightly-wrong regex, it is a suite that ran
nothing. So parse the failure *names*, refuse a CAUGHT verdict that names none,
and — the load-bearing half — **run a baseline before the first mutation and
stop if it is not green.** Every plant assertion is satisfied by an already-red
suite, so without that baseline the whole table is unfalsifiable.

**A harness's cleanup check must be derived from the plant list, not written by
hand.** A run was killed between writing a mutation and reverting it, leaving
`num()` as `return value ? value : null;` — which silently discards a genuine
0°C reading. The *"is anything still mutated?"* check then run enumerated
**seven patterns against eighteen plants**, and the survivor was in the gap:

```
patterns checked   7        plants that can mutate the file   18
                            reported: clean
```

That is this file's own enumeration rule arriving in the cleanup — the guard
walked a smaller set than its subject and reported success, in the direction
nobody re-checks. A pattern list cannot be inspected for completeness, so do not
keep one: **snapshot the file before the first mutation and restore from that
snapshot on every exit path, including a signal.** A byte comparison against a
snapshot has no set to get wrong.

It was caught only because the baseline control went red on the next run — the
control firing on its first genuine opportunity, against its own author's
contaminated tree. Which is the argument for the baseline in one line: *the
thing it protects you from is most often yourself, an hour ago.*

### The next probe fails for a different reason

Every row above treats one bad reading in isolation. In practice you fix the
cause you found and probe again — and **the obvious next probe may fail for a
different cause, so fixing the first one does not make the second reading
trustworthy.**

The clean case is a phrase wrapped across a line break, measured on `PROGRAMME.md`:

```
per-line grep for the phrase    0 hits    <- the NEWLINE defeats it
joined the file, then searched  False     <- the MARKER defeats it
markup stripped, then joined    True      <- for THAT file
markup stripped, TRIMMED, join  True      <- the general form

isolating the two:
  newline alone, naive join     True      <- a break alone does not break a join
  newline + "> ", naive join    False     <- the quote marker does
```

Naive joining produces `suspicious at the > right moment`: the continuation
marker lands *inside* the phrase. So the obvious remedy for the first failure —
"stop searching line by line, search the whole file" — returns a **second
confident absent**, and it is the same word `False` for an entirely different
reason. A reader who fixed one cause and believed the next reading would
conclude the text is missing, twice, with increasing confidence.

The reload count three paragraphs up is the same shape and was not read that
way: `framenavigated` failed because it was the wrong *event*, counting document
responses failed because the SPA fallback polluted the *population*, and only
`Sec-Fetch-Dest` asked the question intended. Three probes, three distinct
causes. That session got there by re-deriving each time rather than by trusting
the correction it had just made.

So when a probe fails, **the fix is a new instrument, and a new instrument needs
its own control** — one case that must be found and one that must not. The
stripped-join above is only believable because a phrase on a single line was
measured beside it. Otherwise "I fixed the grep" is a claim about the last bug,
not about the current reading.

**This section shipped with an insufficient remedy, and the rule above found it
four minutes later.** Verifying an unrelated claim in this same file, the
stripped-join returned `False` for a phrase that is plainly present:

```
1839 [  `revision_unavailable` with the reason instead, the two keys are mutually]
1840 [  exclusive, and `provenance` sets `additionalProperties: false` so an]

per-line                    0 hits   <- the NEWLINE
strip markers, join         False    <- the INDENT: no marker, so the spaces survive
strip markers, TRIM, join   True
```

The join yielded `mutually   exclusive`. In `PROGRAMME.md` the second probe
failed on a `> ` **marker**; here it failed on **leading whitespace** with no
marker at all — so even the *same* remedy fails for different reasons in
different files, which is the section's own claim one level deeper than it was
written.

**And a third cause, found by using that remedy on the clause two sections up.**
It reported the clause *absent* — from a phrase plainly present:

```
                                            strip+trim+join   +emphasis stripped
SUBJECT  "...same way, **on the same object**."     False            True
CONTROL  "**an absent result is a claim ... code.**" True            True
```

Emphasis **around** a phrase is harmless; emphasis **inside** it is fatal, because
the `**` lands in the middle of the span. So the family runs to three, and each
step is the previous step's remedy:

| Probe | Defeated by |
|---|---|
| per-line grep | the **newline** |
| naive join | the line-leading `> ` **marker** |
| strip-markup join | **inline `**`** inside the phrase |

**That remedy was wrong, and the way it was wrong is already forbidden three
sections down.** Strip `**`, then also `` ` ``, then also `_` is **a word list of
markup characters discovered one bite at a time** — each member added because it
bit. The family is not three deep; it is as deep as CommonMark has inline
constructs.

Measured across every prose sentence of 60–200 characters in the three books,
searching for the sentence a reader would quote:

| Remedy | AGENTS.md | PROGRAMME.md | DESIGN.md |
|---|---|---|---|
| strip markup + trim + emphasis (**as committed**) | 46.9% | 44.4% | 48.6% |
| **one normaliser, applied to both sides** | **94.6%** | **97.2%** | **96.0%** |

So the enumerative version returned a confident `False` for **more than half** of
this file's own prose. Backticks alone accounted for more misses than `**` did —
1.5× as many — and `**` was found first only because it happened to bite.

**The structural remedy is one function, applied identically to the needle and the
haystack**, comparing on alphanumerics only:

```python
def norm(s):
    s = re.sub(r'^\s*(> |//\s?)', '', s)          # line-leading markup
    return re.sub(r'\s+', ' ', re.sub(r'[^0-9A-Za-z]+', ' ', s)).strip().lower()
```

**That `.lower()` is not tidiness, and it was missing from this recipe for a
day.** Case is not a construct, so stripping punctuation never reaches it — and
the way it bites is systematic rather than a fluke: quoting a *sentence-initial*
phrase in the middle of your own sentence lowercases its first letter naturally.
The query and the source then differ by one character that carries no meaning,
and the comparison returns a confident `False`. Measured over every
sentence-initial fragment in this file's own prose, quoted that way — at
`3f3d5a3`, the commit before this paragraph existed, since adding it changes the
population it counts:

```
population                                403
the recipe as first written                 0     0.0%
the same recipe + .lower()                395    98.0%
CONTROL, a phrase never written           absent under both
```

Zero of 403 is not a marginal loss, and it is not a tautology worth waving away:
within that population the miss rate is **total**, which is exactly the shape a
reader cannot detect by inspection. It was found the only way it could be — by
using the recipe and getting a `False` for a sentence I could see on the screen.
The residual 2% is sentence splitting, the same as below.

No inline construct that is **purely punctuation** can defeat it — and
normalising *both sides with the same function* is what makes it total. The
earlier attempts each normalised one side, or normalised the two sides
differently, which is how `datastore_active` became `datastoreactive` on one side
and `datastore active` on the other.

**The obvious next claim — that *no* inline construct can defeat it — is false,
and the reason is worth more than the correction.** Stripping punctuation removes
the **delimiters**; it does not remove what the delimiters were **hiding**. So the
operation that makes this total against emphasis is exactly what makes it blind to
links:

```
CONTROL  bold inside a span   FOUND        <- the construct IS punctuation
CONTROL  inline code          FOUND

link, text != dest            NOT FOUND    "See the design book DESIGN md for rules"
HTML comment                  NOT FOUND    "It stays Free see era rg and never"
image                         NOT FOUND    "The tile grid tiles png is unchanged"
```

**The criterion, not the list:** a construct conceals only if the source carries
alphanumerics the **rendered text does not show**. That is what to apply; the
three rows above are illustration, not definition.

An autolink was in that list and does not belong: CommonMark renders
`<https://example.com>` with **the URL as its visible text**, so nothing is
hidden. The counterexample that put it there modelled the reader as *not* seeing
the URL, which deletes text they do see. Corpus control — every real autolink in
`DESIGN.md`, quoted as rendered:

```
autolinks in DESIGN.md   12      found  12/12
```

The brackets and `<!--` are punctuation and vanish — leaving the URL, the alt text
or the comment body sitting *inside* the reader's sentence.

**It bites once in this file today.** An earlier version of this paragraph said it
did not bite at all, on a span test that looked for the words *preceding* a link
only on the link's own line — where, all three being line-initial, there were
none. The haystack joins lines, so the preceding words are on the line before, and
the test was looking where they could not be.

Decomposed as `A T B` — words before, the link's text, words after — against a
haystack that holds `A T T B`, because a self-referential link normalises to its
text twice:

```
L166  nothing follows the link            A T   FOUND     no A T B case   SAFE
L339  nothing follows the link            A T   FOUND     no A T B case   SAFE
L392  " is the design book and ..."       A T B NOT FOUND                 BITES
```

**A quote breaks iff it starts before the link and extends past it.** So the two
safe links are safe for one reason only — **nothing follows them on their line** —
and a comma's worth of continuation would put them in the third row. That is a
much thinner margin than "immune", and it is the third different answer this
question has produced under measurement.

Note what does *not* save the third one: it is preceded by a heading and a blank
line. **A heading and a blank line do not stop a sentence being interrupted**,
because the joined haystack runs straight through them and so does any sentence
splitter built the same way.

Self-reference is what creates the duplicate: `[`X`](../X)` looks like text ≠
dest, but `../` and the backticks are punctuation and vanish, so both sides reduce
to the same words and the haystack carries them twice. **Line-initial position
does not help**, which is the trap — it only makes the preceding words live on the
previous line, where a careless probe will not look for them.

So the general rule is narrower and more useful than "links break it": **only a
construct that interrupts a sentence conceals anything.** A block-level HTML
comment costs nothing; an inline one does. A link on its own line costs nothing; a
link mid-sentence with a different destination does.

**And nothing checks any of this.** Two links are safe only because nothing
follows them, one already bites, and adding text after either safe link — or
pointing a link at a URL that does not match its text — moves it into the third
row. So: the vulnerability is real, **the count today is one**, and the margin on
the other two is a single clause of continuation.

**What it cost to establish that is the part worth keeping.** The claim that none
of them bit came from a measurement with controls, a denominator and a span
table — and it displaced a correct unmeasured instinct that they did. The
population was wrong in one respect nothing in the output could show: the span
test looked for preceding words on the link's own line, and the haystack joins
lines. **A plausible reading defends itself, and one decorated with the apparatus
this file recommends defends itself best of all.** Four measurements of the same
object; the answer changed three times. Do not treat this one as final either.

So: **total against constructs that are punctuation, blind to constructs that
conceal alphanumerics.** Where those are common — ordinary `[text](url)` prose —
resolve links to their text and strip comments before normalising, or render the
markdown and search that.

**And the operational rule, which is the transferable part: an enumerative remedy
cannot be inspected for completeness.** You cannot look at "strip `**`" and notice
`` ` `` is missing — nobody did, including the person who proposed it. But
`164/350` says so instantly. **Measure a remedy's coverage against real text with
a denominator; the miss rate is the only thing that can tell you a member is
absent.**

Not measured, and stated so rather than implied: inline links, nested and escaped
constructs, and the prose under `.github/`. The residual 3–5% above is sentence
splitting, not the normaliser. And
note what the reading itself is: `False` is produced both by *the phrase is
absent* and by *the phrase contains emphasis* — two states, one artefact, in the
instrument recommended for detecting exactly that.

**And the table assumes you have something correct to compare against, which is
its own failure point: a recollection is not a control.**

**And a recollection is not a query, either.** Checking whether a file says
something, by grepping *your own memory of what it says*, guarantees a false
absent the moment your recall drifts by one word. It drifted twice in one hour,
for two people, against the same section:

```
"an alternative you had not imagined"       False    <- recalled
"an alternative you had not conceived of"   True     <- the text

"read the artefact"                         False    <- recalled
"reading the artefact"                      True     <- the text
```

Both read as *the thing is missing*. Neither was. The tell is that a positive
control does not save you here — the control passes, because the instrument is
fine; it is the **query** that is wrong, and no amount of checking the probe
inspects its input. What settles it is reading the paragraph, which takes seconds.

So when verifying a quotation, search a **short distinctive fragment** you are
copying rather than recalling, or read the passage. And note this is the one
place the question at the head of this file is no help: *my own quote is
misremembered* is not a second state anyone enumerates, which is exactly the
limit that section states about itself.

Verifying *this* entry hit the neighbouring rule and nearly retracted a true
finding — and **the diagnosis committed here was itself wrong**, which is the
better half of the story.

I wrote that the second instance failed to reproduce *because a later commit had
added the phrase* — a different tree. Another session hit the same wall, and
measuring the two axes separately settles it:

```
                  section only    whole file
30d4ac7             False           True
master              False           True
```

**Scope explains it entirely; the SHA explains nothing.** The phrase is absent
from the section and present in the file at *both* commits. I had widened the
search from *the section* to *the whole file* and, finding a plausible culprit in
a commit I knew I had made, attributed the discrepancy to the tree. The wrong
axis, chosen because it was the one I had a story for.

So the drift is not only in the remembered *phrase*. It is in the remembered
**scope** — "search the section" recalled as "search the file" — and it has the
same signature and the same blindness to a positive control, because the control
passes in either scope. Two instances, one each way, on the same evening.

The remedy is the one above, applied to the qualifier: **copy the scope out of
the claim you are checking rather than recalling it.** And when two things changed
between a working reading and a failing one, vary them **one at a time** — the
2×2 above took one command and would have caught it immediately.

It reproduces exactly at `30d4ac7`, in the section, with controls. State the SHA
*and* the scope; a finding is only as reproducible as its narrowest qualifier.

**A third axis, and this one belongs to the writer rather than the reader.** A
rule was stated in a session message and then committed to this file, and the
two wordings were never the same string. Measured on `af19194`, the commit
*before* this paragraph existed — which is the scope this entry needs, because
writing it down puts all three strings back into the file:

```
searched  "control should assert"      0     <- the message's wording
the file  "control must assert"        1
searched  "never a recorded reading"   0     <- also the message's
```

The reader's check was **faithful** — they searched the phrasing they had been
sent, verbatim, which is exactly what the remedy above prescribes. The drift was
the *writer's*, between a sentence typed into a message and the sentence that
later landed in the file. Nothing reconciles those two, and a copied fragment
is no protection when the thing you copied it from is not the thing you are
searching.

What earns it a paragraph is the **consequence**, which is worse than a mislaid
fact: the false absent's output was an instruction to *write the section again*.
Acting on it would have committed a second copy of a rule already on master —
and this file's own position, three sections up, is that two copies of a fact
drift immediately and in the direction nobody is watching. **A false absent
about prose does not lose information; it manufactures a duplicate.**

So when a check concludes that something is not written down, search for its
**subject** rather than for its sentence. A sentence is a string somebody chose
once; a subject survives rephrasing — same commit, same reason:

```
decay              2 hits      <- either subject finds it
positive control   6 hits
quaternion         0 hits      <- CONTROL, the probe can still say no
```

A session measuring page height under a simulated outage read `6574px` and
concluded the page got *taller* — because it compared against a ~5000px figure
half-remembered from an audit days earlier, on a different build. Measuring the
healthy case in the same session gave `13157px`, and **the sign inverted**: the
empty states are half the height of the real charts, so the collapse it was
about to implement would have made things worse.

The manager did the same thing in this file, writing that it *"grew by eight
sections in one day"*. Diffing the headings against the evening's starting
commit gave **five** — the others had extended existing sections, which is
precisely the distinction that paragraph was drawing.

Both numbers were plausible, neither was absent or absurd, and no row above
catches them, because **the fault is in the baseline rather than the reading**.
So when a measurement is a comparison, measure both sides in the same session,
on the same build. A remembered figure has no provenance, no timestamp and no
control — it is a claim wearing a number's clothes.

**And the whole table assumes a reading exists. The failure it cannot see is
the claim you never measured at all.**

Every row above tells you to distrust something you read. A fourth kind has no
reading to distrust: you remember the fact, state it, and never open an
instrument. Two instances, from two sessions, on the same day the rest of this
section was written:

- A session quoted a **verbatim blockquote** from `#177`'s body in `#182`'s
  description. The sentence was not in `#177` — it was from a handoff message
  composed minutes apart from the same thought. The substance survived; the
  quotation did not. It was published in a pull request whose own argument is
  that a description is not the thing it describes.
- The manager wrote **"95 PRs merged"** while correcting someone else's stale
  count, having incremented 94 for a commit that was a direct push and never a
  PR. Measured immediately afterwards: still 94.

Neither is absent, plausible-but-wrong, or absurd, because neither came from a
probe. And note where they landed: one in a PR description, one in a status
line — **prose, where no reader expects a citation, rather than a code block,
where everyone does.** A number inside a fenced block reads as measured and
invites *"measured how?"*. The same number in a sentence reads as known.

There is no clever fix. The remedy is the boring one: **open the artefact, or
mark the claim as remembered.** What the taxonomy can offer is the tell —
if you cannot say what command produced a figure, you did not measure it, and
the fluency with which you can say it aloud is not evidence.

The two above were caught by an outside reader and by the author's own habit of
re-counting, respectively. Neither was caught by a rule, and this entry does not
pretend it would have been.

## State the SHA you measured, not the branch

The rule above fires on an empty reading. **The failure it does not catch
produces a perfectly plausible one**, and that is the more dangerous case,
because a plausible value invites no second look.

A session closing out its track measured the deploy-race recovery in real
Chromium against a real build, blocked a lazy chunk, counted document requests
and cross-checked `sessionStorage`. It reported:

```
LAZY CHUNK 404   document requests: 1     <- no reload
                 handler tests el.tagName === 'SCRIPT' and reads el.src,
                 while a LINK carries href, so the case is filtered out
```

Every word of that was true, of the commit it was measured on. Master then
recovered, the message describing the earlier tree arrived after, and the
manager read a live regression into it:

```
b5fb6ad  then-current master, 20:55   tagName === 'LINK': 0     <- measured here
a142621  #174, merged 21:16           tagName === 'LINK': 1
         re-measured 21:18            lazy chunk: 1 -> 2 requests, RELOADED
```

**Neither party was measuring the wrong tree.** The session measured master
correctly, twice, and reported both. What failed was the *handoff*: a finding
that says "the lazy case does not recover" is true only of a commit, and the
commit was not in the message.

The manager's diagnosis — that the session had used a 51-commit-stale worktree —
was **wrong, and unfalsifiable from the evidence he had.** That branch lacked
the `LINK` handler, and so did then-current master; **the two hypotheses produce
the identical observation.** He picked one and wrote it into this file as a
worked example, three sections after writing that an example in guidance is a
claim about behaviour and must be executed. The session checked its reflog and
sent it back.

So the fix is not a check on your own tree, which here would have printed `0`
and changed nothing. It is one line in the report:

```
measured on b5fb6ad          # not "on master", which means something else by
                             # the time anyone reads it
```

**A branch name is a moving reference; a SHA is a claim that stays true.** In a
programme where several sessions merge into one branch through an afternoon,
every message describing "master" describes a different tree from the one its
reader will check, and the gap is invisible from both ends.

The same applies to *when*, and it costs one field. A report saying
`open PRs: 1 (#175)` was read four hours later as a stale snapshot; it was a
live API call made **inside a four-minute window**, and the `21:28` beside it
was Riga time, read as UTC by someone three hours behind it:

```
#175  created 18:28:38Z   merged 18:32:51Z   open for 4.2 minutes
      observed 21:28 local (UTC+3) = 18:28Z  -- seconds after it opened
```

So: `observed 2026-08-27T18:28Z`, not `21:28`. **An instant with a zone is
unambiguous to a reader in another timezone four hours later; a wall clock is
not.**

And the failure that nearly followed is worth more than the fix. Three
apparently-stale reports in one evening tempted the manager into a general
rule — *an idle session's view of PR state is not evidence* — which was
retracted on measurement. `gh pr list --state open` is a live API call with no
cached view to go stale; that reading was correct, and it is the only reason
#175 was reviewed at all against a close-out claiming zero open PRs.
**A rule that dismisses a class of reporter suppresses their true findings with
their false ones**, which is a check that cannot produce a finding — the thing
this file exists to argue against, arriving as a management heuristic rather
than as code.

And that is why a bad rule belongs in this file where a bad number does not:
**a wrong measurement is falsifiable by re-measuring, whereas a wrong
generalisation removes the evidence that would falsify it.** This one would have
made the next correct open-PR report inadmissible — so the check that could have
caught it was the first thing it disabled.

Two things survive from the wrong diagnosis, because they are true independently
of it. **A rigorous instrument produces a confident, well-evidenced conclusion,
which survives review in a way a sloppy one does not** — that session's work was
excellent throughout, including catching a defect in its own first instrument
(`load` cannot count reloads when the bundle 404s, because such a page never
reaches `load`). And a plausible reading like `document requests: 1` never
triggers *print the shape*, because nothing about it looks absent. That
limitation on the rule above is real; it just was not what happened here.

## A permission is not a capability — resolve one real example through it

A flag that grants something reads as evidence the thing happens. It is not:
between the grant and the act there is usually a lookup, and the lookup can
fail for reasons the grant knows nothing about. **The flag then documents an
intention while the behaviour is dead, and nothing anywhere disagrees.**

Three instances, all live in this repo on the same morning:

```
GRANTED                                    ACTUAL
document_fetch_allowed: true               ec.europa.eu claimed by two sources,
  on ec_presscorner, feed HTTP 200          so _index_by_host dropped it ->
  with 10 items                             every Commission URL unresolvable,
                                            0 documents ever fetched

"they will be thrown away"                 _admissible checked quantities,
  in the panel's system prompt              bases and citations, never
                                            specificity -> discarded: 0, ever

NEWSROOM_SEARCH_PROVIDER                   was set nowhere in infrastructure/,
  a supported, documented setting           so search_provider() returned the
                                            null one and discover() returned []
```

Each is *separately* covered by a rule above — the first is two states with one
artefact, the second an example that was never executed, the third absence
resolving to success. What they share is the **place to look**, and it is
cheap: for every permission the system grants, resolve one real example all the
way through the code path that consumes it.

That is a shape rule, so it can be run rather than recognised. Take each
boolean permission and each declarative claim about enforcement, and ask what
input should be *accepted* and what should be *refused*; then execute both. The
Commission collision took one call to find:

```python
registry().resolve_feed_item({"link": "https://ec.europa.eu/eurostat/web/..."})
# UnregisteredSourceError -- against a source configured document_fetch_allowed
```

**And the obvious fix for the third one was another instance of the fault.**
Worth recording, because it happened to someone who had just written this
section. `NEWSROOM_SEARCH_PROVIDER` was duly added to `main.bicep`, which reads
as reviewable configuration and is a dead knob **twice over**:
`newsroom-ci.yml` publishes code and sets `NEWSROOM_REVISION` only, so it never
applies the template — and `search_provider()` returns the null provider for
`brave` with no key regardless, so the templated half could not have taken
effect even once deployed.

`test_deployed_settings.py` caught it, and note what kind of test that is: it
compares the template against a **recorded observation of the running app**,
which is the consumer-side check this section asks for, one layer out in the
infrastructure. Declaring the setting is the grant; the app carrying it is the
capability. The two are now set together, out of band, in the single command
that actually does something — and a comment sits where the parameter was, so
the next person does not add the knob back.

**The tell is a permission with no consumer-side test.** A grant is trivially
easy to assert (`assert source.document_fetch_allowed`) and that assertionpasses on a source that can never be reached, because it re-reads the config
rather than exercising the path. Same failure as a guard that rebuilds the
logic it guards: it agrees with the declaration instead of testing the
behaviour.

And note the asymmetry that keeps these alive. A permission wrongly **granted**
is found the day it is abused. A permission granted and never **exercisable**
is found by nobody, because every observable — the config, the tests, the logs,
the published artefact — is consistent with the feature simply having nothing
to do today.

## Write an exemption as an assertion, not a filter

An exemption for a known offender is often right: naming one and attributing
it beats widening a route list, and beats letting a red check become
wallpaper. But **the shape you write it in decides whether it removes itself
when the offender is fixed, or lives on forever matching nothing.**

Two shipped this programme and both were filters.

```js
// tests/reducedMotionLayout.live.test.ts -- /corrections overflowed by 42px
const KNOWN = /^320px \/corrections: maxScrollLeft 4\d /;
const unexpected = offenders.filter((o) => !KNOWN.test(o));
expect(unexpected).toEqual([]);
```

`#169` fixed that overflow. `KNOWN` then matched nothing, `filter` removed
nothing, and the test went on passing with a dead clause inside it — its own
comment said *"so it is deleted when it is fixed"*, and nothing deleted it. The
same evening, `functionSecurityHeaders.test.ts` carried a list of endpoints
allowed to have no rate limiter; `track-login` was the only member, and when it
was fixed and then removed the list had to be deleted by hand as well.

**A filter cannot notice that it has stopped matching.** An assertion can, and
the repo already contains the correct form:

```js
// tests/typecheckGate.test.ts -- five files excluded from the typecheck
expect(excluded.sort(), 'a new exclusion hides an error rather than fixing it')
  .toEqual([...KNOWN].sort());
```

Fix one of those files and remove it from the config, and `excluded` no longer
equals `KNOWN`: the test goes **red**, and the only way to make it green is to
update the list. The exemption forces its own retirement. Its comment gives the
other half of the reason — a named list makes "exclude one more" a reviewable
change rather than a number quietly going up.

So: **state the exemption as an equality against the full set, not as a
subtraction from it.** `expect(offenders).toEqual([...KNOWN])` rather than
`expect(offenders.filter(not(KNOWN))).toEqual([])`. Both pass today; only the
first fails the day the exemption becomes a lie.

The distinction generalises past exemptions, and it is the same asymmetry as
everywhere else in this file: **a thing that fails loudly when it stops being
true needs no one to remember it; a thing that fails silently needs a human,
and eventually will not get one.** A permanent, justified exemption — such as
`design-system.test.ts` excusing `ThemeContext.tsx` from the colour rule,
because that file *is* the theme — is a different case and may stay a filter,
since it is not waiting on a fix.

**But "permanent" is a narrower category than it sounds, and the test is not
"do I plan to change it".** It is: *do I control the fact this depends on?*
`ThemeContext.tsx` is definitional — it is the theme, and nothing anyone else
writes can make that untrue. Compare `test_collector_matches_dashboard.py`,
which excused `rep_mar` because the newsroom pins a country while `ports.js`
builds the value per port — `'rep_mar=' + encodeURIComponent(c)` at line 96 —
so there is no fixed value on the dashboard side to compare the newsroom's
pinned one against. Entirely legitimate — and it stops being true the day
someone writes a literal value into `ports.js`, at which point the exemption is
silently excusing a real disagreement about which **country** is being read.

So: **an exemption that rests on someone else's code is never permanent,
because you are not the one who decides.** It is contingent, it belongs in an
equality, and the equality is what tells you the day the contingency lapsed.

## Mark the guess in a brief

Work dispatched between sessions arrives as a brief, and a brief is written from
a **symptom** that has usually hardened into a **location** by the time it is
read.

> `comparison_basis_stated` is 5 of 6

is a true observation about a counter.

> the instruction upstream is thin

is already a hypothesis wearing it. **Nothing in the handoff marks where one
ends and the other begins**, so a session that acts faithfully implements the
guess, and does it in the place the guess named.

Three briefs this programme were wrong in exactly that way. Two named the wrong
location — the indicator gap was in the *collector*, not the registry it blamed;
`comparison_basis_stated`'s failures were in the *check*, not the writer it
blamed. The third named a fault that did not exist at all: a dek rule reported
as unenforced was being obeyed 17 times in 18, and the instrument it asked for
would have fired once and destroyed correct work.

All three were caught, and only because the briefs said *"my guess is"* out
loud. **A brief that named the same location without a guess-marker would have
been implemented.** That is a property of the format, not of the reasoning —
a manager working from production output at a distance *should* be wrong
sometimes, and the alternative is not sending briefs.

So separate the two explicitly, every time:

```
OBSERVED   the counter, the log line, the failing assertion — with the number
GUESS      where I think it comes from, marked as a guess
ASK        measure the guess before implementing it; report if it is wrong
```

The cost is one line. The return is that a session knows which part it is
allowed to overturn — and the overturned briefs were worth more than the
correct ones, because a correct brief only produces the work already imagined,
while a wrong one produces a measurement of something nobody had reason to
measure.

### Why the handoff works, and why more care would not

**The measurement defines the shape of the fix.** Having proved a defect, you
fix the thing you proved — and what your measurement did not reach is invisible
precisely because it is what you were not measuring.

Two instances, one session, both verified:

- It demonstrated that an anti-vacuity guard passes on **zero** tests, then
  proposed `assert tests` — which closes the zero case and leaves a file split
  unguarded, because the retained half has a non-zero count.
- It measured branch reachability, concluded a pull request was not its own, and
  **named the author**. `git branch -r --contains` on a squash commit cannot
  return the originating branch — it excludes the true answer by construction
  and reports branches cut from master afterwards.

The second is the sharper one, and the reason is uncomfortable: **its conclusion
was correct.** The PR genuinely was not theirs. And that is what stopped the
re-examination — in their words, *a correct conclusion is the strongest
anaesthetic against re-examining the instrument that produced it.*

A wrong answer eventually collides with something. **A right answer reached by
a broken instrument collides with nothing, ever.** The one-liner had the same
property: it worked, on the case that had been measured.

So this is not "the measurer should be more careful". Care is aimed at
correctness, and correctness is not the failing property — being right is what
removes the only signal that would have made you check the *shape*. That is why
the remedy is structural: **whoever proved the defect states it; someone else
chooses the fix**, or at minimum reviews the fix's reach rather than its
result. Every instance in this file that was caught was caught by someone who
had not done the measuring.

## One generation is not a measurement

The writer, the analyst and the desk are stochastic. Sampling one of them once
tells you what it did once, and a single sample is routinely mistaken for a
verdict — in both directions.

The denominator fact in `#129` is the clean case. Sampled five times against
the same signal, it used the intended direction contrast **four times**, and
once rendered the same fact as a flat level comparison. The first sample drawn
was the one-in-five. Reporting it alone would have retired a feature that works
in 80% of outings; reporting a single *good* draw would have claimed one that
works in 20%. Nothing about the artefact tells you which kind of draw you are
holding.

So **sample a stochastic stage several times before concluding anything about
it**, and report the rate rather than the instance. Five is enough to tell 80%
from 20%, which is the distinction that usually matters. State the denominator:
"4 of 5" is a measurement, "it works" is an anecdote.

The corollary is about what to do with a minority failure. Ask whether it is
*wrong* or merely *weak*. A draw that states something true but less
informative costs one paragraph; a gate that rejects it costs the whole article
and the six model calls that produced it. **Prefer sharpening the prompt to
adding a check** — a prompt cannot reject a true article, and a validator that
fires on a true sentence is a worse defect than the one it was built to catch.

This belongs to the same family as the two rules above it: a measurement that
cannot answer the question it is posed. A word list agrees with its author's
imagination; a single generation agrees with whichever draw you happened to
take; and a comparison between two stages of a pipeline where one already
filters the other — as `publishable` does before the desk ever runs — is empty
by construction and will report a confident zero. Before measuring, ask what
result would look identical whether the hypothesis is true or false.

## A merged pull request is not proof that the branch head merged

`gh pr merge` merges the SHA **the pull request record holds**, which is not
always the SHA the branch actually points at. After a force-push, or when
GitHub's ref sync lags, the PR can stay pinned to an older commit while
`git ls-remote` and the git-ref API both report a newer one.

This happened here, and it cost two commits. `#146` was merged while its record
held `010634b`; the branch was at `462cc17`. The mirror landed and a truth fault
in `detect_streak` — counting *readings* while claiming *consecutive periods* —
did not, along with a collision test for a live crossing. Both had to be
rebuilt as a second pull request.

The failure is silent in both directions. The pull request shows as merged, CI
was green on the stale tree, and nothing anywhere says a commit was skipped.

**It recurred on `#311`, and the second instance is more instructive than the
first, because the divergence was seen and announced before the merge.** The
author pushed a correction, watched three sources agree on the new SHA while
the PR record alone lagged, and said so in writing:

```
git ls-remote / git-ref API / commits?sha=   a813f5d
gh pr view --json headRefOid                 31fc33b     stale, 6 polls / ~2 min
```

It merged `31fc33b` anyway, so the correction commit never landed and three
defects the author had already fixed had to be fixed again on master by someone
else. **Knowing about the trap, and announcing it, protected nothing** — a hold
expressed only as a message to the author is not binding on any other session
that can press merge. The lag is minutes, not seconds, so waiting it out is a
real option; the mechanism that makes a hold visible to a third party is not
something this repo has.

It also defeats the obvious way of reviewing a change before merging it: fetch
the branch, merge it locally onto master, run everything, then merge the pull
request. **That verifies one tree and lands another** — the same shape as a
guard reading a different object from the behaviour it guards, one level out
in the tooling.

So before merging anything, compare the two:

```powershell
git ls-remote origin <branch>                  # what the branch really is
gh pr view <n> --json headRefOid -q .headRefOid # what the merge will use
```

If they differ, push an empty commit or re-target the pull request until they
agree. And after merging something whose content you care about, assert the
content is on master rather than trusting the merge — `git show
origin/master:path | Select-String <the thing>` takes seconds and answers the
question the pull request's own status cannot.

**And the inverse is a trap of its own: a branch head missing from master is
not evidence that a pull request is unmerged.** With squash merging it is
*guaranteed* missing — the merge creates a new commit and the branch head never
becomes an ancestor of anything.

```
git branch -r --contains 39e7251   ->  origin/samoletovs-...  (only the branch)
678f5e5 ancestor of origin/master  ->  True                   (the squash commit)
content at L77, L390, L418         ->  present on master
```

All three are true simultaneously, and only the first looks like "not merged".
This has misled twice. An audit of 89 branches that appeared to hold unmerged
commits — the squash artifact, every one. And a reading of `--contains <branch
head>` that produced the `#146` signature: *a merged pull request whose content
did not land*.

The second is the instructive one, because **recognising the artifact is not
enough to dismiss it.** The session that hit it identified the squash cause
within seconds and still could not rule out a bad merge from that check alone —
it had to go to the content. A reading that is explained is not thereby
disproved: `--contains` returning nothing is *consistent with* a squash merge
and *also* consistent with the merge that dropped two commits in `#146`, and
nothing about the reading separates them.

So settle merge state on the **squash commit** or, better, on the **content**:

```powershell
gh api repos/<owner>/<repo>/pulls/<n> --jq '.merged'
git show origin/master:<path> | Select-String <the thing>
```

The content check is the only one no cache, mirror or stale view can fake, and
it is the one that answers what you actually wanted to know.

## Measuring the newsroom after a change

**A green deploy job means the package was uploaded, not that the app is
serving it.** Triggering a run straight after a merge measures the *old* code,
and the result looks exactly like a run of the new code that failed.

This has now produced two invalid measurements. The second: `#99` added a
deterministic cut for empty closings, the deploy job for `a10f21a` went green at
08:48:26Z, a run triggered minutes later published

> *"The next quarterly release of containerised cargo figures for 2026-Q2 will
> show whether this record high can be sustained."*

— the precise sentence the cut removes. The natural reading is that the fix does
not work. It works: replaying that exact body through `apply_house_style(...,
cut_empty_closings=True)` on the merged tree cuts the paragraph. What was
measured was Azure still serving the previous package.

So a run triggered inside the deploy window is not evidence about the merged
code, in either direction — a pass does not confirm the fix and a failure does
not refute it.

**Do not settle this by waiting longer.** "Long enough" is a guess, and the
failure mode is silent. Two ways to actually know:

- **Replay locally against the merged tree.** For anything deterministic —
  house style, the validator, the checks — construct the artefact and call the
  function. It answers the question in seconds and needs no deployment at all.
  This is what distinguished "the fix is broken" from "the fix was not running".
- **Read the revision out of `provenance`.** This was written here as a
  suggestion — *"an article records its `model` and `prompt_version` but not the
  revision that produced it"* — and it has since been built, so the suggestion
  had become an instruction to implement something that already exists.

  Every article now carries the deployed SHA, supplied by the deploy rather than
  committed to the tree. Verified in production on 2026-08-28T09:24Z:

  ```
  article   baltic-road-freight-gap-widens-...-630368
  generated 2026-08-27 17:10:46Z
  revision  92d2ffa8b0a670b7b36b1816d69fa53937301cb5
            -> 92d2ffa "Stop the plan asking for a mechanism the brief
               does not have (#168)", on master, merged 17:02:26Z
  ```

  Eight minutes between the merge and the article, read rather than inferred.
  So *"was this generated by the code I think?"* is now a lookup: fetch the
  article JSON from the blob base in `deploy.yml` and resolve
  `provenance.revision`.

  And note how it handles not knowing, because it is the pattern the rest of
  this file argues for: when `NEWSROOM_REVISION` is unset the artefact carries
  `revision_unavailable` with the reason instead, the two keys are mutually
  exclusive, and `provenance` sets `additionalProperties: false` so an
  undeclared key fails the schema on the way out. **An absent revision cannot
  be mistaken for a known one**, which is the whole difficulty this bullet was
  originally about.

## What earns a section in this file

This document gained five sections in one day — and declined five more — which
is the point at which a list of hard-won rules starts becoming a list of true
observations, and those are not the same thing. **A taxonomy that admits every
true observation stops being a filter** — the same failure as an exemption list
nobody prunes, one level up.

Two tests, and a candidate must pass both.

**Does a reader do something differently?** A reason without a distinct action
belongs *inside* an existing section, not as a new one. "The method
self-corrects only within the class of faults it can see" is true, sharp, and
was declined on exactly this ground: `read the artefact` already tells you what
to do, and that sentence only tells you why.

**Is there more than one instance?** One occurrence is an anecdote, and this
file already says so under *one generation is not a measurement*. Five
candidates were declined in a single evening on that basis, including two that
were more elegant than several of the entries that were kept — a control that
passes for the wrong reason, and a prohibition that is its own first violation.
Both are recorded in the programme log instead, and either earns a section the
day a second instance appears.

The corollary is the part that actually bites: **the standard has to survive its
author.** The same evening it was written, it was applied to the author's own
findings, to a correction of an over-broad claim he had made an hour earlier,
and to a rule he had stated to another session and had to retract. A standard
only ever gets tested where it costs something.

And when a candidate fails these tests, **write it where it will be found**: in
the file it concerns, next to a test that pins it. Knowledge inside the code it
governs outlives a paragraph someone reads once.

### Prefer a rule that names a shape

Two kinds of entry live here, and only one of them can be *pointed at code
nobody has read yet*.

A **shape** rule names a syntactic form: an exemption written as a subtraction
rather than an equality; a loop that is a test's entire body; an example in
guidance that has never been executed. You can grep for it, and you can mutate
the code to check the rule fires.

A **habit** rule — *read the artefact*, *a word list encodes your examples* —
is true, is often the more important of the two, and cannot be swept for. It
fires when someone already has the artefact in hand.

**And the numbers below are not a ranking.** A shape rule fires in seven
minutes because it can be *executed*, which makes it cheap rather than
important. Reading the artefact produced `#171` — nine of nine rejections were
false positives, the check was wrong and the writer was not — and `#176`, a
prompt teaching that a construction is rejected when it never was. Neither is a
syntactic form; both needed someone to read prose and judge it wrong, and no
greppable rule could have reached either.

So: **a shape rule is what you write down for other people; a habit rule is
what you practise.** A programme with only the first would ship faster and find
less.

The difference is measurable. Two shape rules were written this programme and
each produced a pull request against code they were not written about, in under
seven minutes:

```
2026-08-27T20:18:03Z  "write an exemption as an assertion, not a filter"
2026-08-27T20:24:54Z  -> #177: adding `geo` to NOT_COMPARED left 207 tests green

2026-08-28T06:50:58Z  "an exemption resting on someone else's code is never permanent"
2026-08-28T06:56:43Z  -> #182: the exemption whose premise nothing re-checked
```

No habit rule did that, and none was expected to. So when writing an entry, say
which kind it is — and if it can be given a shape without becoming false, give
it one, because that is the difference between a rule that waits to be
recognised and one that can be run.
