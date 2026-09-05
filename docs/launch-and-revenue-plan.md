# portaBaltica: launch and first revenue

Date: 2026-09-05. Review baseline: `727fcf4`.

## Decision

The owner selected **business briefings for Baltic-focused analysts and small
businesses** as the first revenue experiment. Keep articles, charts, history,
exports and feeds free. Do not implement a paywall, recurring billing, advertising
or a paid API before validating demand.

The first implementation is a trustworthy public research preview and a
briefing-pilot discovery page, not a claim that a paid service is already operating.
There is no dedicated public business inbox yet. Public MX records point
`naurolabs.com` at ImprovMX; this does not prove an individual alias exists.
The owner subsequently chose `portabaltica@naurolabs.com`. The alias was created
in ImprovMX and confirmed present after a reload on 2026-09-05. Its forwarding
destination remains private and is deliberately not recorded in this repository.
External delivery and authenticated branded replies are **not yet verified**.
No paid mail plan was purchased.

## Readiness assessment

- **Invite-only research preview:** useful, with explicit experimental status.
- **Broad promotion:** blocked by data/publication defects and unresolved source
  permissions. Passing tests alone is not editorial verification.
- **Accepting payment:** not ready. No validated paid demand, verified business
  inbox, agreed deliverable, legal seller/terms, billing/refunds or unit economics.
- **Profitability:** a hypothesis to test, never an outcome software can guarantee.

Strengths: cross-country comparisons, source-linked series and exports, explicit
AI disclosure, corrections history, separate static publication and a substantial
existing regression suite.

## Implementation priorities

### 1. Trust before acquisition

Fix and regression-test the actual handlers, not parallel test implementations:

- Select the current electricity delivery interval, not the first row in its hour.
- Expire browser price caches at the same boundary. Refresh only price consumers
  in visible tabs and on return; an old in-flight response must not replace a
  newer country/interval, and failed refreshes must not leave an old price labelled current.
- Count EU funding projects from the project list, not contract amendments.
- Preserve sparse JSON-stat indices and respect each series' actual cadence.
- Preserve good cached observations during upstream failure; distinguish failure
  from a legitimate empty result.
- Build time-dependent health probes at request time.
- Align trade balance periods and reject failed CKAN searches explicitly.
- Make configured cloud publication fail if the article was not durably written.
- Compare raw source observations, including divergence constituents, in revision
  monitoring; do not turn display rounding into an alleged source correction.
- Preserve original observations in the published article before indexing, replay
  incomplete registrations and repair correction-log gaps even if the source
  changes again before retry. Watch every observation establishing a streak.
- Tighten unsupported attribution/causal claims and name nested spreads precisely.

Do not silently rewrite or withdraw existing published articles. Editorial
corrections require their own reviewed action and a durable correction record.

### 2. A useful, honest commercial entry point

- Add `/briefings`: audience, concrete business questions, links to current
  evidence and a sample, and an explicit discovery-pilot status.
- Prepare a bounded enquiry draft only after a verified public mailbox is
  configured. No account, backend lead database, tracking pixels or implicit
  newsletter consent.
- Without that configuration, show a truthful "enquiries are not open" state;
  never render a fake checkout, successful submission or an unverified address.
- Wire discoverability, sitemap, server/client metadata and accessibility tests.
- Retain the project's existing design system and free functionality.
- Add headline/summary search over the current published index and incremental
  article display. A 375px live homepage measured 22,283px tall before this change;
  keep every indexed article reachable without rendering the entire list initially.

### 3. Validate and release deliberately

Run the relevant existing offline tests, lint/type checks and build, then an
independent code review. Exercise reader journeys in a browser, including narrow
screens, keyboard access and the unconfigured contact state. Keep fixes in an
isolated worktree because the main checkout has concurrent changes.

No new infrastructure or purchased service is required for this implementation.
Release and live verification must be recorded separately from local completion.

## First commercial experiment

**Hypothesis:** a small number of analysts or operators will pay for a concise,
human-reviewed Baltic costs/demand/hiring brief that reduces their recurring
research work. An automatically generated collection of statistics is not yet
that deliverable.

Interview 10-15 prospective readers around one repeated decision. Ask what they
do now, how long it takes, which figures they check and what errors cost. Show a
source-linked sample. Do not lead with an unvalidated price or invent testimonials.

Offer at most three manually fulfilled pilots after rights, mailbox and seller
checks. Agree country coverage, question, delivery date, evidence, reviewer,
limits and price in writing. Test a one-off invoice before subscriptions.

Suggested price experiments, not published offers: EUR 49-99 for a scoped pilot
brief; EUR 99-199/month only if a repeatable, genuinely useful recurring
deliverable emerges. Validate rather than treating these as market prices.

## Launch gates and owners

