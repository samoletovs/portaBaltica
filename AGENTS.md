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
└── infrastructure/         # Bicep IaC (future)
```

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
