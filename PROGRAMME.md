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
Expect to run for many hours. You manage; child sessions write code.

**Read `AGENTS.md` and `DESIGN.md` first.** They are long, authoritative, and
written by previous runs of this programme. Do not re-derive what they record.

---

## The brief — three tracks

**1. Design and UI.** The portal must look unambiguously professional.
`DESIGN.md` is the design book; `tests/typography.test.ts` and
`tests/design-system.test.ts` enforce it. **Look at rendered pages, not only
code** — open a browser canvas, read the DOM, screenshot at real viewports.
Mobile is the surface the last programme never reviewed.

**2. Data sources.** Validate every source is green and current. Remove visuals
backed by dead or frozen feeds. Actively hunt for new APIs, or unused data in
APIs already wired, and add visuals that are genuinely interesting. Check
`/api/system-status`. "Reachable" and "fresh" are different questions, and a
feed can serve HTTP 200 with valid JSON while frozen for months.

**3. The newsroom.** Publish more and better articles. Improve the pipeline —
research depth, generation, editorial gates — where it earns its keep.

---

## Additional areas, each with the evidence that found it

These were measured at handover, not brainstormed. Treat them as candidate
fourth/fifth tracks — pick what fits, and check the evidence still holds before
acting on it.

**Nothing alerts the owner when a source goes stale.** A grep for
telegram/webhook/alert/notify across `api/`, `newsroom/pipeline/` and
`.github/workflows/` returns **nothing**. `/api/system-status` is pull-only, so
the freshness machinery the last programme built announces a frozen feed to
whoever happens to load the page. `AGENTS.md` records a Eurostat series frozen
for eight months and a data.gov.lv feed serving header-only CSVs for eighteen
weeks, both behind HTTP 200. **Detection without notification is how those last
that long.** A daily workflow that opens an issue when a required source goes
stale or unhealthy is a small change with a large payoff.

**No data export anywhere.** Zero download affordances across every component —
no CSV, no JSON, no copy-the-series. On an *open-data* portal that is a
conspicuous absence: it is the feature the audience most obviously wants, it
costs little, and it is the natural on-ramp to the "API docs & pricing" the
footer already advertises.

**Real audience, no way to keep it.** Measured at handover:

```
traffic         today 181 · last 7 days 12,243 · last 30 days 20,100 (~670/day)
selfSustaining  0 free · 0 pro · 0 enterprise · €0 · "pre-monetization"
```

RSS is the only follow mechanism — a grep for subscribe/newsletter/email in
`src/` returns nothing. **670 readers a day with no path to come back** is the
biggest gap between what the project has and what it gets for it. Email alerts
on an indicator, or a weekly digest of the wrap, would convert traffic into
audience.

**English only, in a trilingual market.** `lang="en"`, and a grep for
i18n/useTranslation/LOCALES in `src/` returns **0 files** — the site serves
Latvia, Estonia and Lithuania in one language. `AGENTS.md` states this is a
deliberate deferral ("i18n is not required yet"), so it is a decision rather
than an oversight — but it also records a **free Translator F0 already
provisioned and deliberately unwired**, waiting for exactly this phase. An
asset that is paid for and idle is the cheapest expansion available. Machine
translation of an AI newsroom also needs its own disclosure, which is an
editorial question before it is a technical one.

### Two areas measured and found healthy — do not spend time here

- **Security headers.** CSP, HSTS, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy and X-Frame-Options are all present on the live site.
- **Performance.** Home page: TTFB 321ms, DOMContentLoaded 390ms, 44 requests,
  278 KB transferred. Recharts is behind a lazy boundary and stays there.

---

## How to run it

Spawn implementation sessions with `create_session` and brief each one in
detail. **Give every session exclusive ownership of a file set** so concurrent
work cannot collide; that is what made parallelism work last time. You review,
verify and merge. Track work in the `backlog` SQLite table.

### The two practices that found almost everything

**Verify every PR yourself before merging.** Test-merge locally, run the
suites, and check `headRefOid` against `git ls-remote` — `gh pr merge` merges
the SHA the PR record holds, which may not be the branch tip. This caught real
defects in roughly one PR in ten, *including three in fixes written fifteen
minutes earlier by the manager*.

**Plant a fault and confirm the check fails before believing it passes.** A
green test proves nothing until you have seen it go red. **Assert the plant
actually changed the file** — a control that fails to plant is indistinguishable
from a test that fails to fire, and that exact confusion produced a wrong
conclusion last time.

**Write these as a reusable script on day one.** Last time they were retyped ad
hoc for every PR, which is both slow and how several probe errors got in.

---

## Efficiency guardrails — each measured, not guessed

