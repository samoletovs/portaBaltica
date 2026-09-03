# The improvement programme

portaBaltica is developed in long autonomous runs: a **manager** session plans
and verifies, and spawns **implementation** sessions that write the code. This
file is the brief for the manager — paste it into a new session to start a run.

It is written by each run for the next one. If you are finishing a run, the last
section tells you what to leave behind; a successor inheriting stale numbers or
guidance for work that already shipped is worse off than one inheriting nothing.

Companion documents: `AGENTS.md` (how the system works and what has already been
learned the hard way) and `DESIGN.md` (the design book, authoritative for
anything visual).

---

You are the **manager** of a multi-session improvement programme for portaBaltica
(https://portabaltica.naurolabs.com) — a Baltic open-data dashboard with an AI
newsroom attached. Repo: `samoletovs/portaBaltica`.

Run in **autopilot**, in a **new worktree**, publishing **directly to master**.
Expect to run for many hours. You manage; child sessions write most of the code.

**Read `AGENTS.md` and `DESIGN.md` first.** They are long, authoritative, and
written by previous runs of this programme. Do not re-derive what they record.

---

## The brief — three tracks

**1. Design and UI.** The portal must look unambiguously professional.
`DESIGN.md` is the design book; `tests/typography.test.ts` and
`tests/design-system.test.ts` enforce it. **Look at rendered pages, not only
code.** Mobile has now had two passes and both found real defects; assume a
third will too.

**2. Data sources.** Validate every source is green and current. Remove visuals
backed by dead or frozen feeds. Hunt for new APIs, or unused data in APIs
already wired. "Reachable" and "fresh" are different questions, and a feed can
serve HTTP 200 with valid JSON while frozen for months — or, as measured this
run, **HTTP 202 with a zero-byte body**, which every `response.ok` check calls
healthy.

**3. The newsroom.** Publish more and better articles. Improve research depth,
generation and the editorial gates where they earn their keep.

---

## Starting state for YOUR run (every line verified 2026-09-01T17:05Z)

```
master        40e66aa · working tree clean · 0 open PRs · all checks green
site          healthy · required 9/9 · all sources 13/13 · 0 stale
live suite    242 passed / 18 files, run against production at 16:58Z
newsroom      timer 0 0 14 * * * · edition takes 556.7s on the TIMER · functionTimeout 30m

              ⚠️ **This block used to open "No SCHEDULED run has completed under
              that timeout" and quote 625.8 s as "the edition". Both are now
              stale, and in the reassuring direction: the margin is WIDER than
              recorded.** `625.8 s` was the **manual** re-run of 2026-09-01
              fired at 14:29:57Z; the scheduled run of 2026-09-02 took
              **556.687 s**, 11% faster. Quoting the manual figure overstated
              the edition by 69 s against a ceiling the whole block is about.

              The history stands and is not rewritten: the 14:00Z timer run of
              2026-09-01 really was killed at 600011 ms, `d82233b` really did
              raise the limit at 14:14:51Z, and the fix is proven *necessary*
              because 625.8 s does exceed the old 600 s ceiling.

              **All three legs are now PROVEN, on one scheduled run** — read
              from the execution log pair rather than inferred, and written up
              under "The single open question — CLOSED" at the end of this file:

                the timer fires on schedule      PROVEN, Reason='Timer fired at
                                                 2026-09-02T14:00:00.0150453+00:00'
                the edition finishes <30m        PROVEN, Duration=556687ms = 31%
                                                 of the ceiling
                both on ONE scheduled run        PROVEN, one Id at both ends,
                                                 bdd639f7-f277-4028-b5d3-f81d7d33c89f

              ⚠️ **That second leg is weaker than it looks, and a session caught
              it.** `newsroom_run_now` is `@app.route(POST)`, not
              `@app.timer_trigger` — `newsroom/function_app.py` L191–195 against
              L72–73. Its docstring says *"Same code path as the timer"*, which
              is **true of the pipeline and false of the trigger**: both call
              `_run_and_report`, one with `"manual"` and one with `"timer"`. So
              the 625.8 s completion proves the *pipeline* finishes inside 30
              minutes; it does not exercise the timer path.

              `functionTimeout` is declared **host-wide in `newsroom/host.json`
              with no per-trigger scope**, so the *timeout* does not distinguish
              them. The **singleton does** — it belongs to the timer alone, and
              a manual run's success is therefore no evidence at all about the
              lock. That has to be read, not argued.

              ⚠️ **And `host.json` on master is not what runs.** A session
              checked the tree that is actually deployed, which I had not:

                NEWSROOM_REVISION            aebc239  (#370, 2026-09-01 20:58Z)
                aebc239:newsroom/host.json   "functionTimeout": "00:30:00"
                CONTROL 908da40              "00:10:00"  -- the probe distinguishes
                d82233b (the raise) is an ancestor of aebc239

              and that the deployed revision is still *current* for the
              newsroom, which is what makes the gap to master harmless —
              measured against master at `b4a5047`, since the count moves with
              every commit and the **0** is the part that does not:

                aebc239..b4a5047             10 commits, 2 files
                                             AGENTS.md, PROGRAMME.md
                watched by newsroom-ci       0   (newsroom/**, src/news-types.ts,
                                                  pytest.ini, newsroom-ci.yml)
                CONTROL 27abc908..aebc239    1   test_alert_notify.py
                                                 -- the filter check discriminates

              Read `NEWSROOM_REVISION` from app settings and the file from *that*
              commit. Master's copy is evidence about master.

              **So I read it. There is no held lease** — measured ~7 h before
              the next fire, from the platform rather than inferred:

                locks/…/newsroom_edition.Listener  available · unlocked
                locks/…/newsroom_weekly.Listener   available · unlocked
                locks/…/host                       available · unlocked
                timers/…/newsroom_edition/status
                  Last 2026-09-01T14:00:00.0038753Z · Next 2026-09-02T14:00:00Z
                CONTROL, the weekly timer, never killed
                  Last 2026-08-30T15:00:00Z · Next 2026-09-06T15:00:00Z

              So the schedule survived the kill intact and the timer is armed.
              Read those blobs in `azure-webjobs-hosts` (`--auth-mode login`;
              there is no key) if a fire is ever in doubt — the `status` record
              answers *"is it scheduled"*, which no run report can.

              Your first newsroom task is still to watch the 14:00Z run and read
              `trigger` on the artefact, not just its freshness — a manual and
              a scheduled edition are indistinguishable from the article
              timestamps alone, which is the whole reason `trigger` exists.
articles      99 published · 31 corrections · 8 correction surfaces green
tests         154 files · npm test = typecheck + vitest (see the trap below)
books         AGENTS.md 3744 lines · PROGRAMME.md 2002 lines

throughput    30 PRs merged today over 10.3h = 2.9 PR/h
              previous run's baseline was 5.1 PR/h; the whole programme is
              351 PRs over 12 days, peaking at 88 on 2026-08-27

              ⚠️ Read that rate with its denominator. A session finishing this
              run at 2.6 PR/h pushed back, correctly: **a PR that repairs a
              definition is not the same unit as a PR that adds a field**, and
              dividing both by hours pretends they are. Two of its PRs were
              source-level fixes to defects that had already reached readers,
              each needing a corpus measurement before a line was written —
              slower per PR by construction, and right to be. So PR/h measures
              shipping *cadence*, not value, and it is only a valid alarm
              against itself over time **within one kind of defect** — not one
              kind of *work*, which is the looser reading and the wrong one.

              ⚠️ **The consequence is that this metric alarms when the work
              gets deeper.** A programme that shifts from adding features to
              repairing definitions will show a *falling* PR/h **because it is
              succeeding**, and the arrow points the wrong way at exactly the
              moment you most want it not to. Same asymmetry as everything
              else in this file: it fails in the reassuring direction when work
              is shallow, and alarms when it is deep.

              Use it to catch
              the drift from shipping into documenting, which is what it is
              good for; do not use it to compare a definition fix against a
              field addition.
```

**The single most useful thing this run learned, and it is a correction to the
brief you are reading:** the dominant failure was not bad code and not even bad
probes in the abstract — it was **an instrument that could not have failed,
reporting a plausible number**. The journal ended with `instrument` as its
largest category (131 entries) ahead of `finding` (117) and `defect` (67). Four
that cost real time: `PLAYWRIGHT_BROWSERS_PATH` pointing at a missing directory
let 7 of 14 live tests `return` early and *pass in 0 ms*; `iwr` returns
`.Content` as a `Byte[]` for unrecognised content types, reporting "0 of 49"
on a feed with 19; `irm` parses RSS into an XML node array so a regex over it
finds 0; and `vitest --reporter=basic` errors at startup in this version,
reporting "5 of 5 failed" for a file that passes 5 of 5.

**So: every negative finding needs a positive control on the same object,
measured the same way.** A control on a different object proves the thing is
absent *or* that the read failed — one answer for two states, which is no
answer. That habit caught all four.

## First tasks for your run, in order

1. **Confirm the state above rather than trusting it.** It was true at 17:05Z
   and a branch name is a moving reference. `gh pr list`, `npm test`,
   `npm run test:live`, and `irm .../api/system-status`.

2. ⚠️ **This slot held a task that was already done, and it is left here as the
   argument for step 1.** It read: *"the share card still carries withdrawn
   claims — `api/shared/articleMeta.js` marks `Retracted: ` but not
   `Corrected: `; two lines there and two in `ArticlePage.tsx`."* Measured
   ninety minutes after it was published:

   ```
   articleMeta.js L456   const prefix = corrected ? 'Corrected: ' : '';
   ArticlePage.tsx       'Corrected: ' x1  — the hydrated mirror
   landed in             c91df2b, "Mark a corrected article in the share card,
                         and check the mirror (#354)"
   ```

   **`#354` was merged by the manager who then wrote the task.** It is the
   `#172` trap — an instrument aimed at a fault that is not there — produced by
   the same expired-premise failure that run spent the day correcting in other
   people's reports, arriving in its own handover. A session taking it at face
   value would have spent a run re-implementing shipped code and, worse, might
   have "fixed" a working surface. Verify before you build, including against
   this file.

3. **Classify the 31 corrections, or decide not to.** `#364` added `kind`
   (`our_error` | `source_revision`) and deliberately does **not** backfill:
   verified against production, all 31 carry no `kind` and resolve to
   `UNSPECIFIED_KIND`, and a test forbids any module stamping one onto an entry
   that lacks it. Classifying them is a human judgement, not a migration.

   Two things left open there on purpose. **`retract.py` writes correction
   entries and was outside that PR's file set**, so a retraction carries no kind
   and resolves to `unspecified` — correct under the design, and the natural
   next stamp. Note it is arguably a *third* kind rather than a weak
   `our_error`, which is a wording decision rather than a mechanical one. And
   **no surface reads the field yet**: establishing it and making a surface say
   more are separate changes, and the second deserves its own before/after
   rather than being smuggled into the first.

4. **The dashboard has had two mobile passes and both found real defects.**
   Assume a third will. `tests/reducedMotionLayout.live.test.ts` is the guard;
   it tests 320px and currently passes with **two `KNOWN` exemptions**. Check
   those first — this file's own rule is that an exemption resting on someone
   else's code is never permanent, and an exemption matching nothing is a dead
   clause that still reads as coverage.

5. **`articleTitleParity` has a thin margin and the cause is not the tests.**
   `a9056a8` raised its budget to `20_000` after failures at 13.2 s and 16.1 s.
   Measured three times on `a3ae4c5`, all passing:

   ```
   run   total     environment   tests
   1     23.09s    18.55s        122ms
   2      2.43s     1.27s        126ms
   3     12.88s     1.24s        177ms
   ```

   **The test work is 122–177 ms; the jsdom environment is 1.24–18.55 s, a 15×
   spread**, and 18.55 s sits just under a 20 s budget. So the flake was never
   about test work, and every `.tsx` file added to the suite puts the next one
   closer. Raising the budget again treats the symptom — this file's own rule is
   that *a margin computed from a maximum is a likelihood about the next sample,
   not a measurement*. If it recurs, look at environment reuse rather than at
   the number.

6. **Do not re-open these.** The four `data.gov.lv` endpoints using the raw
   socket-idle-timer transport were re-measured against their own stated
   trigger and both conditions are unmet — no stall (79–2426 ms) and no new
   host behind the pattern. `api/ai-insights/index.js` L253-262 already argues
   the same decline for Elering and the ECB with 51 sampled generations behind
   it. The `dashboardCadence` flake was fixed in `#207`.

   ⚠️ **This item used to end "`environment-data.airQuality.bandCount` … now has
   two readers and is not one." That is false, and the outcome it supports is
   still right — which is why the reason had to be replaced rather than the
   conclusion.** Measured on master:

   ```
   node scripts/seam-sweep.mjs   ->  app 321 · test-only 26 · ORPHAN 1
   the one orphan IS environment-data :: airQuality.bandCount
     srcReaders 0 · srcStrongReaders 0 · testReaders 0
   ```

   The supposed "two readers" are `src/types.ts:138`, which is a **type
   declaration** (`bandCount?: number;`) and reads nothing, and
   `tests/seamSweep.test.ts:192-195`, which is **the sweep's own guard file** —
   excluded by design, precisely so the sweep cannot absorb its own findings and
   report fewer orphans the more thoroughly they are written down.

   **Keep the field anyway.** It is the denominator of `rank`, and a rank with
   no population is the bare number this programme keeps warning about. So the
   disposition is *annotate*, not *delete* — and the lesson is the narrower one:
   a name appearing in a file is not a reader of it, and a declaration is the
   easiest of all to mistake for one.

7. **One question is left deliberately open, and leaving it open is the
   answer.** `#333` made `/api/ai-insights` retry Open-Meteo, which hangs on
   this egress. **The mechanism is sound and the magnitude is unmeasured** — we
   know the retry is the right shape and not how much it bought.

   The honest instrument was specified and not built: pair the `unavailable`
   field with the non-retrying probe, dedupe **both** on their own timestamps,
   and read it over a **week** rather than a morning. Attribution arrives on a
   day the probe shows the host hanging while `unavailable` stays empty; a
   morning's data cannot separate "the retry worked" from "the host was up".

   Its author's resting place is the right one and worth quoting: *"I would
   rather a successor found it open than found a p-value."* Three instruments
   were declined on the same run after measuring that the fault was absent — a
   `cacheableIf` cache option, a doc-claims test, and a 400% reflow
   instrument. **Declining on measurement is a result, and it is invisible in
   any PR count**, which is the other half of the throughput caveat above.

## Starting state at the start of the PREVIOUS run — historical, do not act on it

**Superseded by the block above.** Kept because the reasoning around it is
still worth reading, and because a run that silently rewrites its predecessor's
numbers leaves nobody able to check either set.

## Starting state (every line verified 2026-08-28T16:57Z)

```
master        d762f88 · working tree clean
site          healthy · 8/8 required sources · 0 stale
newsroom      deployed at master head; the 14:00Z timer edition published
              2 tier A originals at provenance.revision = that day's master head
articles      81 published
throughput    42 PRs merged · 5.1 PR/h · doc ratio ~1 : 6

              Measured over 5cfba82..925c091 -- the handover commit at 10:16Z to
              the last commit of the run. NOT the calendar day, which adds the
              previous run's last 7 PRs and its markdown.

              Direct commits over that range: 30. It is quotable because BOTH
              ENDS ARE PINNED. An earlier version of this block used
              `5cfba82..origin/master` and said the count was unbindable because
              stating it moved it -- that diagnosis was one axis narrow. The
              self-reference only bites while the far end is open: pin it and
              the commit recording the number lands after the range closes.
              Measured four minutes apart, the two forms already read 32 and 30.

              Bounded, not eliminated: the run continued past the pin, including
              the commit stating it, so 30 undercounts the run's close by however
              many commits followed -- 3 when a session measured it, 4 an hour
              later. That is unavoidable for any figure a repository states about
              itself, and it is harmless only because the window sits beside the
              number: `30 over 5cfba82..925c091` stays true for ever, and anyone
              wanting the closing figure re-derives it in one command. A bare
              number could have done neither.

              To measure YOUR run, substitute your own handover SHA and your own
              endpoint. Do not reuse this range -- an open end would hand you
              this run's commits plus your own, which is the day-versus-run error
              inherited rather than repeated:

                git log --format='%s' <your-handover-sha>..<your-final-sha> |
                  Where-Object { $_ -notmatch '\(#\d+\)\s*$' } | Measure-Object
              (measured 5cfba82..master, i.e. since the handover at 10:16Z --
               NOT the calendar day, which adds the previous run's last 7 PRs)
```

This run merged **42 PRs** and made two dozen-odd direct commits to master, with eight
implementation sessions running concurrently and zero merge conflicts. The
previous run merged 117 and then found thirteen further defects after declaring
itself complete. Treat "complete" as a measurement with a timestamp, not a
state.

**Throughput accelerated rather than decayed** — 11 merges in the busiest hour,
near the end. The previous run's collapse from 88 to 6 came from drifting into
documenting itself; the guardrail that prevented it here was a hard cap of one
markdown-only commit per three code commits, measured every two hours.

**The alerting built this run caught a real outage on its first day.** At
12:00:53Z NordPool — a required source — went unhealthy; the workflow opened
issue #196 naming the source and what it powers, sent Telegram, and failed the
run. At 13:00:42Z it read clean and closed the issue itself. Before today that
outage would have been announced only to whoever happened to load the dashboard
during the hour it lasted.

---

## What this run answered, so you do not re-open it

**The newsroom publishes unattended, and the proof is now an artefact rather
than an inference. That question is closed twice over.**

**And as of 2026-08-31 it is closed on BOTH cadences.** The weekly timer had
never had a scheduled run — it was added in `#108` on 2026-08-27, so every
missing `runs/weekly-*.json` before that date meant *never had the chance*, not
*never fired*, and the two produce the same 404. Its first scheduled run:

```
runs/weekly-2026-08-30.json  trigger="timer"  outcome="published"  15:00:41Z
                             schedule 0 0 15 * * 0 — 41s after the hour
                             8 findings available, min 4, cited 3 articles
runs/latest.json             trigger="timer"  schedule "0 0 14 * * *"
                             14:04:49Z · 288 series · 172 signals · 3 approved
```

Both read from `trigger`, the field `#246` pinned precisely so a hand-run could
never be mistaken for a scheduled one. **The first time that distinction was
load-bearing, it did its job** — and `weekly-latest.json` said `trigger=manual`
right up until the timer fired, which is exactly the healthy-looking record it
exists to distinguish.

It was the previous handover's largest open item, phrased there as: *no
published article has ever been produced by code containing the final editorial
fixes.* Both halves are now settled.

> ### An open, falsifiable prediction for the 14:00Z run of 2026-08-31
>
> Left here because a prediction recorded *before* the event is worth more than
> a reading taken after it, and because **the deployment is confirmed rather than
> assumed** — which is the half that has invalidated this measurement twice.
>
> ```
> BASELINE  runs/latest.json, run 2026-08-30T14:04:49Z, trigger=timer
>           produced by revision e8da9c3
>   rejected_checks.no_unsupported_mechanism   5
>   rejected_checks.figures_traceable          1
>   original_articles  generated 8 · publishable 3
>   sections           government 49 · energy 2 · property 1
>   original_sections  ABSENT
>   counts             published 52 · rejected 5 · errors 0
>
> DEPLOYED newsroom head, re-checked at 2026-08-31T11:52Z: **56554c8**, "Publish
>          the pipeline to Azure" success, and `git log <head>..origin/master
>          -- newsroom/` empty. So #297, #300, #303, #306, #308 and #309 are all
>          in the tree that will run. (An earlier draft of this entry named
>          3a79ef0, which was the head when it was written and is an ancestor of
>          this one — the claim was true and went stale within the hour, which is
>          the branch-name-versus-SHA problem arriving inside a prediction about
>          deployment.)
>
> PREDICTS  no_unsupported_mechanism   5 -> 0     (#297 cuts the named paragraph
>                                                  instead of spiking the article)
>           original_articles.publishable 3 -> 7 or 8 of 8
>           original_sections           ABSENT -> present   (#300)
>           the weekly wrap gains a correction notice, and /corrections
>           gains an entry                                  (#306, #309)
> ```
>
> **The last one exists because "merged" is not "fixed", and I wrote that the
> wrong way round.** Closing out, I recorded the wrap's inverted headline as
> *"Corrected (#306)"*. Measured at 11:55Z, after the merge and after the
> deploy:
>
> ```
> live  electricity-prices-and-renewable-energy-share-rise-in-the-baltics-fa8c99
>       headline    "Electricity prices and renewable energy share rise ..."
>       corrections 0 real entries        <- the falsehood is STILL LIVE
> CONTROL  the electricity daily, read the same way: 1 real entry
> ```
>
> `#306` merged the **machinery**. The notice is filed by the daily run from
> `corrections.PENDING` at `run.py:617`, idempotently, so the honest state was
> *queued*. **Three separate questions, and a merged PR answers only the first:**
>
> ```
> MERGED     the PR is on master
> DEPLOYED   NEWSROOM_REVISION contains it       <- check the slug IS in that
>                                                   revision's corrections.py
> LIVE       the effect has happened             <- only an artefact says this
> ```
>
> Had the deploy predated `#306`, the 14:00Z run would have used a `PENDING`
> without the wrap in it and filed nothing, while the PR sat merged and green.
> This is one step further out than *"a green deploy job means the package was
> uploaded, not that the app is serving it"*: here the package **is** serving,
> and the effect still has not happened.
>
> If the notice does not appear, look at `already_recorded` matching on
> description text against a notice written before that module existed.
>
> **And one thing that must be stated before the run rather than after: a
> quiet `origin_claim_problems` is not evidence the gate is inert.** It is the
> expected outcome of a writer being told the right thing by a prompt that now
> names both fields — `#284` added the gate, `#308` added the guidance. The gate
> earns its place on **coverage, not yield**, and the first time it fires may be
> months away.
>
> That generalises past this one check: **a gate whose value is "this can no
> longer happen silently" has no success metric that arrives on a schedule.**
> Reading a null as a dud is how such a gate gets deleted by whoever next tidies
> up — and its own docstring already explains why the corpus cannot supply a
> positive: every published article is self-consistent with the window that
> produced it, so pointing it at stored articles makes it a green-light
> generator.
>
> **Read `provenance.revision` on a new article before believing any of it.** A
> run triggered inside a deploy window measures the wrong tree in both
> directions, and a green deploy job means the package was uploaded, not that the
> app is serving it. Fetch from the blob directly —
> `https://stportabalticabpmff5so.blob.core.windows.net/articles/runs/latest.json`
> — because the Static Web App does **not** proxy `/articles/runs/`, and a 404
> there will look like absence rather than a wrong URL.
>
> If the prediction fails, that is a finding rather than a disappointment: it
> would mean the replay against the five real drafts did not model the live path,
> and *why* is more interesting than the numbers.

### SCORED, 2026-08-31T14:08:22Z. Two right, one partial, one falsified — and the falsified one taught the most

The run landed under **`56554c8`**, exactly the head named above, so nothing here
turns on a deployment argument.

```
                              predicted      actual                          verdict
no_unsupported_mechanism      5 -> 0         5 -> 1                          PARTIAL
original_articles.publishable 3 -> 7 or 8    3 -> 5                          FALSIFIED
original_sections             -> present     {economy:3, business:1, gov:1}  CORRECT
the wrap gains a correction   yes            corrected_at == finished_at     CORRECT

trigger=timer · errors='' · 34 articles published · provenance.revision 56554c8 on each
```

**The mechanism the prediction was really about worked.** Originals rose 3 → 5 and
mechanism rejections fell 5 → 1 — and the one survivor sits on an article that
*also* fails `figures_traceable`, which no paragraph-cut can rescue. So the cut
did what `#297` intended; the number `0` was the wrong thing to predict.

**Why the yield prediction failed is the transferable part**, in the words of the
session that made it and then diagnosed it against itself:

> I replayed yesterday's five rejected drafts and predicted tomorrow's yield from
> it. The replay was sound about what it measured — those five, that check, 5 of 5
> recovering. It could say nothing about *new* drafts failing *different* checks,
> because it never saw a new draft.

The run's three rejections bear that out: `no_repeated_findings` (a check the
replay never exercised), `figures_traceable` twice. So:

