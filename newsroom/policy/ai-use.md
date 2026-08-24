# How portaBaltica uses AI

**Last updated:** 2026-08-24
**Accountable editor:** Sam Samoletovs

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
- **A human is accountable for everything here.** Named, above.

---

## 1. What data goes to the AI, and who decides

The model receives two things: a payload of already-verified figures from public
datasets, and a style guide for the correspondent writing the piece.

It does not receive personal data. It does not browse. It is not connected to
anything that could send it instructions from outside — content we ingest from
other websites is passed to the model inside explicit boundaries that mark it as
untrusted data rather than instruction, because a hostile headline is a genuine
attack on a system like this one.

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

Sam Samoletovs, named at the top of this page, is accountable for everything
published here — including anything a machine produced without a human reading
it first. "The AI did it" is not an explanation we will ever offer you.

Articles built from open data publish automatically once they pass our
validation checks. Material originating with someone else — official press
releases, or links to other outlets' reporting — is reviewed by a human before
it appears.

## 4. What you see as a reader

Our correspondents are named **Nida**, **Akmeņrags**, **Kolka**, **Ristna** and
**Irbene**, after landmarks on the Baltic coast. Each covers a beat and writes in
a consistent voice.

They are named after lighthouses and capes rather than given human names on
purpose. A reader can mistake "Marta Ozola" for a staff journalist; nobody
mistakes a lighthouse for one. Alongside that:

- every byline reads **"· AI correspondent"**, always, without exception
- every correspondent has a page saying plainly that it is a software system,
  which datasets it works from, and who is accountable for it
- avatars are abstract marks. **We will never use a synthetic human face.**
- every article carries a provenance panel: sources, datasets, when the data was
  retrieved, and which model wrote it

We would rather over-disclose than have you discover it later.

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
