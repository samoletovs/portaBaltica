# International comparison explainers

The owner approved autonomous evaluation and publication of the two verified
international-context comparisons on 2026-10-05. Human approval is not required
for each draft. Factual validation and the AI editorial desk remain mandatory:
an approval by the editor cannot override a failed validator.

## Bounded scope

- World Bank `NY.GDP.PCAP.PP.KD`: GDP per person, PPP, constant 2021
  international dollars. This is output, not salary, household income or wealth.
- OWID `co-emissions-per-capita`, variable `1119914`: territorial fossil-fuel
  and industrial CO2 per person. Not all greenhouse gases, land-use change or
  a consumption-based footprint.
- Latvia, Estonia and Lithuania at the latest year common to all three, chosen
  independently for each measure.
- At most one article for each measure per invocation. Already indexed findings
  are skipped before any writer call.

These are commissioned annual comparisons, not daily news signals. They carry
`signal_detector: commissioned_comparison`, no invented ranking score, visible
observation years and the existing AI bylines. The editor is explicitly told
that no daily ranking selected them.

Commissioned headlines are fixed to the approved comparison question and its
observation year before validation and editorial review. The model writes the
body, not an unsupported record/breaking-news headline. The editor reviews the
actual headline that will be published.

## Run

From a clean, reviewed checkout with the existing newsroom dependencies:

```powershell
python -m newsroom.pipeline.international_explainers --publish
```

Publication requires the existing `BLOB_ACCOUNT_URL` (or its documented alias),
the existing model configuration, and `NEWSROOM_REVISION` identifying the exact
code being run. Use existing Azure credentials: no storage keys, API keys or new
resource are required. Do not substitute a test writer or stamp an unmeasured
revision.

For local evaluation without uploading content:

```powershell
python -m newsroom.pipeline.international_explainers --preview
```

Preview is an internal verification option, not a mandatory human approval
queue. It still makes bounded model calls. Neither mode invokes the normal
edition, syndication, hypothesis panel or schedule.

## Gates and evidence

The command reuses:

1. The pinned collectors and their source-definition, pagination, value,
   country and unit checks.
2. The existing HTTP cache and raw archive, with a 45-second collection deadline
   per provider and one attempt per request.
3. `generate_article`, with its unchanged factual checks and bounded attempts.
4. `run_desk`, including at most one editorial rewrite and the final decision.
5. `figures_from`, so every approved article carries the original, unrounded
   country observations alongside the derived range.
6. `ArticleStore` and `VintageStore`, including the existing accumulated index.

The frozen observations already render through `StoryEvidenceGraphic`. No new
dashboard or live-series proxy is needed. The generated articles omit a live
chart reference rather than link to an unrelated Eurostat measure. Metadata
links and friendly publisher labels are included in the existing provenance UI.

The result is saved at `.newsroom-archive\international-explainers\report.json`;
`--directory` changes that local working directory. Local article copies and raw
responses sit beneath it. All default output is git-ignored.

The report distinguishes `published`, `already_published`, `preview`, `rejected`
and `failed`. Its writer-attempt accounting explicitly excludes editor calls,
transport retries and billing usage. Exit 1 means the batch was incomplete; do
not describe it as two published articles without checking both results and the
public index. Storage errors can occur after an article file is written, so
inspect the recorded state before retrying a partial run.

## What stays unchanged

The original `international_context --collect` command remains model-free and
non-publishing. These sources remain excluded from scheduled `collect_open_data`.
There is no new timer, MCP server, model deployment, public endpoint or
unrestricted source catalog. Permissions are opened only for original writing
from the pinned structured datasets; unrelated restricted-source rules remain.

Future routine collection, revision monitoring of these sources, or expansion
to additional measures is separate work. Frozen article observations remain a
record of the publication vintage, not a claim of live source monitoring.
