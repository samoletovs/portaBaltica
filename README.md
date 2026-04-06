# portaBaltica

Baltic data intelligence platform — real-time economic, trade, labour, energy, and environmental indicators for Latvia, Estonia, and Lithuania.

**Live:** [portabaltica.naurolabs.com](https://portabaltica.naurolabs.com)

## What it does

A Bloomberg-style dashboard aggregating 30+ indicators from government open data across three Baltic countries. Cross-country comparison, time series charts, and live operational feeds.

### Coverage by section

| Section | Indicators | Countries | Source |
|---------|-----------|-----------|--------|
| **Economy** | GDP, salary, CPI, unemployment, house prices, retail, industrial output, population, electricity | LV, EE, LT | Eurostat, NordPool, ECB |
| **Trade** | Exports, imports, trade balance, PPI, hotel occupancy, tourist arrivals | LV, EE, LT | Eurostat |
| **Government** | Revenue, debt, debt/GDP, deficit/surplus, consumer confidence, current account, inequality | LV, EE, LT | Eurostat |
| **Labour** | Hourly labour cost, unemployment, manufacturing wages, IT wages, youth unemployment, job vacancy, GDP per capita, life expectancy | LV, EE, LT | Eurostat |
| **Energy** | Construction output, building permits, vehicles, renewables, electricity production, household electricity price, interest rate | LV, EE, LT | Eurostat |
| **Property** | Construction permits, building energy profiles | LV | data.gov.lv |
| **Environment** | Weather (4 cities), air quality, population | LV, EE, LT | Open-Meteo |
| **Business** | UBO registry (195K+), address search (608K+), EU Recovery Fund (955 projects) | LV | data.gov.lv |
| **Maritime** | Marine weather, ship visits, ferry traffic, cargo | LV (3 ports) | SKLOIS, Open-Meteo |

### Features

- Country selector (LV / EE / LT) with country-specific timezone
- Dark / light theme with flash-free switching
- AI-generated insights from live data feeds
- Baltic comparison charts (LV vs EE vs LT)
- Drill-down indicator detail pages with time range selector
- Scrolling data ticker with exchange rates and electricity prices
- API documentation with pricing tiers
- System health monitoring

## Data Sources

| Source | Data | Refresh |
|--------|------|---------|
| Eurostat REST API | 32 datasets for cross-country comparison | 1 hour |
| NordPool (Elering) | Electricity prices per zone | Hourly |
| ECB XML | Exchange rates (8 currencies) | Daily |
| Open-Meteo | Weather + air quality | 15 min |
| data.gov.lv CKAN | Property, business, maritime | 1 hour |
| CSP PxWeb | Latvia-only indicators (gas price, building permits) | 1 hour |

## Tech Stack

- React 19 + TypeScript 5.9 + Vite 8
- Tailwind CSS 4.2 + recharts 3.8
- Azure Static Web Apps (managed functions, Node.js)

## Development

```bash
npm install
npm run dev
```

## Deployment

```powershell
$token = az staticwebapp secrets list --name portabaltica-swa --query "properties.apiKey" -o tsv
npx swa deploy --app-location ./dist --api-location ./api --deployment-token $token --env production
```