> **A replay against stored artefacts predicts the behaviour of the code path
> replayed. It cannot predict a stochastic pipeline's yield, because the
> population it ran on is yesterday's and the population that matters does not
> exist yet.**

That is the sharper sibling of *one generation is not a measurement*, and it is
worse than it, because the replay was **5 of 5** — a stronger sample than most
things anyone acts on, and still a perfect measurement of the wrong set.

**And the case for recording predictions at all rests on this run rather than on
the two that were right.** A summary written afterwards would have said
*"originals up 67%, mechanism rejections down 80%"*. Both true, both
celebratory, and neither able to expose that the model behind them was wrong.
**The prediction is the only instrument in the exercise that can fail.**

One thing the artefact could not settle, so do not try to settle it there next
time. Between 14:02Z and 14:06Z `runs/latest.json` still read `08/30` — which is
the same artefact for *still running* and for *never fired*. Application Insights
separated them in one query:

```
14:00:00  Executing 'Functions.newsroom_edition'
          (Reason='Timer fired at 2026-08-31T14:00:00.0081963+00:00')
13:58:39  next 5 occurrences (Cron: '0 0 14 * * *')  08-31 · 09-01 · 09-02 · 09-03 · 09-04
```

Eight milliseconds after the hour, with four future occurrences already
scheduled. **Go to the platform's execution log, not to the output, when the
question is whether something ran.**

**Half one — the timer fires.** Application Insights, four for four:

```
requests | where name == 'newsroom_edition'      (KQL literals MUST be single-quoted)
  08-27 14:00:00  success  107.6s
  08-26 14:32:04  success  425.8s
  08-25 14:00:00  success  331.9s
  08-24 14:00:00  success   32.8s
```

**Half two — and this is the part that had never been demonstrated before
today. The 14:00Z edition ran while this run was in progress**, unattended,
`trigger=timer`, finished 14:05:37Z, and published **two tier A originals whose
`provenance.revision` is `aa8df036` — that day's master head**, containing every
editorial change merged that morning. Validator 10/10 on both. Series 268 → 288,
so the `#189` indicators are being collected. Two corrections issued.

**Read the revision, do not infer it from timestamps.** Every article carries
the deployed SHA in `provenance.revision`; a green deploy job means uploaded,
not serving. That field is how this was settled and it is how you should settle
the equivalent question.

### RECORDED BEFORE THE RUN, 2026-09-01T08:05Z. The causal gate has never executed

`#331` merged at `5bda2df`, and the deployed `NEWSROOM_REVISION` is **`9d09f54`**
— read from Azure, not inferred — which contains it (`5bda2df` is an ancestor)
and has **0 newsroom commits after it**. It adds a *"names no particular"*
rejection to the existing `_admissible`, via a new `_particulars()`, and a
`provenance.discovery` field. `hypothesis.py` goes 995 → 1299 lines. None of it
has run against live drafts.

⚠️ The two sentences above are the corrected ones. I first wrote that
`NEWSROOM_REVISION` was `5bda2df` and that `#331` *added* `_admissible` — the
first from a reading twenty minutes stale, the second from not checking. A
control caught the second: `_admissible` is present at `40fb74b`, before the PR.
Both were found by executing the claims before committing them, which is the
only reason this block is worth anything.

Baseline, from the `56554c8` edition that this replaces:

```
causal_panel  panels 8 · consulted 8 · hypotheses 45 · discarded 1
              articles_offered_a_cause 5 · articles_stating_a_cause 1
```

**One discarded in forty-five.** The gate rejected almost nothing before, and
`#331`'s own regression test targets a real published claim it let through.

```
                                 predicted                    why
causal_panel.discarded           >= 8, from 1                 the new rule cuts vague causes
articles_stating_a_cause         <= 1, not higher             fewer admissible causes, not more
provenance.discovery             present on published articles the schema now requires it
errors                           ''                            +304 lines that have never run
```

#### CONDITIONS CHANGED AFTER THE PREDICTION, 2026-09-01T09:03Z

`#342` merged at `37819c5`, **4h57m before the run this block predicts**. I am
recording that here rather than noting it afterwards, because a prediction
scored against conditions it did not anticipate is worth nothing, and the
temptation to explain the difference *after* seeing the result is exactly what
a pre-registered prediction exists to remove.

What changed, and it is not small: `record_claim_holds` is an **eleventh
check**, and `_placement` now emits a note for an ordinary reading where it
was previously silent. So tonight's drafts meet one more gate that can reject
them, and every draft's placement paragraph is built from a different input
than the baseline's was.

```
                          baseline 56554c8    tonight
CHECK_NAMES                        10             11
placement on an ordinary reading   silent    "neither the highest nor the lowest"
```

**Which predictions this touches, stated before the result is known:**

| | affected | why |
|---|---|---|
| `causal_panel.discarded >= 8` | **no** | a different panel; `#342` touches neither `hypothesis.py` nor `_admissible` |
| `articles_stating_a_cause <= 1` | **indirectly** | a rejection here consumes a revision attempt, so fewer drafts survive to state anything — which pushes toward the predicted direction for a reason the prediction did not name |
| `provenance.discovery` present | **no** | independent field |
| `errors ''` | **yes, and it is now a harder test** | +374 validator lines and +99 context lines that have never run against a live draft, on top of the 304 already predicted |

The second row is the one to be careful with. If it comes in at ≤ 1 I must
**not** score it as a hit without checking the rejection log, because `#342`
supplies a second sufficient cause and the prediction cannot distinguish them.
`runs/latest.json`'s `rejected_checks` — the field `#329`'s sibling added for
exactly this reason — is what separates them: a draft rejected on
`record_claim_holds` is `#342`'s doing, not the causal gate's.

**Why merge anyway.** Six of seven measured false superlatives reached readers
from the branch `#342` closes, and `estonia-s-core-inflation` published *"the
lowest in the 296 observations"* when 71 are lower. Holding a fix for published
falsehoods to protect the tidiness of my own forecast would be optimising the
instrument over the thing it measures.

Verified before merging: head guard on a **derived** branch name, test-merge on
pinned `55b57fb`, pytest 2559 / npm 2333 / lint 0 / build 0, and three planted
faults each caught by a named test — including one proving that removing the
`origin is None` silence brings the original defect back (6 named failures).

#### THE FIRST PREDICTION IS BADLY CALIBRATED, AND I AM SAYING SO BEFORE THE RESULT, 2026-09-01T10:20Z

`causal_panel.discarded >= 8` was set from a baseline of 1 in 45, by
reasoning that a new rule "cuts vague causes" and picking a number that felt
like a real change. I have now run the rule itself against real hypotheses,
which I could have done before writing the prediction and did not.

`provenance.hypotheses` is published on articles, so 73 real claims are
recoverable from the corpus. Running `_particulars` over them:

```
discarded, EMPTY vocabulary       24 of 73   33%
discarded, REALISTIC vocabulary   64 of 73   88%
CONTROL  the vocabulary must raise the rate : True
CONTROL  something must still survive       : True

scaled to a 45-hypothesis edition           ~39
predicted here                              >= 8
```

So the prediction will almost certainly be scored a hit, and **that will mean
very little**: I predicted a floor of 8 for a mechanism whose own arithmetic
implies about 39. A prediction that cannot fail is the thing this file spends
several thousand words warning about, and I wrote one into my own scored
block.

**And the way I got there is worth more than the number.** My first run used
an empty vocabulary and reported 33% discarded, with the survivors kept on
particulars like `['lithuania']` — a country name that every claim about that
country contains by construction. I read that as *the gate is close to
vacuous*, and was composing a brief to that effect. It is the opposite of
true. The function ends:

```python
return frozenset(found) - vocabulary
```

The vocabulary is **subtracted**, so a larger one yields fewer particulars and
*more* discards. My empty-vocabulary run was the **minimum** discard case, not
the maximum, and the docstring says so in its first line — *"the nameable
particulars a claim contains, **beyond the finding's own words**"* — and then
spends a paragraph on the exact false negative I thought I had discovered.

With the finding's own words removed, the survivors are `brell`, `lng`,
`russian`, `kazāks`/`mārtiņš`. Those are real particulars. The rule works.

Two things to carry forward. **Test the mechanism before predicting its
magnitude** where the mechanism is runnable — it was, from published
provenance, in about ten minutes. And **an empty argument is not a neutral
one**: passing `frozenset()` felt like "no configuration", and it was in fact
the single most permissive input the function accepts, which inverted the
result and pointed me at a defect that is not there.

The second is the one worth watching, and it is deliberately the **unflattering**
direction: a gate that discards more can only reduce what is left to state. If
`articles_stating_a_cause` *rises*, the model behind this table is wrong and the
reason will be worth more than the prediction — which is what happened to the
yield prediction above.

