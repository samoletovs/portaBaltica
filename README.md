# portaBaltica

Live maritime dashboard for Latvia's three major ports — Riga, Ventspils, and Liepaja.

## What it does

Combines free government open data with real-time marine weather to show what's happening at Baltic ports right now:

- **Marine weather** — wave height, sea surface temperature, wind, swell (Open-Meteo Marine API)
- **Ship visits** — vessel arrivals and departures from SKLOIS (Latvia Maritime Single Window)
- **Ferry traffic** — passenger counts on Baltic ferry routes
- **Cargo data** — transport mode shares and volume trends

## Data Sources

| Source | Data | Refresh | Auth |
|--------|------|---------|------|
| Open-Meteo Marine API | Waves, SST, currents | Hourly | None |
| Open-Meteo Weather API | Temp, wind, clouds | Hourly | None |
| data.gov.lv SKLOIS | Ship visits (CNCVESLS/REJVESLS) | Biweekly | None |
| data.gov.lv Ferry Stats | Passenger counts | Biweekly | None |
| data.gov.lv Port Ops | Cargo shares, access data | Annual | None |

All government data is CC0 licensed.

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS
- Azure Static Web Apps

## Development

```bash
npm install
npm run dev
```

## Ports Covered

| Port | UN/LOCODE | Lat | Lon |
|------|-----------|-----|-----|
| Riga | LVRIX | 57.05 | 24.10 |
| Ventspils | LVVNT | 57.40 | 21.55 |
| Liepaja | LVLPX | 56.52 | 20.97 |

## Future Plans

- Estonia and Lithuania port expansion
- Paid AIS vessel tracking integration (Datalastic)
- Cargo volume trend charts
- Marine weather map overlay
