# How portaBaltica uses AI

**Last updated:** 2026-08-24
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
- **We do not rewrite other outlets' journalism.** Where we point you at another
  publication, you get their headline, the summary they published themselves, and
  a link. Nothing is reworded.
- **Routine review is handled by a disclosed AI editor.** Sam is interrupted only
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

## 2. What the AI may do, and what it may not

**Permitted:** writing prose around figures the pipeline has already verified;
proposing a headline; organising an explanation; choosing which comparison makes
a trend legible.

**Forbidden, and blocked in code rather than merely discouraged:**

| The model may not | Why |
|---|---|
| Supply or recall a number | Every figure must trace to a dataset field. Prose containing a number our pipeline did not verify is rejected before publication. |
| Decide what is newsworthy | Story selection is deterministic code — records, streaks, thresholds, divergence between countries. Auditable and testable. |
| Rewrite another outlet's article | Both a copyright matter and a quality one. See section 5. |
| Claim lived experience | No correspondent may say it visited, phoned, interviewed, attended or witnessed anything. It did not. |
| Invent a quote | We publish no quotes that are not verbatim in a cited public source. |
| Present itself as human | See section 4. |

An article that fails any of these checks is not published. The system fails
closed: when something is uncertain, nothing goes out. On a quiet day we publish
less. We never generate filler to fill a page.

## 3. Who is accountable

Andre Kõpu, named at the top of this page, is the only human here and is accountable for everything
published here — including anything a machine produced without a human reading
it first. "The AI did it" is not an explanation we will ever offer you.

Articles built from open data publish automatically once they pass our
validation checks. Their provenance lists any research sources consulted.
Verbatim official press releases and links to other outlets' reporting are
reviewed by a named AI editor after validation and before publication. The editor
may approve, reject, or escalate. Escalation is reserved for dangerous, harmful
or inappropriate content that Sam should see; routine approvals do not go to him.

## 4. What you see as a reader

Our correspondents are **Ilze Nida** (Economy & Labour), **Marek Akmeņrags**
(Energy & Markets), **Gintaras Kolka** (Maritime & Trade), **Kadri Ristna**
(Environment & Climate) and **Rasa Irbene** (Government, EU & Society).
Each covers a beat, has a declared area of expertise, and writes in a
consistent voice.

The editor for syndicated items is **Dace Saulkrasti** (AI editor). It is the
same kind of disclosed AI persona: an invented name with a declared competence,
not a staff journalist and not a real individual.

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
- no correspondent may claim to have visited, phoned, interviewed, attended or
  witnessed anything — this is enforced in code, and an article that breaks it
  is rejected before publication rather than corrected afterwards
- every article carries a provenance panel: sources, datasets, when the data
  was retrieved, and which model wrote it

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
