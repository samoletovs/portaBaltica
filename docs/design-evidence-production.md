# Production evidence archive

Approved 2026-09-13 following the verified local unemployment pilot.

## Reader value and scope

Readers can open the exact source response behind an eligible article, download
its frozen data and inspect revisions without confusing today's observations
with what was available then. A browsable archive also stands on its own.

Launch with the existing `baltic-unemployment-v1` contract (EE/LV/LT, `une_rt_m`,
M/SA/TOTAL/T/PC_ACT, normalized window from January 2020). Raw source responses
may include earlier observations and the EU aggregate; the page must distinguish
the complete retrieved source from the normalized Baltic subset.

No payment system, accounts, new source catalogue or additional cron. Existing
free data and article behaviour remains available.

## Capture and storage

Capture the exact `RawItem` the existing Eurostat collector parsed, before article
selection; do not independently refetch and label that as an article's evidence.
Cache reuse retains the original retrieval timestamp. A TTL hit is not a fresh
source observation. Every collection attempt records fresh/reused/failed status.

The new capability is enabled by `NEWSROOM_EVIDENCE_ENABLED=true`, default off
until deployment, online storage and seeded data are verified. No changes to the
edition timer cadence.

Private canonical snapshots retain the pilot's `raw-feeds/evidence/v1/` layout.
Only checked Eurostat unemployment packs are published create-only beneath the
existing public `articles/evidence/v1/` prefix. No other raw feeds, approval items
or credentials are exposed. Public serving copies stay online outside the raw
archive's 180-day offline-tier rule. No new resource is required.

Snapshots are idempotent for an exact retrieval identity plus raw hash, so retries
and cached reads do not create new vintages. Never overwrite a completed release.
Publish all checked artifacts before the immutable public manifest, and index only
completed public releases. Durable failures are visible, never local-only success.

Mutable catalogue updates use conditional writes/retries or an equivalent storage
lock: concurrent runs must not lose archive entries or move latest backwards.

## Public static contract (version 1)

Base: `${ARTICLES_BASE_URL}/evidence/v1` (frontend uses the existing
`VITE_ARTICLES_BASE_URL`; no new origin or client credential).

- `index.json`: `version`, `series_id`, `title`, `dataset`, `selection`,
  `start_period`, `stale_after_hours`, `last_attempt`, `last_success_at`,
  `latest_snapshot_id`, `months` (YYYY-MM newest first), `recent` (bounded list).
- `last_attempt`: `attempted_at`, `finished_at`, `status`
  (`captured`, `unchanged`, `reused`, `failed`), optional bounded public `error`.
- `recent` and monthly `snapshots` entries: `snapshot_id`, `observed_at`,
  `source_updated_at`, `row_count`, `missing_count`, `flagged_count`.
- `months/YYYY-MM.json`: `version`, `month`, `snapshots`. No silent truncation:
  all completed captures remain discoverable through their month.
- `snapshots/<32hex-id>/manifest.json`: pilot manifest plus optional
  `previous_snapshot_id` and `comparison` summary. The original provenance and
  SHA-256 hashes remain present.
- Same snapshot prefix: `source.json` (original bytes), `normalized.json`,
  `observations.csv`, `dictionary.json`, and optional `comparison.json`.
  Artifact URLs are constructed from the validated ID and known filenames, not
  arbitrary URLs returned by metadata. Raw source download hash is
  `manifest.provenance.sha256`; derived hashes are in `manifest.artifacts`.

The UI exposes both observation period and retrieval time, missing/flagged counts,
coverage limits, attribution/disclaimer, and source-revision differences separately
from expanded request coverage or new periods. A failed or overdue archive must
not wear a healthy/fresh badge.

The revision reader offers country and change-type filters with an explicit
matching count and a 12-row initial preview. Expanding reveals every matching
change; it does not change the capture or its comparison. Printing includes the
selected country's complete observation window and all matching revisions,
not just the screen preview. The selected scope remains named, source/checksum
disclosures open for printing, and their previous states are restored afterward.
Print uses readable paper colours in both screen themes and wraps table content
within the page.

## Exact article binding

`SourceRef` / article source schema / TypeScript source interface gain optional
`evidence_snapshot_id` (32 lowercase hex). Only a successfully committed public
pack may populate it. It propagates through the real detector/generator pipeline,
not a fabricated article fixture in production.

Existing articles are not rewritten. A small create-only lookup can establish an
exact match to an audited older source without modifying its published prose:

- `bindings/<64hex-key>.json`: `version`, `source_id`, `dataset`, `observed_at`,
  `request_url`, `snapshot_id`, `raw_sha256`.
