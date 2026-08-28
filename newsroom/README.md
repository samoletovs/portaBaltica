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
   ├─ 4. CONTEXT      deterministic — NO LLM. What else the newsroom already
   │                  holds that bears on this finding: the same measure in the
   │                  other Baltic states, related measures in the same economy,
   │                  where the reading sits in its own history, the same point
   │                  in earlier years. Every figure is merged into the signal,
   │                  so it faces the identical traceability check.
   │
   ├─ 5. RESEARCH     relevant items from registered official and news feeds,
   │                  then the FULL TEXT of the official statements the registry
   │                  permits fetching. Third-party reporting contributes
   │                  headline + link leads only, and its page is never
   │                  requested. Search is off unless configured, and can only
   │                  ever surface a page of an already-registered publisher.
   │                  Every item is nonce-fenced as untrusted input.
   │
   ├─ 6. ANALYSE      a domain specialist per beat reads the figures and the
   │                  context and files an editorial brief: the angle, why it
   │                  matters, candidate mechanisms, who it lands on, what would
   │                  settle it. A mechanism that does not name verified fields
   │                  is deleted in code before the writer sees it.
   │
   ├─ 6b. THE PANEL   two specialists per beat, consulted separately, propose
   │                  *why*. This is the one stage permitted world knowledge,
   │                  and everything it returns is a hypothesis: attributed to
   │                  whoever holds it, marked unconfirmed, and carrying no
   │                  quantity — a claim with a number in it is deleted in code.
   │                  See "The causal panel" below.
   │
   ├─ 7. WRITE        gpt-4o-mini via managed identity → foundrylab-aiservices.
   │                  Receives the enriched signal, the context pack, the
   │                  analyst's brief, fenced research and a persona voice card.
   │                  It is never asked to recall or supply a figure.
   │
   ├─ 8. VALIDATE     the gate. See below. Fails closed.
   │
   ├─ 9. EDIT         tier A: the desk reads every original article and can
   │                  approve, send back once, or spike it. Tier B/C: approve,
   │                  reject or escalate. Routine decisions stay inside the
   │                  pipeline; Andre is notified only for dangerous, harmful or
   │                  inappropriate material.
   │
   ├─ 10. PUBLISH     article JSON → Blob → SWA serves it statically
   │
   └─ 11. WATCH       the revision watch. Re-reads every series behind a figure
                      already published, against the vintage it was published
                      on. A restated figure appends a public correction to the
                      live article and to corrections.json. This is the only
                      stage that acts on articles already out.