⚠️ **`discarded >= 8` is a guess at a threshold, not a measurement.** I have not
replayed the rule against the stored hypotheses, and the section directly above
records why a replay would not settle it anyway. Score it as falsified if it
comes in lower; the number is chosen so that "the rule is doing something" and
"the rule is inert" give different answers, which is the only property it needs.

#### SCORED, 2026-09-01T14:30Z — AND THE EDITION FAILED FIRST

**The 14:00Z timer fired and the host killed the run.**

```
14:00:00  Executing 'Functions.newsroom_edition' (Timer fired at 14:00:00.0077895+00:00)
14:10:00  Timeout value of 00:10:00 exceeded
14:10:00  Executed (Failed, Duration=600011ms)
```

Nothing published, and `runs/latest.json` was not written — so from outside,
**a timeout is indistinguishable from a timer that never fired**. The blob is
written when a run finishes. This was diagnosed from `Executing`/`Executed`
with a matching Id, which are emitted at both ends and say which end they are.

The margin had always been thin, and it is derivable from the artefact rather
than from telemetry (whose retention here is under a day):

```
2026-08-31  finished_at 14:08:22Z   502 s of 600 s   margin 98 s (16%)
2026-09-01  killed      14:10:00Z   600 s of 600 s   margin  0
```

**Two rows read as a climb, and the series is not one.** All nine scheduled
runs the workspace holds, in minutes, read from `AppRequests` rather than from
the run reports — which cannot show a run that never finished:

```
08-24  0.55    08-27  1.79    08-30   4.83
08-25  5.53    08-28  5.63    08-31   8.38
08-26  7.10    08-29  5.48    09-01  10.00  killed
```

So **8 of 9 fired and finished unattended**, and the duration swings rather
than climbs — 7.10 down to 1.79, back up to 5.63. The pair above is the top two
values of a noisy series, not its trajectory, and reading a trend off them is
the overfit this file warns about under *one generation is not a measurement*.
What is true is that the workload had reached 84% of the old ceiling before
crossing it, and that 625.8 s against 1800 s is 35% where against the old 600 s
it was **104%** — the fix was necessary, not merely sufficient. Predict nothing
from the last run's duration; watch the ceiling.

⚠️ **`runs/latest.json` cannot answer this and looks as though it can.** It is
written when a run *finishes*, so a killed run leaves the previous report
standing — on 2026-09-01 it read `trigger: manual` from the re-run, carrying no
trace of the timer run that had died nineteen minutes earlier. `AGENTS.md` has
the general rule; the instrument that answers it is the pair emitted at both
ends, plus the exception that names the ceiling in the platform's own words:

```
Executing 'Functions.newsroom_edition' (Reason='Timer fired at 2026-09-01T14:00:00.0077895+00:00', Id=f7575a2c)
Executed  'Functions.newsroom_edition' (Failed, Id=f7575a2c, Duration=600011ms)
AppExceptions  "Timeout value of 00:10:00 was exceeded by function: Functions.newsroom_edition"
```

`d82233b` raised `functionTimeout` to `00:30:00` with a pin. **The re-run took
625.8 s**, so the fix was not merely sufficient but *necessary* — at 600 s it
would have failed a second time. 6 new originals, all stamped `rev=d82233b9`,
which is how we know the new code ran rather than inferring it.

**The scores.**

| Prediction | Observed | |
|---|---|---|
| `causal_panel.discarded >= 8` | **37** | HIT, and near-unfalsifiable — pre-recorded as such at `1c694a8` |
| `articles_stating_a_cause <= 1` | **3** | **MISS** |
| `errors == []` | `[]` | HIT |
| `provenance.discovery` present | absent on all 8 | MISS |

**The miss is the valuable one, and this file called that in advance** — six
paragraphs up: *"If `articles_stating_a_cause` rises, the model behind this
table is wrong and the reason will be worth more than the prediction."* It rose,
1 → 3.

And the pre-recorded correction at `daf65a2` is properly discharged rather than
used as an excuse: `#342`'s `record_claim_holds` rejected **0** drafts, so it is
*not* a second sufficient cause here. The prediction simply failed. The model
was "a gate that discards more can only reduce what is left to state", and the
opposite happened — `hypotheses` fell 45 → 8 while `discarded` rose 1 → 37, so
the panel is now proposing far fewer and better candidates rather than pruning a
long list.

**My own pre-run expectation was wrong in both directions, and I am recording it
because it was written down beforehand.** I predicted attempts would rise and
`publishable` might fall, since two gates landed that morning. Measured:

```
attempts_total   23 -> 18      (2.88 -> 2.25 per article, cap 3)
publishable       5 ->  6
rejected_checks  no_repeated_findings disappeared entirely
```

Both moved the *other* way. Adding gates made the run cheaper and more
productive, which no model I had predicted.

**Both defects fixed that morning are proven on live output**, which is the
result that matters more than any score. Re-swept after the edition: 6 new
articles, 40 new declared figures, and **still exactly the same 9 mislabelled
percentage-point figures — zero new**. `#344` holds at the source. `#342`'s gate
rejected nothing, and the published superlatives are genuine.

⚠️ **That "9" is a count of provenance metadata, and I reported it as a count
of falsehoods. Only 3 ever reached a reader.** Measured afterwards by asking
what the *prose* says rather than what the figure declares:

```
cumulative_change  3 of 3   "...a cumulative change of 5.5% year on year"      WRONG
deviation          6 of 6   "...16.35 percentage points below the seasonal norm" CORRECT
```

The six seasonal ones carry a rate unit in `provenance` and say **percentage
points** in the body, because `detect_seasonal_deviation` is the one detector
that already routed its basis through `units` — which this repo's own notes
say, and which I had read. All three reader-visible ones are now corrected, so
the published corpus is clean.

**The error is the population, again.** My sweep walked *declared figures* and
my sentence claimed *published statements*, and those are not the same set —
a difference of 3×, in a brief I dispatched, a journal entry and two closing
summaries. It is the same fault as the section two pages down about a summary
claiming more than its artefact, committed by its author within the hour.

Two things generalise. **The natural probe measures the machine-readable
field, because it is the one that is easy to enumerate** — and the reader never
sees it, so the interesting population is always the harder one. And a
correction session that stopped at 3 of 9 was **right**, which read at the time
like unfinished work; had it obeyed the brief it would have annotated six
correct articles with notices saying they were wrong.


**The causal panel from `#185` is live and behaving correctly in both
directions**, which is the harder thing to demonstrate. One article published an
attributed, hedged, figure-free cause — *"Dr. Ineta Zvirbule suggests this is a
likely explanation, but the data cannot confirm it."* The other refused: *"The
data does not show what drove the change… and no specific causes can be
confirmed."* A panel that found nothing and a panel nobody convened look
identical in the output unless you check; these were checked.

**The real problem was never liveness — it is signal starvation**, and the
08-27 run says so in its own words:

```
ranking: 50 signal(s) considered … 49 already published … 0 selected
quiet day: 0 article(s) will be written. This is the intended behaviour —
           the pipeline has no mechanism to top the wire up.
```

Series coverage grew 12 → 90 and signals 3 → 50, but the detectors all read
`series.latest`, so against monthly and quarterly data a daily timer consumes
each release on the first run after it lands and finds nothing until the next.
**Adding more monthly indicators cannot fix this.** `#189` added the one lever
that can — `demo_r_mwk_ts`, weekly deaths — plus building permits and gas
prices. `#206` now alerts when a run generates zero originals, so a quiet day is
no longer silent.

**The desk is not the bottleneck either.** Approval rate by day: 08-25 6/41
(13%), 08-26 18/24 (43%), 08-27 17/3 (85%). The previous run's editorial work
solved it. I nearly briefed a session to fix it and the measurement stopped me.

---

## Guidance from the last prompt that was WRONG. Do not inherit it.

Each of these was in the brief I was handed. Each cost something.

- **"A grep for telegram/webhook/alert/notify returns nothing."** False.
  `newsroom/pipeline/editor.py` has a working `TelegramEscalationNotifier`,
  `config.py` reads `NEWSROOM_TELEGRAM_BOT_TOKEN`, and
  `.github/workflows/telegram-check.yml` is a live delivery check. There are now
  **two** monitors using it (`source-alert.yml`, `wire-alert.yml`) sharing one
  notifier. Do not build a third.
- **"No data export anywhere."** Shipped in `#187`: CSV and JSON on every
  indicator surface, free.
- **"Nothing alerts the owner when a source goes stale."** Shipped in `#188`
  and `#193`.
- **"Use the existing `ocean-*` Tailwind palette."** This was in `AGENTS.md`,
  I repeated it verbatim in a brief, and it is false: `ocean-` appears in
  `src/index.css` and `AGENTS.md` and in **zero** components. Corrected.
- **"Assert `git diff --stat` is non-empty to prove a plant applied."** Wrong
  in three independent ways — see the instrument section. This is the single
  most important correction in this document.

---

## The three practices that found almost everything

**Read the published artefact.** This was the highest-yield activity of the run
by a wide margin, and it is the one a manager is uniquely placed to do — the
sessions are inside the code, and nobody else is looking at what the site
actually published. Everything it found had passed every automated gate:

```
5 published articles carrying real figures under metrics they did not measure   (previous run)
3 false claims on /api-docs, incl. a €15/mo Pro feature that shipped free 90 min earlier
3 of 10 tier A articles inflating JSON-LD citations 3 identical entries deep
€259 printed beside €26 with no noun, from two branches disagreeing on a threshold
a gap of 29.6 restated as a level, a direction, and the wrong pair of countries
```

Not one of those is findable from a test run, a diff, or a CI log. Several were
findable only by holding two numbers side by side and asking whether they mean
the same thing. **Budget an hour a day for it and treat it as primary work, not
as a check on the sessions' work.**

> **The 2026-08-30/31 run confirms this at a scale that should settle the
> argument. Reading published articles found NINE false claims, one in a
> headline, and not one was reachable from any test of the producer** — because
> the producer was right every time. The detectors supplied correct comparison
> bases; the writer restated them about the wrong population.
>
> ```
> LV rail passengers      "highest ... in 39 obs since the series began 2016-Q3"
>                         15 higher in our own window · 55 in the series
>                         series max 7781 vs the claimed 4653 — 67% out
> EE inflation (HEADLINE) "drops to 2%, the lowest in the series"
>                         79 lower · true minimum -2.1% in 2009-10
> + EE economic sentiment, LV house prices, LV retail, LT construction,
>   LT producer prices, LT cars, LT renewable share
> ```
>
> **All nine share one sentence**: *"the lowest/highest in the series"* on a
> series we had never seen, because the collector fetched a window and
> `series_start_value` handed the writer that window's first period under a name
> claiming it was the origin. **The falsehood was manufactured upstream and
> named as fact**; the writer repeated it accurately.
>
> Two of the twelve measured were **true by luck** — the cube's real extreme
> happened to sit inside our window. `lithuania-s-crude-birth-rate` says *"the
> lowest reading in the series"* over 19 observations of a 66-observation cube
> and is correct, because 2025 genuinely is the lowest since 1960. **The prose is
> identical in the true cases and the false ones**, which is why no prose guard
> could ever have separated them and why the fix had to be at collection time
> (`#280`, `c5afdd0`).
>
> Eight corrected and verified to the accessibility tree; the ninth was in flight
> at handover. **`#257` and `#280` are both needed and one article proves it**:
> after `#257` the claim carries its window (*"the 20 observations since…"*), and
> the window is then named as the origin — the half only the collector could fix.

**And here is what that practice cannot tell you, found by getting it wrong
twice in one hour.** The corrections apparatus is **append-only by design** —
`corrections.py` argues the rule at length, and it is the right rule, because a
correction the reader cannot check against the page is worse than none. The
consequence is that a corrected article's body prose **stays false for ever**:

```
uncorrected false article    body[2] is false
corrected   false article    body[2] is false, + a warning panel above it
                             -> the separator is `corrections`, never the body
```

So *read the artefact* — the highest-yield practice in this document — is
**structurally unable to answer "is this still wrong?"**, because it directs you
at the one field the remedy deliberately does not touch. On 2026-08-31 I read
two article bodies, confirmed the arithmetic against the live series, and
briefed a session that two falsehoods were "live on the site now". Both had been
corrected four hours earlier. I then began sizing a nine-article backlog on the
same premise; re-run with one extra field it came back **9 of 9 already
corrected, 0 uncorrected**.

**Bound this before you carry it away, because "the body stays false for ever"
reads worse than the truth.** The limit is on *our verification practice*, not on
the reader's experience. Measured in a browser by walking the rendered document
in order:

```
H1                 Latvia's industrial electricity price dr…
CORRECTION NOTICE  "Corrected 31 August 2026: CORRECTED. This article said…"
BODY PARA          "Latvia's industrial electricity price has decrease…"
```

The notice sits **between the headline and the first body paragraph**, carrying
the description and the previous value, and `ArticleView` renders it from
`article.corrections ?? []` so a null is handled. 15 of 38 live articles carry
one — 39%, which is why the distinction matters: *"15 live falsehoods"* and
*"15 correctly-labelled corrections"* are very different states and only the
second is true. A corrected and an uncorrected article are byte-identical in
`body`, which is where an auditor looks. They are not identical to a reader.

Two things make the auditor's half worth a paragraph rather than an apology.

**The discriminator was in my own terminal output.** At 10:20Z I printed the
article's key list, which ends `..., published_at, corrections`, and read past
it to `provenance` and `body` — the fields that supported the story I already
had. That is the `41e10b5` shape one step earlier: not substituting a weaker
instrument after a failure, but never consulting the field that could
contradict me.

**And the answer was written down, in the block immediately above.** It ends
*"Eight corrected and verified to the accessibility tree; the ninth was in
flight at handover."* I am the manager of this document and I was working from
my recollection of the corpus rather than from the file — the *photograph of a
moving file* rule, collecting on its own author within the hour, and in the one
direction that rule does not warn about: not a stale quote, but a passage never
re-read at all.

Verifying *this* entry then hit a third trap from the same family. I checked the
quoted line really preceded my entry, and my probe reported that it did not —
because the original is **line-wrapped** across two lines, so a per-line search
matched only my own single-line copy of it, 34 lines further down. The ordering
was correct all along. `AGENTS.md` names that trap, and it defeated the check
written to verify a paragraph about failing to check.

The action is one field: **when reading a published artefact, read its
correction record before concluding anything about what stands.** The body is
evidence about what we published. Only `corrections` is evidence about what is
still claimed.

**Verify every PR yourself before merging.** `scripts/verify-pr.ps1` exists now
and does it in one command: it checks `headRefOid` against `git ls-remote`,
test-merges onto current master in a throwaway worktree, runs build/test/lint on
the **merged** tree, and optionally checks the diff stayed inside the session's
owned file set (`-OwnedPaths`). Use it. **Re-run it if master moved between your
first check and the merge** — that happened twice this run.

> **And know that the protocol can be bypassed, because it was, three times in
> one day.** Seven PRs merged before I had verified them; six were fine and one
> left **master lint-red for twelve minutes** — `Date.now()` in a render body,
> which CI's `quality` job had already failed and which I had held in writing.
>
> **A head-SHA check is a claim about the instant it ran**, which is the
> `readAgoMs` defect in the tooling: the check passed at 09:22Z, the branch moved
> afterwards, and the PR merged at the stale SHA the record still held. So the
> durable guard is not a better pre-check —
>
> **run `npm run lint` and the suite against `origin/master` after ANY merge you
> did not perform.** Content verification is the only check whose truth does not
> depend on when it ran. It caught this in under a minute, by accident, because
> another PR's merged tree carried the error.

**Plant a fault and confirm the check fails before believing it passes.** This
found, this run: a guard against a missing branch defeated by a missing branch;
a typography rule blind to two of three real faults; a freshness assertion blind
to precisely the mismatch it existed to catch; and a mutation harness whose own
"working tree restored: True" was computed from a broken instrument while ten
mutations sat in the file.

**A plant that passes may be telling you the state is unreachable.** The reflex
is to strengthen the test until it fails; sometimes the correct response is to
delete a sentence instead. Two instances, both mine, both on the last day:

- I declined to build a guard requiring every tier A/B source to have a display
  name, because tier C returns early in `ArticleView.tsx:250` and never reaches
  `ProvenanceBlock` — the gap is real and cannot be reached. That is the
  `#172` case, and `AGENTS.md` covers it: an instrument aimed at a fault that is
  not there.
