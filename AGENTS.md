# portaBaltica — Agent Instructions

## Project overview

Baltic open data intelligence dashboard. Evolving from a maritime-only dashboard to a full Bloomberg-style data platform covering 44+ Latvia government APIs across economy, property, energy, environment, transport, and business intelligence.

## Tech stack

- **Frontend:** React 19, TypeScript 5.9, Tailwind CSS 4.2, Vite 8
- **Backend:** Azure Static Web App managed functions (JavaScript)
- **Data sources:** data.gov.lv CKAN API v3, Open-Meteo, Elering (NordPool), ECB, CSP PxWeb
- **Hosting:** Azure Static Web Apps (free tier) at portabaltica.naurolabs.com
- **Theme:** Dark ocean theme with custom `ocean-*` color palette

## Architecture

```
portaBaltica/
├── src/                    # React frontend
│   ├── App.tsx             # Main dashboard with tile layout
│   ├── api.ts              # All API fetch functions
│   ├── types.ts            # Shared TypeScript interfaces
│   └── components/
│       ├── Header.tsx       # Dashboard header
│       ├── InsightsBanner.tsx # AI-generated insights
│       ├── EconomyTile.tsx  # Economy & Business data
│       ├── PropertyTile.tsx # Property & Energy data
│       ├── EnvironmentTile.tsx # Weather, air quality, population
│       ├── MaritimeTile.tsx # Port data (original functionality)
│       ├── PortCard.tsx     # Individual port card
│       ├── ShipVisitsPanel.tsx
│       ├── FerryPanel.tsx
│       └── CargoPanel.tsx
├── api/                    # Azure SWA managed functions (JS)
│   └── src/functions/
│       ├── port-data.js    # Maritime data proxy (existing)
│       ├── economy-data.js # ECB, NordPool, CSP, business registries
│       ├── property-data.js # Construction, energy certs, cadastral
│       └── environment-data.js # Weather, air quality, population
├── newsroom/               # News pipeline contracts (personas, sources, schema)
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
- Maritime components (PortCard, ShipVisitsPanel, FerryPanel, CargoPanel) are preserved as-is within the Maritime tile

## Data source patterns

- **CKAN Datastore:** `fetch('https://data.gov.lv/dati/api/3/action/datastore_search?resource_id=ID&limit=N')`
- **Open-Meteo:** Direct client-side fetch (CORS-enabled)
- **ECB rates:** `fetch('https://www.bank.lv/vk/ecb.xml')` — parse XML
- **NordPool/Elering:** `fetch('https://dashboard.elering.ee/api/nps/price?start=...&end=...')`
- **CSP PxWeb:** POST JSON query to `https://data.stat.gov.lv/api/v1/lv/OSP_PUB/`