```

### Why the depth stages exist

The pipeline used to hand the writer **one series, alone**, and discard the
other fifty it had just retrieved. On 2026-08-25 it published three separate
articles reciting Latvian, Estonian and Lithuanian hourly labour costs while
holding, in memory, at that exact moment, the fact that makes it a story:
Latvia has the cheapest labour in the Baltics. The Latvian piece then spent its
remaining paragraphs restating its own first sentence and promising that
"future data releases will provide further insights".

It was not short of words. It was short of context it already had, and of
anyone who knew what an hourly labour cost means.

`context.py` fixes the first and `analyst.py` the second. Neither weakens the
gate: context figures are merged into `Signal.fields`, which is exactly what
`figures_traceable` resolves against, and every analyst mechanism must name
fields the pipeline actually retrieved or it is deleted before the writer's
prompt is built.

### The causal panel

Both stages above left the reader's first question unanswered, and the analyst
prompt says so in terms: *"do not reach for world knowledge about tax changes,
elections, wars or company decisions"*. That rule is right for a **mechanism**,
which this wire publishes as fact. Its consequence was that no component
anywhere could say why anything happened.

Measured across the 21 published articles carrying an analyst brief, 18 held at
least one mechanism — so the desk was working. A mechanism is a relationship
between two verified series, and never a cause, so an article could hold two of
them and still close:

> The decline in economic sentiment coincides with a GDP growth of 0.4% quarter
> on quarter and an unemployment rate of 6.4% of the labour force in the same
> period.
>
> **The data does not show what drove the change in sentiment.**

Both sentences are true. Together they are an admission that nobody looked.

`hypothesis.py` is the component that looks. A **hypothesis** is a different
kind of claim from everything else here, and the two are kept apart all the way
to the reader:

|              | Mechanism (`analyst.py`)   | Hypothesis (`hypothesis.py`)     |
| ------------ | -------------------------- | -------------------------------- |
| rests on     | two verified series        | domain knowledge, or a document  |
| published as | a statement of fact        | attributed, and marked unconfirmed |
| guard        | `_ground`: field names     | `_admissible`: no quantities     |
| if wrong     | a correction               | a hypothesis that did not hold   |

**Three guarantees, all in code**, because a prompt instruction is not an
argument — `_admissible` runs after the model exactly as `_ground` does:

1. **No quantities.** Every claim goes through `numeric_scan`, the same module
   the validator uses to decide what a numeric claim *is*, and one carrying a
   number is dropped rather than redacted. Note what this deliberately permits:
   bare years are masked, so *"the 2024 pension reform"* survives while
   *"housing costs rose 12%"* does not. That is asserted, not assumed — naming
   a specific policy is the whole point, and a year that killed the claim would
   force the vagueness this stage exists to remove.
2. **A cited document exists.** A hypothesis resting on an official statement
   must name a source in *this article's* research context, and only an
   `official_statement` — tier C is link-out only, so a hypothesis attributed to
   a newspaper would put its name behind a cause we read not one word of.
3. **Attribution is assigned, never claimed.** For a domain-knowledge claim the
   name is written from the panel table, not read from the answer. A model
   cannot promote its own guess into a central bank's mouth.

**Two analysts, consulted separately.** Asking one model for three perspectives
returns one perspective wearing three hats, because the second is written in the
light of the first. Independent calls mean a convergence is evidence rather than
an artefact of ordering, and `_converge` tells the correspondent which causes two
panellists reached alone.

**The lenses are not the sections.** A finding is read by whoever can explain it,
which is why `environment` — where this newsroom files its demographic series —
routes to a demographer and a political economist rather than to a climate
analyst. A section-shaped default is exactly what made the birth-rate article
shallow.

**It costs two model calls per article**, on top of the analyst's one and the
writer's one to three. `NEWSROOM_PANEL_SIZE` is the dial; two is the floor at
which a convergence means anything, and the third lens per beat exists for
where they genuinely disagree. Watch it against the €3–5/mo target rather than
assuming it is free.

**The gate got stricter, not looser.** `no_unsupported_mechanism` now admits a
figure-free paragraph that explains something on the newsroom's own analyst's
authority *only* when the same paragraph marks the cause unconfirmed, and it
tests that branch **before** the general attribution exemption. That ordering is
the whole guarantee: `_ATTRIBUTED_TO_A_SOURCE` matches any sentence containing
"says", so a desk cause stated flatly would otherwise pass on the generic
clause and the hedge requirement would be a branch nothing ever reached. The
panellists' names are read off the article's own provenance rather than matched
by pattern, so *"Dr Liina Sarapuu says X is driven by Y"* — the same claim on
the same authority, without the possessive a regex would look for — is caught.

An outside publisher is on the record independently and answerable for what it
said; our panellist is a model this newsroom prompted. The asymmetry is
deliberate.

**A hypothesis is never attributed to a publisher, even when one informed it.**
`_admissible` can establish that a named document was *retrieved* for this
article. Nothing establishes that the document *says* the claim — the guard
compares a name against a list and never opens the release. So attributing the
claim to the publisher would answer a question nobody asked, and the failure is
legible to the reader and invisible to us: they follow the link, read the
release, and find we paraphrased it into saying something it does not. Every
claim is therefore the panellist's, for both bases, and a cited release is
recorded beside it as `informed_by`.

What the gate still cannot see is the truth of an attribution: *"According to
Latvijas Banka, the fall is driven by X"* passes whether or not the bank said
so, and it has passed since the check was written — measured against the
untouched validator with no panel present at all. The panel does not widen that
and is built not to walk into it, but the limit is real and is named in
`check_no_unsupported_mechanism`'s docstring rather than left implied. Closing
it means requiring that an attributed cause name a source whose document text
was actually fetched, which is a change to a long-standing rule and belongs in
its own piece of work.

**Retrieval had to be fixed first.** `research._topic_terms` knew only the
section vocabulary, so the birth-rate story could match on `climate`,
`environment` and `weather` and nothing else. The five items it retrieved were
Estonian farm subsidies, a crane migration count, Greece's Social Climate Plan,
Latvijas Banka's climate disclosures and a Commission daily digest, and the one
document actually read into the prompt was the climate report. Widening the
section list would have fixed that one finding and left the next; the metric's
own label is asked instead, because it always describes the subject and a metric
added tomorrow brings its own vocabulary with it. Measured on the published
case, the demographic headline went from scoring **0** — below the crane story's
4, so it could not be selected at all — to outranking it.

### What the desk is shown

The editor sees three things besides the prose, each added after it made the
same class of mistake without them:

- **the detector's finding** — what was found, what it is measured against, and
  how it ranked. Asking whether a piece is worth a reader's attention while
  withholding the evidence of its significance got the answer you would expect.
- **the wider context** the correspondent had, as labels without values, so the
  desk can tell a piece written with no context from one that threw the context
  away. Those need opposite verdicts, and it could not previously tell them
  apart. Values are withheld deliberately: a numeral here comes back as an
  editor note, and a note asking for a number is a note the writer may answer
  with one the pipeline never verified.
- **the analyst's suggestion**, nonce-fenced. It is model output derived in part
  from the third-party pages the research stage now fetches, so handing it to a
  second model as bare prose would let a page the newsroom merely *read* address
  the editor directly.

The one exception to "never ask for a figure the article does not have" is a
figure listed in that context block: those are verified and already in the
writer's hands, so asking for one by name is the most useful note the desk can
give.

### Verifying the depth end to end

`scripts/depth_smoke.py` runs collect → detect → rank → context → research →
analyse → write → validate against **live** data and the real model, and prints
the context pack, the documents it read, the analyst's brief and the finished
article for each signal. A pipeline stage that exists in a module but was never
exercised against real data is indistinguishable from one that does not work.

```powershell
python scripts/depth_smoke.py
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