- Then a plant swapping `items` for `shown` in `ElsewhereRail` **passed every
  test**, because `useOutlets` derives the filter buttons from `items`, so no
  reachable filter matches nothing. My comment claimed the guard preserved an
  announcement for "a filter that matched nothing". That state does not exist.

The second is the one `AGENTS.md` does not cover, and the distinction is worth
carrying, in the words of the session that drew it:

> A guard hardened against an unreachable state is the belt-and-braces the book
> warns about; **a comment describing an unreachable state is a false claim
> about the code that will be believed by the next reader.**

So: when a plant survives, ask whether the state it targets can occur *before*
hardening anything. If it cannot, the defect is in the prose.

**Prove the plant applied by comparing file CONTENTS, not `git diff --stat`.**
This check has now lied in **seven distinct ways**, found by six different
sessions and by me, and all failing in the direction that reports success:

```
untracked file                     git diff --stat is always empty
after git checkout -- <paths>      the restore is STAGED, so the bare form is empty
plant edits an already-dirty line  the stat line is byte-identical
content hash across a checkout     line endings are normalised, so bytes differ
TEXT-mode read/write round trip    the converse: read_text() translates CRLF to \n
                                   and write(newline="") emits \n, so the FILE
                                   flips to LF while a text comparison of two
                                   translated reads is always equal
"the replacement is present"       the replacement was already a substring
the assertion is page-scoped       a sibling element carries the same string, so
                                   deleting the thing under test leaves it green
```

The fifth is the mirror of the fourth and it is worth seeing them together: one
is a **byte** comparison defeated by normalisation, the other a **text**
comparison hiding a byte difference — in the check whose entire job is
byte-identity. It was caught only by reading `git status` after a restore that
had already reported `byte-identical: True`, and `git status` said *modified*.

**So verify a restore two ways: compare bytes, and ask git.** `ReadAllBytes` +
`SequenceEqual` answers "is the content the same"; `git status --porcelain <path>`
answers "does the repository agree", and on Windows those are different
questions. Either alone has now been wrong.

The last one is the subtlest and it is not about plants at all — it is about
**what the assertion is scoped to**. A test asserting a period "appears on the
page" was satisfied by the stale notice, which carries the same period, so
removing the date from the element whose honesty was in question passed. **Scope
an assertion to the element under test, not to the document.**

One session's mutation harness reported its own *"working tree restored: True"*
from that same empty diff while ten mutations sat in the file. **The
applied-check must assert the ORIGINAL clause is GONE**, not that the new one is
there. Use `git status` as the authority for a checkout-based restore and a
content comparison for a direct write; the two are not interchangeable. Restore
from the string you read, in a `finally` — `git checkout --` reverts to HEAD and
will destroy uncommitted work in the same file.

**Plant against the boundary, not far past it.** Two sessions independently hit
this: a "stale" case chosen thirteen months past a three-month threshold is
stale under the old rule too, so the plant passes and tells you nothing about
where the boundary is.

**A plant against a "greater than zero" assertion must remove the whole
population.** Removing one of four declarations correctly left it green.

---

## Instrument discipline — still the dominant failure mode

I hit a wrong reading roughly once an hour, all day, knowing this. Assume you
will too. Traps measured this run, on top of the six the last prompt recorded:

- **PowerShell's `..` range operator eats a git revision range.**
  `git rev-list --count $rev..origin/master` returned a confident **0** —
  "fully deployed" — where `"$rev..origin/master"` returned **5**. Always quote.
- **`@($null).Count` is `1`.** An absent array counts as one present item, so
  every "did this happen?" tally built on `@(...).Count` reports one occurrence
  of nothing. It has now produced a retracted finding in this programme (180
  prose blocks, `0` with zero figures — the real answer was 57 of 180) and
  nearly invalidated a second survey the same day.

  **Keep the second one, because it is the more useful half: the conclusion was
  right and the instrument was broken.** Auditing whether published falsehoods
  were still uncorrected, I counted `@($a.corrections).Count`. Nineteen of
  thirty-four articles carry `corrections: null`, and every one of them was
  being counted as *corrected*. Re-run counting only entries that carry a
  `corrected_at`, the answer was **still 9 of 9** — none of the nine happened to
  be a null.

  So the reading survived, the method did not, and nothing in the output could
  have told me apart. What broke the tie was one article reporting
  `corrections=1` with an **empty timestamp and empty description** — absurd
  enough to disbelieve, which is the only row of the taxonomy that defends
  itself.

  **And that absurd reading was the bug displaying itself.** There is no
  malformed correction anywhere in the corpus — measured, `present-but-blank:
  0`. `@($null).Count` had manufactured a single "entry" which, being `$null`,
  had no timestamp and no description to print. A quieter version of this bug —
  one that miscounted by a plausible amount — would still be in this file,
  because nothing else about the run looked wrong.

  **The remedy is not a stricter probe. It is a partition that has to
  reconcile.** `null + corrected == total` cannot be satisfied by an instrument
  that is guessing, and it settled this from both ends:

  ```
  ARTICLES   88 total = 73 with `corrections: null` + 15 carrying one
  ENTRIES    16 real, 0 blank      <- one article carries two
  ```

  Another session counting the feed rather than the index reached the same **19
  originals carrying `null`** independently, which is the corroboration a single
  probe cannot give you.

  **And the partition caught its own author within minutes.** My first draft of
  this paragraph wrote `73 + 16 = 89` against a total of 88, because I had
  summed *articles* with *entries* — one article carries two corrections. The
  arithmetic refused, which is the entire point: a bare count of 16 would have
  been believed. **State which population you are counting, and make the sum
  fail when you mix two.**

  That matters because the instinct after a counting bug is to tighten the
  method, and tightening introduced a *new* failure the loose version did not
  have. Filtering on `$_.corrected_at.Trim()` looks more rigorous and is worse:
  `ConvertFrom-Json` coerces those timestamps to `[datetime]`, which has no
  `.Trim()`, so the expression throws inside `Where-Object`, **every entry is
  silently dropped**, and the count comes back `0` with a browser open showing
  one. Two symmetric errors in one afternoon — a null counted as one, a real
  entry counted as none — both invisible in the output, both caught only because
  the number was ridiculous rather than merely wrong.
- **`git rev-list --count origin/master..<branch> > 0` does not mean the branch
  holds unmerged work.** Squash merging guarantees it is non-zero for *every*
  merged branch, so a sweep built on it reports each one as stranded. Measured:
  a worktree sweep on 2026-08-29 flagged five sessions as "stuck with unpushed
  commits"; all five branches were already pushed, all five PRs were **merged**,
  and every file was on master. This is the same fault as `git branch --merged`
  wearing a different command, and it survived being written down in that form —
  so settle it on the PR record (`gh pr list --head <branch> --state all`) or on
  the **content** (`git cat-file -e origin/master:<path>`), with a control that
  must come back false.
- **A dirty worktree is not stranded work — `git status --porcelain` cannot tell
  a session mid-edit from one that abandoned its tree.** The sweep is worth
  running, because `gh pr list --state open == 0` reported a clean programme
  while 737 uncommitted lines sat in a worktree, and I committed them to their
  own branch to protect them. But run it with an **mtime column**, because the
  next hit was the opposite case and looked identical:

  ```
  causal-explanation   14 files   flagged twice, no action across two reports   -> rescued
  friendly-sniffle      2 files   newest edit 8 SECONDS ago                     -> live session
                                  ...and the tree was clean again within 2 min
  ```

  Both read as `2 dirty path(s)` and `96 insertions`. Committing the second
  would have squatted on another session's in-flight edits and collided with
  their own commit a minute later. **Two states, one artefact; the separator is
  the file's age, not its content.** So: sweep, sort by newest edit, and treat
  anything touched in the last few minutes as someone working — flag it, do not
  rescue it.
- **`git push --quiet 2>&1 | Out-Null` cannot report a rejection, and the
  obvious confirmation answers identically either way.** I pushed, silenced the
  output, then read `git rev-parse --short origin/master` and reported that SHA
  as mine. The push had been rejected non-fast-forward; the SHA I read back was
  a *different session's* commit that had landed in between. Nothing looked
  wrong — this is the **plausible** row of the taxonomy, not the absent one, so
  no instinct fires. It surfaced an hour later only because I traced a code
  change to that SHA and the subject line was somebody else's. Confirm a write
  by reading the **content** with a control, never by re-reading a pointer:

  ```
  git show origin/master:PATH | Select-String 'the thing I wrote'   -> PRESENT
  git show origin/master:PATH | Select-String 'a phrase never written' -> absent
  ```

  The commit survived as an orphan only because it was reachable from the
  reflog; `git reset --hard` had already moved off it.
- **A 404 from a guessed path is not evidence of absence, and "print the shape"
  does not help — there is no shape to print.** Hunting the rejected drafts I
  probed `rejected/<slug>.json`, `drafts/<slug>.json` and the bare slug, got 404
  three times, and wrote *"rejected drafts are not persisted publicly"* in a
  brief. They are: `runreport.py:78` states the path in prose —
  `rejected/<day>/<slug>.json` — and every one fetched first try once I read it.
  Same hour, same class: `runs/latest.json` 404'd where `articles/runs/latest.json`
  served. **The remedy for a missing field is to print the structure; the remedy
  for a missing path is to read the code that writes it.** A 404 carries no
  structure to inspect, so the usual instinct has nothing to work with and the
  absence looks settled after three tries. This one nearly closed the newsroom's
  highest-value open question by declaring its evidence non-existent.
- **A non-zero exit explained away, then "confirmed" with a narrower command.**
  This is worse than believing a bad reading, because the correct signal was in
  hand and was discarded. Measured on my own `#301`:

  ```
  npm test            empty filtered output, EXIT CODE 2
  my reading          "just Select-String buffering"
  my substitute       npx vitest run          <- SKIPS the typecheck
  reported            127 files / 2279 passed, lint 0, build 0
  actually            tests/registryDuplicateKeys.test.ts: error TS7016
  ```

  `npm test` is `npm run typecheck && vitest run`; `npx vitest run` is the
  second half alone. `npm run build` stays green because it is `tsc -b` over
  the **app** project, while the tests are `tsconfig.test.json`. So all three
  green figures in that report were true and none of them covered the gap, and
  master was broken by a change whose author had run the command that would
  have caught it.

  Two rules. **When a command exits non-zero, read its output before
  explaining it** — an empty *filtered* view is not an empty result, and
  `2>&1 | Select-String` hides exactly the lines that matter. And **never
  substitute a narrower command for one that just failed**: the substitution
  agrees with whatever story you told yourself, which is what makes it feel
  like confirmation.

  **The second rule did not fire on the next run, because of its own
  precondition.** The 2026-09-01 manager never ran `npm test` at all — the
  gate was `npx vitest run`, `eslint`, `vite build`, `pytest`, four commands
  none of which typechecks. Nothing had "just failed", so a rule about what to
  do *after* a failure had nothing to attach to, and `#349` merged with nine
  `error TS2345`s in it. Master went red across two merges and the deploy was
  skipped for 35 minutes, taking `#349`'s own fix off the site.

  So state it unconditionally: **the gate is `npm test`.** Not a command that
  runs some of what it runs. A composite script exists precisely because the
  parts are separable, and the part that gets dropped is invisible — a suite
  that passes looks identical whether or not a typechecker ran before it.
  `vitest` cannot see a type error at all, because esbuild strips types
  without checking them.

  And a second one, from the same merge and cheaper still. `gh pr view`
  reports two fields about mergeability and I read one:

  ```
  mergeable         MERGEABLE     <- what I checked
  mergeStateStatus  UNSTABLE      <- a required check is FAILING
  ```

  `UNSTABLE` is not a caveat on `MERGEABLE`; it is the CI result, and GitHub
  was telling me the answer while I merged past it. **Refuse to merge on
  anything but `CLEAN`** — or `BLOCKED`, which here means awaiting review
  rather than failing. Swept across all 18 merges that day, this was the only
  one I introduced; the other reds were a genuine wire alert.

  The near-miss twin: `chartRef.test.ts` already imported that same registry
  with `createRequire`, for this exact reason. The correct sibling was one
  `git grep` away — *"when you audit the consumers, audit the input they
  share"*, and I wrote a second consumer without reading the first.
- **Your instructions are a photograph of a moving file.** `AGENTS.md` is
  injected into every session's context at start. It is also edited *during* the
  run — this programme touched it in **14 commits in two days**. So a quotation
  from your own instructions is a **recollection**, subject to every rule this
  file states about remembered figures, and it has the one property that makes a
  recollection dangerous: it arrives verbatim, in the voice of the document, with
  no visible age.

  Measured. A session spent an hour resolving `migr_asyappctzm` because the
  survey note in its context read *"newsworthy; codes unresolved. Worth another
  attempt."* The file on disk said:

  ```
  in context   "codes unresolved. Worth another attempt."
  on disk      "RESOLVED 2026-08-29 -- codes resolved, definition measured",
               with the full pin, the coverage measurement, and the ruling
               FRST over TOTAL, "because repeat applications track case
               processing, not arrivals"
  ```

  The indicator was already in the registry at line 562, **457 lines above**
  where the session appended a second copy of it — with the pin the file had
  explicitly ruled against, under a title a reader could not distinguish.

  **The tell is that nothing looked wrong.** No probe returned absent, no number
  was absurd, no command failed. The session did careful, correct work on a
  question that had been closed two days earlier, and the file would have said so
  in one `Select-String`.

  So: **open the file, do not quote the context.** This is distinct from the
  recollection rule already in `AGENTS.md`, which is about your own memory of
  what a document says — here the text is verbatim and still wrong, because the
  document moved. The action is different too: not "read the passage again" but
  "read it *from disk*, in this worktree, now."

  What made it expensive rather than merely wrong is the second half, and that
  part is about registries. A JS object literal takes the **last** repeated key
  with no error, `Object.keys()` deduplicates so no test can count it, and
  ESLint never runs on `api/` — `eslint.config.js` matches `**/*.{ts,tsx}`, so
  `no-dupe-keys` is not in play at all.

  **But "every guard was blind" is not what I measured, and the truth is more
  useful.** Planting the real duplicate two ways:

  ```
  duplicate with a WIDER band  [0, 20000]
    indicators.test.ts     1 failed   "sizes the asylum band so it excludes the
                                       EU27 aggregate ... whose lowest month
                                       is 7,845: expected 20000 to be less than"
  duplicate with the SAME band, only applicant=TOTAL instead of FRST
    indicators.test.ts     322 passed          <- blind
    registryDuplicateKeys  1 failed, naming INDICATORS.asylum_applications
  ```

  So the sanity band **is** a real discriminator and it caught the loud version:
  5000 clears the Baltic extreme by 3.4× and sits 36% below the EU27 floor, so
  it separates *our three countries* from *we are accidentally reading Europe*.
  What it cannot see is the quiet version — the same band with a different pin,
  which swaps the statistic under an identical title and passes 322 of 322.
  `tests/registryDuplicateKeys.test.ts` owns that case. Saying which corruption
  each guard catches is worth more than the sweeping claim, and the sweeping
  claim was the one I nearly wrote down from a session message without
  re-deriving it.
- **`az monitor app-insights query` fails with a bare `BadArgumentError`**
  whenever the KQL contains a **double-quoted** string literal. Single-quote
  them. Use `--offset P21D` rather than `ago()`.
- **`gh run rerun` replaces a run's `conclusion` in place.** A run that failed
  can later read `cancelled` or `success`. Read `attempt` before trusting
  `conclusion` — and do not re-run a job whose original outcome is still
  evidence you need. I destroyed my own primary evidence that way.
- **`Invoke-RestMethod` silently coerces ISO timestamps to `[datetime]`** and
  renders them in host locale, so string comparisons against `'2026-08-26'`
  return zero rows. Filter in KQL, or use `node` + `fetch` for JSON with dates.
- **`process.argv[1]` in node is the script path**, not the first argument. My
  probe required itself and failed identically on two trees that should have
  differed — which was the tell.
- **A count is not a usage.** I grepped a workflow for `continue-on-error` and
  `success()`, found one of each, and nearly filed a contradiction. Both were
  inside the comment explaining why they are not used.
- **CRLF.** A multi-line find string built with LF silently matches nothing.
- **`git worktree remove --force` follows a directory junction and deletes the
  target.** It emptied this repo's `node_modules`, and the next `npm run build`
  failed with `'tsc' is not recognized`, which reads as a broken machine.
  Measured control: `Remove-Item -Recurse -Force` does **not** follow it — so
  my first explanation was wrong and a control caught it before it shipped.

