# portaBaltica readiness review

Reviewed 2026-09-05. Code baseline: `727fcf4`. Live observations in this report
precede this branch's release. See [the execution and revenue plan](launch-and-revenue-plan.md).

## Executive judgment

**There is a useful product here, but not yet a proven business.** Its strengths
are comparable Baltic data, source-linked reporting and the ability to inspect
and export the underlying evidence. Its weakness is not a shortage of features:
it is the gap between correct-looking outputs and dependable interpretation.

**Share selectively as an experimental research preview. Do not promote it as a
dependable newswire or accept subscriptions yet.** Engineering repairs, source
permissions, an editorial review of already-published material and a tested
commercial contact are separate gates. None establishes willingness to pay.

The recommended commercial position is narrower than "Bloomberg for the
Baltics": **help a Baltic-focused analyst or operator prepare a recurring
management, budget or hiring discussion with less research work**.

## What was examined

- Independent review of dashboard handlers, source parsing, caching, searches,
  exports, health checks and their actual-handler tests.
- Independent review of newsroom publication, validation, revision monitoring,
  source registry and policies, with controlled adversarial reproductions.
- Live frontend/news index, navigation, mobile layout, article discoverability,
  follow routes, API documentation and commercial promises.
- Public comparator offers and first-party source-use terms, linked in the plan.
- Existing test/build/lint gates and independent review of implementation diffs.

Not a penetration test, complete accessibility certification, legal clearance,
audience survey or financial audit. No private customer records were needed.

## The assets worth preserving

1. **Evidence is inspectable.** Readers can move from an article to a source,
   compare countries and export data without registering.
2. **AI is disclosed.** Correspondents and the editor are labelled as AI.
   Provenance and a public corrections history are stronger foundations than
   an anonymous content farm.
3. **The publication architecture is economical.** Readers consume finished
   articles; they do not trigger a paid model call for each page view.
4. **Substantial regression coverage already exists.** It includes attribution,
   dates, source degradation, typography, contrast and deployment wiring.
   The defects below show why it still needs adversarial, end-to-end cases.
5. **The interface has a coherent system.** Preserve named tokens, readable
   hierarchy, source links, keyboard focus and reduced-motion support rather
   than replacing them with a cosmetic redesign.

## Priority findings

### P1: Correct-looking statistics can be wrong

| Baseline defect | Evidence | Required repair |
| --- | --- | --- |
| Wrong current electricity interval | At 06:24 UTC, economy returned 24.63 EUR/MWh while the quarter-hour endpoint returned 22.20 for 06:15. A 06:45 fixture with prices 10/20/30/40 returned 10. | Select the containing delivery interval; cache schedules without losing outage fallback at interval boundaries. |
| Funding amendments counted as projects | `/api/eu-funds` selected an amendments table: 1,724 rows for 460 distinct projects. The project-list resource contained 466 projects. Status totals represented only the first 200 rows. | Select the correct resource, aggregate the actual whole project population, order the stated update field. |
| Failed refresh replaces valid history | Good response, expiry, upstream outage, then HTTP 200 with an empty cached series. | Preserve usable history during grace; failures must not be cached as valid empty datasets. |
| Sparse observations move to the wrong year | `value: {"2": 123}` across 2024/2025/2026 was returned as 2024 = 123. | Decode flat JSON-stat indices, not the enumeration order of present values. |

Relevant implementation:
[economy](../api/economy-data/index.js),
[funding](../api/eu-funds/index.js),
[history](../api/historical-data/index.js),
[cache](../api/shared/responseCache.js).

### P1: A successful publication report need not mean a published article

A mocked failed blob upload still put the slug in the index, recorded one
publication and reported no errors. This was reproduced locally, not observed
as a production outage. Require durable acknowledgement of configured cloud
writes; failed authoritative reads must not license an empty overwrite.

See [publication](../newsroom/pipeline/publish.py) and
[orchestration](../newsroom/pipeline/run.py).

### P1: Revision monitoring and validation overstate their coverage

- Divergence stories stored synthetic geography `Baltic`, while observations
  were indexed under EE/LV/LT. Changing a constituent unemployment figure left
  the published gap uncorrected in a controlled reproduction.
- Comparing display-rounded figures with raw observations could invent a
  source revision. An unchanged 1,486,367 became a stored 1,486,370.
- Paragraph-wide denial/attribution exemptions allowed an unsupported causal
  claim or fabricated quotation through deterministic validation.
