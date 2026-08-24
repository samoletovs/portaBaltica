# portaBaltica newsroom

The pipeline that turns Baltic open data into original journalism.

Read this before touching anything under `newsroom/`, `api/`, or the news
routes in `src/`. It is the contract between four workstreams that are being
built in parallel.

## What this is, and what it deliberately is not

portaBaltica is **a data-journalism wire, not a news aggregator.** Every article
we publish under our own byline is original analysis of open data that we
retrieved, checked and can point back to a dataset. We do not scrape other
outlets and we do not rewrite their work.

That constraint is not squeamishness. Two independent forces make aggregation a
dead end for a portal this size:

- **EU DSM Directive 2019/790 Art. 15** gives press publishers a neighbouring
  right over online reuse, transposed in Latvia, Estonia and Lithuania since
  2021. Only hyperlinks and "individual words or very short extracts" are
  carved out. Google, with vastly more leverage, still had to either license or
  withdraw — in Spain it shut Google News entirely, in France it was fined
  €500m before signing deals. A small portal has no negotiating position at all.
- **Google's scaled content abuse policy** (March 2024) names "scraping feeds …
  automated transformations like synonymizing, translating, or other
  obfuscation techniques" as spam. Google is explicit that AI content is *not*
  inherently spam — it is spam when it is unoriginal and adds no value. An AI
  paraphrase of an ERR article is exactly the target. Original analysis of
  Eurostat data is exactly not.

Both point the same way, and it happens to be the direction portaBaltica was
already built for: it has spent a year accumulating resilient, cached access to
30+ Baltic open-data indicators. That is the moat. The dashboard is the
evidence; the articles are the product.

The precedent worth copying is AP's automated earnings stories — coverage went
from ~300 to ~3,700 stories a quarter — which worked precisely because the
input was structured, the template was defined, and the control conditions were
set in advance. Automate the form, never the judgment.

## The three tiers

| Tier | What | Who writes it | Approval | Rewriting |
|------|------|---------------|----------|-----------|
| **A** | Original data journalism from open APIs | An AI correspondent, from a verified signal | Auto-publish once the validator passes | n/a — it is ours |
| **B** | Official press releases (EC, EP) | Nobody — reproduced verbatim | Human, via Telegram | **Never** |
| **C** | Third-party headlines | Nobody — headline + the outlet's own RSS snippet + link | Human, via Telegram | **Never** |

`newsroom/sources.yaml` is authoritative. Content from a source not registered
there is dropped. The `rewrite_allowed` flag is enforced in code, not by
convention.

## Pipeline

```
 Timer (Azure Functions, Flex Consumption, Python)
   │
   ├─ 1. COLLECT      open-data APIs + registered RSS feeds → raw blob archive
   │                  every raw item is stored before anything reads it,
   │                  so a validator failure is always reproducible
   │
   ├─ 2. DETECT       deterministic signal detection — NO LLM
   │                  records, streaks, threshold crossings, cross-country
   │                  divergence, seasonal deviation. Emits Signal objects
   │                  with a newsworthiness score. Pure functions, unit-tested.
   │
   ├─ 3. RANK         top N signals by score, floor applied.
   │                  Quiet day ⇒ fewer articles. Never pad to hit a quota:
   │                  padding is precisely what "scaled content abuse" means.
   │
   ├─ 4. WRITE        gpt-4o-mini via managed identity → foundrylab-aiservices.
   │                  Receives the signal payload and a persona voice card.
   │                  Writes prose AROUND numbers it is given.
   │                  It is never asked to recall or supply a figure.
   │
   ├─ 5. VALIDATE     the gate. See below. Fails closed.
   │
   └─ 6. PUBLISH      article JSON → Blob → SWA serves it statically
                      tier B/C instead → Telegram approve/reject → Blob
```

### Why generation is batch, not per-request

