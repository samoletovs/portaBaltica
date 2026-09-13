# Full-product design direction

Research and owner feedback: 2026-09-09.

## What changed in the brief

The owner rejected a mostly cosmetic Signal Desk migration, then a striking
homepage connected to largely familiar internal screens. The replacement must
change the composition and interaction of the news edition, article, research
workspace and indicator detail together. A new entrance alone is not completion.

Keep the approved subdued slate-blue light palette and petrol/copper dark
palette. Preserve every source, period, correction, AI disclosure and free data
path. Do not turn design into a new product claim or invent forecasts.

## Research, with its limits

| Reference | What it establishes | What we take from it |
| --- | --- | --- |
| [OpenAI GPT-6 Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) | Official coding, research, computer-use and tool support. It does not promise design awards. | Use tools to build and inspect complete working journeys, not just generate a screenshot. |
| [Astra demo roundup](https://explainx.ai/blog/gpt-6-astra-best-demos-showcase-2026) | A secondary account of launch demos. Its frontend example explicitly describes an official clip with no independent reproduction attached. | Reference-led composition and iteration from rendered output. We did not reproduce or independently audit the videos. |
| [The Pudding's project description](https://awards.journalists.org/entries/the-pudding-7/) | A visual-essay publication described on the Online Journalism Awards site. The fetched description alone is not proof of a particular award. | Make the subject shape the presentation; distinguish an editorial reading experience from an operator's workspace. |
| [Our World in Data explorers](https://ourworldindata.org/explorers) | A real catalogue of topic-specific data exploration tools, not a marketing page. | A searchable, focused analysis workspace with definitions, country selection and export, rather than a long inventory of charts. |
| [Sigma Awards 2024 winners](https://www.sigmaawards.org/meet-the-winners-of-the-sigmas-2024-for-data-journalism/) | The awards organiser documents the FT's *How China is tearing down Islam* among its winners and discusses coherent integration of evidence and page design. | Keep explanatory text, geographic context and source material one connected story. Do not copy its reporting or artwork. |

These are reference principles, not templates to clone. Our World in Data is a
usability reference here, not a claimed design-award winner. No paid plugin,
undocumented model setting or newly installed skill is presented as the cause
of a good design.

## The connected system

- **Journal:** a full-width editorial edition, a substantial illustrated lead
  and varied story rhythm. Search and filters govern the reporting, not the
  whole identity of the page. Other publishers remain clearly separate.
- **Story:** an expansive editorial opening, readable prose and a persistent
  evidence companion. Published observations and current charts are different
  records and must remain distinguishable.
- **Data explorer:** find an indicator, work on one comparison at a useful scale,
  switch representation, inspect exact values and export. The same pattern
  continues into indicator permalinks; this is one tool, not two products.
- **Dashboard:** retain the all-sector scan and single-sector views, with sticky
  sector navigation and existing specialist capabilities in the shared design.
- **Business briefings:** a complete public sample with independently loaded
  prices, labour costs and retail observations, common-period comparisons,
  evidence links, exports and print. Bespoke enquiries remain gated and closed.

The shared visual language is self-hosted Barlow Semi Condensed, story-specific
evidence graphics, open rules and analytical surfaces. Fonts are served as
WOFF2 with Latin and Latin-extended coverage under the bundled SIL Open Font
License. The earlier Natural Earth map study remains a concept reference,
not recurring decoration on every report.

The success criterion is a coherent, noticeably reimagined product across its
actual working pages. Awards remain external judgements, not something the
implementation can certify.

## Implementation record

The working journal, article/evidence layout, research workspace, indicator
detail and briefing page now use this system. Existing sector tools are
retained in the first-class Dashboard. The earlier landing-page studies are not
the implemented news route, and their fixed snapshots are not application data.

Research links preserve country and indicator selection. Legacy indicator
metadata is derived from the displayed registry measure rather than the former
hand-written descriptions. Original published article text, source provenance,
correction notices and the closed briefing-enquiry gate remain intact.
All screen sizes show the same four peer navigation links, without a menu
toggle. There is no separate white research CTA or duplicate desktop directory,
and all routes share one publication footer. The Dashboard's market snapshot
starts expanded with a continuous, pausable tape.

## Motion references supplied by the owner

The owner clarified that the intended experience is scroll-driven rather than
mostly static, and supplied:

- [MindStudio: Astra website design](https://www.mindstudio.ai/blog/gpt-6-astra-design-websites)
- [Video reference 1](https://www.youtube.com/watch?v=5V7FiduSrpw)
- [Video reference 2](https://www.youtube.com/watch?v=xGLaBBf2Rxw)
- [Video reference 3](https://www.youtube.com/watch?v=dQudtNmDjJw)

The accessible article specifically describes independently moving visual
planes, different page grammars and a custom prompting framework. Its linked
[public source](https://github.com/nateherkai/scroll-craft) was inspected at
`0b816225945e45380397d6a0487efa3c98916858`, including the
[layering guide](https://github.com/nateherkai/scroll-craft/blob/main/plugins/nateherk-design/skills/scroll-craft/references/hero-depth.md).
No external asset-generation service or private API key was used.

The video fetches were blocked by a sign-in check; their contents were not
independently viewed. A public walkthrough attachment in the source README
also returned 404. Search-generated guesses about the video titles are not
treated as evidence.

GSAP and ScrollTrigger provide the site's motion mechanism. After reviewing the
map in context, the owner chose evidence over recurring geographic decoration:
the journal lead now reveals actual recorded comparisons, followed by collection
reveals. Article navigation tracks the actual
story length. Dashboard sector rules and cards enter as the reader moves
through the overview. Explorer transitions change the representation, not the
underlying observations. No numeric value is animated through invented
intermediate readings.

Motion follows the device's reduced-motion preference. Print remains static
and exposes all observations, including content not yet scrolled into view.
Scroll input stays native; the site does not replace the wheel or lock the
cursor. These changes belong to the working product, not another standalone
landing-page study.

## Quality pass: 10 September 2026

The follow-up evaluates task completion as well as appearance. The approved
type, palette, two-tone wordmark and source-backed editorial identity remain.

| Proposal | Decision | Reason |
| --- | --- | --- |
| Reduce the Dashboard's initial API fan-out | Implemented bounded comparison batches | A fully painted page can still have missing data. Request efficiency comes before decorative polish; production rate limits remain unchanged. |
| Return mobile catalogue selection to the analysis | Implemented | Leaving the catalogue open puts the chosen result below the viewport. Desktop retains the open library for rapid comparison. |
| Clarify and align data controls | Implemented | The former isolated line-style icon had no visible explanation. Country, history and Lines now form a deliberate narrow-screen arrangement. |
| Make evidence access complete | Implemented | Sources links open the record, repeat visits work, and printing includes nested checks without leaving the page expanded afterward. |
| Pair briefing commentary with its figures | Implemented | Wider screens support reading and checking side by side; phones retain a single reading order and full country-specific evidence links. |
| Another decorative map, rebrand or repeated entrance sequence | Declined | These add visual activity without improving the question-to-evidence journey the owner selected. |

[W3C ARIA22](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22)
specifies that a status-message container is present before the message occurs;
the copy-link feedback now follows that pattern. The
[Web Vitals guidance](https://web.dev/articles/vitals) distinguishes loading,
interactivity and visual stability and evaluates real-user results at the
75th percentile. Local browser measurements guide this pass; they are not a
claim of field-wide Core Web Vitals compliance or an award outcome.

## Evidence and usefulness pass: 11 September 2026

**Release decision, 13 September:** the owner selected **overnight stays** for
the main tourism view. The prospective arrivals change described in this
earlier evaluation was not released. The final `tourism` definition uses
`tour_occ_nim`, title "Overnight stays" and unit "nights" throughout the
Dashboard, explorer, exports and future newsroom reporting. Latvia's separate
`historical-data?indicator=tourist_arrivals` API continues to count arrivals in
persons. Old browser entries with either the arrivals cube or the old persons
label on night counts are invalidated; historical articles are not rewritten.

Baseline: `c5964be6dba591e3741913681a5afd7a14a52528`. The approved visual
identity is retained. This pass prioritises accurate evidence and complete
reader tasks over another palette, type or animation change.

| Perspective | Observed problem | Selected change and value | Effort / risk |
| --- | --- | --- | --- |
| UI / evidence | A sampled article stored four publication observations but displayed none in its Sources panel; its graphic used only two primary points. | Show the full usable frozen record and download it with sources and corrections. Keep current series separate. | Medium; bind each row to the article and handle absent records explicitly. |
| UI / handoff | Copying a table view at an inspected period retained only country. | Preserve history, view and period, and explain an unavailable shared period. Distinguish a failed article fetch from an editorial refusal and offer retry. | Medium; avoid an extra default-window fetch and preserve keyboard access. |
| APIs / meaning | `tourism` asked for nights under an arrivals label; national arrivals were labelled thousands rather than persons. | Read actual arrivals, retain genuine overnight-stay series, and refuse obsolete browser definitions. | Medium; historical newsroom vintages must retain their original source identity. |
| APIs / reliability | A successful HTTP response with no Baltic observations could replace good cached data; current weather estimates carried unsupported daily or seasonal comparisons. | Refuse empty comparisons while retaining partial countries and zeros; keep observation wording within its actual time basis. | Low; no quota increases, new provider or request fan-out. |
| Newsroom / editing | The daily and weekly desk revision paths supplied notes without the draft they referred to. | Supply the complete fenced editable draft, keep notes through retries and retain the existing validation budget. | Medium; deterministic flow is tested, but net model cost and prose-quality gains are unmeasured. |
| Newsroom / comparison | A same-period power-price tie was described as an unqualified highest reading. | Rank the original observations and name joint-highest, joint-lowest and equal readings explicitly. | Low; optional ranking is omitted when the subject observation is unavailable. |
| Briefings / planning | Country ranges did not tell a reader what changed locally or what to check next. | Add country-focused costs, labour and retail questions, label-addressed changes, limits and next-reading conditions; retain common-period Baltic evidence. | Medium; these are planning prompts, not forecasts or validated customer demand. |
| Briefings / reuse | A printout or shared link needed the focus and evidence scope stated. | Preserve focus and section in the link; print source URLs and retrieval instants; label exports as the full retrieved window. | Low; sharing a live view is not freezing its values. |

The transferable reference principles remain source/context proximity from
[Our World in Data](https://ourworldindata.org/faqs),
[Datawrapper's question-led chart guidance](https://www.datawrapper.de/blog/better-charts)
rather than reusable decoration, and the
[GOV.UK table component's captions and scoped headings](https://design-system.service.gov.uk/components/table/)
for inspection. Existing [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
informs persistent copy/download feedback. The
[Web Vitals distinction between lab and field measurements](https://web.dev/articles/optimize-cls)
continues to bound the performance claims: a local browser check is not a
field-wide accessibility or performance certification.

Two useful source candidates were probed but deferred. Eurostat
`tour_occ_mnor` offered monthly hotel bed occupancy for all three countries
through June 2026; it is hotels-only, not the full accommodation scope of
arrivals. `nrg_pc_203` offered ten populated half-years of non-household gas
prices for each country through 2025-S2, for the 10,000-99,999 GJ band excluding
taxes. Both could support narrower planning questions, but neither outranked
correcting existing information. They are not added to the product by this
document. [Eurostat reuse conditions](https://ec.europa.eu/eurostat/help/copyright-notice)
require acknowledgement and attention to exceptions; existing Elering,
Open-Meteo and third-party-news commercial clearance remains unresolved.

No historical article is rewritten or republished by this pass. The editorial
sample found older scope, time and subject claims needing a separate publisher
correction review. Cross-country own-base index semantics, complete cumulative
revision accounting, paid offerings, outbound delivery and a new visual
redesign are deferred. No stochastic model-quality improvement, customer
demand, commercial readiness or award outcome is claimed.

### Pre-merge consistency refinement

The owner's four screenshots exposed a repeated-role mismatch, not a missing
font. Rendered at 696px on `c3a54f4`, all four destinations used Baltic Editorial,
but the journal title was 56px/600 with 0.94 leading and capitals; Dashboard and
briefing titles were 40px/400, and the explorer was 40px/600. Title spacing also
differed. The mechanical type scan alone reported no problem.

The shared `PageIntro` and `PageTitle` now carry those roles, with data controls
below the opening rather than above the title. Section titles,
actions, filters, fields, evidence tables and inset panels also share type and
geometry, while reading and analytical layouts retain their different jobs.
The existing Barlow family, slate-blue/petrol-copper palette, source-backed
graphics, two-tone wordmark, disclosures and data workflows are unchanged.
The browser contract measures computed styles rather than accepting matching
class names as proof; its original 696px case exposed 19 failing presentation assertions.