### The rule that generalises all of them

**The reporting layer, not the subject, is what swallows the reading.** Three
probes returned nothing this run for three different reasons — vitest does not
surface `console.log` from a setup file; a CI log puts ANSI codes between a
filename and its `(`; pytest captures stderr without `-s`. In every case *the
control was absent too*, and that is the only thing that exposed the probe
rather than the code.

**So: emit a control through the same channel, always.** A reading of zero from
an instrument you have not proven can see anything is not a measurement. The
best example this run: a session measured sixteen routes at `overflow 0` and
then injected a 600px div to prove the probe could report a non-zero.

> **And its harder sibling, earned 2026-08-31: a control must be SIZED, not
> merely present, because a partial result is the default failure mode of
> anything that scans.**
>
> A session hunting misattributed magnitudes used `[^.]*` for "within one
> sentence" and it stopped at the decimal point: `41.75%` became `75%`, and the
> count of magnitude-bearing clauses came back **2 where the answer was 6**.
> `AGENTS.md` names that exact defect and supplies the fix — **the book prevented
> the second occurrence, not the first.**
>
> ```
> an ABSENT result announces itself
> a PARTIAL result looks exactly like a complete one
>   -> the only thing separating them is knowing how much there should have been
> ```
>
> A truncating regex, a paginated API returning page one, a directory walk that
> stops at a symlink, a query with an implicit `LIMIT` — all return *something*,
> and something is what every ordinary check tests for. **Assert the matched
> span, not merely that a match occurred.** "The known instance was found" is
> satisfied by finding one character of it.
>
> The session had the tell — `2 → 6` — only because they re-ran the same corpus
> after fixing the regex. Fix it before the first run and you report six, with no
> idea it might have been two.

> **A control pair has a free self-check, and it caught me.** Verifying a claim
> that a named constant was inert, I ran the mutation on "master" and on the
> branch and got **RED on both** — which contradicted the session. Rather than
> report it I looked: the PR had merged four minutes earlier, so my "master"
> worktree was cut from the post-merge tree and **both readings were of one
> tree.** The honest pair is `GREEN` pre-merge, `RED` post, confirming them
> exactly.
>
> **RED-on-both is structurally impossible for a control pair** — the two sides
> are *defined* by disagreeing, so agreement is a statement about the setup and
> never about the subject. That check is available before you know anything about
> the code. **Any measurement whose two arms must differ has it; one whose arms
> merely usually differ does not.**
>
> The cause is `AGENTS.md`'s *"state the SHA you measured, not the branch"*,
> arriving in the instrument built to check other people's work. A stale value
> looks wrong eventually; **a stale tree looks like a valid measurement forever.**

**And I guessed JSON object shapes wrongly six times in one day**, including
twice on the same endpoint after `AGENTS.md` warned about it. `/api/system-status`
is `dataSources.checks[].{name,status,freshness,…}`; article checks are at
`provenance.validator.checks`, not `provenance.checks`; article sources key on
`source_id`, not `id`. I also guessed the column names of **my own SQLite
journal table**, created by me the same day. **Print `Object.keys()` on the
parent before reading any child**, and do it for your own artefacts too.

### Additions to the taxonomy, all earned today

*(This heading said "Two additions" until the count went stale inside the
document that records the rule about counted claims. Dropped rather than bound,
per the audit below.)*

**A plant reports the same silence four ways, and only one of them is a
finding.** This was three-way at handover and is four-way now, the fourth
contributed by a session that hit it against my own code:

```
never applied                      silence   <- a wrong find string, a CRLF regex
applied, changed nothing           silence   <- NOT LOAD-BEARING, itself a finding
applied, left the file unparseable silence   <- pytest never ran; reported GREEN
applied and caught                 RED
```

Three of four are indistinguishable at the point you read the output, so **the
harness must separate them; the reader cannot.** Asserting the mutation *applied*
is not enough — a stray backtick changes the text and still leaves the file
unparseable, and a variable can be created and never reach the return. The
necessary conditions, in order: **the text changed, the file still parses, and
the plant reddens something.** Only the third makes a green verdict mean
anything.

The second row is the one worth hunting on purpose. `GRACE_MS = 0` changed
nothing a reader would see, because the constant that *named* the grace window
drove the inner `cache.memo` while a bare literal drove the outer `withCache` —
the layer a reader's outage actually passes through. **A constant that names a
window and does not control it is worse than a magic number**, because it invites
you to read the constant and believe the behaviour. Proved with a control pair:
the same plant is **green on master** and **red on the branch**, and the green
half is what establishes the defect was real rather than the fix decorative.

**A lint rule constrains shape, a type constrains structure, and neither can
observe an effect.** Both defects in that pair were *shaped* correctly: a clock
moved into state satisfied `react-hooks/purity` and never ticked, and `GRACE_MS`
read correctly at both sites and governed nothing. `react-hooks/purity` can tell
you the clock is in the wrong place; only a test can tell you it moves.

**A partial correction can raise the credibility of the error it did not
address.** The ninth false article carried two falsehoods; a note fixing only the
dated one would have supplied, in our own voice, the fact the surviving sentence
depended on. Correcting one paragraph and leaving its neighbour is not half a fix
but a **worse artefact than none**, and nothing about the first note's own
correctness reveals that.

**A self-consistent artefact is not evidence.** Asked whether origin claims could
now be checked automatically, the honest answer was *going forward yes, backwards
no* — because every pre-`c5afdd0` article recorded the window boundary as
`series_start_value`, so its own pack agrees with its own false claim and a check
returns green. Same species as a guard reproducing its subject, arriving in the
archive rather than in a test.

**Work held pending a decision can be invalidated by the change it was waiting
behind**, and a faithful implementer cannot see that from the patch, because the
patch reads as correct — it *was* correct. A `prompts.py` fix teaching *"we do
not know when the series began"* was retired rather than applied, because `#280`
made it false and applying it would have deleted the most informative
construction the pipeline now supports. `#172` with a timestamp on it.

**When you fix a shared input, enumerate its consumers.** `AGENTS.md` has the
converse — *"when you audit the consumers, audit the input they share"* — and
this is the half it is missing, because it is the half that fails silently.
Measured: the `#194` field-meanings registry was written to stop one number
being described as two things, and it reached **one of three** stages that build
that table from `signal.fields`. The two it missed run *first*, and the analyst's
own prompt tells the writer to quote its claims almost verbatim. So a correctly
informed writer faithfully reproduced a corrupted brief, and a published article
called a **spread between two countries** a *reading*, said confidence had
*"risen sharply"* when all three countries were negative, and had four attributed
hypotheses explaining a rise that never happened. Validator 10/10 throughout.
**A fix that reaches one of three consumers looks exactly like a fix that
worked.**

**Take the branch from the pull request, never from session metadata.** I read
an entirely different branch while verifying a PR, because the cross-session
message header named the session's branch and the PR was on another one. The
wrong branch *existed*, had real content, and still contained the un-fixed
line — so the reading was plausible, reproducible, and perfectly consistent with
*"the session did not do what it claimed"*. Two forced fetches failed to
reconcile it because I was reconciling the wrong ref. `verify-pr.ps1` had been
reporting `head-sha PASS` the whole time because it resolves the branch from the
PR record. **The correct sibling was sitting beside my hand-rolled check and I
trusted mine** — which is the same shape as every other instance of that pattern
in `AGENTS.md`, arriving in the tooling rather than in the code.

**Make the instrument say what it measured, rather than remembering.** This is
the mechanical form of the rule above, and it is the one to actually implement,
because three separate instrument failures this run were the same shape: a
reading that was correct when taken and silently stopped being correct, with
nothing about holding it to say so.

```
a detached `vite preview` still answering on 4321 all afternoon, serving
  whatever build it was started with
a flake control measured on a tree that acquired the fix an hour later
a branch ref resolved from session metadata instead of the pull request
```

The fix that worked was a `/__which` endpoint on the local preview server: it
names the `dist` it is serving, so **every reading carries its own provenance and
a stale instrument identifies itself instead of being remembered as fresh**. The
same move is available almost everywhere — state the SHA beside the measurement,
print the resolved path beside the file count, name the endpoint beside the
field. A remembered fact about your instrument is exactly as unreliable as a
remembered fact about the code.

**And when sessions do that, expect their premises to have expired anyway.** On
2026-09-01 five implementation sessions sent me six reports whose premise was
already false on arrival:

```
#345  MERGED 10:50:33Z   reported OPEN, from base 511f239
#344  MERGED 10:51:57Z   a second commit reported unshipped -- it was in the squash
#343  MERGED 10:46:55Z   reported "green, head 4ae6e2c" -- that head IS what merged
#349  MERGED 12:13:03Z   a duplicate announced as forthcoming; it had landed
#348  MERGED 12:16:15Z   a gap reported as open, closed four hours earlier BY THE SENDER
plus  a base three minutes older than the AGENTS.md section it reported missing
```

Not carelessness. **The expiry is a property of writing a thorough report**: each
of those took long enough to compose that master moved underneath it, and master
moved 26 commits and `AGENTS.md` alone took 7 while one of them was being
written. A careful message is slower than a careless one and therefore *more*
likely to arrive stale — which is exactly backwards from how it reads.

So the manager's rule is not "ask sessions to be current", which is not
available. It is: **treat every incoming premise as expired and re-measure
before acting on it.** Six for six today, each settled in one command, each
against work that turned out to be sound.

And the reason one command sufficed is the rule above: **every one of them
stated its SHA.** That is what separates "this session is confused" from "this
session measured a different tree", and without it the only remaining move is
to re-derive their whole finding. The practice works; it just does not prevent
the expiry, and it was never going to.

The cost of getting this wrong is not a wasted probe. Twice today a session was
about to rebuild work already on master, and once one was about to write a
second copy of a rule — and this file's own position is that two copies of a
fact drift immediately, in the direction nobody is watching.

**And a phrase that wraps is invisible to a line-based search — twice over.**
Three instances, one family, and the last is the sharpest because the newline is
not the culprit:

```
#222's verifier   flattening a quoted sentence dropped a `//` into the middle
                  of it, and reported a verbatim quote MISSING
a session's grep  Select-String matches per line; the phrase spanned a break
                  -> 0 hits on text that is present
mine, minutes on  joined the whole file and STILL missed it, because the
                  continuation line begins "> " and the join left that marker
                  sitting inside the phrase
```

So the fix is not "search the whole file" — I did that and still got a false
absent. It is **strip the line-leading markup before joining**, or match a
fragment short enough not to wrap. Verified on the same text: naive join
`False`, markup-stripped join `True`.

A fourth arrived while writing this down: the multi-line anchor for this very
edit was built with LF against a CRLF file and matched nothing, silently.

Every one produced a confident *absent* on text that was there, and each was
caught only by printing the shape. **A one-line grep is an instrument like any
other, and it is the one nobody thinks to distrust.**

**The second instance is `git diff --stat`, and the pair gives the criterion.**
Reading the diffstat before committing caught three of my own errors in one day:
twice a `PROGRAMME.md` insert **consumed the neighbouring heading** rather than
preceding it, and once a replayed one-line fix turned out to be a wholesale file
copy from a stale tree — a silent revert of another session's work, wearing a
fix.

```
first attempt   32 insertions(+), 1 deletion(-)    <- a deletion I did not intend
after fix       31 insertions(+)

a "one-line change"   15 +--------------           <- fourteen lines of someone
                                                      else's work, about to go
```

Two instances, one property, stated by the session that drew it:

> both make an instrument state what it did, so a wrong one identifies itself
> rather than being remembered as right. Mine names the build it served; yours
> names the lines it touched. **Neither requires anyone to be suspicious at the
> right moment, which is the only property that survives being tired.**

That is the test to apply when choosing between two safeguards: not which is
more thorough, but **which one works when nobody is looking for a problem.**
"Check carefully" fails at hour fourteen. One line of output that states what
happened does not.

**A message is a claim about when it was written, not when it lands.** Same
family, one layer out — in the coordination channel rather than in git. Nine
cross-session reports arrived late on the final day, every one composed before
the merges it described. I correctly identified eight as stale duplicates and
got the ninth backwards: I read a stale-delivered *proposal* as a fresh one,
concluded the session was about to redo merged work, sent a stop, and wrote it
up as a vivid instance of a rule that session had itself authored.

Measured after they objected with evidence:

```
#220 merged  15:33Z
#226 CREATED 15:54Z  on the branch they named, at the SHA they sent me
     merged  16:02Z  by me, after I planted against it
```

Their base was current; the work was finished; I had already merged it. **The
tell was two seconds away** — `gh pr view <n>` would have shown the branch was
already mine to merge — and I did not take it because the message *read* as a
proposal and I never questioned when it was written.

The retraction matters more than the error. Their objection is the correct
application of this file's own rule: **a false example is worse than an
unenforced rule, because it fails silently in the safe direction.** A successor
reading *"the session that identified the stale-control trap then fell into it"*
would draw a conclusion about vigilance from an event that did not happen, and
would have no way to check. The generalisation survives — *naming a failure mode
does not immunise you against it* — but its instance is now the real one, in
`AGENTS.md`: the same session wrote the week/month collision docstring in the
same commit as the function whose ordering broke on it.

**A control has a timestamp, and it decays.** This is new and it is not in
`AGENTS.md`. A session measured a flake rate on clean master, correctly and
rigorously, and reported it in `#204`. It reused that control in `#211` — by
which time master had *fixed* the flake, so the reading was right when taken and
wrong when used, and **nothing about holding it tells you which**. Their words:
*"A control has a timestamp; mine had expired."* `AGENTS.md` already says a
remembered figure has no provenance; this is sharper, because the figure had
impeccable provenance and was still misleading. **Re-take a control in the same
session, on the same build, as the thing it is controlling for.**

**A documented trap is not a guarded one.** The locale-coercion trap above is
recorded in this very document, by me, and I walked into it again four hours
later — `published_at` came back as `08/28/2026 14:04:38`, so a filter on
`'2026-08-28*'` returned **zero originals** on a day that published two. Reading
about a trap does not install a check for it. The only thing that recovered it
was the mechanical habit: **when a probe returns nothing, print the shape before
printing a conclusion.** That habit fires without needing to remember anything.

**And stamp your journal from the clock, not from your sense of elapsed time.**
Five of my own journal batches carried timestamps I had estimated forward; one
was fourteen minutes in the future, which is impossible and which I only noticed
when a `git` reading contradicted it. A journal with fabricated provenance is
worse than one with ranges — they are corrected to a measured bound now.

**When replaying a change onto a moved base, apply the edit, never the file.**
I redid a one-line fix by capturing the whole file from my earlier commit and
copying it onto current master. `git diff --stat` said `15 +--------------` for
a one-line change — a **silent revert of another session's work, wearing a
fix**. Caught by reading the diffstat before committing, which is the whole
defence. Nothing about the copy looked wrong.

**A shape rule generates suspects, not convictions.** This is a correction to
the enthusiasm above, and it was earned the same day. `house_style._NAMES_A_READING`
still uses raw `[^.]`, eleven lines below `_GAP`'s own comment explaining why
that is wrong — the identical syntactic shape as the `#223` validator bug that
was destroying articles. Measured: **0 of 5 wrongly flagged. It does not bite.**
`from X to Y` must *span* the number, so a decimal kills the match; `above … \d`
only needs to *reach* the first digit, which comes before the decimal point.
Same idiom, opposite consequence. So a greppable rule is what you hand to other
people, and the grep's output is a list to measure, not a list to fix.

**A discriminating test proves two things differ. It does not prove there are
only two.** This is the enumeration fault arriving as a *truth table*, and it is
worse defended than the usual kind because every row present is correct. I
verified `record_correction_note` had two perfectly discriminating branches —

```
A  rank=1 beaten=15   'was not the highest'=True   'only in'=False
B  rank=1 beaten=0    'was not the highest'=False  'only in'=True
```

— and reported the pair as though it settled the shape. A session came back with
a third: `rank=4, beaten=3` emits B's wording, correctly, because *"the
fourth-highest only in the 40 observations retrieved"* is true when exactly three
beat it there. My table was silent about C and **silence read as coverage**.

It was mechanically catchable in one command, which is what makes this a shape
rule rather than a caution:

```powershell
python -c "import ast,inspect;from newsroom.pipeline.revisions import record_correction_note as f;
s=inspect.getsource(f);[print(ast.get_source_segment(s,n.test)) for n in ast.walk(ast.parse(s)) if isinstance(n,ast.If)]"

#   -> beaten_in_window == 0 or rank > 1      <- the disjunction, line 114
```

**A disjunction in the branch that selects your output means more paths than
outputs.** I had two rows for two wordings; the code had three paths to two
wordings, and the `or` says so on sight. So when you claim a truth table is
exhaustive, derive the row count from the function's own conditions rather than
from the cases you thought to construct — the same move as reading a probe's URL
off the application instead of restating it, applied to control flow.

The general form, from the session that caught it: **an absent row is a claim
about the enumeration**, exactly as an absent reading is a claim about the
instrument.

Run across `revisions.py`'s seven public functions it fires **once**, on the one
that bit, and six show zero — which is what makes the one non-zero a reading
rather than a probe that flags everything. The other three note builders have one
output each and no branch selecting it, so a truth table over their wordings
cannot under-count.

**And the disjunction is a fossil of two features arriving separately**, which
tells you where to look first. Nobody writes `A or B` in a branch selector on the
first pass; you write `A`, and later a second condition wants the same output.
Measured on this one:

```
399d2f9  08-30 12:18  #273  beaten_in_window == 0   arrives
e8da9c3  08-30 12:35  #276  rank > 1                joins it
                            -> 17 minutes, two consecutive PRs
```

The session that spotted the mechanism guessed *"a day apart"*. It was **17
minutes**, which is the more useful number: a fossil can form inside one
afternoon, so *"audit functions that have grown"* does not mean old code. One
instance — whether disjunctive selectors are *usually* fossils is unestablished,
and the sweep above gives 1 of 7 rather than a rate.

---

## Exclusive file ownership, and the one property worth preserving

Give each session a file set it alone may write, and re-clear files explicitly
when work moves. I imposed this across eight concurrent sessions to stop merge
conflicts, and it produced zero. It also produced a second effect I did not
design — and the session it happened to insisted on the caveat before letting me
write it down, which is why the honest version is here.

**It separated measurement from remedy — but by luck, not by construction.**
`AGENTS.md` argues that whoever proves a defect should state it and someone else
should choose the fix. A session published the rejection reasons the pipeline had
been discarding, executed the failing check's own regexes against the four
paragraphs it refused, and handed the result over **because `validator.py` was
not in its set**. The session that received it found four defects, only one of
them vocabulary; the largest was a regex reading a decimal point as a full stop,
whose repaired form already sat in two sibling files. The likely alternative was
a 25th pattern from someone who had not measured.

**Their correction, which the rule must carry:**

> It worked because the measurement and the remedy happened to fall in different
> files. Had `comparison_basis_stated` been defined in `runreport.py`, the same
> boundary would have handed me both roles and enforced nothing.

So the claim is *a boundary drawn for one reason produced a second, better effect
where the files happened to divide along the measure/remedy line* — **not**
*ownership enforces the split*. The generalisable half is the cheaper one anyway:
**when you prove a defect, say so and stop**, and let the boundary help when it
happens to.

**The property that does not depend on luck is where the boundary is drawn.** It
stopped them *writing*, not *reading* — so they could still measure `validator.py`
and report what they found. A boundary that had blocked the measurement would
have produced silence, and **silence from a session that found something is
indistinguishable from a session that found nothing**, which is the failure this
entire run has been about. If ownership is ever formalised: draw it at the write.

---

## Hard stop: one brief commit after your last PR

**This is the guardrail that matters and it replaces judgement with a count.**
Measured on this run, from the outside, by a session that was not part of it:

```
last PR merged                     2026-08-28T19:28Z
commits after that point                        43
  touching PROGRAMME.md                         22
  touching AGENTS.md                            16
  touching src/ or api/                          7

named gaps that got zero commits    data export, reader retention, i18n
```

The previous guardrail was a **ratio** — code:docs ≥ 3. It is a lagging measure
you can satisfy while still spending the last quarter of a run on meta-work, and
two consecutive runs have failed the same way through it: 0.71:1 then 1.59:1.

So the rule is absolute and checkable at the moment of the decision:

> **After your last PR merges, you get one commit to the brief. Then stop.**

If you are still finding things worth writing down — and you will be, because the
meta-work is genuinely interesting and that is exactly why it is hard to
stop — they belong in the `journal` table.

**But know what that table is and is not.** It is **per-run**: measured just now,
this run's DB holds 186 entries with the earliest at `2026-08-28T10:20Z`, and none
of the previous run's 48. **A successor does not read it.** The journal is raw
material for *this* document, not a channel to the next session — so anything that
must actually reach a successor goes in the brief, and the one commit is where it
goes. An earlier draft of this rule said the next run reads the journal anyway;
that was false and would have sent findings somewhere they quietly vanish.

The uncomfortable part, stated plainly because it is the reason a softer rule
fails: **the documentation this run produced is good.** The corrections are real,
each was measured, several overturned committed claims. Quality is not the
signal — a bad batch would have been easy to stop. What tells you is the counter
above, and it is only visible from outside, which is why it is written down here
as a number rather than left to notice.

**A run that ends because the work is done is worth more than one that ends
because it ran out of things to say about ending.**

### What writing it down actually buys, measured

The whole apparatus above assumes recording a finding prevents its recurrence.
**It does not**, and the run of 2026-08-31 measured that five times:

```
a session's line-wrap rule    violated by its author      90 minutes later
the same rule                 violated by me              90 minutes later
@($null).Count == 1           documented, then WARNED a session by name,
                              used correctly at 14:15Z, fallen into at 14:35Z
a session's two prompt gates  both defects in the failure path they were written for
a removal-comment trap        author of the trap, author of the entry, and
                              victim were ONE PERSON, on ONE symbol, hours apart
```

That last one is the decisive case, in the finder's own words: *knowing the
mechanism, having written it down, and having built the tool did not stop me
writing a naive grep — it only meant I recognised the reading in one second
instead of filing a false regression.*

So the honest claim is narrower and still worth the cost:

> **Documentation does not lower the rate of the mistake. It collapses the time
> between making it and catching it.**

Every one of the five was caught, most within minutes, and none reached a
reader. That is what the writing bought — not prevention.

**Say it this way rather than the flattering way**, because *"we wrote it down"*
reads as prevention, and a successor who believes that will be surprised by
their own first violation and may conclude the entry was wrong. It is not
wrong; it is doing the only thing of this kind that can be done. The
corollary is the practical one: **put the rule where it executes**, because a
rule that must be recalled is a rule that buys recognition speed, and a rule
in a test buys the mistake never shipping.
## Efficiency guardrails

**Watch throughput.** Merged PRs/day across the two runs:

```
08-24: 35   08-25: 23   08-26: 22   08-27: 88   08-28: 49   (42 of them this run)
```

The previous run collapsed from 88 to 6 while still busy, because the work had
drifted from shipping into writing rules about shipping. **If merged PRs/day
falls below a third of your peak while you are still busy, stop and ship
something.**

**Cap documentation at one markdown-only commit per three code commits.** This
run: 14 code, 1 markdown-only. Measure it; do not trust your sense of it.

**Only document a rule with two independent instances.** The plant-proof entry
above earned its place with three, from three different sessions, in one day.

**Derive the backlog from PR state at merge time.** Do not maintain it by hand;
the last run left 69 items in non-terminal states that had all actually shipped.

**Reply once to a session's report, with the measurement, and give it the next
task in the same message.** That worked well: six sessions, each on its third
or fourth task by handover, with no idle time between.

---

## How to run it

Spawn implementation sessions with `create_session`. **Give every session
exclusive ownership of a file set**, list explicitly what it may *not* touch and
who owns it, and update the list every time you dispatch. Six concurrent
sessions worked with zero merge conflicts this run, entirely because of that.

**Write briefs as OBSERVED / GUESS / ASK, and mark the guess.** This is the
highest-leverage thing in this document. My briefs were wrong four times this
run — a location, a denominator, an enumeration, and a whole finding — and
every one was caught **because the session knew which part it was allowed to
overturn**:

- I reported two front-page `h2`s as inverted. Measured against their *own*
  sections they were fine; the session found two others I had not looked at.
- I said "4 of 25 articles". It was 4 of 4 of one detector — a 100% failure
  rate wearing a 16% denominator.
- I told a session to walk `registry().enabled_sources()`, "the same enumeration
  `run.py` fetches". It is not: `collect_feeds` intersects it with tiers B and
  C, and following me literally would have shipped a permanent false red on
  seven statistical APIs.
- I said the CI flake was CKAN escaping through `fetch`. It was PxWeb escaping
  through `https.request`, one function name away from a mock that looked
  complete.

**A wrong brief that is marked as a guess produces a better finding than a
correct one, because it makes someone measure something nobody had reason to
measure.** Say so explicitly: *"measure this before implementing it; report if
I am wrong."*

**And add a fourth field: `MEASURED ON <sha> at <instant>` — on both ends of the
contract.** Marking the guess tells a session which part it may overturn; the
SHA tells it whether the whole brief has already expired, which is a different
failure with a much larger bill.

**A report needs it for the same reason a brief does, in the other direction.**
A completion report and a statement of intent are the same sentence: *"deployed
shows 0 of 18"* reads identically whether the fix merged an hour ago or is
sitting in a branch. I stood a session down on exactly that ambiguity — its
message was a past-tense summary of work that had already merged, and I read it
as present-tense intent. The session's own framing is the right one:

> a brief needs it so a session can tell the premise has expired, and a report
> needs it so you can tell a finished measurement from a live one

Measured on this run's last day, **three instances of work nearly rebuilt after
it had shipped** — the population stated, because a count without one is the
fault this file spends pages on:

```
13dbac17  discarded three finished pieces mid-build when #349 landed under it
c4c8f6a6  specified the sixth correction surface — already live in #354
me        published a brief whose first task had shipped that morning in a
          pull request I merged myself, with a second false clause beside it
```

Two of the three are the same underlying work — `articleMeta.js`, the share
card — reached independently by two people who could not see each other. None
was caught by a brief. Each was caught late, by an artefact contradicting
itself: a live guard going green on an assertion that should have been red, or a
stale message that happened to make someone re-check their own claim.

⚠️ **I first wrote "four sessions" here, and the fourth was `#359` — which was
not an instance at all**, but the remainder that session shipped *because* of the
first, merged normally. The session corrected me. So the paragraph warning about
unstated populations had an inflated one, until someone counted it.

The suggestion is that session's and it is exact:

> a task brief could carry the SHA it was measured on, so *"measured on
> 894a871"* makes an expired premise visible **on arrival** instead of at the
> first green assertion that should have been red

It costs one line and it is the only field that fails *early*.

**The manager should write code too.** The last prompt implied the manager only
verifies. Six of this run's commits were mine, and three of them came from
reading artefacts nobody had been asked to read — the pricing page selling a
feature that had shipped free ninety minutes earlier, two dead wire feeds
behind a stale `verified:` note, and two indicator registries sharing an id
space where nine ids name different statistics. **Read the artefact.** It is
the habit that found the most this run and it cannot be delegated.

**Make the closing exchange part of the process, not politeness.** When a
session finishes, send it what you merged and what you wrote down about it, and
read what it sends back. This run's final hour produced **four corrections to
me**, every one from a session reading the brief rather than from me re-reading
it, and every one landed in the handover:

```
a false example I had written about a session's own work   -> retracted
a throughput number I was incrementing rather than counting -> exposed a window
                                                               error inflating
                                                               the headline 42 -> 49
an overclaim that ownership "enforces" the measure/remedy split -> weakened to
                                                               what the evidence
                                                               supports
a false illustration whose fix reached one of three copies  -> all three fixed
```

**The method found faults in itself, in its own artefacts, using its own rules** —
an incremented tally that nobody could audit is precisely `runs/latest.json`
before `#217`, one layer out in the coordination channel.

**And the caveat is the important half**, in the words of the session that drew
it: all four were caught by *a second reader*, not by the author and not by any
check. **The method self-corrects only where it has a second reader — and a run
that loses that will not notice it has.** Fewer sessions, or sessions that do
not read each other's closing messages, removes the mechanism silently. It costs
one message per session at a point where the work is already done.

**And one correction to that, from the session it credits — because crediting a
person for what a mechanism did is the error this whole document is about.** I
had written that they caught a bad figure "by checking before reporting". They
did not:

> I checked because the numbers **disagreed**. Had your table been internally
> consistent and merely answering the wrong question, I would have read past it.
> **The discrepancy did the work, not the discipline** — and the difference
> matters because only one of the two is available when nothing looks wrong.

Same asymmetry as the absurd reading that defends itself while the plausible one
does not, arriving one layer out in the coordination channel.

**Which gives this document its stopping rule, and you should know it before you
trust anything here.** It was corrected roughly a dozen times on its final
evening, every correction from a second reader. So the errors that remain in it
are, *by construction*, the ones that look fine — a further pass by the same
readers cannot find them, because those readers already read past them once.

A reader with a different question can. **That is you.** Treat the figures here
as claims with windows attached rather than as facts: each states the range it
was measured over precisely so you can re-derive it, and re-deriving one is worth
more than reading ten. If you find a figure that does not reconcile, that is the
discrepancy doing its work — follow it.

## How to tell whether any of this is working

`AGENTS.md` is long and it is tempting to judge it by whether the mistakes it
describes stopped happening. **They will not stop, and that is not the test.** In
the words of a session closing out this run:

> Knowing a trap and *recognising an instance of it* are different acts. The rules
> do not prevent the failures; they make them cheap to identify afterwards.
> **Cheap identification is the entire product. Prevention was never on offer.**

So the measure is not *did the book prevent it* but **how long did the mistake
survive**. Measured on this run's own commits, each pair being a thing shipped to
master and then corrected:

```
e56565d -> b918f72     3 min   the wrapped-phrase remedy was insufficient
dde6a28 -> dfeeafe     9 min   the principle shipped without its limits
73af3b9 -> ae52ff3     9 min   that remedy was an enumerated word list
6642896 -> 385dab5    10 min   a diagnosis blamed the SHA; it was the scope
```

Median under ten minutes, every one of them caught by **a second reader**, and
several by someone who had written the relevant page minutes earlier — which is
the same evidence for the rule as against the author's memory of it.

The control is the contrast, and it is stark: `/api-docs` shipped four false
claims that survived **weeks**, because nobody read the page. Same book, same
rules, same people. The variable is not knowledge, it is whether a second reader
with a different question ever looked.

**So if you want one number for whether the practice is holding, take the interval
from shipping a mistake to someone naming it.** If that figure starts being
measured in days, the mechanism has gone — and it will go quietly, because a run
with no second reader produces no corrections and therefore looks flawless.

---

## Run a journal in SQLite, not in markdown

```sql
CREATE TABLE journal (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL, kind TEXT NOT NULL, track TEXT,
  what TEXT NOT NULL, cost TEXT, fix TEXT
);
```

`kind` is one of `challenge | instrument | deadend | timesink | decision |
surprise`. Write an entry every time a probe lies to you, every time you decline
to do something, and every time a session overturns you. The `instrument`
entries are the most portable artefact you can produce — twenty of this run's
forty-eight are instrument entries, and the whole section above is derived from
them.

**Record declines especially.** I declined to brief the desk (already fixed),
declined to fix a "missing" link-out rail (it has a Show-more control), and
declined to report 46 unreachable articles (they were reachable). Nothing else
records a decline, and each was two turns of measurement that saved a session.

---

## First tasks, in order

> ⚠️ **SUPERSEDED — these were the first tasks for the run that ended
> 2026-09-01. Yours are near the top of this file, under "First tasks for your
> run, in order".** Everything below is a record of what that run was asked to
> do and what it found, which is why the numbers here are worth reading and the
> instructions are not worth following.

> **THE PROGRAMME'S LARGEST OPEN QUESTION IS CLOSED.** The brief that produced
> this section opened by asking whether the newsroom publishes unattended. It
> does, on **both** cadences, verified 2026-08-31T05:36Z on the field `#246`
> pinned so a hand-run could never be mistaken for a scheduled one:
>
> ```
> runs/weekly-2026-08-30.json  trigger="timer"  published  15:00:41Z
>                              (schedule 0 0 15 * * 0 — its FIRST scheduled run)
> runs/latest.json             trigger="timer"  schedule "0 0 14 * * *"
>                              14:04:49Z · 288 series, 172 signals, 3 approved
> ```
>
> Do not re-open it. If you want to check it still holds, the answer is one
> unauthenticated GET of `runs/weekly-<YYYY-MM-DD>.json`, and **absent is the
> finding** — not the absence of one.