| Gate | Evidence needed | Owner |
| --- | --- | --- |
| Data correctness | Adversarial handler tests plus sampled live/source parity | Engineering |
| Editorial trust | Review 20 representative recent originals; correct material issues with public notices | Publisher |
| Source rights | Dated commercial use/redistribution matrix; Elering permission; Open-Meteo plan; third-party excerpt clearance | Publisher |
| Production hosting | Verify the actual subscription offer; production workloads and shared AI dependencies must not rely on dev/test-only Visual Studio benefits | Owner |
| Public contact | Create alias, verify external inbound and replies, spam handling and monitored owner | Owner |
| Seller and privacy | Real legal seller, contact, terms, data-processing/retention, tax/VAT and refund arrangements | Owner/adviser |
| Pilot value | Readers demonstrate a repeated job and willingness to pay | Owner |
| Delivery economics | Revenue net of tax/fees exceeds model/data/hosting and reviewer/support labour | Owner |
| Release | Reviewed commit, successful CI and production reader-journey checks | Engineering |
| History privacy | Review existing historical identity findings separately; the new-commit range must pass the unchanged push guard | Owner |

## Measurement, not vanity metrics

Track interviews, qualified enquiries, samples delivered, paid pilots, renewals,
delivery time, corrections, refunds and net contribution. Raw HTTP requests are
not people, subscribers or monthly active readers. Do not introduce behavioural
tracking until its purpose and privacy obligations are agreed.

Unit contribution = net price excluding VAT - payment fees - paid source/API
costs - generation/delivery cost - reviewer/support hours at a realistic rate.
Add monthly fixed costs to determine business break-even. Free cloud credits do
not make editorial labour free.

For example, a EUR 99 one-off pilot **excluding any applicable VAT**, less
EUR 3 assumed payment cost, one reviewer hour at EUR 30, 15 minutes of support
at the same rate, and EUR 5 other variable costs leaves EUR 53.50 before sales,
administration and fixed costs. At two reviewer hours it leaves EUR 23.50.
These are illustrative assumptions, not a payment-provider quote or a forecast.
Record actual time on the first pilots; a low cloud bill cannot rescue an
unbounded bespoke research service at a newsletter price.

## 30 / 60 / 90 day decisions

- **Days 1-30:** repair trust blockers, resolve permissions and contact, interview
  10-15 readers, deliver five permission-cleared samples. Continue only if at
  least three readers name a repeatable job and ask for another brief.
- **Days 31-60:** aim for three paid pilots; record fulfilment time and feedback.
  Do not automate an offering nobody wants.
- **Days 61-90:** seek at least two repeat purchases and positive contribution
  including labour. If achieved, consider recurring billing and explicit
  subscriber preferences. If not, narrow the audience/problem or stop the offer.

These are decision thresholds for an experiment, not forecasts.

## Deferred

Subscriptions, automated email delivery, personalisation, customer accounts, paid
API/SLA, sponsored placements, additional languages and new data sources.
Each adds obligations before it adds proven revenue. Revisit only after the
pilot identifies which capability a paying customer actually needs.

## Market and source checks

Public offers checked on 2026-09-05; these demonstrate alternatives, not demand
for this project:

- [The Baltic Times](https://www.baltictimes.com/subscribe/online/) advertises
  EUR 49/year with 2,400 article credits, not unlimited access.
- [BNS](https://www.bns.ee/en/services/) already offers English daily/weekly
  bulletins and Baltic Business Weekly under an information-services agreement.
- [bne IntelliNews](https://www.intellinews.com/buy) advertises country packages
  at USD 59/month; Baltic States is listed as a country package. This is not a
  like-for-like price benchmark for an unproven pilot.
- [Via Baltica](https://viabaltica.fi/about/) offers free Baltic summaries,
  a newsletter and RSS. Aggregation alone is not a defensible paid advantage.

Rights checklist (guidance, not legal advice):

| Source | Confirmed condition / unresolved issue |
| --- | --- |
| [Eurostat](https://ec.europa.eu/eurostat/help/copyright-notice) | Commercial reuse generally permitted with acknowledgement; exceptions and dataset-level notices apply. Label modifications, provide citations/access dates and the applicable disclaimer. |
| [ECB](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html) | Accurate reproduction and attribution; disclose that ECB information is free at the source before payment and whenever the buyer accesses incorporated information; identify modifications. |
| [Elering API](https://dashboard.elering.ee/assets/api-doc.html) / [Nord Pool](https://www.nordpoolgroup.com/en/services/power-market-data-services/dataportalregistration/) | Public access does not establish commercial redistribution rights. Obtain written clarification for prices, retained history, derived figures, exports and API access. Our source registry already requires permission before promotion. |
| [Open-Meteo](https://open-meteo.com/en/terms) | The free hosted API is non-commercial. Subscriptions or advertising can change eligibility for the whole website, not just the paid page. Obtain the appropriate plan or remove the dependency before commercial operation; observe data attribution. |
| Third-party news | RSS availability is not proof of permission for commercial republication. Review headline/snippet rights; do not assume a publisher-provided snippet is automatically a permitted length. |

Start commercial samples with explicitly cleared Eurostat/ECB series. That does
not by itself resolve the public portal's weather and power-data dependencies.
Open-Meteo also lists promotional activities as commercial use: resolve this
before publishing or promoting a lead-generation pilot, not merely before the
first payment.

Before invoicing, confirm legal seller, B2B/B2C scope, applicable VAT, withdrawal
and refund requirements with an adviser. References:
[EU distance selling](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm),
[VAT OSS](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en),
[GDPR obligations](https://europa.eu/youreurope/business/governance-and-sustainability/digital-and-data-compliance/data-protection-gdpr/index_en.htm),
[AI Act Article 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50).
The existing AI disclosure is worth retaining; an AI editor is not human review.

### Azure credits are not a production entitlement

The lab's documented default is a Visual Studio credit subscription. Microsoft
states that [these monthly credits are for individual development/testing, not
production workloads](https://learn.microsoft.com/visualstudio/subscriptions/faq/subscriber/azure/).
Verify the actual billing offer on the project's SWA, Functions, storage and
shared model dependencies before commercial launch; the offer was not inspected
through authenticated billing APIs in this review. If it is dev/test-only,
convert/move production to an eligible paid subscription with explicit owner
approval and a fresh cost budget. Do not assume that removing a spending cap or
using a service's Free SKU changes the subscription's permitted use.
No subscription, spending limit or resource placement was changed here.

## Email activation runbook

1. Alias creation is complete. Existing catch-all and other aliases were unchanged.
2. Send a neutral test to the public alias from a different external inbox.
   Confirm arrival in the intended inbox and inspect spam; sending from the
   forwarding destination itself can be suppressed as a loop.
3. Choose an outgoing service with the owner's approval. ImprovMX's account
   advertises paid SMTP at USD 9/month; no upgrade has been approved. Verify
   current checkout terms before buying anything.
4. Configure authenticated send-as and required SPF/DKIM/DMARC records without
   replacing unrelated existing senders. In Gmail, use the provider's
   [SMTP setup guide](https://improvmx.com/guides/gmail-smtp/).
   Passwords and verification codes are entered by the owner, never committed.
5. Send an outbound test to an independent inbox; verify the public From address,
   replies, authentication and delivery. The
   [legacy Gmail SMTP workaround](https://improvmx.com/guides/send-emails-using-gmail/)
   explicitly warns of authentication and rejection problems; it is not our
   recommended business-mail configuration.
6. Assign an inbox owner and response/retention policy. Only then set the GitHub
   repository variable `VITE_BRIEFING_ENQUIRIES_OPEN=true` and rebuild/redeploy.
   Missing, false or unrecognised values leave enquiries closed.
7. Verify `/briefings` prepares the correct mailto draft and fallback text.
   It must never say a request was sent: only the reader's mail client sends it.

No lead database or newsletter has been introduced. A future mailing list needs
separate opt-in, unsubscribe, processor and privacy arrangements.

## Publication status

The implementation was first committed on `feat/business-readiness-20260905`
(code commit `459b9fe`, initial status record `60765f0`). On 2026-09-05 the owner
explicitly requested commit, merge and deployment. Remote `master` was
fast-forwarded from `727fcf4` to `60765f0` through the unchanged pre-push hook,
without a force push, exception, history rewrite or pull request.

The initial new-branch attempt had a different audit scope: it scanned existing
ancestry and flagged identity metadata in **463 historical commits**. Those
commits were already on public master. The ordinary existing-branch update audits
the actual outgoing range; both new commits and all 84 changed files passed its
13 configured patterns. A clean workspace checkout resolved configuration
discovery without copying private configuration or changing the hook.

Historical metadata still warrants owner-approved remediation, including the
implications for existing references and collaborators; the clean outgoing range
does not certify old history.

The existing workflows have deployed the frontend/API and newsroom at `60765f0`.
Live verification confirmed the briefing page on both Azure and custom hostnames,
search and pagination, correct project counts, delivery-interval electricity
prices, one-year annual history, server metadata and the sitemap. The Function
App reports that revision and both daily/weekly timers are registered.

Enquiries and payments remain disabled. No new resource or paid service was
created. The cost helper failed to launch Azure CLI on Windows; Cost Management
returned HTTP 429 after backoff, and the consumption fallback provided no usable
cost values. Current metered spend is unknown, not zero. Production-eligible
billing and all commercial activation gates above remain separate work.