**Watch throughput, and treat a collapse as a signal.** Measured last time:

```
merged PRs/day   08-24: 35   08-25: 23   08-26: 22   08-27: 88   08-28: 6
commits          170 total, 134 code, 36 markdown-only (21%)
final six hours   23 total,   9 code, 14 markdown-only (61%)
```

The final day produced **6 PRs against a peak of 88** while activity continued
at full pace. The work had drifted from shipping into writing rules *about*
shipping, and it felt productive throughout. **If merged PRs/day falls below a
third of your peak while you are still busy, stop and ship something.**

**Cap documentation at one markdown-only commit per three code commits**, and
measure the ratio rather than trusting your sense of it.

**Only document a rule with two independent instances.** Twelve candidates were
declined on this last time and the file is better for it. A rule built from one
example is a description of that example.

**Keep the backlog honest, or derive it.** Last time 69 of 243 items sat in
non-terminal states (`dispatched`, `routed`, `proposed`) — and on inspection
*every one sampled had actually shipped*. The tracker drifted from reality and
would have told a successor there were 69 open items. Either close items at
merge time, or derive status from the PR record instead of maintaining it by
hand.

**Reply once to cross-session messages, with the measurement, and move on.**
Verifying what arrives is right — several re-deliveries carried genuine defects
and several carried corrections worth having. Long philosophical exchanges are
not; they consumed many turns for little shipped code.

---

## Instrument discipline — the dominant failure mode

The programme's main enemy was never bad code. It was **probes returning
confident wrong answers**. Specific traps, all hit for real:

- `npx tsc --noEmit` exits 0 **without checking anything** on this
  project-references setup. Use `npm run build`, which runs `tsc -b`.
- `git rev-parse <missing-ref>` returns the literal string — non-empty and
  truthy, so `if (-not $x)` never fires.
- `git for-each-ref 'refs/copilot/checkpoints/*'` returns 0; the glob does not
  span path levels.
- `git --date=format-local` appends a misleading `Z` to **local** time.
- `Measure-Object -Line` silently omits empty lines.
- `git branch --merged` cannot identify merged branches here — squash-merge
  means a merged branch is never an ancestor. It reported 123 of 185 branches
  as unmerged. Match names against merged PR `headRefName` instead, then diff
  the remainder by content.

Three rules that follow:

- **When a reading is absent, print the shape before concluding. When it is
  absurd, suspect the probe. When it is merely surprising, confirm which thing
  you actually measured.**
- **State the SHA you measured, and make the measurement read it.** Prefer
  `git show <sha>:path` over the working tree. A session verified a SHA with
  `git log origin/master`, then swept `process.cwd()` — two trees, one report,
  four commits of drift.
- **Never suppress the output of a command whose failure you would want to know
  about.** `| Out-Null` on a failing build and on a failing `git checkout` both
  produced confidently wrong follow-on conclusions.

**A green deploy job means uploaded, not serving.** Do not measure the site
straight after a merge and treat the result as evidence in either direction.
For anything deterministic, replay locally against the merged tree. Every
article records its producing commit in `provenance.revision`, so "was this
generated by the code I think?" is a lookup, not a guess.

---

## Run a journal, and leave the next run a better prompt

This prompt exists because the last programme was measured after it finished.
Everything useful in it — the throughput collapse, the doc-ratio drift, the six
instrument traps — was noticed **retrospectively**, which meant each one cost
its full price before anyone saw it. **Record as you go and the same
observations become steering rather than hindsight.**

**Keep it in SQLite, not in markdown.** This must not become more prose commits;
the doc cap above still applies. Create the table on your first turn:

```sql
CREATE TABLE journal (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,              -- ISO-8601 UTC instant
  kind TEXT NOT NULL,            -- challenge | instrument | deadend | timesink | decision | surprise
  track TEXT,                    -- design | api | newsroom | process
  what TEXT NOT NULL,            -- what happened, one or two sentences
  cost TEXT,                     -- turns, wall time, or PRs lost
  fix TEXT                       -- what you did, or what a future run should do
);
```

Write an entry when any of these happens — they are cheap, and the ones that
felt trivial at the time turned out to be the most valuable:

- **`instrument`** — any probe that returned a wrong answer. This was the
  dominant failure mode and a running list is the single most portable artefact
  you can produce. Record the command, the wrong reading, and the true one.
- **`deadend`** — work started and abandoned, with why. A successor that knows
  what was already tried does not retry it.
- **`timesink`** — anything that consumed disproportionate turns for its value.
- **`challenge`** — what blocked you and what unblocked it.
- **`decision`** — especially *declines*. A rule you chose not to write, or a
  finding you chose not to file, is worth more than one you did, because
  nothing else records it.
