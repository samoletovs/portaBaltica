# portaBaltica house style

**Applies to:** every article published under a portaBaltica byline.
**Enforced by:** `newsroom/pipeline/house_style.py`, run on every article
between generation and publication.

The rules below are not preferences. They are applied in code, because a style
rule that lives only in a prompt is a suggestion the model follows most of the
time, and a style rule that lives in a function is a fact about what can be
published.

Where a rule needed an authority we have taken the [Guardian and Observer style
guide](https://www.theguardian.com/guardian-observer-style-guide-a), which is
published in full and is the closest thing British journalism has to a public
standard.

---

## Headlines

**Sentence case. Always.**

> Estonian unemployment falls to 6.6% in June

not

> ~~Estonia's Unemployment Rate Declines to 6.6% in June 2026~~

Reuters, the BBC, the Guardian, the FT and the Economist all set headlines in
sentence case. Title Case is a house style at some American papers, but combined
with the other habits of generated prose it is one of the strongest surface
signals that nobody edited the copy.

Proper nouns, acronyms and months keep their capitals. Figures are never
touched: the case rule refuses to alter any token containing a digit, because
numbers belong to the validator.

**Use active verbs.** "Estonian unemployment falls" beats "Unemployment rate
declines recorded". No full stop at the end.

**No journalese.** The Guardian names the offenders: *bid, brand, dub, slam*,
and their broadsheet equivalents *insist, signal, target*. Add *spark, mull,
eye, blast, hit out at*. The test is whether anyone would say it aloud: nobody
in a bar says "the minister slammed the proposal in a dramatic bid".

## Dashes

**En dashes (–), never em dashes (—), and sparingly.**

The Guardian is explicit: *"Dashes should be en dashes rather than em dashes or
hyphens"*, and *"A single dash can add a touch of drama – like this. But use
sparingly."*

More than two dashes in a wire item and the prose is, in the guide's phrase,
"dashing about all over the place". Commas usually carry it better; a semicolon
sometimes does.

This one rule does more than any other to stop copy reading as machine-written.

## Numbers

- Percentages to **one decimal**: 6.6%, not 6.71378%.
- Other quantities to **two**: €16.32 an hour.
- Spell out one to nine in prose; figures for 10 and above. Always figures with
  a unit or a percentage.
- The exact value stays available to the reader — the renderer keeps it in a
  tooltip — but the sentence gets the readable one.

## Dates

Day, month, year, no commas: **21 July 2026**. Quarters as Q2 2026.

## Register

Say what is known and say what is not. Delete anything that could survive being
cut:

- ~~"This shift may be attributed to various factors."~~ Which factors? If we do
  not know, the sentence is filler.
- ~~"It is worth noting that…"~~ If it were not worth noting we would not be
  printing it.
- ~~"Moreover", "Furthermore", "In conclusion"~~ — essay scaffolding, not copy.
- ~~"a testament to", "plays a crucial role", "the evolving landscape"~~ — these
  phrases carry no information in any context.

Prefer "the data shows" to "experts say". There are no experts here.

## Voice

Each correspondent has a distinct register, set out in `newsroom/personas.yaml`
and rendered into the writing prompt by `voice_card()`. House style constrains
the surface; voice shapes the prose within it.

**Voice never touches a number.** The figure validator governs every value
regardless of whose byline is on the piece.

## The desk

`apply_house_style()` runs on every generated article before publication. It
**corrects** what can be corrected deterministically — headline case, a trailing
full stop — and **flags** what needs judgement. Corrections are recorded in the
run so the trail shows what the desk changed, rather than the copy quietly
differing from what the writer filed.
