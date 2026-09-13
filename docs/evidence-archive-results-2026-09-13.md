# Evidence archive pilot: 2026-09-13

## Decision status

Implemented and exercised locally for review. Not deployed, not scheduled and not
offered for sale. Existing articles, data routes, history and exports are unchanged.
No new packages, infrastructure, model calls, Azure writes or lifecycle changes.

## What the real source returned

Selection: Eurostat `une_rt_m`, frequency `M`, adjustment `SA`, age `TOTAL`,
sex `T`, unit `PC_ACT`; countries EE, LV and LT; observation window from `2020-01`.

| Country | Returned monthly coordinates | Numeric readings | Missing readings | Latest numeric period | Latest reading |
|---------|------------------------------|------------------|------------------|-----------------------|----------------|
| Estonia (EE) | 80 | 79 | 1 | 2026-07 | 6.9% |
| Latvia (LV) | 80 | 79 | 1 | 2026-07 | 7.3% |
| Lithuania (LT) | 80 | 79 | 1 | 2026-07 | 6.2% |

The coordinate range is January 2020 through August 2026. August has no numeric
reading in any of the three countries: it remains missing, not zero or a forecast.
No observation flags were present in these live responses. Preservation of flags
and all-missing country rows is verified with explicitly synthetic offline tests.

The first two capture times were **2026-09-13 13:04:52 UTC** and
**2026-09-13 13:05:34 UTC**. Both responses reported source update time
`2026-09-04T23:00:00+0200`. These are three distinct concepts: retrieval time,
source update time, and the month being measured.

## Reproduction evidence

- First snapshot: `a4fcc7a9dfb04d608a81fc92e1141187`.
- Second snapshot: `bdd89f87c1274f04aaf87a25a6ff75bd`.
- First raw SHA-256:
  `bc5a157ee4f4bddc5dfbfb09c679e498dcf033390980d6ecd8cb9e7415829923`.
- Replayed CSV SHA-256, independently checked with PowerShell `Get-FileHash`:
  `a746e1f653e947c02dce9ec7752e8e111b06c77f272f4b78909a8efbcc58644c`.
- Second capture: zero cell changes, zero metadata-label changes, `unchanged=true`.
  **Two captures on the same day do not demonstrate historical revision value.**

Local review pack (deliberately excluded from git):
`.newsroom-evidence/review-pack.zip` (also unpacked in
`.newsroom-evidence/review-pack/`). It contains the original response, normalized
data, CSV, dictionary and manifest from a third final-format capture at
**2026-09-13 13:21:49 UTC**, snapshot `1f3774aad7d24172afe52466b124f252`.
It again found no changes. The final CSV hash is
`d20bc6d160f25f91eba5caf41486d4124d68516fe3183456602d3ae798c92dbf`;
it differs from the first CSV because each row carries its own retrieval time.
The raw and normalized hashes remain identical.

The earlier replay pack remains in `.newsroom-evidence/review-sample/`, and its
unchanged comparison is `.newsroom-evidence/same-day-comparison.json`.

Replay does not contact Eurostat. Unit tests forbid network access during replay
and compare the CSV against separately constructed expected bytes, rather than
merely asserting that the implementation agrees with itself.

## Existing archive: genuine revisions recovered

A bounded read-only audit inspected **246 Blob metadata entries** across three
dates and downloaded only **three matching raw responses**. Their full SHA-256
hashes matched the original archive metadata. No source data, permissions,
credentials or lifecycle settings were changed.

The first SDK download failed to invoke the Azure CLI; this was not an observed
authorization denial. A normal direct invocation of the already installed Azure
CLI, using the same signed-in account, recovered the three named blobs without
another listing or a sign-in/account change. Both the initial failure and successful
recovery remain recorded in local audit artifacts.