- Key: SHA-256 of UTF-8
  `source_id + "\\n" + dataset + "\\n" + retrieved_at + "\\n" + url`.
  The separators are newline characters. Do not normalize or guess a missing URL.
- The reader validates every returned identity field against the article source;
  404 means no frozen match, not a match to the nearest date.

UI routes: `/evidence` (catalogue and archive health) and
`/evidence/:snapshotId` (frozen pack and optional revision comparison). Link
eligible sources from their provenance panel. Older sources with no exact match
must not claim a frozen record. Link the catalogue from the main data navigation.

## Operations and verification

Archive outcome is included in the newsroom run report and the existing system
status surface. A missing, stale or failed archive report is distinguishable from
unchanged data. If the collector fails before producing an item, record failure
for the selected contract as well. Error details exposed publicly are sanitized.

Before activation: check actual budget, online lifecycle and existing access;
seed only the three already-audited source responses and one current capture.
Activate the feature on the deployed host, exercise collection without running
paid article generation where possible, and verify exact source bindings and
downloads in a real browser. Do not manufacture or edit articles for the demo.

Tests must cover the actual collector-to-provenance path, cache/failure semantics,
retries/concurrency, immutable publication, monthly discovery, failed/stale health,
untrusted IDs/metadata, missing/flagged rows, old article bindings and downloads.
Retain the pilot's independent offline tests and verify real-source replay.

Roll back by disabling `NEWSROOM_EVIDENCE_ENABLED`; keep published snapshots and
links intact. Restore a prior application release only through the normal reviewed
deployment workflow. Do not delete evidence as part of rollback.

## Read-only deployment readiness, verified 2026-09-13

- Function `portabaltica-func` in `portabaltica-rg`: Python 3.12, existing daily
  `0 0 14 * * *` schedule, deployed revision `c351d70`.
- Storage `stportabalticabpmff5so`: articles are blob-public, raw-feeds are private,
  shared keys disabled; the existing Function identity can write both containers.
- Only raw-feeds is lifecycle-tiered. The new articles/evidence prefix remains
  online without a new account, container, role or lifecycle policy.
- Browser CORS permits the branded origin. Verify the reader at
  `https://portabaltica.naurolabs.com`; the SWA platform hostname is
  `ambitious-water-07243ee03.2.azurestaticapps.net`, but it is not a permitted
  Blob CORS origin. `/articles` on the branded site is not a proxy; use the
  existing direct Blob base.
- The budget API reports EUR 15.70067 spent against a configured EUR 100 budget
  (EUR 84.30 headroom), with billing-cycle forecast EUR 51.76. This is budget
  headroom, not measured remaining subscription credit. The legacy helper could
  not invoke `az`; a Cost Management query was throttled. Neither failure is zero spend.
- This remains a free research experiment. Commercial production billing/rights
  eligibility is a separate gate, not implicitly approved by this deployment.

Do not deploy the entire existing Bicep template as part of this change: it
declares private articles/account public access off, unlike the working live
configuration. This code-only rollout must preserve the existing delivery path.

An exact raw capture for the existing article
`latvia-s-unemployment-rate-rises-to-7-3-in-july-154f54` was recovered:
`2026-09-08/eurostat/20260908T131545Z-c5bcf72f8d1f.raw`, original retrieval time
`2026-09-08T13:15:45Z`, full hash
`c5bcf72f8d1f9bd63a31446fa15726ff1b886cb37578620e334f4b04c1842ab4`.
Its exact URL and timestamp match the article source. Seed the audited response
and binding to verify the real reader journey without editing or manufacturing
an article.

## Operator commands

From the repository root with the existing non-secret `BLOB_ACCOUNT_URL`,
`NEWSROOM_CONTAINER_RAW_FEEDS=raw-feeds` and
`NEWSROOM_CONTAINER_ARTICLES=articles` settings in the process environment:

```powershell
python -m newsroom.pipeline.evidence --cloud publish-audited
python -m newsroom.pipeline.evidence --cloud collect-only
```

The first command is restricted to the four explicitly approved local legacy
snapshot IDs. It replays/hash-checks them before replication and public serving.
The second exercises the real selected collector and returns its SourceRef,
including the committed evidence ID. Neither invokes the model or changes the
deployed feature flag. Without `--cloud`, these commands are local previews.

On the deployed Function App, `POST /api/evidence/collect` is protected by
function-key authentication and additionally refuses to run while the feature
flag is disabled. Use only its function-specific key in an HTTP header, never
the host master key, query strings, logs or committed files.

Only the exact source tuple can mint a legacy binding. The source response may
be the same bytes as another capture, but its original retrieval time still
belongs to that capture. Never create a binding by copying a date or guessing
which earlier blob probably backed an article.
