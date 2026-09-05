# How portaBaltica uses AI

**Last updated:** 2026-09-05
**Accountable publisher:** Andre Kõpu (human)

portaBaltica is an experiment in whether artificial intelligence can produce
genuinely useful journalism from open data. It is operated by NauroLabs, an
independent research lab. This page explains exactly what the machines here do,
what they are not permitted to do, and who answers for it when something is
wrong.

We publish this because a portal that uses AI and does not say so precisely is
asking for trust it has not earned.

---

## The short version

- **Our own articles are written by AI, from open government and EU data.** Every
  one is labelled, bylined to a named AI correspondent, and shows the datasets it
  came from.
- **The AI never chooses what counts as news, and never supplies a number.** Both
  come from deterministic code that we can inspect and test.
- **Where we suggest a cause, we say whose idea it is and that we cannot confirm
  it.** A statistic tells you what changed, not why. Rather than always answering
  "the data does not show what drove this", we ask AI analysts for candidate
  explanations — and every one is published as the newsroom's own AI analyst,
  marked unconfirmed. They are proposals, not findings, they never carry a
  figure, and they are never dressed up as a person.
- **We do not rewrite other outlets' journalism.** Where we point you at another
  publication, you get their headline, the summary they published themselves, and
  a link. Nothing is reworded.
- **Routine review is handled by a disclosed AI editor.** Andre is interrupted only
  when material appears dangerous, harmful or inappropriate; the editor approves
  or rejects ordinary verbatim items itself.
- **A human is accountable for everything here.** Named, above.

---

## 1. What data goes to the AI, and who decides

The model receives three things: a payload of already-verified figures from
public datasets, a style guide for the correspondent writing the piece, and
bounded research context selected from registered official and news feeds.
Research can explain a plausible cause, identify who is affected, or point to
what happens next. It can never supply a figure: a number found only in research
is rejected before publication.

It does not receive personal data and it does not browse freely. Deterministic
code selects a small number of relevant items from feeds we already fetched and
cached. Content we ingest from other websites is passed to the model inside
nonce-delimited boundaries that mark it as untrusted data rather than
instruction, because a hostile headline is a genuine attack on a system like
this one.

The list of permitted sources is a published file in our source code
(`newsroom/sources.yaml`). Content from a source that is not on that list is
discarded. Adding a source is a code change, reviewed by the accountable editor.

### The one place a model uses knowledge of its own

There is a single exception to all of the above, and it is worth stating
plainly because it is the only point at which anything here draws on something
other than a retrieved figure.

A statistic says what changed. It almost never says why, and for a long time
this site answered that question by refusing it — "the data does not show what
drove the change" appeared in article after article. That sentence is honest,
and it is also an admission that nobody looked.

So after the figures are verified, three AI analysts are consulted separately and
asked what a demographer, a political economist, an industry analyst, a
geopolitical analyst or a household economist would say drove this. They are
permitted to use what they know about the region — its policy history, its
industries, its corridors, its population structure. They are consulted
separately rather than together, so where two of them independently land on the
same explanation, that is worth something and we say so.

**They are not people, and they are never given names.** An analyst appears as
*"the newsroom's AI demographer"* — a role, carrying the same disclosure the
byline carries, in the same phrase a reader sees. This is a correction rather
than a design we got right first time: the panel initially gave each analyst an
invented name, and on 28 August 2026 an article published

> "Dr. Ineta Zvirbule suggests this is a likely explanation, but the data cannot
> confirm it."

That sentence is attributed, hedged and honest about its uncertainty, and it is
still wrong. No such economist exists. She has no page on this site, and the
sentence reads as a correspondent relaying an expert they had consulted — on a
site that will not publish a synthetic human face and rejects an article for
claiming an interview. There is now no invented person for a reader to mistake
for a real one, which is a stronger guarantee than a rule about how to describe
one.

That article is still up, with the paragraph exactly as published and a
correction above it. We did not go back and quietly swap the name out. A site
that edits its own archive to remove an embarrassment has no archive, and a
correction you cannot check against the page it corrects is worth nothing.

**What they produce is a hypothesis, and it is published as one.** Four rules
are enforced in code rather than asked for in a prompt:

- **It is attributed.** To the AI analyst who proposed it, by role. A cause we
  cannot put an accountable name to is not published.
- **It is disclosed as AI.** The article must say so in the same sentence. An
  analyst is never introduced as a person, given a title, or given a doctorate.
- **It is marked unconfirmed.** The article says, in the same paragraph, that
  this data cannot establish it. Our validator rejects the piece otherwise, and
  it applies that rule to our own analysts *more* strictly than to an outside
  institution — a central bank is on the record independently and answerable for
  what it said; our analyst is a model we prompted.
- **It carries no figure.** A hypothesis containing a number is deleted before
  the correspondent sees it, because a number we did not verify is not
  publishable however it is framed.

