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
| `/briefings` | Business briefing discovery pilot; enquiries stay closed until the contact channel is verified |
| `/evidence`, `/evidence/:snapshotId` | Capture history and immutable source packs, with verified downloads and revision comparisons |
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
- Searches headlines and summaries in the current published index, with more
  articles revealed on demand rather than one unbounded front-page list.

## Launch and revenue

The first commercial experiment is a narrowly scoped business briefing, not a
paywall on existing public data. See [the launch and revenue plan](docs/launch-and-revenue-plan.md)
for the readiness findings, rights and email activation gates, pricing
hypotheses and 30/60/90-day validation decisions.

`/briefings` is a discovery page, not an operating subscription service.
`VITE_BRIEFING_ENQUIRIES_OPEN` must be exactly `true` at build time to show its
enquiry form; CI reads the same-named repository variable. Keep it unset until
inbound mail, branded replies and an accountable inbox owner are verified.
The form prepares an email draft locally: it does not submit, store a lead,
enrol anyone in a newsletter or collect payment.

## Where articles come from

The frontend reads finished static JSON — `articles/index.json` and one file per
slug — written by the generation pipeline. **The browser never holds a
credential**: generation runs on a timer in a Function that has the managed
identity, so nothing needs to be shipped to the client. Set
`VITE_ARTICLES_BASE_URL` to develop against a local fixture directory.

Nothing renders without passing `isServable()` in [src/news-types.ts](src/news-types.ts):
an article that lacks `status: 'published'` and a passing validator verdict is
refused at render time, however it reached the client.

## Policy pages

`/about/ai` and `/corrections` render
[newsroom/policy/ai-use.md](newsroom/policy/ai-use.md) and
[newsroom/policy/corrections.md](newsroom/policy/corrections.md) directly, through
a small dependency-free markdown renderer. **Do not restate policy text in JSX** —
the published commitments have one source of truth, and rendering from it is what
keeps the page and the promise from drifting apart.

Three commitments in that policy are binding on the UI and are covered by
[tests/policyCommitments.test.tsx](tests/policyCommitments.test.tsx): no synthetic
human face on any correspondent, every byline carrying `· AI correspondent`, and
the provenance panel showing sources, datasets, retrieval time and model on every
article.

## Bundle size

Run `node scripts/route-weight.mjs` after a build to see what a reader actually
downloads per route. It walks the static import graph, which is the only reliable
way to catch a heavy dependency leaking into a route that should not have it —
chunk names alone are misleading.

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

## Evidence archive

The archive preserves a precisely selected Baltic unemployment series, including
missing observations, source flags and retrieval provenance. `/evidence` exposes
capture history, checked downloads and revision comparisons. Eligible article
sources link only to an exact matching original capture, never the nearest date.

`NEWSROOM_EVIDENCE_ENABLED=true` enables capture of the existing collector's
response on the existing newsroom schedule. It does not add a timer or model
call. Checked public serving packs remain online in the articles container;
other raw feeds remain private. Existing history and exports stay free.
See [production design and operation](docs/design-evidence-production.md),
[the original pilot](docs/evidence-archive-pilot.md), and
[verified historical findings](docs/evidence-archive-results-2026-09-13.md).

## Model pilot

**Prepared, not promoted.** The parent owns synthetic API/quality evaluation
and the combined +$10/month pilot. Do not run a paid edition or change cloud
settings to test this branch.

The routine writer (including the analyst/editor/desk using the same client)
targets `foundrylab-aiservices` in `foundrylab-rg`, deployment and actual model
`gpt-6-luna`, version `2026-09-22`. Set these Function App settings together:

- `AZURE_OPENAI_ENDPOINT=https://foundrylab-aiservices.cognitiveservices.azure.com/`
- `AZURE_OPENAI_DEPLOYMENT=gpt-6-luna`
- `AZURE_OPENAI_API_VERSION=2024-10-21`

The deployment must serve the same-named model; unknown aliases and mismatched
response models fail closed rather than mislabelling article provenance.
GPT-6 uses `max_completion_tokens` with `reasoning_effort=none`. Each existing
caller keeps its ceiling (article writer 2,000; desk 400). There is no Sol
newsroom tier, new retry, changed cadence, or relaxed factual/publishing gate.
The returned model/version continues into article provenance.

Rollback changes only `AZURE_OPENAI_DEPLOYMENT` to `gpt-4o-mini` or `gpt-4.1`
on the same resource. Those models use the original `max_tokens`/temperature
parameters. Luna Global short-context USD/M rates are **0.10 input, 0.50
output, 0.01 cached input**; forecast uncached input unless cache hits are
measured, not assumed.

Production code ships through [newsroom-ci.yml](.github/workflows/newsroom-ci.yml),
job **Publish the pipeline to Azure**, to `portabaltica-func`
(`portabaltica-rg`). That workflow does not apply Bicep or change the existing
deployment setting, which shadows the code default. The parent must apply the
approved model setting separately. No persistent Foundry agent is involved.

### Issue triage is a separate promotion

[copilot-triage.yml](.github/workflows/copilot-triage.yml) now defaults
`TRIAGE_DEPLOYMENT` to `gpt-6-luna`, with a 300-completion-token cap and no
reasoning. The repository variable can select `gpt-4.1-nano`, `gpt-4o-mini`
or `gpt-4.1` for rollback, with legacy token parameters. A truncated or refused
reply labels the issue `needs-review`, never `approved`.

Its existing `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_KEY` **secrets remain
unchanged**. They historically target `oai-agents-s6vbks3oteo4y`, not the
MI-only foundryLab account. A deployment on foundryLab is therefore **not**
proof triage can call Luna. Before promotion the parent must verify a
key-compatible resource/deployment/actual-model triple, or separately approve
an auth migration; this branch does neither. Keep triage on its supported
rollback deployment until that distinct gate passes.

## License

MIT
