# Evidence archive pilot

## Scope

An opt-in, command-line proof inside portaBaltica, not a paid service or a new
public API. Production collection, article publication, schedules and infrastructure
are unchanged. No model calls, new dependencies or paid services are required.

The first selection is Eurostat `une_rt_m`: monthly (`M`), seasonally adjusted
(`SA`) unemployment, total age (`TOTAL`) and sex (`T`), percent of active population
(`PC_ACT`), for EE, LV and LT, with observation periods from January 2020.
This reuses the existing newsroom series definition and source registry.

The archive answers "what did this source return when we captured it?", not
"what was first published then?". Source update time, retrieval time and the
observation period are different fields. Missing cells and observation flags
remain explicit. This is not a guarantee that every intermediate release was caught.

## Implementation

- `newsroom/pipeline/evidence/`: strict JSON-stat normalization, immutable
  local/optional Blob artifacts, live capture, legacy import, replay, CSV and diff.
- `.newsroom-evidence/`: ignored local artifacts, including run journals.
- `newsroom/tests/pipeline/test_evidence*.py`: offline behavioural tests.

A capture writes raw bytes before parsing; a completed manifest is written last.
Every artifact is hash-checked when replayed. Raw byte hashes are integrity checks,
not signatures proving publisher authenticity. Local files are create-only through
this tool, not protected against an administrator editing the filesystem.

Configured Blob writes are authoritative: failure cannot become local-only success.
The existing private `raw-feeds` container is reused without provisioning or changing
permissions. Optional cloud mode uses the existing identity pattern. It is not enabled
by running the local pilot.

Each attempt has separate started/result journal records. Missing result means an
interrupted attempt, not unchanged data. No successful release is produced on a
network, validation or storage failure. Capture is independent of article selection
and never calls the writer.

Replay regenerates normalized JSON and CSV from the stored raw response and recorded
provenance without contacting Eurostat. Comparison distinguishes changed readings and
flags, newly returned periods, filled missing values and removed observations.
Editorial significance thresholds must not discard changes from this archive.

Legacy import requires the original request URL, retrieval timestamp, full SHA-256,
HTTP status and Blob origin. Import time is recorded separately. The tool verifies
bytes and series coordinates; it cannot certify the truth of a caller-supplied
sidecar. Only audited source-archive metadata should be imported.

## Acceptance criteria

1. Replay a real capture offline and reproduce its CSV byte-for-byte.
2. Preserve all returned Baltic cells in the selected period range, including nulls
   and flags, with source measurement coordinates attached.
3. A failed HTTP request or authoritative write leaves an explicit failed attempt,
   exits non-zero and produces no complete manifest.
4. Reusing a path cannot overwrite an existing artifact.
5. Comparison reports a flag-only change and a removed value; a new month is not
   described as a revised earlier reading.
6. Imported historical bytes retain their original retrieval time.
7. Existing collectors and publication behaviour remain unchanged.
8. A real observed source revision is reported only if two verified source captures
   demonstrate it. Synthetic test revisions are never presented as market evidence.

## Running the pilot

From the repository root, using the project's selected Python environment:

```powershell
python -m newsroom.pipeline.evidence capture
python -m newsroom.pipeline.evidence capture --previous <snapshot-id>
python -m newsroom.pipeline.evidence replay <snapshot-id> --export-directory .newsroom-evidence\review-sample
python -m newsroom.pipeline.evidence compare <older-id> <newer-id> --output .newsroom-evidence\comparison.json
python -m newsroom.pipeline.evidence import-legacy <raw-response-file> <audited-metadata-file>
```

Capture prints the run and snapshot identifiers through the CLI logger. Failed
commands exit non-zero. Artifacts default to `.newsroom-evidence/`; use
`--directory <path>` before the subcommand for an isolated archive.
No local `.env` is automatically loaded.

`--cloud` before the subcommand explicitly selects the existing configured
`BLOB_ACCOUNT_URL` and private `raw-feeds` container, under `evidence/v1/`.
It does not create containers or change permissions. In cloud mode the artifacts
are cloud-authoritative and the local directory contains attempt journals;
use replay's export option to obtain a local pack.
Do not enable cloud writes or scheduled operation as part of the review pilot.

The exported pack contains:

- `source.json`: exact original response bytes, including unselected source metadata.
- `normalized.json`: all selected coordinates, including explicit missing cells.
- `observations.csv`: selected values, flags and per-row provenance.
- `dictionary.json`: column meanings and source dimension labels.
- `manifest.json`: original retrieval time, import/capture origin, coverage and hashes.

The first development captures predate the standalone dictionary artifact. They
remain replayable: their CSV and normalized hashes are checked and the dictionary
is regenerated on export. New captures also store and verify the dictionary hash.

Reusing an export path is permitted only when its bytes are identical. Use a new
folder for each different snapshot. Comparison output is likewise create-only.
A flag-only change is visible even when numeric readings match. Missing readings
are never converted to zero. New months are not counted as numeric revisions.

## Review gate and next step

This milestone does not wire a production timer, public download route, article
evidence links, checkout or a subscription. Review the sample and audit first.
Then decide whether to add a monitored capture hook to the existing collection
schedule and a reader-facing frozen-evidence view.

The current infrastructure template moves `raw-feeds` to Cool after 30 days and
offline Archive after 180 days. Before promising interactive historical downloads,
retain the serving packs in an online tier and verify deployed lifecycle settings.
Do not rehydrate old blobs or alter lifecycle policy as part of this pilot.

Eurostat reuse requires attribution, identification of modifications and applicable
disclaimers/exceptions. Current charts and exports remain free. Rights checks,
exact-series competitor coverage and repeat buyer demand precede any paid offer.