These explanations may be wrong. That is the nature of a hypothesis, and it is
why they are labelled as such rather than folded into the reporting. We think an
attributed, falsifiable, clearly-marked attempt at "why" serves you better than a
refusal — but only if it is impossible to mistake for a finding, which is what
the three rules above are for.

## 2. What the AI may do, and what it may not

**Permitted:** writing prose around figures the pipeline has already verified;
proposing a headline; organising an explanation; choosing which comparison makes
a trend legible; offering a candidate cause, where it is attributed by name and
marked as unconfirmed (see section 1).

**Editorial prohibitions, backed by bounded automated checks:**

| The model may not | Why |
|---|---|
| Supply or recall a number | Every figure must trace to a dataset field. Prose containing a number our pipeline did not verify is rejected before publication. |
| Decide what is newsworthy | Story selection is deterministic code — records, streaks, thresholds, divergence between countries. Auditable and testable. |
| Rewrite another outlet's article | Both a copyright matter and a quality one. See section 5. |
| Claim lived experience | No correspondent may say it visited, phoned, interviewed, attended or witnessed anything. It did not. |
| Invent an expert | A cause may only be attributed to a source we retrieved or to one of our own AI analysts, named by role and disclosed as AI. A paragraph crediting an invented "Dr" is rejected before publication. |
| Invent a quote | Detected quotations and attributed statements must match excerpts of cited official document text fetched for validation. Punctuation and whitespace are normalised, not the wording. |
| Present itself as human | See section 4. |

An article that fails a check is not published. These checks are not a semantic
truth certificate: they cannot establish that every causal premise is true or
that a source excerpt is interpreted correctly. Human editorial review remains
necessary. A denial in one sentence does not support speculation in another, and
declaring a figure does not authorise an unrelated explanation.
Negation is carried only between directly recognised coordinated predicates.
After an unrecognised fragment, a draft must repeat the data subject and denial;
the gate can reject valid but ambiguous grammar rather than guess its scope.

**We also do not report a change the source cannot measure.** Some of the
statistics here are estimates drawn from samples — the unemployment rate comes
from a labour force survey, the sentiment index from a survey of businesses and
households. Two readings that differ by less than the survey can resolve are not
a rise and a fall; they are the same quantity measured twice. Before asking
whether a movement is interesting, the pipeline asks whether it is measurable,
and drops it if it is not. This is why you will sometimes see no story about a
number that moved: a tenth of a point in a sampled rate is not news, and
reporting it as though it were is a way of being wrong that looks like
diligence.

Where a series is not a survey, the floor is read from the data itself: a
statistic published to one decimal place cannot express a difference finer than
that, so we do not claim one.

## 3. Who is accountable

Andre Kõpu, named at the top of this page, is the only human here and is accountable for everything
published here — including anything a machine produced without a human reading
it first. "The AI did it" is not an explanation we will ever offer you.

Articles built from open data publish automatically once they pass our
validation checks. Their provenance lists any research sources consulted.
Verbatim official press releases and links to other outlets' reporting are
reviewed by a named AI editor after validation and before publication. The editor
may approve, reject, or escalate. Escalation is reserved for dangerous, harmful
or inappropriate content that Andre should see; routine approvals do not go to him.

## 4. What you see as a reader

Our correspondents are **Ilze Nida** (Economy & Labour), **Marek Akmeņrags**
(Energy & Markets), **Gintaras Kolka** (Maritime & Trade), **Kadri Ristna**
(Environment & Climate) and **Rasa Irbene** (Government, EU & Society).
Each covers a beat, has a declared area of expertise, and writes in a
consistent voice.

One AI editor, **Dace Saulkrasti**, reviews everything on this site: the
original articles our correspondents write, and the decision to carry someone
else's story unchanged. It is the same kind of disclosed AI persona they are —
an invented name with a declared competence, not a staff journalist and not a
real individual. Andre Kõpu, named at the top of this page, is the human
accountable for what it approves.

**None of them exists.** They are invented people. The names are fictional, the
expertise is a description of what each one is built to look for, and no
correspondent has held a job, studied anywhere, been anywhere or met anyone.
Their working methods are drawn from real traditions in economics, market and
accountability reporting — a reader who knows those traditions may recognise
the approach — but no correspondent is modelled on a named individual or claims
any association with one.

Everyone in the newsroom carries the surname of a Baltic lighthouse or coastal
station. It is a house style rather than a disguise, and it does none of the
disclosure work on its own. These rules do:

- every byline reads **"· AI correspondent"**, always, without exception
- every correspondent has a page that opens by stating it is a software system
  and not a person, before anything else
