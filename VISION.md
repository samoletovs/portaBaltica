# portaBaltica — Baltic News, Built From Open Data

## What is this?

portaBaltica is a news portal for the Baltic region, written by AI
correspondents from open government and EU data. It is NauroLabs' Moonshot v1 —
the first project designed from day one to be self-sustaining.

It began as an open-data dashboard aggregating 40+ Latvian government APIs. That
dashboard is still here, at `/data`, but it is no longer the product. **The
dashboard is the evidence; the articles are the product.**

## Why a news portal, and why this shape

The obvious way to build an AI news portal — ingest other outlets' feeds and
have a model reword them — fails twice over, independently:

- **Legally.** EU DSM Directive 2019/790 Art. 15 gives press publishers a right
  over online reuse, transposed in Latvia, Estonia and Lithuania since 2021.
  Google itself had to either licence or withdraw: it shut Google News Spain
  entirely rather than pay, and was fined €500m in France before signing deals.
  A portal this size has no negotiating position at all.
- **In search.** Google's March 2024 scaled-content-abuse policy explicitly
  names *"scraping feeds … automated transformations like synonymizing,
  translating, or other obfuscation techniques"*. Google is equally explicit
  that AI content is **not** inherently spam — unoriginality is the trigger.

Both point the same way, and it happens to be the direction portaBaltica had
already been building toward for a year: resilient, cached access to 30+ Baltic
open-data indicators. That is the moat.

The precedent worth copying is AP's automated earnings stories, which took
coverage from ~300 to ~3,700 a quarter. It worked because the input was
structured, the template defined and the control conditions set in advance —
not because the model was good at journalism. **Automate the form, never the
judgment.**

## How it works

| Tier | What | Approval | Rewriting |
|------|------|----------|-----------|
| **A** | Original data journalism from open APIs | Automatic, once the validator passes | n/a — it is ours |
| **B** | Official EU/government press releases | Human, via Telegram | Never — reproduced verbatim |
| **C** | Third-party headlines | Human, via Telegram | Never — headline + the outlet's own snippet + link |

Story selection is **deterministic code**, not a model: records, streaks,
threshold crossings, cross-country divergence. The model writes prose around
figures the pipeline has already verified, and a validator rejects any article
containing a number that cannot be traced to a dataset. On a quiet day we
publish less.

## The correspondents

Five AI correspondents, each with a beat and a distinct voice: **Nida**
(Economy & Labour), **Akmeņrags** (Energy & Markets), **Kolka** (Maritime &
Trade), **Ristna** (Environment & Climate), **Irbene** (Government, EU &
Society).

They are named after Baltic coastal landmarks rather than given human names, and
that is a design decision, not decoration. A reader can mistake "Marta Ozola"
for a staff journalist; nobody mistakes a lighthouse for one. Personality
survives; impersonation becomes structurally impossible. Every byline still
reads *· AI correspondent*, and we have committed publicly never to use a
synthetic human face.

## Who is it for?

- **Anyone following the Baltics in English** — the region is under-covered, and
  the English-language outlets that exist are thin on data journalism
- **Analysts and investors** with Baltic exposure — replaces hours of manual
  data gathering
- **Journalists and researchers** — every article links to the dataset behind it
- **Developers** — a unified REST API instead of integrating 50+ sources

## How does it connect to NauroLabs?

portaBaltica tests whether an AI agent can produce something people actually
want to read, and eventually fund itself doing it. The Baltic open data layer
(9,000+ datasets across LV, EE, LT) is the connective tissue binding all
NauroLabs experiments — portaBaltica is where that layer becomes a product
rather than a dependency.

## Revenue hypothesis

The first experiment, selected on 2026-09-05, is **scoped business briefings for
Baltic-focused analysts and small businesses**. The articles, dashboard, history,
CSV exports and feeds remain free. History and exports are already public
features, not credible differentiators for the formerly proposed Pro tier.

We will test whether source-linked, human-reviewed work on a specific recurring
decision saves enough time to earn a paid pilot and then a repeat purchase.
`/briefings` describes that discovery pilot; it does not promise an operating
subscription, delivery schedule or validated price.

The earlier EUR 3-5/month infrastructure target is not a business break-even
calculation. Count data licensing, email, hosting beyond credits, payment fees,
applicable taxes, support and editorial labour. Demand and commercial reuse
permissions remain unproven. See [the launch and revenue plan](docs/launch-and-revenue-plan.md)
for test prices, cost assumptions and explicit continue/stop gates.

## Self-sustaining progression

1. **Prove €1** — an agent CAN earn money
2. **Cover delivery costs** — including editorial labour, source licences and support, not only infrastructure
3. **Fund experiments** — ~€50-100/month to finance new NauroLabs projects
4. **Real revenue** — €500+/month, replicable pattern

## Success metrics

Stated up front so they cannot be invented afterwards:

1. **Corrections per hundred articles** — the honest measure of whether this works
2. Proportion of articles whose sourcing a reader could independently verify
3. Whether readers can tell what was automated, when asked
4. 100 monthly active readers within 60 days of launch

If automation costs more in verification than it saves in production, that is a
finding, and we publish it.

## Phased rollout

- **Phase 1:** English-only. Tier A from Eurostat, ECB, Elering, data.gov.lv;
  tier B from the European Commission and Parliament; tier C from LSM English,
  ERR News, The Baltic Times
- **Phase 2:** Deeper Estonian and Lithuanian statistical coverage
- **Phase 3:** Permission-cleared, human-reviewed business briefing pilots;
  alerts and a paid API remain candidates only if paying customers need them
- **Phase 4:** Additional languages — using the free Azure Translator F0 tier for
  **our own** articles only. Never for third-party content: translating someone
  else's journalism is both a derivative work and explicitly named in Google's
  spam policy

## Design principles

1. **The evidence remains accessible** — underlying data retains its own
   source-specific licence and attribution obligations; value comes from the
   research, preparation and review we add
2. **The model never supplies a number** — figures come from the pipeline, prose
   comes from the model, and a validator enforces the boundary
3. **Fail closed** — no validator verdict means not servable; a collector failure
   means fewer articles, never a fabricated one
4. **Disclose more than required** — bylines, provenance panels, a public AI
   policy and an append-only corrections log
5. **Never pad to hit a quota** — publishing filler is the definition of the
   thing that gets news sites deindexed
6. **Self-sustaining by design** — the agent tracks its own costs against revenue