This sidesteps a documented platform constraint. SWA Free cannot use managed
identity (see `.github/wiki/insights/swa-free-tier-constraints.md`), which has
historically forced projects that need AI either onto Standard tier or into
holding API keys in app settings. Because articles are generated on a timer by
a Function that *does* have managed identity, and the frontend only ever reads
finished static JSON, the browser never needs a credential and the SWA never
needs an identity. Nothing to leak, nothing to rotate, and the SWA stays free.

This also fixes portaBaltica's standing anti-pattern: it is currently listed in
`.github/wiki/insights/foundrylab-shared-account.md` as a project that had *not*
adopted the shared Foundry account. It does now — no new AI resource, no keys.

## The validator

The single most important component. An article is servable only if
`provenance.validator.passed` is true, and the renderer refuses anything else.

| Check | Fails when |
|-------|-----------|
| `figures_traceable` | a number in the body has no `signal_field` pointing at the source payload |
| `no_invented_numbers` | a numeric token appears in the prose that is absent from `figures` |
| `snippet_verbatim` | a tier C snippet does not byte-match the stored raw RSS `<description>` |
| `no_rewrite_of_restricted_source` | generated prose exists for a source with `rewrite_allowed: false` |
| `byline_discloses_ai` | a byline lacks "AI correspondent" |
| `no_lived_experience_claims` | the prose claims visiting, interviewing, witnessing or phoning |
| `attribution_present` | a tier B/C item lacks its required attribution string |
| `comparison_basis_stated` | a change is described without naming what it is measured against |

**Write these tests so they fail when the requirement is unmet, not merely when
the code changes.** The lab has already shipped a green PR whose test asserted
the truncation bug it was supposed to fix. A validator test that passes because
the validator does nothing is worse than no test, because it manufactures
confidence. Each check needs at least one fixture that *should* be rejected.

## Correspondents

Five personas in `newsroom/personas.yaml`, each owning a beat with a distinct
voice. They are named after Baltic coastal landmarks — Nida, Akmeņrags, Kolka,
Ristna, Irbene — and that is a deliberate anti-deception decision: a reader can
mistake "Marta Ozola" for a staff journalist, but nobody mistakes a lighthouse
for one. Personality without impersonation.

Hard rules, enforced in `persona_rules.py`:

- every byline renders `<name> · AI correspondent, <beat>`
- every correspondent has a public bio page saying plainly what it is
- abstract avatars only, never a photorealistic human face
- no claims of lived experience, interviews or attendance
- **voice shapes prose only — it never touches a number**

Routing from section to correspondent is deterministic, so bylines stay stable.

## Layout

```
newsroom/
├── personas.yaml              # correspondents, voices, anti-deception rules
├── sources.yaml               # source registry: licence, tier, rewrite_allowed
├── schemas/
│   └── article.schema.json    # the publication contract
├── source_registry.py         # loads sources.yaml; refuses a loosened contract
├── persona_rules.py           # bylines, routing, forbidden-claim detection
├── fencing.py                 # nonce-delimited fencing for untrusted feed text
├── numeric_scan.py            # numeric tokenising for no_invented_numbers
├── validator.py               # the gate: every check in the schema enum
├── requirements.txt           # pyyaml, jsonschema, pytest — no Azure SDK
└── tests/                     # negative fixtures first; see test_invariants.py

api/                           # existing SWA managed functions (dashboard)
src/                           # React frontend; news routes + /data dashboard
infrastructure/main.bicep      # Functions + Storage + Foundry role assignment
```

## Non-negotiables

1. **Every ingested feed item is untrusted input.** Wrap it in nonce-delimited
   fences in any prompt and tell the model the fenced content is data, never
   instructions. A hostile headline is a prompt-injection vector. This is the
   pattern memex already uses — see `memex/AGENTS.md`.
2. **The model never supplies a figure.** It writes sentences around numbers the
   pipeline verified. If a number is missing, the sentence does not get written.
3. **Fail closed.** No validator verdict means not servable. A collector error
   means fewer articles today, never a fabricated one.
4. **Never pad to hit a volume target.** Target is 3–8 substantial articles a
   day *when the data warrants it*.
5. **Corrections are public and append-only.** If we get something wrong, the
   article shows it and the corrections log records it.