### The index reserves room for our own journalism

`write_index` used to sort every entry by date and keep the newest 200. That is
a defensible shape until you notice the arithmetic underneath it.

Tier C is minted at feed velocity — LSM, ERR and EUobserver supplied **154 of
the 161** entries in the live index — while tier A is written only when the data
warrants it, which is nought to eight a day. Sorting the two together by date
has exactly one outcome, and replaying the live index proved it: a single
further run's worth of syndication evicted **all seven** original articles and
left an index that was 200/200 link-outs. The front page would then have read
"Nothing to report yet today" beside a full rail of other outlets' headlines.

So the wire would have converted itself into the aggregator this README says it
deliberately is not — not by anyone's decision, but by a sort order.

The budgets are now separate (`INDEX_MAX_OURS`, `INDEX_MAX_ELSEWHERE`).
Syndication cannot take our allocation at any ratio, however fast the feeds run.
Tier B counts as ours: a licensed press release is material we chose and is not
produced at feed velocity.

`scripts/index_eviction_check.py` replays the real index so the claim stays
checkable:

```
live index: 161 entries, 7 ours, 154 link-outs
after run +1 (100 new link-outs): 7/7 of ours kept, 50 link-outs, 57 total
after run +3 (100 new link-outs): 7/7 of ours kept, 50 link-outs, 57 total
```

### A link-out is dated by its outlet

A syndicated card's `published_at` was left unset at build time and filled in by
the editor with its own decision time. In the live index that put **105 of 154**
cards inside the same two minutes — the moment the timer ran — and dated a
three-day-old ERR story to tonight.