- **`surprise`** — a reading that contradicted your model of the system.

### Review your own execution on a cadence, not at the end

**Every two hours of wall time**, run these and act on them:

```powershell
# throughput: merged PRs per day; compare today against your peak day
gh pr list --state merged --limit 300 --json mergedAt | ConvertFrom-Json |
  Group-Object { ([datetimeoffset]$_.mergedAt).ToUniversalTime().ToString('yyyy-MM-dd') } |
  Sort-Object Name | ForEach-Object { "$($_.Name)  $($_.Count)" }

# doc ratio: markdown-only COMMITS vs code commits (want code:docs >= 3:1)
$code = 0; $docs = 0
foreach ($c in (git log --since='2 hours ago' --format='%H' origin/master)) {
  $files = git show --pretty='' --name-only $c
  if (($files | Where-Object { $_ -notmatch '\.md$' }).Count -eq 0) { $docs++ } else { $code++ }
}
"code $code · markdown-only $docs"
```

Count **commits, not files.** The obvious one-liner —
`git log ... | ForEach-Object { (git show --name-only $_) -notmatch '\.md$' } | Group-Object`
— returns `True: 35, False: 13`, which looks like an answer and is a count of
files across all commits. The true figure for that same window was 10 and 14.
This was caught by testing the command before shipping it in this prompt; the
loop above is the tested version.

Also check **backlog honesty**: sample a few non-terminal items and confirm they
have not, in fact, already shipped.

If throughput has collapsed, or the doc ratio has crossed 1:3, or the backlog
is drifting from reality — **say so in the journal and change what you are
doing**. The last run's failure was not that it drifted; it is that it drifted
for six hours without noticing.

### Final deliverable: the successor prompt

Before you stop, write `next-session-prompt.md` to your session files
directory. It must:

1. **Verify every factual claim in it** — master SHA, PR count, test counts,
   site health — and stamp the instant you measured. The starting-state block
   below was checked line by line before this prompt was handed over; do the
   same, because a successor trusting a stale number will conclude something
   was deleted.
2. **Carry the journal's `instrument` and `deadend` entries forward.** These
   are the entries with the longest shelf life and the least chance of being
   rediscovered cheaply.
3. **Say what you changed from this prompt and why**, in a short section at the
   end. That diff is the actual record of whether the process improved, and
   without it each run starts from the same place with different words.
4. **Delete guidance that stopped being true.** This prompt inherited a bullet
   recommending work that had already shipped; a successor would have built it
   twice. Guidance that describes a solved problem is worse than no guidance.

---

## Starting state (verified 2026-08-28T10:06Z)

```
master d6804c7 · 0 open PRs · working tree clean
site healthy · 8/8 required sources · 0 stale · 28 published articles
frontend 1515 tests (85 files) · newsroom 1568 tests
```

The last programme merged **117 PRs**, then found **thirteen further defects
after declaring itself complete**. Treat "complete" as a measurement with a
timestamp, not a state.

### First tasks, in order

1. **Verify the unattended newsroom run.** The timer is `0 0 14 * * *` (14:00
   UTC daily, overridable via `NEWSROOM_SCHEDULE`). At handover the newest
   article was ~17h old, and *no published article had ever been produced by
   code containing the final editorial fixes* — confirmed by comparing
   `provenance.revision` against those merge commits, not inferred from
   timestamps. **Whether the newsroom publishes unattended with the current
   code is the single largest open question in the project.** Check it first.

2. **Continue the mobile work.** `#184` landed the first pass — the guided tour
   no longer opens itself below 640px, plus three defects behind it. It was the
   first review mobile had ever had, so treat one pass as a start rather than a
   finish: walk every route at phone widths and keep going.

3. **Dispose of one parked branch.** `samoletovs-surface-family` (`af8bf2a`,
   *"WIP surfaces + status migration"*) — 19 design-system files, never opened
   as a PR. It conflicts in 9 of 19 files against master and its test files
   already exist there, so it is probably superseded. **Read it before
   deleting**; 19 files of parked intent may hold an idea that never shipped.

### Two things to know on day one

`src/sections.ts` is the single definition of the nine dashboard sections. Five
further copies exist across three languages that cannot import it and are
asserted equal by tests — adding a section means editing all six, and the tests
name which.

The Static Web App lives in `era-rg`, not `portabaltica-rg`. That is a known
deviation, deliberately unfixed, and `AGENTS.md` explains why.

---

Start by reading `AGENTS.md` and `DESIGN.md`, checking `/api/system-status`,
and looking at the live site on desktop and mobile viewports. Then plan, spawn,
and ship.
