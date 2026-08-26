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
| **B** | Official press releases (EC, EP) | Nobody — reproduced verbatim | AI editor; Telegram only on escalation | **Never** |
| **C** | Third-party headlines | Nobody — headline + the outlet's own RSS snippet + link | AI editor; Telegram only on escalation | **Never** |

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
   ├─ 2b. MEASURE     the measurement floor. Is the movement resolvable at all?
   │                  A move below the series' own precision — or below the
   │                  declared floor for a sampled survey — is dropped, not
   │                  scored down. See "The measurement floor" below.
   │
   ├─ 3. RANK         top N signals by score, floor applied.
   │                  Quiet day ⇒ fewer articles. Never pad to hit a quota:
   │                  padding is precisely what "scaled content abuse" means.
   │
   ├─ 4. RESEARCH     relevant items from registered official and news feeds.
   │                  Reuses the cached collection pass: no search key and no
   │                  extra fetch per article. Official summaries are context;
   │                  third-party reporting contributes headline + link leads
   │                  only. Every item is nonce-fenced as untrusted input.
   │
   ├─ 5. WRITE        gpt-4o-mini via managed identity → foundrylab-aiservices.
   │                  Receives the verified signal, fenced research context and
   │                  a persona voice card. It writes what changed, plausible
   │                  causes, who is affected and what to watch.
   │                  It is never asked to recall or supply a figure.
   │
   ├─ 6. VALIDATE     the gate. See below. Fails closed.
   │
   ├─ 7. EDIT         tier B/C only: approve, reject or escalate.
   │                  Routine decisions stay inside the pipeline; Sam is
   │                  notified only for dangerous, harmful or inappropriate
   │                  material.
   │
   ├─ 8. PUBLISH      article JSON → Blob → SWA serves it statically
   │
   └─ 9. WATCH        the revision watch. Re-reads every series behind a figure
                      already published, against the vintage it was published
                      on. A restated figure appends a public correction to the
                      live article and to corrections.json. This is the only
                      stage that acts on articles already out.
```

### The measurement floor

Every detector asks whether a movement is *large* or *unusual*. None of them
asked whether it was **measurable**, and those are different questions.

The wire published "Estonia's Unemployment Rate Declines to 6.6% in June 2026"
off a one-tenth move in a Labour Force Survey estimate. That is not a decline,
it is the same number measured twice. Worse, the sigma-based guard in
`detect_sharp_move` *inverts* on a stable series: the calmer the history, the
smaller the sigma, so the more impressive a rounding-width wiggle looks.

`pipeline/significance.py` applies two floors and takes the larger:

- **publication resolution**, read off the data — a series printed to one
  decimal place cannot express 0.05, so a computed 0.05 is our arithmetic and
  not Estonia's economy;
- **survey resolution**, declared per metric in `SURVEY_FLOORS` for series that
  are sample estimates. These are editorial thresholds and say so; they are not
  a claim to have recovered Eurostat's published standard error.

A finding below the floor is **dropped, never down-weighted.** A score can be
rescued by a quiet day, which is exactly when the wire would otherwise run it.

Adding a detector without registering it in `DIFFERENCE_FIELD` or
`NOT_A_MOVEMENT` raises, rather than silently exempting it — the gate must not
stop guarding the moment someone extends it.

### The revision watch

161 articles had been published and **zero** corrections issued. That was not a
record of accuracy; nothing in the pipeline could compare a figure it published
last week against what the source says today, so there was no mechanism by which
the wire could ever discover it was wrong.

`pipeline/vintage.py` keeps a ledger of every published figure and the reading
that justified it — metric, geography, period, value, and the *vintage*, meaning
the retrieval time. `pipeline/revisions.py` compares that ledger against each
run's freshly collected series, reusing the measurement floor as its tolerance:
one definition of "a difference that counts", applied in both directions.

Three rules that are load-bearing rather than stylistic:

1. **The prose is not rewritten.** Every number in a body block is bound by the
   validator to a verified signal field; swapping one breaks that binding, and
   it also edits the past. The correction states both readings and their dates.
2. **The status stays `published`.** The schema offers `corrected`, and using it
   would be the obvious move and a serious bug: `is_servable` and the frontend's
   `isServable` both require `published`, so an article would vanish from the
   site at the moment it was corrected. An unpublish disguised as a correction
   is still an unpublish.
3. **A source revision is not our error, and the wording says which it is.**
   Conflating them trains readers to discount both.

`corrections.json` is a **bare JSON array**, because `fetchCorrections` in
`src/news-api.ts` does `if (!Array.isArray(raw)) return []`. Wrapping it the way
`index.json` is wrapped would empty the public log with no error anywhere. That
file had been documented in the frontend since it was written and never
produced by anything, so `/corrections` reported "no corrections have been
issued yet" as a permanent condition rather than a true one — the third time
this repository has shipped a frontend built to a contract the backend never
fulfilled, after `chart_ref` and the desk's `revise` verdict.

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
├── pipeline/research.py       # bounded context from cached registered feeds
├── pipeline/significance.py   # the measurement floor: is the move resolvable?
├── pipeline/vintage.py        # ledger of published figures and their vintages
├── pipeline/revisions.py      # the revision watch and the public correction
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
   article shows it and the corrections log records it. An article is never
   deleted to resolve a complaint: wrong stories are corrected in public, right
   ones stay up. The published account of RuntimeWire quietly removing accurate
   stories when their subjects asked is the failure this rule exists to name in
   advance, while it is still cheap to refuse.
6. **A difference below the measurement floor is not a small story.** It is the
   absence of one. Never make it survivable by weighting.

## Deploying

There is no CI/CD for the Function App yet — it ships by hand, from a clean
worktree:

```powershell
git worktree add ../portaBaltica.deploy origin/master --detach
cd ../portaBaltica.deploy/newsroom
func azure functionapp publish portabaltica-func --python --build remote
```

**Deploy from `origin/master` in a separate worktree, never from your own
checkout.** `func publish` uploads whatever is on disk. It does not consult
git, so uncommitted work ships silently and without review.

This is not hypothetical. On 2026-08-24 a `func publish` from the main checkout
deployed a background agent's uncommitted, half-finished editor stage into
production, where it called Azure OpenAI with live feed data and failed every
run. Nothing in the deploy output hinted at it: the branch was `master`, the
tree looked fine at a glance, and the only symptom was an HTTP 500 several
minutes later. This repository is worked on by parallel agents — treat the
working tree as something another writer may be editing right now, because it
usually is.

Then prove it, because merging is not shipping and shipping is not working:

```powershell
$key = az functionapp function keys list -n portabaltica-func -g portabaltica-rg `
  --function-name newsroom_run_now --query default -o tsv
irm "https://portabaltica-func.azurewebsites.net/api/newsroom/run?code=$key" -Method POST
```

A healthy run ends `0 error(s)`. Read the summary rather than the exit code —
the run that published nothing for two days reported `0 error(s)` every time,
because "the validator rejected everything" is a correct outcome for the
pipeline and a broken one for the product.

Finally, confirm a reader can see it. The index is what the front page reads,
and an article missing from it is invisible however faithfully it was stored:

```powershell
(irm "https://stportabalticabpmff5so.blob.core.windows.net/articles/index.json").count
```