- A power story described a 90.82 EUR/MWh difference between intraday ranges as
  general price divergence. That is not the 41.86 daily-mean price difference.

Repair constituent/raw-observation tracking, failure propagation, explicit
grounding and quantity names. **No automated validator proves prose true.**
Human editorial sampling and honest limitations remain necessary.

See [revision tracking](../newsroom/pipeline/vintage.py),
[revision detection](../newsroom/pipeline/revisions.py) and
[validation](../newsroom/validator.py).

### P1 commercial gate: Public access is not commercial permission

The source registry itself says Elering access must be clarified before public
promotion. Nord Pool redistribution conditions, Open-Meteo's non-commercial
free hosted service and third-party news excerpts require separate decisions.
An API docs sentence claiming all data is CC0/CC-BY was too broad.

The chosen briefing offer does not erase those dependencies from the rest of the
portal. Resolve them before sponsorships, subscriptions or other commercial use.
The [rights checklist](launch-and-revenue-plan.md#market-and-source-checks)
records the primary sources and open questions.

Production hosting is a separate gate. The lab's documented Visual Studio
monthly-credit benefit is [dev/test-only according to Microsoft](https://learn.microsoft.com/visualstudio/subscriptions/faq/subscriber/azure/).
The project's actual billing offer was not independently read in this review.
Check it, including shared model dependencies, and use production-eligible
billing before a commercial launch. Credits are neither revenue nor permission
to operate a paid production service.

### P2: Smaller errors still undermine trust

- Unemployment ticker used a frozen national table despite the historical
  path knowing about fresher Eurostat data.
- Annual history ignored the selected year range.
- Weather reconstructed from an older cached observation acquired a new
  apparent fetch time without a useful stale warning.
- Health-probe time windows froze at worker startup.
- CKAN errors appeared as successful empty searches, and address filtering
  discarded inactive rows after pagination rather than before it.
- Trade balance combined different reporting months.
- Concatenated query fragments allowed cache-key ambiguity.

These warrant regression cases at the real request boundary, not just tests
of locally copied parsing code.

### P2: Discoverability and commercial promises

The 375px homepage measured **22,283px tall** with 77 headings and no headline
search. Helpful follow links and alternative outlets were buried below a large
list. Existing Pro/Enterprise prices advertised unavailable functionality
without an operational purchase or delivery path.

This branch adds search and incremental display, keeps all indexed articles
reachable, introduces a truthful `/briefings` discovery page, and removes the
unvalidated subscription promises. API indicator links also become native
keyboard-operable links rather than clickable code elements.

## Technical/design assessment

Code-informed scores before implementation, not formal certifications:

| Dimension | Score / 4 | Finding |
| --- | --- | --- |
| Accessibility | 3 | Focus/contrast/reduced-motion foundations exist; API indicator chips were not keyboard links. |
| Performance | 2 | Lazy chart boundaries are good; the front page renders a needlessly large list. |
| Responsive design | 3 | No page-level overflow observed at 375px; navigation is dense and much content is far below the fold. |
| Theming | 3 | Shared light/dark semantic tokens and tests; no redesign needed for this experiment. |
| Anti-patterns | 2 | Dark blue, repeated panels and repetitive article framing feel templated; not a reason to prioritize decoration over correctness. |
| **Total** | **13/20** | **Usable foundations; significant trust and discovery work remains.** |

Design heuristic scores (0-4): system status 3, real-world language 2,
control/freedom 2, consistency 3, error prevention 2, recognition 2,
efficiency 2, minimalism 2, error recovery 2, help/documentation 3: **23/40**.
These are review judgments, not instrumented UX metrics.

The automated checks used were the project's existing token, typography,
accessibility and route tests plus browser measurements. No new design-scanner
package was installed. A full assistive-technology and cross-browser audit remains.

**First-time reader:** several navigation rows appear before the story; the
relationship between a country selector and the unfiltered news feed is unclear.
Explain scope and provide a direct route to useful work.

**Analyst:** source links and exports are valuable, but an observation from the
wrong interval/year or a falsely marked correction is more damaging than a
missing chart. Reliability and precise definitions are the priority.

**Prospective buyer:** existing prices lacked an operating service behind them.
A pilot should explain the decision supported, reviewer, scope and limits,
not ask for payment before those exist.

## Work that code alone cannot complete

- Review at least 20 representative published originals, including divergence
  and hypothesis-heavy stories; apply approved corrections with public notices.
  Existing articles were not automatically rewritten during this review.
- Investigate source anomalies rather than normalizing them into invented
  facts; the funding source contains a future update date.
- Confirm legal seller identity/contact, privacy disclosures and processor/
  retention arrangements before receiving paid work.
- Test the new public email alias end-to-end and choose authenticated outbound
  mail. Configuration persistence is not delivery verification.
- Recruit prospective customers and obtain evidence of repeatable value.
- Investigate unknown-route behaviour and simplify navigation in a subsequent
  reader-focused pass; those were not part of this branch's trust repairs.

## Revenue judgment

A general English Baltic news subscription faces inexpensive or free established
alternatives. Display advertising needs a qualified audience that has not been
demonstrated. A paid API requires contractual rights, customer authentication,
durable quotas, support and reliability commitments that the anonymous public
API does not provide.

The smallest credible next step is a **manually fulfilled, permission-cleared,
human-reviewed business briefing pilot**. First prove that a specific customer
will pay and renew, then automate delivery. The plan defines interview, paid-pilot,
repeat-purchase and margin gates and explicitly includes reviewer labour.

Neither request counts nor a green build demonstrate a profitable project.

## Start the editorial review here

These are review candidates observed before release, not instructions to silently
rewrite published work:

| Published item | Review question | Closure evidence |
| --- | --- | --- |
| [Youth unemployment gap](https://portabaltica.naurolabs.com/article/youth-unemployment-gap-between-estonia-and-lithuania-widens-to-14-603186) | Does the pandemic-recovery explanation have supporting evidence, rather than merely following a disclaimer? | Verify sources; remove or properly qualify unsupported interpretation through the public correction process if warranted. |
| [Power price spread](https://portabaltica.naurolabs.com/article/power-price-spread-between-latvia-and-estonia-reaches-90-82-848317) | Does the reader understand that 90.82 is the difference between intraday ranges, not daily-average prices? | Reproduce both ranges and the mean-price comparison, then make the quantity unambiguous with an appropriate notice. |
| Recent poverty/social-exclusion, government-revenue and air-passenger coverage | Is the measure named precisely? Are unlike economic sizes being interpreted fairly? Does a correction actually represent a source change rather than rounding? | Record source, period, definition, comparison basis and a review outcome for each item. |

For the remaining sample, cover at least one record, streak, cross-country
divergence, weekly review and source-revision notice. Record material errors
separately from upstream revisions; the corrections log and current feed are
different populations and must not be divided into a misleading error rate.

## Implementation verification

Completed on the isolated `feat/business-readiness-20260905` branch, not on the
live site:

| Check | Result |
| --- | --- |
| Full JavaScript/TypeScript suite | 2,598 passed across 145 files; 3 existing todo cases |
| Full newsroom Python suite | 2,899 passed; 1 runner-only shell check skipped on Windows |
| Build and existing lint gate | Passed |
| Python compatibility | 28 changed Python files parsed using Python 3.11 grammar |
| Production npm dependency audit | 0 reported vulnerabilities; no dependency versions changed |
| Existing staged-content leak guard | Passed across 84 files and 13 configured patterns |
| Independent code reviews | Frontend, dashboard API and publication findings closed after regression fixes |
| Pilot page | No horizontal overflow at 320, 375, 768 or 1280px; enquiries closed by default |
| Enquiry flow, enabled locally only | Correct public recipient, editable-mail draft, no automatic send or request while preparing |
| News discovery | 12 articles initially; all 69 in the sampled public index reachable; search finds initially hidden items |
| Price lifecycle | Browser-clock fixture advanced 10 -> 20 -> 30 at boundaries/resume; hidden tabs did not poll; unrelated feeds did not refetch |

Browser tests used public-index fixtures and controlled API responses in the
local preview; they do not certify deployed fixes or email delivery. The final
375px local front page measured 6,566px tall versus 22,283px on the original
live page, with every indexed article still reachable. The local preview's
unrelated dashboard APIs were disconnected, so this is not a like-for-like
performance benchmark.

Windows fork workers initially failed to start. The existing Vitest suite passed
with a bounded thread pool and the runner configuration loader; production CI
configuration was not weakened. Full-suite and independent-review findings were
fixed rather than excluded.

The leak guard found three pre-existing personal-name references in the touched
project instructions; those references were anonymized. Historical commits were
not rewritten, and this is not a claim that repository history has been scrubbed.

**Release remains withheld.** No production deployment, paid mail purchase,
subscription checkout, automatic correction of existing articles or source-rights
clearance was performed. The public contact alias is configured but end-to-end
delivery and branded replies still need verification.
