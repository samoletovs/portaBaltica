# portaBaltica — Agent Instructions

## Project overview

Baltic open data intelligence dashboard. Evolving from a maritime-only dashboard to a full Bloomberg-style data platform covering 44+ Latvia government APIs across economy, property, energy, environment, transport, and business intelligence.

## Tech stack

- **Frontend:** React 19, TypeScript 5.9, Tailwind CSS 4.2, Vite 8
- **Backend:** Azure Static Web App managed functions (JavaScript)
- **Data sources:** Eurostat dissemination API (JSON-stat 2.0), data.gov.lv CKAN API v3, Open-Meteo, Elering (NordPool), ECB, CSP PxWeb
- **Hosting:** Azure Static Web Apps (free tier) at portabaltica.naurolabs.com
- **Theme:** Dark ocean theme with custom `ocean-*` color palette

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
│   │   └── ports.js        # Baltic port registry + Eurostat maritime cubes
│   ├── baltic-compare/     # LV vs EE vs LT from Eurostat
│   ├── historical-data/    # Latvian series: CSP PxWeb, Eurostat fallback
│   ├── power-prices/       # Nord Pool day-ahead + zone spread
│   ├── port-data/          # Baltic port statistics from Eurostat (?country=)
│   ├── economy-data/       # ECB, NordPool, CSP, business registries
│   ├── property-data/      # Construction, energy certs, cadastral
│   ├── environment-data/   # Weather, air quality, population
│   ├── system-status/      # Health probes for every upstream
│   ├── news-rss/           # /rss.xml — our own articles only
│   └── news-sitemap/       # /sitemap.xml
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
- Use the existing `ocean-*` Tailwind color palette for all new components
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
- **Open-Meteo:** Direct client-side fetch (CORS-enabled)
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
- **Stamp the code version into `provenance`.** An article records its `model`
  and `prompt_version` but not the revision that produced it, so which code
  wrote it is inferred from timestamps rather than read. With the deployed SHA
  in provenance, "was this generated by the code I think?" stops being a guess.