That was not only cosmetic. It is what made every link-out newer than every
article the newsroom had ever written, and therefore what let the rail evict us.
Cards now carry the outlet's own date, parsed from the feed; `approved_at` still
records when we cleared it. A date we cannot parse is left unset rather than
guessed, and the editor supplies one only in that case.

### Sections are our taxonomy, for our work

`SYNDICATED_SECTION` files every card under one section because the schema
requires one. It is a **storage default, not a classification** — deciding from
a headline what somebody else's article is about asserts a judgement we did not
make. Do not add keyword matching to make it look real.

The visible cost of forgetting that: the front page built its tab strip from
every article, so "Government" appeared as a section, and clicking it emptied
the main column while the rail stayed full. `NewsFeed.tsx` now derives tabs from
our own reporting only, and the rail is not narrowed by a section filter,
because the only section value it carries is one we assigned it.

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

## Why the wire goes quiet, and the only thing that refills it

A quiet day is the intended behaviour and `rank.py` says so: *"the pipeline has
no mechanism to top the wire up."* But it is worth being precise about **what**
runs out, because two plausible-looking fixes cannot work and one non-obvious
one can.

Cross-run suppression is keyed on `finding_key(metric, geography, period)`.
That is deliberately narrower than `Signal.id`, which also hashes the detector
and the value: without it, two detectors firing on one reading give a reader
*"Estonian unemployment hits a record"* and *"Estonian unemployment extends its
run"* about the same number on the same day.

Measured on a real unattended edition, with 90 series in the collector:

```
ranking: 50 signal(s) considered, 1 below the quality floor, 0 deduplicated,
         49 already published, 0 selected
```

Three consequences follow from the shape of that key.

- **Adding detector kinds cannot increase volume.** A new detector firing on a
  current reading produces a finding whose key is already published, so it is
  suppressed before it costs a single model call. This is the obvious idea and
  it is dead on arrival.
- **Replaying detectors over history *does* clear the gate**, because the period
  is part of the key — and that is exactly the trap. Replayed across 59 months
  of `une_rt_m` for all three states it yields 51× more signals, of which the
  records are *all* superseded by later readings. They were news once; publishing
  them now would be true, traceable and misleading. Perishability, not volume,
  is the binding constraint.
- **Only new `(metric, geography)` pairs refill the space.** The collector holds
  roughly 22 metrics across 3–4 geographies, and the wire has consumed it. A new
  metric is a fresh key space: one story when it is first detected, then a
  trickle on each release.

So when the wire is quiet, the question is never *"which gate is too strict?"*
It is *"what have we not yet measured?"* — and the answer lives in
`pipeline/collect/opendata.py`, which must stay in step with
`api/shared/indicators.js`. They drifted once: Eurostat froze the ECOICOP ver.1
HICP tables, the dashboard was migrated and the newsroom was not, and the
newsroom read eight-month-old inflation with every validator check passing,
because the number really was in the payload. It was simply the wrong payload.
`tests/pipeline/test_collector_matches_dashboard.py` exists to stop that
recurring; a comment asserting the two are copies is not an invariant.

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
| `no_repeated_findings` | two paragraphs rest on the identical set of `signal_field`s |

The general case, which the rest of this section is examples of:

> **An assertion that something is absent needs a companion proving it could
> have been present.**

`== []`, `not in`, `assertRaises`, `toBeNull`, `queryBy...` returning nothing —
every one of them is satisfied by a world where the mechanism under test never
ran at all. The assertion cannot tell the difference between "the guard
excluded it" and "nothing was ever there to exclude", and neither can a
reviewer reading the assertion on its own.

The cheapest companion is usually the same fixture aimed somewhere the
exclusion does not apply. The EU27 exclusion asserts
`detect_all([eu_series]) == []`; beside it, the identical series for Latvia
must produce signals. That pairing caught a fixture of ten flat readings and a
spike, which fires nothing at all — a flat run has no variance, so the
sigma-based detectors refuse it, and the exclusion would have been untested
while reading as proven.