> **STOP. Measured `2026-08-29T09:05Z`: four of the seven tasks briefed from this
> list on the morning after the run were already done.** Three sessions caught
> theirs by measuring instead of building; one was caught only because a fourth
> session read a commit title carefully. Each cost most of a morning.
>
> ```
> "only articles are server-rendered"    closed by #228, 74 min AFTER the
>                                        measurement this list quotes
> "nothing offers a reader a file"       closed by #187, DURING the run
> "IndicatorCard has 16 unnamed tab      NOT CLOSED -- see below. I marked this
>  stops of 19"                          done from a source grep and was wrong.
> "building permits are still graded"    closed: all three variants are in
>                                        polarity.ts DELIBERATELY_NEUTRAL
> "/weekly is unpopulated"               the whole system EXISTS -- timer,
>                                        manual trigger, writer, page, tests.
>                                        The task is diagnosis, not building.
> ```
>
> **The list dated faster than the run that wrote it.** Not one entry was
> careless; each was true when measured and false before the document was
> finished, because the run kept closing its own items. So:
>
> **And the correction to that, which cost less than the four but matters more:
> one of the five was NOT done, and I only thought so because I searched the
> source for a defect that is injected at runtime.**
>
> ```
> grep src for role="application"        1 hit
>   -> the hit is PROSE, inside the comment explaining the FIX
> real JSX role="application" in source  0      <- recharts injects it at runtime
>
> measured in Chromium, /data/economy:
>   74 tab stops · 19 role="application" · 19 of 19 UNNAMED
>   control: 30 buttons, 25 links seen  <- probe not blind
>   attribution: BalticCompareChart 10, IndicatorCard 8, PowerMarketCard 1
> ```
>
> **UPDATE 2026-09-01T09:35Z: this one is now closed too, and it was the
> careful one.** The entry above is the correction to four premature "already
> done" claims — it was measured in a browser precisely because a source grep
> had been wrong. Re-measured in Chromium this morning, same method, four
> sections:
>
> ```
>                    role="application"   unnamed
>   /data/economy            10              0
>   /data/property            1              0
>   /data/environment         1              0
>   /data/maritime            1              0
>                            13              0     was: 19, all unnamed
>   controls: 33 buttons, 25 links seen · [role="zzz-not-a-role"] 0
> ```
>
> So the list's own most carefully-verified open item expired within four days,
> and `migr_asyappctzm` — which `AGENTS.md` still describes as *"needs one pass
> across four files"* — is at `api/shared/indicators.js:563`, in a registry that
> has grown to **72** indicators. **Eight of nine status claims checked across
> this programme have been closed by the time someone went to act on them.**
>
> That ratio is high enough to change what the list is *for*. It is not a
> backlog; it is a record of reasoning, and every status sentence in it should
> be read as a claim about a tree that no longer exists. The fifteen-second
> re-measure is not diligence, it is the **normal case** — and it now costs
> less than reading the entry it checks.

> `IndicatorCard`'s well-named `role="img"` wrapper is real — and the unnamed
> focusable `application` sits **inside** it, so a source read sees the good half.
> **The fix's own documentation matched a grep for the defect**, which is the
> concealing-sibling shape arriving inside an instrument.
>
> Two rules, and the second is the one I did not have:
> **a defect injected at runtime is invisible to a source search**, so "already
> fixed" claims about *runtime* behaviour stay unmeasured until something renders;
> and **once four tasks in a row come back closed you are primed to find the
> fifth closed too.** The prior was right three times and wrong here, and what
> separated them was a browser rather than a tree.
>
> Also measured there and worth knowing before anyone reaches for the obvious
> remedy: `accessibilityLayer` is **not** decorative. The tooltip is
> `role="status" aria-live="assertive"`, arrow keys walk the series, and Chromium
> exposes the readings. Switching it off removes a working announced feature.
>
> **Re-measure the claim that says a task is open, before you start it.** One
> command, against master or production, with a control that must fail. If it is
> closed, say so and stop — do not open a no-op PR. That is a fifteen-second
> check standing in front of a four-hour mistake, and today it paid four times
> out of seven.
>
> The entries below are kept because their *reasoning* is still good and the
> measurements are still instructive. Treat every status claim in them as
> **expired**.


1. **Read the newest published articles in full, before anything else.** This
   was the single highest-yield activity of the run and it is not close. The
   14:00Z edition published two originals; reading them found a defect class
   that ten validator checks, a desk pass and 1,790 unit tests all passed. It
   takes fifteen minutes. Fetch the article JSON, read `body`, then read
   `provenance.analysis` and `provenance.hypotheses` beside it and ask whether
   the prose is about the same quantity the signal is about.

   **The strongest illustration of why:** at 14:05Z I quoted this sentence to a
   session as *proof the causal panel was working* —

   > *"Dr. Ineta Zvirbule suggests this is a likely explanation, but the data
   > cannot confirm it."*

   Attributed, hedged, figure-free: the contract exactly. **And no such
   economist exists.** She is not on `personas.yaml`, so she has no bio page and
   no AI byline — while *Rasa Irbene*, named in the same article's provenance,
   **is** on the roster. So a reader who checks one name finds a real page and
   reasonably assumes the other has one. `byline_discloses_ai` checks bylines
   and `test_one_roster` pins the roster; the panel introduced a **second class
   of name, in body prose, that no part of that apparatus looked at.** Fixed in
   `#219` by making an analyst a *role* with the disclosure inside the copied
   string — removing the object rather than policing it.

2. **`comparison_basis_stated` was destroying half the wire — and it is fixed.**
   Kept here because the *method* is the most reusable thing this run produced.
   `#217` published the rejection reasons the run report had been discarding,
   then executed the check's own regexes against the paragraphs it refused:

   ```
   gate: validator 6 of 6 · house style 0 · desk 0
   comparison_basis_stated  4 of 6      no_unsupported_mechanism  4 of 6
   change word fires        4 of 4      _BASIS_PATTERNS matched   0 of 24, in all four
   ```

   `#223` then found four defects, and **only one was vocabulary**. The largest:
   `\bfrom\b[^.]{1,60}?\bto\b` treats a **decimal point as a full stop**, so
   *"from 52 to 61"* matched and *"from 52.8% to 61.2%"* did not — the form an
   economic series almost always produces. **The repo already held the repaired
   expression twice**, in `house_style._GAP` and `weekly._GAP`, each with a
   comment explaining it, while the gate kept the broken one. 8 false positives
   → 0, with 0 false negatives.

   **And the obvious structural fix was measured and rejected.** *"Two numbers
   in the paragraph"* is not a faithful reading of *"a basis is a relation
   between two quantities"*: against adversarial controls it trades the 8 false
   positives for **3 false negatives**, and on a truth gate that is the worse
   trade. `no_unsupported_mechanism` was then measured too and **vindicated** —
   9 of 9 refusals genuinely unsupported — so the run stopped rather than
   loosening it.

3. **The remaining lead, scoped and deliberately not built.**
   `no_unsupported_mechanism`'s docstring says the test is whether *the thing
   attributed to* is present in the piece's own figures; the implementation asks
   only whether **any** figure is present:

   ```
   the retracted sentence, figure-free        -> REFUSED
   the same sentence, one figure declared     -> PASSES
   ```

   So a retracted sentence would republish beside an unrelated figure. It is
   **not currently being walked through** — 1 of 42 attributions in
   figure-carrying paragraphs named an unobserved property, and that one was
   honest — so building tonight risked an instrument for a fault that is not
   there. The handover lives in the check's own docstring with an assertion
   pinning current behaviour, so whoever narrows it gets a red test telling them
   to delete the note. **Do not reach for a list of "unobserved nouns"**: every
   sampled failure used *capacity*, *efficiency* or *resilience*, which is
   exactly what makes such a list look sufficient.

4. **Choose the reader-facing staleness threshold. The measurement is done; the
   decision is not.** A full sweep of 71 indicators × 3 countries, judged by the
   repo's own `es.isSeriesStale` with a two-way control, found **0 of 213 stale**
   — and that number is a trap. `MAX_AGE_MONTHS` is a **failover** threshold
   ("is this feed dead?"), deliberately about twice the worst real publication
   lag. *"Should a reader see a date?"* is a different question, and nothing
   comes close to the failover line: the worst is `consumer_confidence/EE` at
   67% of its allowance.

   Meanwhile **nine series are 20 months old and rendered as current**
   (`life_expectancy`, `rd_spending`, `hotel_occupancy` × LV/EE/LT). Normalised
   to publication cadence:

   ```
   more than 1   period behind   43 of 71 indicators
   more than 1.5 periods         40
   more than 2   periods          8      <- the sweep's recommendation
   more than 3   periods          3
   ```

   **It is 0, 8, 40 or 43 depending entirely on which line is adopted, and that
   choice is the whole design decision.** One period behind is normal lag for
   nearly every series here. `#215` already dates every figure regardless, which
   is the half that helps daily; this is only about which ones get a warning.

5. **`building_permits` polarity.** `polarity.ts` admits an indicator only if
   "a finance ministry, a trade union and a central bank would all agree on the
   sign". `#212`/`#226` closed the balance family by **deriving** taint from
   `stk_flow` — `BAL(x) = CRE(x) − DEB(x)` — across every family in the
   registry rather than the one it was found in. Building permits are still
   graded and the same three-party test plausibly fails.

5. **~~Only articles are server-rendered.~~ CLOSED — and the way this entry was
   wrong is the most expensive kind.** The measurement below was taken
   `2026-08-28T14:50Z`; `#228` merged at **16:04:37Z**, 74 minutes later, and
   fixed it. The entry was written from a reading that was true when taken and
   false before the document was finished.

   **It cost a session.** Re-measured `2026-08-29T08:44Z` on production, raw HTML,
   no JavaScript, build `index-bmgjCV0L.js`: **124 of 124 sitemap URLs carry their
   own title, canonical and `og:title`; 124 distinct titles; 0 offenders in every
   category.** Eleven `page-shell` rules are deployed plus `/article/*`. The
   control fires — `/utterly-invented-page` returns the generic head, so the zeros
   are a reading rather than a blind probe.

   Also corrected: **`/correspondent/:slug` is not a route.** `main.tsx` declares
   `/newsroom/:id`, with `/correspondents/:id` as a legacy redirect. Wiring the
   singular would create a URL, not fix one.

   **The lesson, since the entry is otherwise useless now:** a task list written
   during a run dates faster than the run finishes. Before starting anything here,
   **re-measure the claim that says it is open** — the brief's own rule about
   controls decaying applies to the brief. Residual, small and real: legacy
   `/economy` and `/correspondents` answer 200 with `canonical=/` rather than
   redirecting to their destinations.

   The original entry follows, for the record. Measured `2026-08-28T14:50Z` against
   raw HTML with no JS: **21 of the 22 sitemap URLs ship the home page's
   canonical, title and `og:title`.** `#209` fixed the *rendered* canonical with
   `usePageMeta`, which is correct for Google and invisible to every crawler
   that does not execute JavaScript — X, Facebook, LinkedIn, Slack, WhatsApp,
   Bing, and the LLM crawlers. Share `/api-docs` today and the preview card
   reads *"portaBaltica — Baltic open data, reported"*. **The control fires:**
   `/article/*` is server-rendered with its own correct meta, which is both why
   the probe is trustworthy and why nobody noticed — a spot check of any article
   says the site handles per-route meta correctly. `articlePageFunction` is the
   existing mechanism; it is wired for one route family only. Routed as a
   scoping question at handover, not as an instruction.

---

## Things to know on day one

- `src/sections.ts` is the single definition of the nine dashboard sections.
  **Five further copies exist across three languages** that cannot import it and
  are asserted equal by tests. Adding a section means editing all six. **That
  question is closed** — a session scouted a suspected gap in `Header.tsx` and
  found `tests/routeCoverage.test.ts:77-99` already asserts both directions with
  a vacuity floor. Do not rebuild it.
- The Static Web App lives in **`era-rg`**, not `portabaltica-rg`. Known,
  deliberate, and `AGENTS.md` explains why.
- **The newsroom and the frontend deploy from different workflows.**
  `newsroom-ci.yml` deploys the Function App and stamps `NEWSROOM_REVISION`,
  but only on pushes touching `newsroom/**`, `src/news-types.ts` or
  `pytest.ini`. `deploy.yml` handles the SWA. So master can be five commits
  ahead of the deployed newsroom and that is correct.
- **Every article records the commit that produced it** in
  `provenance.revision`. "Was this generated by the code I think?" is a lookup.
- **Tier C returns early in `ArticleView.tsx:250`** with only a `LinkOutCard`,
  so it never reaches `ProvenanceBlock`. This is load-bearing in a way nothing
  records: `lsm_en`, `err_en` and `euobserver` are cited 50 times between them
  and have **no entry in `SOURCE_NAMES`** — harmless only because that early
  return makes them unreachable. I nearly "fixed" the dead entries in that map
  by analogy with `#210` and stopped when the measurement showed the analogy
  fails: `correspondents.ts` made a **claim to a reader**, so a false entry
  there is a lie, whereas `SOURCE_NAMES` is a lookup with a graceful fallback
  and a spare entry is insurance. **Deleting by analogy would have removed
  insurance and called it a fix.**
- Azure app settings on `portabaltica-func` hold a live Telegram bot token. Do
  not print it, and do not commit it.

---

## Accessibility: what is measured, still open, and the harness traps

Carried from the session that did the audit, because it is engineering work on a
named gap rather than a note about method:

- **No real screen reader has been used.** Everything so far is DOM assertions.
- **Errors are announced on first render, not on update** — a value that goes
  stale while the page is open says nothing.
- **400% reflow is covered, and this entry was wrong about it.** Forced-colours
  **was** on this line and is now
  closed: `tests/forcedColours.live.test.ts` walks the 2×2 of
  `forced-colors × prefers-color-scheme` against production and measures five
  painted element groups at the floor WCAG gives each. It found a real defect —
  the app always renders `data-theme="dark"`, forced-colours strips the page
  background but does **not** remap an SVG `stroke`, so under a *light* high-
  contrast theme the dark palette's chart lines landed on white at 1.67–2.51:1.
  Fixed in `#305`, widened in `#307`.

  **Verified end-to-end, which is the pattern worth copying**: the same test
  failed against unmodified production *before* the fix existed (1 failed, 3
  passed, naming the light case) and passed after the deploy (4, then 5). A
  plant proves a test notices a change you made; this proves it saw a defect it
  did not create.

  **Reflow at 400% was already tested, which is why this bullet's remaining
  half is now struck too.** Browser zoom at 400% on a 1280-device-px window
  *is* a 320 CSS px viewport — they are layout-identical, and
  `deviceScaleFactor` changes only the rendering resolution. Measured against
  production:

  ```
                                    clientWidth  dpr  overflowX
  320 CSS px, dsf 1  (a phone)          320       1       0
  320 CSS px, dsf 4  (1280 @ 400%)      320       4       0
  ```

  So `reducedMotionLayout.live.test.ts` (17 routes derived from the router,
  widths 320–1024) and `headerOneRow.live.test.ts` (320/375/390/640, asserting
  the document does not scroll sideways) already cover SC 1.4.10. A separate
  400% pass would cost ~11 minutes on every deploy to re-measure a width the
  suite already walks — an instrument aimed at a fault that is not there.

  ⚠️ **The trap that makes it look untested.** CSS `zoom` is not browser zoom.
  Setting `documentElement.style.zoom = '400%'` leaves `clientWidth` at 1280,
  so no media query fires, the desktop layout is scaled up, and the page
  reports a dramatic overflow:

  ```
  CSS zoom 400%   clientWidth 1280   /  overflowX 288   /data 277   /api-docs 48
  real 400%       clientWidth  320   /  overflowX   0   /data   0   /api-docs  0
  ```

  Those 288 pixels are an artefact of the wrong mechanism, and they are exactly
  plausible enough to be believed and "fixed". Simulate zoom with the viewport,
  not with the `zoom` property.
- **`/weekly` is populated as of 2026-08-30.** The first scheduled wrap ran at
  15:00Z with `trigger: timer` and `outcome: published`, and
  `runs/weekly-latest.json` carries the record. **It published a false headline**
  — see the wrap correction — so the open question about that route is no longer
  "does anything reach it" but "is what reaches it true".
