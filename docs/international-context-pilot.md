# International context pilot

This is a non-publishing source experiment, not a dashboard release. It adds two
registered, narrowly selected datasets without changing daily/weekly collection,
signals, model calls, publication, public evidence packs or schedules.

## Selected measures

| Provider | Dataset | Meaning |
|---|---|---|
| World Bank WDI | `NY.GDP.PCAP.PP.KD` | GDP per person in constant 2021 international dollars, adjusted for purchasing power |
| Our World in Data | `co-emissions-per-capita`, indicator `1119914` | Territorial fossil-fuel and industrial CO2 emissions in tonnes per person, excluding land-use change |

Countries are Latvia (`LV`/`LVA`), Estonia (`EE`/`EST`) and Lithuania (`LT`/`LTU`).
The window is 2000 through the last complete calendar year. These are annual
background measures, not real-time readings or a reason to publish daily news.

The internal metric IDs are deliberately distinct from the existing Eurostat
GDP-in-euros and total-greenhouse-gas measures. Do not splice them together.
No all-time record can be inferred from the bounded history.

## Run explicitly, without publishing

From the repository root, using the existing project-compatible Python 3.11+
environment with the newsroom dependencies:

```powershell
python -m newsroom.pipeline.international_context --collect
```

`--collect` is required. This command cannot generate an article or invoke a
model. It uses local storage even if Azure storage settings are present.
No API key, MCP server, new dependency or cloud resource is required.

The default directory is `.newsroom-archive\international-context`, already
git-ignored. `--directory <path>` selects another local directory.

- `evidence-cards.json`: the latest two-source result; overwritten on a rerun.
- `raw\`: source data and metadata bytes, archived before parsing.
- `conditional-state.json`: persistent HTTP cache metadata.

Each source requires two GET requests on a cold run. A 24-hour cache normally
avoids all requests on a warm rerun. Each request has one attempt through the
existing collector; each source has a 45-second overall deadline. The parser
refuses responses above 2 MiB, unexpected pagination, other geographies, changed
units/identities and malformed observations.

The command exits **0** only when both cards support a common-year Baltic
comparison. It exits **1** on source failure, malformed evidence, write failure
or missing common-year coverage, and **2** on invalid CLI arguments. A failing
source is logged and marked unavailable; valid evidence from the other source
is still saved. It never substitutes another provider or zeros for missing data.

## Evidence-card contract

The result declares `mode: non_publishing_pilot` and
`publication_allowed: false`. Each successful card includes:

- Exact metric, unit, definition, original providers, licence and attribution.
- The latest year for which all three countries have an observed value.
- Each country's value for that same year, separately from its latest reading.
- Annual history with `null` and `status: missing` for unavailable observations;
  source notes are retained. A real zero remains an observation.
- The age of the comparison relative to the requested window end.
- Dataset/version, provider update date and original retrieval timestamp.
- Request URLs, archive names and SHA-256 digests for data and metadata.

The two cards can have different comparison years. Do not treat values across
them as contemporaneous or calculate ratios without a further alignment step.
Cached evidence retains its original retrieval timestamp; `generated_at` only
dates the report.

## Rights and source changes

World Bank access follows [its data terms](https://data.worldbank.org/summary-terms-of-use)
and the cited original providers. OWID's
[chart API](https://docs.owid.io/projects/etl/api/chart-api/) supplies definitions
and citations alongside the data. CC BY 4.0 declarations for the selected Global
Carbon Budget and population inputs were checked in the
[indicator metadata](https://api.ourworldindata.org/v1/indicators/1119914.metadata.json)
on 2026-10-05. This is not a blanket licence for every OWID dataset.

A different OWID variable identity or a changed World Bank price base is a
failure requiring definition and rights review, not an automatic schema update.
The pilot registers both sources with `rewrite_allowed: false` and
`requires_human_approval: true`; `enabled: false` alone is not a tier A
collection gate. The actual isolation is that the scheduled collector never
calls these functions.

## Ten fixed acceptance behaviors

The `TestAcceptance` group in
[the pilot tests](../newsroom/tests/pipeline/test_international_context.py)
checks:

1. World Bank values, ISO country mapping and the 2021 PPP price basis.
2. OWID values, per-person units, territorial scope and original attribution.
3. Missing values remain missing; zero is not discarded.
4. Comparisons use one common year, never each country's independently latest year.
5. A missing country prevents a successful comparison.
6. Provenance resolves to exact data and metadata bytes.
7. A cached rerun makes no HTTP requests and preserves retrieval provenance.
8. An upstream failure is visible without discarding the other source.
9. Scheduled collection and prose-generation permissions remain unchanged.
10. The actual capture command persists local, non-publishing evidence even when
    cloud settings exist.

Additional tests reject incomplete pagination, duplicates, future/out-of-window
years, wrong indicators, non-finite/negative values, changed scope, malformed CSV
and oversized responses. They also check CLI opt-in and incomplete-result exit
codes. Tests use mocked HTTP, not external services.

## Promotion is separate work

Before using these values in articles or a public view, review live cards,
confirm rights and freshness policy, select the related newsroom topics, and
wire the existing factual/provenance checks. A green local pilot does not enable
publication or promise source availability. No health-check or production
dashboard source has been added while the sources remain pilot-only.
