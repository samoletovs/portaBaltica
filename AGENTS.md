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
  the MIG_* codes return all-null series and every aggregate code is rejected
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
| `migr_asyappctzm` monthly asylum | HTTP 413 unpinned, 400 pinned | Newsworthy; codes unresolved. Worth another attempt. |
| Statistics Estonia (`andmed.stat.ee`) | HTTP 200, 224–518ms, **PxWeb** — the protocol `api/historical-data` already speaks | Technically cheap, strategically wrong: buys depth in one country and manufactures the asymmetry the Baltic grid exists to avoid |
| Statistics Lithuania (`osp-rs.stat.gov.lt`) | HTTP 200, 2386ms, **SDMX 2.1**, 7.3 MB dataflow catalogue | Different protocol entirely, for the same strategic cost |

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
`2026-W28` and `2026-W31` share July, so a month index would have swapped an
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
worth little without that. `freshness` is still the only zero-reader field of
the eight today — not read, not even declared in the client's type — and that is
*not* a defect: the client recomputes the verdict itself because only one of the
two upstreams sends one, and a rule that applies to Latvia and not to Estonia is
worse than no rule.

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

And note where all three defects were found: **at the reporting layer, by
reading the output.** Not one is reachable from a test of the producer, because
the producer was right every time.

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
same way. This costs one extra assertion and it is the only thing standing
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

**And the table assumes you have something correct to compare against, which is
its own failure point: a recollection is not a control.**

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