- **Five components still expose unnamed `role="application"` surfaces.**
  `IndicatorCard` alone accounts for **16 of the 19 tab stops** on
  `/data/economy`, which is the whole keyboard experience of that page.

Two harness traps that cost a session each, so the next one does not rediscover
them:

- **jsdom gives `ResponsiveContainer` no size**, so recharts draws nothing and
  every query against it returns zero — including the controls. See the section in
  `AGENTS.md` on confirming a probe can see anything.
- **A stale detached preview server serves an old `dist`.** Make it name the build
  it is serving, or you will measure yesterday's bundle and believe it.
## Housekeeping: 140 stale local branches, and the wrong tool for them

A session flagged this on its way out and correctly declined to act on it. I
measured it, and **its stated mechanism is wrong in the dangerous direction**:

```
measured 2026-08-28T19:40Z, before this run's own cleanup:
  ALL local branches             265
    samoletovs-*                 140
    pb-*                          54
    everything else               71
  LOCAL ONLY -- lost if deleted  135   <- across all prefixes
  checked out in live worktrees   15

measured 2026-08-28T19:55Z, after it:
  ALL local branches             217        (48 pb-* scratch branches removed)
  LOCAL ONLY -- lost if deleted   87

the samoletovs-* slice alone, which is what a prefix filter shows you:
  local 140   remote 133   both 129   local-only 11   remote-only 4

claimed:  "git branch -d refuses them by design"
actual:   git branch -d SUCCEEDS
          "warning: deleting branch X that has been merged to <upstream>"
```

Squash merging means a branch head is never an ancestor of master, so the
intuition that `-d` will refuse is reasonable — and false. These branches have
upstream tracking, and `-d` compares against **the upstream, not master**. It
deletes them, and the warning is the hazard:

```
git branch -d zz-probe-disposable
  warning: deleting branch 'zz-probe-disposable' that has been merged to
           'refs/remotes/origin/...', but not yet merged to HEAD
  Deleted branch zz-probe-disposable (was 8beab33).
```

Read it as a reader does. `warning:` trains you to stop; *"but not yet merged to
HEAD"* reads as the reason for a refusal; and **the opening clause is past tense
reporting a deletion that already happened.** The word `Deleted` is on the next
line. Someone who stops at the warning takes away the opposite of the fact.

**Two ways this bit the manager who wrote this note, within the hour.**

Scratch branches were being cleaned up all evening with `git checkout master
2>$null; git branch -D $b 2>$null`. In a worktree, `git checkout master` fails —
*"already used by worktree at ..."* — so the delete then failed too, on the branch
still checked out. `2>$null` hid both. **54 branches accumulated while the cleanup
reported nothing, and nothing is what success looks like.** Detach first
(`git checkout --detach`), and do not silence the stream that tells you it did not
work.

Then the bulk delete that followed removed five branches this note had just
promised to preserve. They were recoverable **only because their SHAs had been
captured earlier for an unrelated check** — luck, not design. Before any bulk
delete, print the SHAs you are about to drop:

```powershell
git branch --format='%(objectname:short) %(refname:short)' | Where-Object { $_ -like '* pb-*' }
```

Reproduce a destructive probe on something disposable. The first measurement here
ran `-d` on a real branch and **destroyed its own subject** — the reading was
correct and unrepeatable, and nothing was lost only by luck. `git branch` has no
`--dry-run`, so the safe form is to recreate the condition on a throwaway, which
is how the transcript above was obtained.

That matters because someone told `-d` refuses will reach for **`-D`**, which
skips every safety check, on a set where 11 branches exist nowhere else.

Settled by content rather than by reachability, since `ahead 1 / not an ancestor`
is the documented squash signature and proves nothing:

| local-only, ahead of master | verdict |
|---|---|
| `live-guard-reach` — the `#178` wiring reach | substance is on master |
| `programme-run-2` — the `/api-docs` claim | stale figure gone from master; guard present |
| `surface-family` — *"WIP … parked"* | deliberate, 34h old, author's call |

So cleanup is safe today — **but only because someone resolved each one against
master's content.** **This note was itself under-enumerated, by 12×, and it is worth knowing why.**
It was written from `samoletovs-*` because that is the prefix the sessions use —
and it reported 11 branches at risk when the true figure across every prefix is
**135 of 265**. The subject was *stale local branches*; the population measured
was one prefix of them. That is the smaller-population rule from `AGENTS.md`, in
a note whose entire topic is a population, found only because a final tidy-up
matched a different prefix and returned a number that looked wrong.

So enumerate without the filter. The list is a snapshot; re-derive it before acting:

```powershell
$local  = git branch --format='%(refname:short)' |
            Where-Object { $_ -notlike '(*' }        # drop the detached-HEAD pseudo-entry
$remote = (git ls-remote --heads origin | %{ ($_ -split "`t")[1] -replace '^refs/heads/','' })
$local | Where-Object { $_ -notin $remote }   # these exist nowhere else

Run from a scratch branch of your own and the answer is one higher, because the
branch you are standing on is also local-only. The figures above were taken from
`master` with no scratch branch checked out.
```

And note what the whole situation is an instance of: **a local branch looks
identical whether it is a merged-and-pushed leftover or unpushed work.** One
symbol, two facts — the collapse `AGENTS.md` opens with. `git branch -d`'s
warning is the artefact that cannot distinguish them, which is why the answer
had to come from the file contents instead.
## A `$null` argument is dropped, not passed — and the command defaults

Four probes failed in one session and one of them is not the `absent` row of the
taxonomy, because **the reading was not absent. It was plausible, well-formed,
and came from a different object entirely.**

```
$sha = gh pr view 315 --json mergeCommitSha --jq '.mergeCommit.oid' 2>$null
                                         Unknown JSON field -> $sha is $null
git log -1 --format='%B' $sha            -> the argument is DROPPED
                                         -> git defaults to HEAD
                                         -> "#315 trailers=2"
```

Measured, and the distinction is the whole entry:

```
$null arg   [adc77d4]     PowerShell drops it; git sees no rev and uses HEAD
'' arg      fatal: ambiguous argument ''
no arg      [adc77d4]
```

**An empty string errors loudly. `$null` vanishes and the command succeeds
against the wrong object.** So the usual instinct — *"it would have failed if the
lookup failed"* — is true for one of them and false for the other, and `--jq`
against a missing field returns the silent one.

Nothing about `trailers=2` looks wrong: right shape, believable magnitude, and
it disagreed with the claim under audit by just enough to look like a finding. I
was one step from filing a false regression against `#320`, whose numbers
reproduce perfectly once measured against `mergeCommit.oid` — `#311`=1,
`#313`=1, `#315`=3, exactly as stated.

**And the control I wrote for this entry falsified it, wrongly.** I tested
`git log -1 --format='%h' ''`, got an error rather than HEAD, and concluded the
mechanism was fiction. The bug's value was `$null`; my control's was `''`; the
two behave in opposite directions. That is `AGENTS.md`'s *"a control validates
the mechanism, not the mapping from question to measurement"* — merged an hour
earlier — arriving inside the paragraph documenting it. The control worked. It
was answering about strings while the question was about null.

The remedy is one line, and it is not a control, because a control cannot see
this: the instrument is working perfectly on an object you did not intend.

```powershell
if (-not $sha) { "NO SHA - refusing to measure"; continue }
```

Refusing to measure is the whole fix. `NO SHA` is a bounded problem; `trailers=2`
is an unbounded one, because it sends you to re-derive someone else's correct
work.

Git is full of arguments that default when absent — an omitted rev is `HEAD`, an
omitted pathspec is everything, an omitted ref is the current branch. Combined
with a shell that drops nulls, every failed lookup becomes a confident answer
about the wrong thing.

The other three failures were ordinary `absent` readings and the taxonomy
already covers them: `$_.freshness.state` against a field that is a **string**,
so the stale filter could never match and `0 stale` was a probe that could not
fire; `.Count` on a broken property chain reporting `0` for a feed holding **43
items**; and a `Select-String` for a branch name in the HEAD reflog matching a
`merge origin/<branch>` line rather than a creation. All three were caught by
printing the shape. Only the `$null` kind gets past that, because there is no
shape to print — the value is real, it just belongs to something else.

## Final deliverable: the successor prompt

Before you stop, write the next one. It must:

0. **Drain first: `gh pr list --state open` must return zero.** Merge what is
   ready, close what is not with a reason. This is item zero because it is the
   only one whose cost is silent — a pull request that is `MERGEABLE`, `CLEAN`
   and green with nobody left to merge it is the cheapest possible thing to
   lose and the hardest to notice, because **nothing about it looks wrong.**

   Measured: this run stopped with `#280` open and it sat for **19.7 hours** —
   created `2026-08-30T09:58:41Z`, merged `2026-08-31T05:39:53Z`, by which time
   a different session had noticed. Not blocked, not failing, not contested —
   clean merge, green checks, simply never merged before the manager went
   quiet. It was a real fix (*"Take the series origin from the series, not from
   the window"*) and it shipped a day late for no reason at all.

   The check costs one command at the moment of the decision, which is the
   property that made the absolute-stop rule work where the doc ratio did not.
   A ratio is read after the fact and argued about; `0` is read now and is not
   arguable.

   Note the shape, because it recurs: a stalled run and a finished run produce
   **the same repository state** — clean tree, green CI, master unchanged.
   Only the open-PR count separates them, and only while someone is looking.

1. **Verify every factual claim and stamp the instant you measured.** Every
   number in the starting-state block above was re-measured at 12:20Z.
2. **Carry the `instrument` and `deadend` entries forward.** They have the
   longest shelf life and the least chance of being rediscovered cheaply.
3. **Say what you changed from this prompt and why**, in a short section at the
   end. That diff is the actual record of whether the process improved.
4. **Delete guidance that stopped being true.** This run inherited four false
   statements from the last prompt and one from `AGENTS.md`, and repeated one
   of them into a session brief before measuring it.

### What I changed from the prompt I was handed, and why

- **Replaced the plant-proof.** `git diff --stat` was the last prompt's
  recommendation and it is wrong three ways. This is the change most likely to
  prevent a false conclusion.
- **Added "mark the guess" as a first-class instruction**, with four worked
  examples of my own briefs being overturned. The last prompt mentioned
  OBSERVED/GUESS/ASK only via `AGENTS.md`.
- **Said the manager writes code.** The last prompt's "you manage; child
  sessions write code" left the highest-yield activity — reading artefacts —
  unowned.
- **Deleted the four false gap claims** and folded the "additional areas"
  section into the three tracks, because three of the five had shipped.
- **Replaced "write the verification script on day one"** with "it exists, use
  it": `scripts/verify-pr.ps1`. The last prompt also asked for a fault-planting
  script that already existed as `scripts/mutation-check.ps1`.
- **Added the reporting-layer rule**, which no previous run had named, and which
  explains three separate probe failures in one day.

---

## Stand-down, 2026-09-02T12:57Z — read this first

Stopped from outside, not by a guardrail. Every guardrail this run wrote fired
and none of them stopped it, because **the alarm was keyed on volume and only
composition inverted.**

```
00:00-12:30Z, origin/master, commit touches a non-.md file?
             code   docs-only   total
2026-08-30     31       4        35
2026-08-31     36      25        61
2026-09-01     17      14        32
2026-09-02      8      58        66    <- highest total, lowest code output
```

Final: `AGENTS.md` **6715** lines, `PROGRAMME.md` **2702** before this section.
This run's ratio was roughly **7 docs commits per code commit**, against a stated
cap of one per three. The books now total ~144k tokens injected before any
session does work.

**The successor's first job is not to add to the books.** If a rule is worth
having it is worth *replacing* one, and the bar in `AGENTS.md` — a `what` needs a
population, a `why` needs to be correct — governs additions and says nothing
about total size. That is the gap. A size budget belongs beside it.

### The single open question — CLOSED, 2026-09-03

It read: *"The 14:00Z scheduled newsroom run had **not fired** at stand-down
(12:57Z). It has never been proven that a timer-triggered edition completes."*
It has now, and the instruction it carried was the right one — the answer came
from the **execution log pair**, which is emitted at both ends with a matching
`Id`, and not from `requests`, which carries a duration and so is written at the
end and cannot say whether anything started.

```
14:00:00  Executing 'Functions.newsroom_edition'
          (Reason='Timer fired at 2026-09-02T14:00:00.0150453+00:00',
           Id=bdd639f7-f277-4028-b5d3-f81d7d33c89f)
14:09:16  Executed  'Functions.newsroom_edition'
          (Succeeded, Id=bdd639f7-f277-4028-b5d3-f81d7d33c89f, Duration=556687ms)

runs/latest.json, read as RAW BYTES rather than through ConvertFrom-Json:
  "finished_at": "2026-09-02T14:09:16Z"      <- the Z is on the wire
  "trigger":     "timer"                     <- not "manual"
  "schedule":    "0 0 14 * * *"
```

All three legs on one scheduled run: the timer fired on schedule, the edition
finished, and both belong to the same execution. `Duration=556687ms` is
**9m16.7s against a 30-minute ceiling — 31% of it.**

⚠️ **Two instrument notes, because the first attempt got a clean zero from a
correctly configured component.** `portabaltica-ai` is **workspace-based**, so
`az monitor app-insights query` reports `traces | count -> 0` *ever*; the data
needs the Log Analytics workspace **and** the table `AppTraces`, not `traces`,
and either change alone still returns zero. And `Invoke-RestMethod` runs
`ConvertFrom-Json`, which types a date-like string to `[datetime]` and **drops
the `Z`** — so `finished_at` renders as a local wall clock and a reader three
hours away cannot tell 14:09Z from 14:09 local. Read `.Content` from
`Invoke-WebRequest` when a zone is load-bearing.


### Instrument traps with the longest shelf life

Every one of these fails **toward success**, and several are already documented
in `AGENTS.md`; these are the ones that cost this run time anyway.

```
git diff --stat is NOT plant-proof, five ways: untracked file · staged restore
  after `git checkout <c> -- <p>` · same-line edit · line-ending normalisation ·
  asserting the REPLACEMENT is present when it was already there.
  Authority: compare CONTENTS, and assert the ORIGINAL clause is GONE.

PowerShell `..` mangles a git revision range built by interpolation.
  `git rev-list --count $a..$b` -> a confident 0.  Always quote "$a..$b".

`git checkout -B master` exits 128 in a worktree where master lives elsewhere.
  Piped to Out-Null the exit code survives UNREAD, the commit lands detached, and
  `git push origin master` then pushes a STALE LOCAL ref.
  Use `git push origin HEAD:master` and read $LASTEXITCODE.

%aI spells UTC as `Z`; %ai spells it `+0000`. A filter on '\+00:00$' reports
  ZERO UTC commits in a repo with 53.

[datetime] subtraction ignores Kind. [datetime]'…Z' parses to Kind=Local with the
  value shifted; minus a .ToUniversalTime() value it is silently 3 h out here.
  Use [datetimeoffset] on both sides.

`gh run rerun` REPLACES a run's conclusion in place. Read `attempt` before
  trusting `conclusion`; a rerun destroys the evidence you may still need.

npm ci is broken on this tree (E404 react-router-dom, ETARGET @vitejs/plugin-react),
  so **vitest cannot run locally and CI is the only gate.** Plant faults through CI.

scripts/verify-pr.ps1 junctions node_modules into a temp worktree; `git worktree
  remove --force` FOLLOWS the junction and deletes the target. Tear it down with
  `cmd /c rmdir` first.
```

### A trap recorded at one site of two

`newsroom/function_app.py` carries **two** timers and **two** manual routes, and
the docstring *"Manual trigger for operators. Same code path as the …"* appears
**twice** — L182 (weekly) and L194 (edition). Earlier handovers named only L194.
The claim is true of the pipeline and false of the *trigger*, and a singleton lock
belongs to the trigger, so both sites mislead identically.

`git ls-files '*function_app.py'` also matches **two** files —
`infrastructure/verify/function_app.py` is the identity smoke test, not the
subject. `| Select-Object -First 1` asserts a singleton nobody checked.

### Dead ends worth not re-walking

Three false alarms were killed before filing rather than shipped as findings: a
`consumer_confidence` "freeze" that was a correct trailing-null; a
`ProvenanceBlock` "dead code" claim that fails because `ArticleView` returns early
for tier C, making the entries unreachable rather than wrong; and a derived guard
for tier A/B display names, declined because the defect it targets is currently
unreachable by construction.

Everything else from this run stays in the SQLite journal and dies with it. That
is the intended outcome.