**Write these tests so they fail when the requirement is unmet, not merely when
the code changes.** The lab has already shipped a green PR whose test asserted
the truncation bug it was supposed to fix. A validator test that passes because
the validator does nothing is worse than no test, because it manufactures
confidence. Each check needs at least one fixture that *should* be rejected.

That failure has now recurred four times in different clothes:

* `all_detector_signals()` did not cover `sharp_move`, `streak` or
  `threshold_cross`, so the invariant test over "every detector" was green
  while three detectors went unchecked;
* the cross-run suppression fixtures were alphabetically lucky, so a test that
  should have proved ordering proved nothing;
* the first verification of the retraction read back through `ArticleStore`,
  which is **local-first** — so it reported success for a write that never
  reached blob storage at all;
* and `ourArticles` filtered feeds on an article's `status`, which index
  entries did not carry, so the guard could not fire on any live index.

**All four were green.** None failed, none errored, and each read as protection
in review. Two of them were not tests at all — one was a production
verification, one a runtime guard — which is why "write better tests" does not
describe the fix. The rule that does:

> **Check that the thing you are asserting about can actually be false.**

Concretely, that means every validator check needs a fixture that *should* be
rejected, and `test_validator_rejects.py` ends with a meta test asserting one
exists for every entry in `_CHECKS`. `no_repeated_findings` sat with none from
the day it was added until the day that meta test was written — the suite was
green throughout, and its own docstring still said "all eight checks". A
verification of production goes through `BlobServiceClient` directly, never
through the store that wrote it. A guard that filters on a field is accompanied
by a test that the field is emitted.

**Then it happened inside that meta test.** `validate_article` iterates
`CHECK_NAMES`; `_CHECKS` is the registry it looks names up in. A check present
in the registry and absent from the tuple is *registered and never runs* — and
the meta test above reads `_CHECKS`, so it stays green while the behaviour it
claims to guard does not happen. `no_unsupported_mechanism` was added that way
and the suite applauded.

The two lists agree today and a test now asserts they always will. But the
sharper rule the near-miss produced is:

> **A guard must assert on the same object the behaviour reads.**

Two structures that ought to agree are two chances to check the wrong one, and
the mistake is invisible precisely because both look authoritative.

The frontend has since supplied the worst instance of the family, which is
worth borrowing here because it is not a test at all. A computed-colour diff
run from a second git worktree served the *other* tree's bundle, so a branch
was compared against itself: **0 changed across 31,908 nodes.** A measurement
that cannot fail, failing *upward* — reporting the strongest possible evidence
that nothing had broken. It was caught by chasing a contradiction in the data,
not by doubting the number. That harness now asserts the bundle hash and the
resolved theme, and throws rather than measures when either is wrong.

Measurements are what we use to check the tests. So they need the rule more
than the tests do, not less.

The most recent instance is a different animal again, and it is worth keeping
separate because the rule above would not have caught it. `renderByline`
rebuilds a byline from the correspondent registry so that an article filed
under an older surname still shows the current one. It is correct. It has a
unit test. It was written to reconcile a rename, and the rename it reconciles
is real: `personas.yaml` kept the pre-#43 surnames for months after the
frontend moved to lighthouse ones.

`Byline` — the only component that renders a byline anywhere on the site —
built that function's argument a field at a time and left out `id`. Without an
id the registry lookup returns nothing, so every byline fell through to the
stored string. The repair never ran on a single page.

> **Exercise the path the user takes, not the unit you suspect.**

Two things make this its own entry. First, nothing was green-but-empty: the
function worked, the test was honest, and both were exactly what they claimed.
The defect lived in the gap between them, which no assertion on either end can
see. Second — and this is the part worth remembering — the symptom was never
hidden. It was the largest text on the front page, wrong for months, while
three people who had each read the function believed the page was fine.

It was first reported here as *a repair that removes the symptom the guard
would have fired on*, which was a better story and was not true. That version
came from verifying `renderByline` directly, with an id supplied by the test
author. The honest form is stranger and less flattering:

