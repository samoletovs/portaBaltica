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
