# portaBaltica

portaBaltica is a dashboard that aggregates public Baltic economic, trade,
labour, energy, property, environmental, business, and maritime data.

## Research question

portaBaltica tests the NauroLabs question **"What's worth selling?"** It asks
whether normalizing and presenting fragmented, free public data creates useful
value beyond the source APIs themselves.

## What it does

- Compares indicators across Latvia, Estonia, and Lithuania.
- Presents time series, operational feeds, and indicator detail views.
- Proxies and normalizes data from Eurostat, data.gov.lv, NordPool, ECB,
  Open-Meteo, CSP PxWeb, and maritime sources.
- Generates short data summaries from the available feeds.

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, and Recharts
- Azure Static Web Apps managed Functions
- Public Baltic and European data APIs

## Run locally

```powershell
npm install
npm run dev
```

Before submitting a change:

```powershell
npm run lint
npm test
npm run build
```

## Status

**Active experiment.** The dashboard and its cross-country data surfaces are
deployed at [portabaltica.naurolabs.com](https://portabaltica.naurolabs.com).
Source coverage and data reliability vary with upstream public APIs.

## License

MIT