- avatars are abstract marks. **We will never use a synthetic human face.**
- **no invented person appears anywhere on this site.** Our correspondents are
  named, and every one of them is labelled an AI correspondent with a page
  saying so. Our analysts are not named at all: an analyst is "the newsroom's AI
  demographer", never a person with a surname or a doctorate. If you see a
  personal name in an article, it belongs to a real person or organisation in a
  source we retrieved and linked.

  One article, published on 28 August 2026, breaks that rule and carries a
  correction saying so. A defect gave our analysts invented personal names for a
  few hours, and one reached print as "Dr. Ineta Zvirbule". The paragraph is
  still there, unedited, with the correction above it — we do not quietly edit
  our archive, and a rule stated as though it had never been broken would be a
  second untruth on top of the first.
- no correspondent may claim to have visited, phoned, interviewed, attended or
  witnessed anything — this is enforced in code, and an article that breaks it
  is rejected before publication rather than corrected afterwards
- every article carries a provenance panel: sources, datasets, when the data
  was retrieved, and which model wrote it
- every article carries the same disclosure in a form a machine can read. The
  byline tells a person; a `digitalSourceType` marker in the page's structured
  data tells a search engine, an assistant or a verification tool, using the
  IPTC vocabulary that content-provenance tooling already understands. This is
  the transparency the EU AI Act requires of AI-generated text on matters of
  public interest, and we would publish it regardless: a disclosure only a human
  can see is one that vanishes the moment an assistant quotes us.

We would rather over-disclose than have you discover it later. If you ever read
something here and are unsure whether a person wrote it, we have failed, and we
would like to know.

## 5. Why we do not rewrite other publications

The tempting shortcut for a portal like this is to ingest other outlets' work and
have a model reword it. We do not, for three reasons, any one of which is
sufficient.

**It is not ours.** Under EU Directive 2019/790, press publishers hold a right
over online reuse of their publications, transposed into Latvian, Estonian and
Lithuanian law since 2021. Only links and very short extracts sit outside it.

**It is bad journalism.** A reworded article adds nothing and quietly strips the
original reporter's accountability. If the underlying piece is wrong, the
paraphrase repeats the error with less traceability.

**It is not a business.** Search engines treat mass-produced rewrites as spam,
and they are right to.

So where we point you at another outlet, you get their headline, the summary they
themselves published in their feed, their name, and a link to them. If you find
their story interesting, you should read it on their site, and we would rather
you did. Journalism from LSM, ERR, The Baltic Times and others is the work of
people we are not employing and could not replace.

## 6. Where the record is kept

Every article stores, and displays:

- each source, the dataset used, and the timestamp at which we retrieved it
- each official statement or prior-coverage lead consulted during research
- the deterministic signal that caused the story to be written at all
- the model and prompt version
- the result of every validation check
- for reviewed material, who approved it and when

Raw feed data is archived before anything reads it, so if we get something wrong
we can reconstruct precisely what the system saw at the time. Not just that it
failed — *why*.

## 7. When we get it wrong

We will. Automated systems fail in ways their authors did not anticipate, and
saying otherwise would be the least trustworthy sentence on this page.

When it happens: the correction appears on the article itself, not quietly in
place of the original text, and it is added to our public
[corrections log](/corrections). Corrections are append-only — we do not edit
away our mistakes.

**Not every correction here is a mistake of ours, and we say which is which.**
Statistical offices revise. A first estimate is published from partial returns
and restated weeks later when the rest arrive; this is normal practice and is
documented in their own revision policies. So a figure we reported accurately in
August can describe a number that no longer exists by October. New ledger entries
track raw source observations for headline readings, each country's constituent
of a Baltic divergence, explicit comparison periods, and cited context facts with
source coordinates. Display rounding is not a source revision. When a tracked
observation changes beyond its measurement floor, the article gets a dated note.

Coverage is bounded by the fetched source history and a 2,000-row ledger; this is
not a promise to monitor every historical claim indefinitely. Older ledger rows
without a raw-observation marker are excluded from automatic revision comparison.
They need explicit maintenance using archived observations, not silent backfilling
from today's values. Existing articles and correction notices are not rewritten
by this change.

The article's text is left alone in that case. We do not go back and change the
number in a sentence we already published: the piece did say what it said, and
silently updating it would be a tidier lie than the original. The note tells you
what changed, and the wording distinguishes a restatement by the source from an
error by us.

An article is never deleted to resolve a complaint. If a published story is
wrong we correct it in public; if it is right, it stays up.

If you spot an error, please tell us. Errors reported by readers are the single
most valuable signal we get about whether this experiment is working.

## 8. What we are measuring

This is a research project and we would rather state our success criteria in
public than claim them afterwards. We are watching:

1. corrections per hundred articles published
2. the proportion of articles whose sourcing a reader could independently verify
3. whether readers can tell what was automated, when asked
4. whether the data actually supported a story, or the system reached for one

If automation turns out to cost more in verification than it saves in production,
that is a finding, and we will publish it too.

---

*portaBaltica is a NauroLabs research experiment. It is not a licensed news
agency and does not employ journalists. Its purpose is to test whether open data
plus disclosed automation can produce something honestly useful about the Baltic
region.*