| Original capture (UTC) | Imported snapshot | Selected coordinates | Original raw SHA-256 |
|------------------------|-------------------|----------------------|---------------------|
| 2026-08-30 14:00:02 | `85e48db98f634d12af47a7324b1cd4dd` | 180 | `45010b8155cea48d66c67ca211727779f728b79b4cdb02923729593007758694` |
| 2026-09-05 14:00:02 | `811c9fbc583e42cebf24e477b8519ecf` | 240 | `c5bcf72f8d1f9bd63a31446fa15726ff1b886cb37578620e334f4b04c1842ab4` |
| 2026-09-12 14:00:04 | `5d0a588eac784e0ea34a703f32bc4220` | 240 | `c5bcf72f8d1f9bd63a31446fa15726ff1b886cb37578620e334f4b04c1842ab4` |

The imports retain those original retrieval times; September 13 is recorded
separately as import/audit time. These are recovered real captures, not fabricated
historical vintages.

**August 30 versus September 5: 64 numeric changes at matched country/month
coordinates.** The pilot comparison independently reproduced the audit's result:

| Country | Changed existing readings | June 2026 reading in August capture | June 2026 reading in September capture |
|---------|---------------------------|-------------------------------------|---------------------------------------|
| Estonia | 49 | 6.6% | 6.9% |
| Latvia | 12 | 6.8% | 7.1% |
| Lithuania | 3 | 6.9% | 6.2% |

These examples are the same dataset, age, sex, seasonal-adjustment and unit
coordinates. We observed the source responses changing between captures; this
does not establish the exact time or reason for an official revision.

Three July readings changed from missing to available. There were **no flag
changes**. Sixty newly returned coordinates were kept separate from the 64 numeric
revisions: 57 came from expanding the earlier 60-month request window back to
January 2020, and three were the new, still-missing August coordinates. They are
not sixty newly published readings.

September 5 and September 12 are byte-identical. Their normalized Baltic values
also match the new September 13 captures, despite the historical raw response
including older periods and the EU aggregate.

Review files:

- `.newsroom-evidence/revision-review.zip`: replay-verified August and September
  packs, full comparison JSON, and a 64-row numeric-change CSV for review.
- `.newsroom-evidence/historical-comparison.json`: verified August-to-September diff.
- `.newsroom-evidence/september-comparison.json`: verified unchanged September pair.
- `.newsroom-evidence/legacy-audit/audit-semantic-provenance.json`: exact Blob
  references, request URLs, hashes, original timestamps and bounded audit findings.
- `.newsroom-evidence/legacy-audit/payloads/`: three unchanged source responses and
  their original-provenance sidecars.

This is sample evidence, not a claim of complete historical coverage. The earlier
capture's observation window begins in August 2021, and only three archive dates
were audited.

## Verification and review

The targeted command:

```powershell
python -m pytest newsroom\tests\pipeline\test_evidence_archive.py newsroom\tests\pipeline\test_evidence_cli.py newsroom\tests\pipeline\test_collect.py -q
```

**120 passed** using the project's editor-selected Python 3.14.3. Existing runtime
dependencies were already installed; none were downloaded or changed. This is not
a claim of a Python 3.11/3.12 CI run or a deployed cloud smoke test.

An independent reviewer and independently authored tests found that the initial
normalizer rejected an entirely missing country's observations. The fix preserves
those coordinates and flags, validating coordinate presence separately from numeric
availability. This is material: a withdrawn reading is itself evidence worth retaining.
The independent reviewer rechecked the fix and confirmed the finding resolved.

Tests cover sparse and dense reordered cubes, zero versus missing, flags,
sub-threshold numeric changes, new versus removed periods, tampered artifacts,
wrong measurement dimensions, original legacy timestamps, exact replay, create-only
storage, network failures and authoritative Blob-write failures at every release
stage. Failed captures leave a failed attempt instead of an unchanged-data release.

## Commercial interpretation

The prototype demonstrates reproducible evidence, not willingness to pay.
The recovered captures demonstrate genuine differences in earlier source readings,
whereas the same-day captures demonstrate correct unchanged-data handling.
An original historical snapshot must retain its original provenance; today's
historical observations cannot be relabelled as observations captured years ago.

Review the sample before adding more series. The next proposed milestone is a
monitored hook in the existing collection schedule and an article-to-frozen-evidence
reader journey. Decide retention/online serving and source rights before that
rollout. Billing, account creation and a paid API remain out of scope.