> **A repair that would have hidden the symptom, in a path that never called
> it.**

A shim can be sound, tested, and unreachable. Reading it tells you what it
would do, not whether it runs.

### A sweep inherits the frame of whatever prompted it

The newest member, and the only one found twice on the same afternoon by two
people working independently on opposite sides of the repo.

The dashboard side supplied a rule about where a gap in a series is dangerous:
**a hole needs a guard where the consumer indexes by position, and is
self-limiting where the consumer addresses by label.** The newsroom side ran it
over every consumer it had — `same_season_history` filters on a season key,
`_latest_at_or_before` compares period spans, `_adjacent` compares period
labels — found one positional access in `detect_sharp_move`, fixed it, and
reported the sweep clean.

It was not clean. **`_adjacent` is correct only if `series.frequency` is
correct, and nothing checked `frequency`.** Its correctness rested on a
hand-check run once against live data, which existed nowhere in the repo. The
sweep audited the consumers and not the input all of them trust.

The dashboard side made the identical mistake in the same hour, and worse:
it ran the rule over one of its own consumers, generalised to the file, and
wrote the rule down — *while writing the rule down* — before finishing the
audit.

> **A sweep inherits the frame of whatever prompted it.**

You go looking for positional accesses because the example was a positional
access. `frequency` is not one; it is the value those accesses are safe
*because of*. The rule was right and the search took the shape of its example,
which is the word-list failure one level up: **a word list encodes the author's
examples, and a sweep encodes the shape of the instance that prompted it.**

The practical form, which both sides reached independently:

> **When you audit the consumers, audit the input they share.**

And a corollary about where these hide. `NOT_COMPARED = {"freq"}` carried a
note explaining, correctly, why frequency could not be compared *as a query
parameter* — and naming the attribute the newsroom carries it in instead.
Nothing compared that attribute. **The note read as "not comparable" while
meaning "compared elsewhere", and closed the enquiry of anyone who came
looking.** That is the same concealment as a correct sibling function
reassuring a reader about a broken one: documentation that answers the
question you were about to ask, with an answer to a different question.

### What the validator cannot see: the article's subject

Every check above is about a *figure*. None is about what the article is
**about**, and that gap has now produced two live errors of the same shape — a
sentence where every per-article invariant holds and the subject is wrong.

**"Latvian sea passengers fell to X."** Traceable, uninvented, correctly
compared. Also a claim about Ventspils alone, because Riga stopped filing after
2021-Q4 and the national total has equalled one port ever since. It reads as a
statement about a country.

**"Lithuania's business bankruptcy declarations spike to 130.9 index points."**
Traceable, uninvented, correctly compared. Also the *new registrations* series —
the collector's cache key omitted the query, so datasets sharing a cube were
served each other's payloads. Bankruptcies were 120.3, and the two numbers mean
opposite things about an economy. Five of twenty tier A articles published this
way. `AGENTS.md`, under "Adding a data source", is the authoritative account.

Neither was catchable downstream. The validator confirmed that 1088.6 came from
the signal, and it had — the signal was built from the wrong cube.

So: **the contract protects figures, not subjects.** A fault in what a series
*is* has to be caught where the series is chosen, which means the guards live in
`tests/pipeline/test_collect.py` and run against the registry rather than
against a fixture: no two `EurostatDataset` entries may share a cache key; no
`unit` may contain a digit, because the unit reaches the prose; a geography that
publishes nothing is declared rather than discovered; and where the data has an
arithmetic identity — goods + services = the trade balance — assert it, because
that check needs no fixture and survives republication.

### Reject what is wrong; coach what is weak

Two instruments act on a draft and they are not interchangeable. The validator
**rejects**: it is for faults that make an article untrue, untraceable or
mechanistically unsupported, and its cost is the whole piece plus the six model
calls that produced it. Prompt guidance **coaches**: it cannot reject anything,
so it is free, and it is the right instrument whenever the fault is that a true
sentence is a weak one.

