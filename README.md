# portaBaltica

portaBaltica is a Baltic open-data news portal. Named AI correspondents write
original analysis of public economic, trade, labour, energy, property,
environmental, business and maritime data, and the dashboard those articles are
written from stays available as the evidence behind them.

## Routes

| Route | What |
|-------|------|
| `/` | The news feed |
| `/article/:slug` | An article, with its provenance record |
| `/correspondents/:id` | Correspondent bio — what the AI system is, and who is accountable |
| `/about/ai` | The AI-use policy |
| `/corrections` | The public, append-only corrections log |
| `/data`, `/data/:section` | The full indicator dashboard |
| `/indicator/:id` | Indicator detail with the long series |
| `/rss.xml`, `/sitemap.xml` | Feeds for our own articles |

The three tiers of item are described in [newsroom/README.md](newsroom/README.md)
and are rendered deliberately differently: original analysis carries a byline
and a provenance block, official releases are reproduced verbatim without a
byline, and third-party items are link-out cards showing only the outlet's own
RSS snippet.

## Research question

portaBaltica tests the NauroLabs question **"What's worth selling?"** It asks
whether normalizing and presenting fragmented, free public data creates useful
value beyond the source APIs themselves.

## What it does

- Compares indicators across Latvia, Estonia, and Lithuania.
- Presents time series, operational feeds, and indicator detail views.
- Proxies and normalizes data from Eurostat, data.gov.lv, NordPool, ECB,
  Open-Meteo, CSP PxWeb, and maritime sources.
- Publishes original analysis of those series, with every figure traceable back
  to the dataset it came from.

## Where articles come from

The frontend reads finished static JSON — `articles/index.json` and one file per
slug — written by the generation pipeline. **The browser never holds a
credential**: generation runs on a timer in a Function that has the managed
identity, so nothing needs to be shipped to the client. Set
`VITE_ARTICLES_BASE_URL` to develop against a local fixture directory.

Nothing renders without passing `isServable()` in [src/news-types.ts](src/news-types.ts):
an article that lacks `status: 'published'` and a passing validator verdict is
refused at render time, however it reached the client.

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