The denominator fact is the worked example. Offered the EU reading, the writer
used the intended direction contrast in four of five samples; in the fifth it
wrote *"6.1%, which is lower than Latvia's rate"* — true, traceable, no
unsupported mechanism, and a waste of the fact, since a European average is
higher or lower than any one country every month of the year. A validator check
would have burned a whole article to improve one paragraph. Sharpening the
prompt to name the direction took it to ten of ten, and did something a gate
could not have: the direction moved from a trailing clause echoing the fact's
own label to the main verb of a sentence the writer composed.

Getting this backwards is expensive in both directions. A gate on a weak-but-
true sentence throws away good journalism; guidance on a false one publishes it
whenever the retries run out. That second half is why *house style has no
rejection path* remains true and is not in tension with this: **house style must
never be asked to carry a truth fault.** The test is not how badly the sentence
reads, it is whether it is *wrong*.

### Both instruments assume the diagnosis is right

The choice above is between a gate and a coaching note. It has a precondition
nobody had stated: that the fault is where the rejection counter says it is.

`comparison_basis_stated` reached the top of that counter — five of the six
rejected drafts in the run of 2026-08-27. The diagnosis was the familiar one,
and it was written down as a guess: the plan asks for a comparative sentence in
a slot that does not carry the comparison, so the instruction upstream is thin.
Every previous entry in this file fits that shape.

Eighteen drafts were generated across three signals and every rejection read in
full, with its paragraph and its declared figures. **Nine of nine were false
positives.** Not one was the writer omitting a basis.

Seven were the closing paragraph house style asks for:

> The next release would need to show a decrease **below 141.6%** to indicate a
> potential easing of energy inflation.

**A threshold is a reference point.** Two more stated a basis the pattern list
did not happen to contain — it required the article, *"a year earlier"*, and the
writer wrote the numeral, in a block whose declared figure was named
`value_one_year_earlier`. **The data knew what the regex did not.**

So neither instrument was the answer, because the writer was already correct:

> **A coaching note that tells a writer to do what it is already doing makes it
> worse.**

That is the part with teeth. The wrong diagnosis does not fail safe here — it
would have added guidance against a working behaviour, and the resulting
degradation would have been slow, plausible and attributed to the model.

Two things made it invisible. First, the check had not changed. #160 and #168
removed the *other* causes of rejection, and a check whose false-positive rate
was always high rose to the top by subtraction:

> **A gate does not have to change to become the bottleneck.** Everything else
> getting better looks identical to this one getting worse.

Second, the failure message names the token it matched — `'decrease'` — which is
exactly the information that cannot distinguish a missing basis from an
unrecognised one. **The counter says which check fired, never whether it was
right to.** Reading the prose was the only way to tell, and it took eighteen
drafts to say so with a straight face.

The correction is not "trust gates less". It is the same discipline the
denominator fact got, one level earlier:

> **Before choosing an instrument, confirm the fault is real. Read the
> artefact.**

And the counterweight, because widening a gate is how it stops protecting
anything: the repair admits `above` and `below` as comparative prepositions
governing a figure — `than` was already there — and deliberately **refuses
`over` and `under`, because `over 3 months` is a duration**. A time span
admitted as a reference point would leave a check that still looks like a
check. The exclusion is load-bearing, so it has its own test; the judgement
survives only because something asserts it.

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
├── pipeline/hypothesis.py     # the causal panel: attributed, quantity-free why
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
7. **A cause is never asserted, and never anonymous.** The causal panel is the
   one stage allowed knowledge from outside the retrieved figures, and every
   claim it produces reaches the reader carrying both a name and a mark that
   this data cannot confirm it. Neither half is optional: without the name the
   reader cannot weigh whose idea it is, and without the mark the wire has
   asserted something it did not establish. A hypothesis also never carries a
   quantity — if one is ever needed to make the claim stand up, the claim is a
   numeric assertion the pipeline did not verify, and it is dropped.

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
