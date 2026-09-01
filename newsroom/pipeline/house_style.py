"""House style — the rules that make copy read like a newspaper.

Andre's note was that the wire "does not look like a professional news portal":
Title Case headlines, em dashes everywhere, and the flat register of generated
prose. All three are fixable, and all three are fixable *deterministically*,
which matters more than it sounds. A style rule expressed only as a sentence in
a prompt is a suggestion the model follows most of the time. A style rule
expressed as a function is a fact about what can be published.

The rules below are taken from the Guardian and Observer style guide, which is
published in full and is the closest thing British journalism has to a public
standard. Two of its entries do most of the work here:

    dashes — "A single dash can add a touch of drama - like this. But use
    sparingly... Beware sentences that dash about all over the place - commas
    (or even, very occasionally, brackets) are often better. Dashes should be
    en dashes rather than em dashes or hyphens."

    headlines — "Use active verbs where possible... Avoid tabloid cliches such
    as bid, brand, dub and slam, and their broadsheet counterparts such as
    insist, signal and target."

Guardian headlines are sentence case: "Man walks on Moon", not "Man Walks On
Moon". Reuters, the BBC, the FT and the Economist all do the same. Title Case is
a house style at some American papers, but combined with an em dash habit it is
one of the strongest surface signals that nobody edited the copy.

Nothing here touches a figure. Numbers are the validator's territory and this
module must never rewrite one — see `sentence_case`, which refuses to alter any
token containing a digit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final, Mapping

from newsroom.pipeline import units

# --- dashes ----------------------------------------------------------------

EM_DASH = "\u2014"
EN_DASH = "\u2013"

#: More than this many parenthetical dashes in one article and the prose is
#: "dashing about all over the place". Two is generous for a 400-word wire item.
MAX_DASHES_PER_ARTICLE = 2


# --- words that give the writer away ---------------------------------------

#: Journalese. The Guardian names most of these explicitly.
JOURNALESE = (
    "slam",
    "slams",
    "slammed",
    "bid to",
    "dubbed",
    "branded",
    "insisted",
    "signalled",
    "signaled",
    "targeted at",
    "sparked",
    "sparks",
    "mulls",
    "mulled",
    "eyes up",
    "blasted",
    "hit out at",
    "amid fears",
    "raft of",
    "sweeping changes",
)

#: Register that reads as machine-written rather than edited.
GENERATED_TELLS = (
    "delve into",
    "delves into",
    "it is worth noting",
    "it is important to note",
    "moreover",
    "furthermore",
    "in conclusion",
    "landscape of",
    "a testament to",
    "plays a crucial role",
    "plays a vital role",
    "underscores the importance",
    "highlights the importance",
    "navigating the",
    "in today's",
    "ever-evolving",
    "robust growth",
    "positive trend",
    "potential shift",
    "various factors",
)

#: Hedges that say nothing. A wire either knows or says it does not.
EMPTY_HEDGES = (
    "may be attributed to",
    "could be attributed to",
    "suggests a positive",
    "indicating a potential",
    "it remains to be seen",
    # Named causes that name nothing. Each of these appeared in a draft the
    # editor sent back for "vague assertions about causation", and each is a
    # way of sounding like an explanation while supplying none. If the data
    # does not show why, the piece should say that instead.
    "market dynamics",
    "underlying pressures",
    "underlying factors",
    "economic conditions",
    "broader trends",
    "a range of factors",
    "a number of factors",
    "several factors",
)

#: The closing that says the next release will tell us more, which every
#: release always does. The system prompt has banned these since the depth
#: rewrite and the model writes them anyway — the live wire closed a piece with
#: "The upcoming inflation figures for August 2026 will provide further
#: insights into whether this trend continues", which carries no figure and no
#: information.
#:
#: A prompt rule is advisory. Listed here it is a fact: the generation loop
#: treats a style violation like a validator failure and hands it back while
#: the writer still has an attempt left, at the cost of no model call at all.
#:
#: Matched as substrings against lowered text, so each entry is the shortest
#: fragment that is damning on its own. "will provide further insight" catches
#: both the singular and the plural, and "figures for August will provide
#: further insights" as well as "future data releases will".
EMPTY_CLOSINGS = (
    "will provide further insight",
    "will provide further clarity",
    "will provide more clarity",
    "provide further insights into whether",
    "further insights into the",
    "time will tell",
    "further analysis is needed",
    "further research is needed",
    "bears watching",
    "bears close watching",
    "will be crucial to assess",
    "will be crucial in determining",
    "will be crucial for",
    "will be important to monitor",
    "will be key to monitor",
    "remains to be seen whether",
    "may have significant implications for",
    "could have significant implications for",
    "it will be interesting to see",
    "only time will reveal",
    "warrants further attention",
    "warrants close attention",
)

#: The paragraph that kills more articles than anything else.
#:
#: A forensic pass over 200 rejected drafts found "unsupported assertions about
#: causation or impact" in **24 of 36 desk rejections — 30% of every tier A
#: rejection**, the single largest cause. The shape never varies:
#:
#:     "This increase in construction output directly impacts the construction
#:      sector and real estate developers."
#:     "This decline impacts manufacturers directly, as tighter margins may
#:      lead to reduced investment in production capabilities."
#:
#: The writer is asked to say why a finding matters and reads that as licence
#: to speculate about consequences. It has no source for any of it, the desk
#: correctly refuses it, the rewrite produces the same shape again, and the
#: article dies — one draft that died this way carried cross-country
#: comparison and historical context and was better journalism than several
#: pieces that published.
#:
#: The prompt has forbidden this in prose since the depth rewrite. Matched here
#: it becomes a fact instead: the generation loop treats a style violation like
#: a validator failure and hands it back while the writer still has an attempt
#: left, at the cost of no model call at all. Catching it at the desk costs a
#: full revision cycle and usually the article.
#:
#: Regexes rather than substrings, because the offence is a CONSTRUCTION —
#: "impacts <a group of people>" — not a word. "The impact of the storm on
#: generation" is fine and must stay fine; the bare verb would catch it.
_AFFECTED = (
    r"sector|industry|market|economy|consumers?|businesses|companies|firms|"
    r"manufacturers|producers|employers|employees|workers|households|"
    r"developers|exporters|importers|investors|borrowers|taxpayers|"
    r"passengers|shippers|carriers|farmers|retailers"
)

SPECULATIVE_IMPACT = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        # "impacts manufacturers", "will affect the construction sector"
        rf"\b(?:impacts?|impacted|affects?|affected)\s+(?:\w+\s+){{0,3}}(?:{_AFFECTED})\b",
        rf"\b(?:impact|effect)\s+on\s+(?:\w+\s+){{0,3}}(?:{_AFFECTED})\b",
        # "may lead to reduced investment", "could result in higher prices"
        r"\b(?:may|might|could|would|will|is likely to|are likely to)\s+"
        r"(?:lead to|result in|translate into|feed through|put pressure on|"
        r"weigh on|boost|dampen|squeeze|erode|drive up|drive down)\b",
        # "poses challenges for", "presents difficulties for"
        rf"\b(?:poses?|presents?|creates?)\s+(?:a\s+|significant\s+|new\s+)*"
        rf"(?:challenges?|difficulties|pressures?|risks?|headwinds?)\s+"
        rf"(?:for|to)\s+(?:\w+\s+){{0,3}}(?:{_AFFECTED})\b",
        # "has implications for households"
        rf"\bimplications?\s+for\s+(?:\w+\s+){{0,3}}(?:{_AFFECTED})\b",
    )
)


# --- the closing, structurally ----------------------------------------------
#
# A blacklist of empty closings does not hold, and there is evidence rather than
# an opinion behind that. The banned list contained "X will be crucial to
# assess"; across ten consecutive published articles the model wrote "crucial to
# confirm", "crucial to determine", "crucial to understanding", "essential to
# determine", "essential to assess" and "will clarify whether". Ten of ten
# closed with the same skeleton. It walks around a list one synonym at a time,
# and twenty more entries buy another day.
#
# So the test is what the closing IS, not what it is not.
#
# An empty closing makes a claim about the future of INFORMATION — the next
# release will tell us more, which is true of every release ever published and
# therefore says nothing. A real closing makes a claim about the WORLD or states
# a decision rule: what a specific reading would mean, or where the evidence
# stops. That distinction is structural and it survives paraphrase, because the
# paraphrases are all of the empty half.

#: Pointing at a future release. Necessary for an empty closing, not sufficient:
#: "the next day-ahead auction settles on Monday" points at a future event and
#: is a fact about the world, so this is only half the test.
#: A decimal point is not a full stop. ``[^.]`` stopped dead at the "." in a
#: figure, so "the next 2.4 percent release will be crucial to confirm the
#: trend" went uncaught -- the sentences carrying numbers being exactly the
#: ones this cannot afford to miss. Found while fixing the identical mistake in
#: `weekly.period_problems`.
_GAP = r"(?:[^.]|\.(?=\d))"

_FORWARD_LOOKING = re.compile(
    r"\b(?:next|upcoming|future|forthcoming|coming|subsequent|later)\b"
    + _GAP + r"{0,60}?\b(?:release|releases|report|reports|reading|readings|data|"
    r"figures|print|prints|statistic|statistics|numbers|settlement|auction|"
    r"update|quarter|month|year)\b",
    re.IGNORECASE,
)

#: What makes a forward-looking closing worth reading: it names the reading and
#: what that reading would MEAN. A conditional carries a consequence; the empty
#: formula never does, which is exactly why none of the ten contained one.
_NAMES_A_CONSEQUENCE = re.compile(
    r"\bwould\b"
    r"|\bif\b" + _GAP + r"{0,80}\b(?:then|that would|it would)\b"
    r"|\bany\s+\w+\s+(?:above|below|under|over)\b",
    re.IGNORECASE,
)

#: Verbs whose object is knowledge rather than the world.
#:
#: This list is the reason the check needed a third iteration. Requiring a
#: conditional caught the blacklist's paraphrases, so the model paid the
#: smallest possible price and swapped WILL for WOULD: "the next release WOULD
#: clarify whether this trend continues" satisfied ``_NAMES_A_CONSEQUENCE`` via
#: a bare ``would`` while saying precisely what "will clarify" said. Three of
#: three measured closings did this.
#:
#: A consequence expressed with one of these verbs is not a consequence. "Would
#: clarify whether X continues" promises that information will exist, which is
#: true of every release ever scheduled.
_INFORMATION_VERB = (
    r"(?:crucial|essential|key|important|critical|vital|instrumental|necessary|"
    r"useful|telling|informative|insightful|provide|offer|give|shed|clarify|"
    r"reveal|determine|confirm|indicate|show|tell|prove|establish|demonstrate|"
    r"assess|understand|illuminate|elucidate|verify|validate|ascertain|test|"
    r"settle)"
)

_INFORMATIONAL_PROMISE = re.compile(
    rf"\b(?:will|would|should|could|may|might|shall)\s+(?:be\s+)?(?:\w+\s+)?"
    rf"(?:to\s+)?{_INFORMATION_VERB}\b"
    rf"|\b(?:is|are)\s+what\s+(?:will|would)\s+{_INFORMATION_VERB}\b"
    rf"|\bprovide[sd]?\s+(?:further\s+)?(?:insight|insights|clarity)\b"
    # "…for 2026-Q2 TO SEE IF this trend continues" — no modal at all, so the
    # verb patterns miss it, and it is the exact shape the analyst desk was
    # instructed to produce and then handed to the writer. Bare because the
    # construction has no other use: naming a future release "to see whether"
    # something happens is a promise about information however it is inflected.
    rf"|\bto\s+(?:see|find\s+out|learn|know)\s+(?:if|whether)\b",
    re.IGNORECASE,
)

#: A specific reading: a threshold with a number, or a named ordinal period.
#:
#: This is what rescues a legitimate closing that happens to use an information
#: verb — "a revision below 100 would show the recovery had stalled" names the
#: value that would change the conclusion, and is exactly the sentence the
#: guidance asks for.
_NAMES_A_READING = re.compile(
    r"\b(?:above|below|under|over|beneath|beyond|exceed(?:s|ing)?)\b[^.]{0,24}?\d"
    r"|\d[^.]{0,24}?\b(?:or (?:higher|lower|more|less|above|below))\b"
    r"|\b(?:a\s+)?(?:second|third|fourth|fifth|another)\s+(?:consecutive\s+)?"
    r"(?:month|quarter|year|reading|print|release|observation)\b",
    re.IGNORECASE,
)


#: Or it says plainly where the evidence stops, which is the third legitimate
#: shape and a complete closing on its own.
_STATES_A_LIMIT = re.compile(
    r"\b(?:does not|do not|cannot|could not|will not)\s+"
    r"(?:show|establish|say|settle|explain|reveal|identify)\b"
    r"|\bnothing\s+in\s+(?:the|this|these)\b"
    r"|\bno\s+(?:evidence|indication|source)\b"
    r"|\bis not established\b|\bremains unexplained\b",
    re.IGNORECASE,
)


#: A quantity written at a scale the reader has to convert for themselves.
#:
#: The live wire published::
#:
#:     Latvia recorded 4653 thousand rail passengers in 2026-Q1
#:
#: Every figure in that sentence is correct and traces to Eurostat. It is still
#: unreadable: "4653 thousand" is 4.65 million, and the first reader to see it
#: did the arithmetic, landed above Latvia's 1.9 million population, and read
#: the piece as a data fault. Nothing in the newsroom could see it, because
#: every numeric gate protects figures rather than how they read.
#:
#: A SHAPE, not a word list. The property is that the mantissa is four digits
#: or more, so the next scale word up would say the same quantity in fewer —
#: "4.65 million" for "4653 thousand", "1.5 billion" for "1500 million". That
#: is never worse and usually much better, so this cannot fire on a sentence
#: that was right, which is the bar a deterministic cut has to clear here.
#:
#: Built FROM ``units.MAGNITUDES`` rather than restating it, because that is
#: the ladder the renderer descends and a guard that enumerates a different set
#: from its subject is unguarded wherever the two differ. The largest rung is
#: excluded by construction: nothing says "1000 trillion" more briefly.
#:
#: The pipeline now hands the writer the readable form in the comparison basis
#: AND in the figure table, so reaching this at all means the writer went out
#: of its way. It is the backstop, not the mechanism.
_SCALE_LADDER: Final[tuple[str, ...]] = tuple(word for word, _ in units.MAGNITUDES)

#: Each rung, mapped to the one that says it in fewer digits.
_NEXT_SCALE_UP: Final[dict[str, str]] = {
    smaller: bigger
    for bigger, smaller in zip(_SCALE_LADDER, _SCALE_LADDER[1:])
}

_UNREADABLE_SCALE: Final[re.Pattern[str]] = re.compile(
    r"\b(\d{1,3}(?:[,\u00a0\u202f]\d{3})+|\d{4,})(?:\.\d+)?\s*"
    rf"({'|'.join(_NEXT_SCALE_UP)})\b",
    re.IGNORECASE,
)


def unreadable_scale_phrase(text: str) -> tuple[str, str] | None:
    """The first quantity written at a scale a reader must convert.

    Returns the offending phrase and the scale word that says it in fewer
    digits, or ``None``.
    """
    match = _UNREADABLE_SCALE.search(text)
    if match is None:
        return None
    return match.group(0), _NEXT_SCALE_UP[match.group(2).lower()]


#: Sentence boundaries, for rules that are about a sentence rather than a
#: paragraph. Deliberately identical to ``validator._SENTENCE_SPLIT``: the two
#: modules do not import each other, so this is a second copy, and
#: ``test_record_window.py`` asserts the two patterns are equal so the day they
#: diverge is a failing test rather than a silent disagreement about where a
#: sentence ends. The lookbehind on ``[.!?]`` requires whitespace after, so a
#: decimal point inside "2.4%" is not a boundary.
_SENTENCES: Final[re.Pattern[str]] = re.compile(r"(?<=[.!?])\s+")

#: "Within one sentence", written so it survives a decimal point. Plain `[^.]`
#: stops dead at the "." in "2.4 percent", so the sentences carrying figures --
#: the ones a record check can least afford to skip -- are exactly the ones it
#: would miss. `shape_controls` measured it: with `[^.]` the superlative clause
#: below does not match "the highest 2.4 percent reading in the series".
_NEAR: Final[str] = r"(?:[^.]|\.(?=\d))"

#: A claim that this is the biggest or smallest reading there has ever been.
#:
#: The second alternative is a SUPERLATIVE SCOPED TO THE SERIES, and it is here
#: rather than in the bound below because of what it does to a sentence. "The
#: highest in the series" makes exactly the claim "a record high" makes; it
#: simply never says the word. Published, live, and matched by neither half of
#: this check before it moved:
#:
#:     "This reading is the highest in the series, surpassing the previous
#:      record of 614..."
#:
#: The writer's own prompt already calls the shape BAD -- "A RECORD IS ALWAYS A
#: RECORD OVER A WINDOW, AND YOU MUST NAME IT" -- so this aligns the check with
#: guidance that was already correct, rather than inventing a rule.
#: The optional adjective is not decoration. This repo's own "clean draft"
#: fixture is headlined "the highest level in the MONTHLY series", which is the
#: same claim with a word in the way, and it slipped a version of this pattern
#: that required ``the series`` adjacent. Measured against the published
#: corpus, admitting one adjective flags **zero** further sentences -- so it
#: closes a shape the writer demonstrably produces at no cost in reach.
#: The superlative vocabulary, named once because two checks need it and two
#: copies would drift. ``_CLAIMS_A_RECORD`` uses it to find a record claim;
#: ``origin_delta_problems`` uses it to notice that an origin phrase is bounding
#: one of these rather than a figure.
_SUPERLATIVE_WORDS: Final[str] = (
    r"highest|lowest|largest|smallest|biggest|strongest|weakest|greatest|peak|record"
)

_CLAIMS_A_RECORD: Final[re.Pattern[str]] = re.compile(
    r"\brecord\s+(?:high|low)\b|\ba\s+record\b|\bset\s+a?\s*record\b|"
    r"\ball[-\s]time\s+(?:high|low)\b|\b(?:highest|lowest)\s+ever\b|"
    r"\bnever\s+been\s+(?:higher|lower)\b|\bon\s+record\b|"
    r"\b(?:" + _SUPERLATIVE_WORDS + r")\b" + _NEAR + r"{0,40}?"
    r"\b(?:in|of|for|across|anywhere\s+in|throughout)\s+"
    r"(?:the|this|its)\s+(?:\w+[-\s])?(?:series|record|history)\b",
    re.IGNORECASE,
)

#: And the phrase that makes such a claim true: the window it is a record over.
#: ``detect_record_extreme`` supplies exactly this in its comparison basis --
#: "across 48 observations since 2014-Q1" -- so the writer is never asked to
#: invent it, only to keep it.
#:
#: A bound needs a COUNT or a DATE. The bare nouns are deliberately not here:
#: an early version admitted ``\breadings?\b``, and "this is the highest ever
#: READING for the metric" then bounded itself with the word for the thing
#: being counted. A window is how many or since when, never merely what.
#:
#: That member was removed and its siblings were not. ``in the series``,
#: ``series began`` and ``since the series`` all named the thing rather than
#: the window, so "this is an all-time high IN THE SERIES" bounded itself with
#: the very phrase that makes the claim -- the same defect the paragraph above
#: describes, surviving three lines below its own description. They are gone,
#: and the superlative form now reads as a claim instead.
#:
#: The date alternative asks for a year near a word that OPENS a window, not
#: for the literal token "since": measured against the published corpus, a
#: narrower version rejected three sentences that do name their window --
#: "which began in August 2021", "since it began in 2014-Q1". Naming the window
#: is the rule; "since" is one way of saying it.
_BOUNDS_THE_RECORD: Final[re.Pattern[str]] = re.compile(
    r"\b\d[\d,]*\s+(?:observations?|readings?|quarters?|months?|years?|weeks?)\b|"
    r"\b\d+[-\s](?:quarter|year|month|week|day)\b|"
    r"\b(?:since|began|beginning|begins|start(?:s|ed|ing)?)\b"
    + _NEAR + r"{0,24}?\d{4}\b",
    re.IGNORECASE,
)


def record_claim_problems(text: str, *, where: str) -> list[str]:
    """A record claim must say what window it is a record over.

    THE FAILURE THIS CATCHES
    ------------------------
    Published, live, and false::

        "Latvia's food inflation drops to record low of -2% in July 2026"

    Measured against Eurostat's full ``prc_hicp_manr`` series for LV/CP011:
    348 observations from 1997-01, and the true all-time low is **-8.6% in
    2010-01**. Eighteen observations outside the window we fetched are below
    -2%. It is not a record low; it is the lowest in the five years we asked
    for.

    WHY EVERY STAGE BEHAVED CORRECTLY AND THE HEADLINE WAS STILL FALSE
    ------------------------------------------------------------------
    The collector requests a fixed window -- ``periods=60`` here. The detector
    then reports honestly, and its comparison basis says so in the construction
    this repo already praises: "across 60 observations since 2021-08" counts
    observations, calls them observations, and claims no time unit. The writer
    drops the qualifier and keeps the noun.

    And the gate that should have asked for the missing basis is the one that
    blesses it: ``record high|low`` sits in the validator's own
    ``_BASIS_PATTERNS``, so "drops to record low" *satisfies*
    ``comparison_basis_stated``. The phrase that needs bounding is treated as
    self-bounding.

    Measured across the 27 tier A articles published to 2026-08-29: all three
    ``record_extreme`` pieces claim a record in the headline, and all three sit
    on an observation count exactly equal to a collector window -- 60, 48, 48.
    A series that ended where we cut it did not begin there; we began there.

    WHY THIS IS A STYLE VIOLATION AND NOT A VALIDATOR GATE
    -----------------------------------------------------
    Because the honest form already exists in the corpus: 7 of the 20 record
    sentences published name their window, so a hard gate would be tightening a
    rule the writer half keeps rather than teaching one it does not know. The
    proximate cause is the prompt, which *required* the phrase "record high" or
    "record low"; that is fixed at the same time. This feeds the revision loop
    while the writer still has an attempt left, which is what house style is
    for -- and it cannot destroy a correct article, which a gate could.
    """
    if not text or not _CLAIMS_A_RECORD.search(text):
        return []
    if _BOUNDS_THE_RECORD.search(text):
        return []
    return [
        f"{where}: claims a record without saying over what window. Name it — "
        f'"the lowest in the 60 observations since 2021-08" — or drop the word. '
        f"Both numbers are given to you: the period on series_start_value and "
        f"the count on readings_in_series"
    ]


def closing_problems(text: str, *, where: str = "the closing") -> list[str]:
    """Violations in the paragraph a piece ends on.

    Only ever applied to the last paragraph, because the rule is about how an
    article STOPS. A forward reference mid-article — "the figure is released
    quarterly" — is ordinary reporting and must stay legal.

    An empty closing needs BOTH halves: it points at future information, and it
    promises that the information will resolve something. Either alone is
    legitimate. "The next day-ahead auction settles on Monday" points forward
    and reports a scheduled fact; "a reading below 95 would show the recovery
    had stalled" promises a resolution but names the reading that produces it.
    Only the pair — a future release that will tell us more, with no reading
    named — says nothing, and it says nothing about every release ever
    scheduled.
    """
    if not text:
        return []
    if not (_FORWARD_LOOKING.search(text) and _INFORMATIONAL_PROMISE.search(text)):
        return []
    # Either legitimate shape on its own terms, whatever else the sentence does.
    if _STATES_A_LIMIT.search(text) or _NAMES_A_READING.search(text):
        return []
    # A conditional counts only if its consequence is about the world. A
    # conditional whose consequence is that we will know more is the empty
    # formula with one word changed, which is what beat the previous version.
    if _NAMES_A_CONSEQUENCE.search(text) and not _INFORMATIONAL_PROMISE.search(text):
        return []
    return [
        f"{where}: points at a future release without saying what it would "
        "mean. Name the reading that would change the conclusion ('a second "
        "month below the seasonal mean WOULD make this a contraction'), or "
        "say where the evidence stops, or end the article a paragraph earlier"
    ]


# --- sentence case ---------------------------------------------------------

#: Words that stay lower case inside a headline unless they start it.
_MINOR_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "nor", "of", "on", "onto", "or", "over", "per", "the", "to", "up", "via",
    "with", "within", "against", "after", "before", "than", "that", "this",
}

#: Proper nouns that must keep their capital in sentence case. Everything the
#: Baltic wire says often enough to matter, plus months and institutions.
PROPER_NOUNS = {
    "Latvia", "Latvian", "Estonia", "Estonian", "Lithuania", "Lithuanian",
    "Baltic", "Baltics", "Riga", "Tallinn", "Vilnius", "Kaunas", "Klaipeda",
    "Ventspils", "Liepaja", "Narva", "Tartu", "Daugavpils",
    "Europe", "European", "EU", "Eurostat", "ECB", "Nord", "Pool",
    "Elering", "Commission", "Parliament", "Brussels", "NATO", "OECD", "IMF",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "Q1", "Q2", "Q3", "Q4", "GDP", "HICP", "VAT", "CPI", "PPI",
}

_WORD = re.compile(r"[A-Za-z\u00c0-\u024f']+")


def _looks_like_title_case(headline: str) -> bool:
    """True when most eligible words are capitalised — the Title Case habit."""
    words = _WORD.findall(headline)
    if len(words) < 4:
        return False

    # Skip the first word (capitalised either way), proper nouns and acronyms,
    # which prove nothing — and minor words, which are lower case in *both*
    # styles and so carry no evidence either way. Counting "to" and "in" as
    # evidence against Title Case is what let "Estonia's Unemployment Rate
    # Declines to 6.6% in June 2026" slip through at exactly the threshold.
    eligible = [
        w for w in words[1:]
        if w not in PROPER_NOUNS
        and not w.isupper()
        and len(w) > 1
        and w.lower() not in _MINOR_WORDS
    ]
    if len(eligible) < 2:
        return False

    capitalised = [w for w in eligible if w[0].isupper()]
    return len(capitalised) / len(eligible) > 0.6


def sentence_case(headline: str) -> str:
    """Rewrites a Title Case headline into sentence case.

    Leaves alone anything that is already sentence case, every proper noun,
    every acronym, and — critically — every token containing a digit. A figure
    is the validator's business and must survive this untouched.
    """
    if not _looks_like_title_case(headline):
        return headline

    tokens = headline.split(" ")
    out: list[str] = []
    for index, token in enumerate(tokens):
        stripped = token.strip("\"'“”‘’(),.:;!?")
        if any(ch.isdigit() for ch in token) or stripped in PROPER_NOUNS or stripped.isupper():
            out.append(token)
            continue
        if index == 0:
            out.append(token)
            continue
        # Only lower a word we would have capitalised for decoration; a word
        # that is already lower case, or that is a name we do not know about,
        # is left as the writer had it unless it is a known minor word.
        lowered = token.lower()
        if stripped.lower() in _MINOR_WORDS or token[:1].isupper():
            out.append(lowered)
        else:
            out.append(token)
    return " ".join(out)


# --- the check -------------------------------------------------------------

@dataclass
class StyleReport:
    """What the desk would send back, and whether it is fixable in place."""

    violations: list[str] = field(default_factory=list)
    #: Corrections applied automatically. Recorded so the trail shows them.
    corrections: list[str] = field(default_factory=list)
    #: Prose deleted outright, as opposed to rewritten. Separate from
    #: ``corrections`` because a caller that has already validated the article
    #: has to re-validate when this is non-empty: the verdict describes prose
    #: that no longer exists.
    cuts: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.violations


def speculative_impact_phrase(text: str) -> str | None:
    """The consequence-speculating construction in ``text``, if any.

    One implementation, used both to report the fault and to cut it. Two would
    be free to disagree about what the fault is, and the cut would then remove
    a paragraph the report did not name, or leave one it did.
    """
    for pattern in SPECULATIVE_IMPACT:
        found = pattern.search(text)
        if found:
            return found.group(0).strip()
    return None


#: Fields holding a DIFFERENCE between two things rather than a level of one.
#:
#: Re-exported from :mod:`newsroom.pipeline.units`, which is where it now lives:
#: :func:`units.unit_for_field` needs the same set to know that a distance
#: across a rate series is in percentage points, and this module already imports
#: that one, so the set could not travel in this direction without a cycle.
#: Bound here rather than restated so existing callers keep working and there is
#: still exactly one definition.
DIFFERENCE_FIELDS: Final[frozenset[str]] = units.DIFFERENCE_FIELDS

#: A threshold proposed on a single reading, as opposed to on a difference.
_THRESHOLD_ON_A_LEVEL = re.compile(
    r"\b(?:above|below|under|over|beneath|beyond|exceed(?:s|ing)?)\b",
    re.IGNORECASE,
)

#: Words naming a level of one thing, as opposed to a difference between two.
_LEVEL_SUBJECT = re.compile(
    r"\b(?:reading|readings|level|levels|balance|rate|price|prices|value|"
    r"figure|figures|index|volume)\b",
    re.IGNORECASE,
)

#: Words naming a difference between two things. A threshold governed by one of
#: these is stated in the right quantity however the rest of the sentence reads.
_DISTANCE_SUBJECT = re.compile(
    r"\b(?:gap|distance|spread|difference|divergence|margin|deviation)\b",
    re.IGNORECASE,
)

#: How far back to look for the noun the comparison is attached to.
#:
#: This is the whole correctness of the rule. An earlier version asked whether a
#: level word appeared ANYWHERE in the sentence, and once the writer was fixed
#: it flagged five correct closings out of five — "a future reading that narrows
#: the gap below 23.48" contains "reading", and the threshold is plainly on the
#: gap. A word list keyed on the sentence tests the vocabulary; the noun
#: governing the comparison is the property.
_GOVERNING_WORDS = 4


def _governing_subject(text: str) -> str | None:
    """Is the comparison attached to a level or to a distance?

    Reads the few words immediately before the comparison word, which is what
    the threshold is actually about:

        "a consumer confidence BALANCE above 29.6"   -> level
        "a future release showing a GAP above 23.48" -> distance
        "a reading that narrows the GAP below 23.48" -> distance

    The last of those is why proximity matters rather than presence: it carries
    both words, and only the nearer one governs.
    """
    found = _THRESHOLD_ON_A_LEVEL.search(text)
    if not found:
        return None
    before = re.findall(r"[A-Za-z']+", text[: found.start()])[-_GOVERNING_WORDS:]
    window = " ".join(before)
    distance = _DISTANCE_SUBJECT.search(window)
    level = _LEVEL_SUBJECT.search(window)
    if distance and level:
        # Both in the window: the later one is nearer the comparison.
        return "distance" if distance.start() > level.start() else "level"
    if distance:
        return "distance"
    if level:
        return "level"
    return None


def threshold_subject_problems(
    text: str, figures, *, where: str = "the closing"
) -> list[str]:
    """A future test proposed on a level, but quantified by a difference.

    THE PUBLISHED CASE. A structural-divergence piece closed with::

        "A sustained consumer confidence balance above 29.6 in the coming
         months would reinforce this positive trend"

    29.6 is ``latest_gap`` — the spread between the highest and lowest country,
    ``-2.9 − (-32.5)``. A country *balance* above 29.6 is a different quantity,
    and all three countries were deeply negative, so the sentence proposes a
    test that essentially cannot occur. It reads as a falsifiable prediction
    and is not one.

    Every check passed and was right to. ``no_invented_numbers`` traced 29.6 to
    a declared figure; the figure is real and its subject changed. This is the
    same class as the ``gap``/``recent_gap`` collision — one number, two
    meanings — arriving in the sentence nobody guards.

    WHY THE FORWARD-LOOKING CONDITION IS LOAD-BEARING. Without it the rule
    fires on four sentences that are simply *describing* the present reading —
    "this reading is 16.35 percentage points below the seasonal norm",
    "exceeding the previous record by 542 thousand tonnes" — which are correct
    and are what a deviation and a margin are *for*. Measured over all 144
    published paragraphs: 5 hits without it, 4 of them wrong; 1 hit with it,
    and no false positive. A rule that rejects true work costs more than the
    fault it catches.

    ADVISORY, like everything here except the two cuts. It is fed back while
    the writer still has an attempt left, costs no model call, and cannot
    reject a true article. At one occurrence in twenty-seven it does not earn
    a cut, and the paragraph is worth keeping: a named threshold is the thing
    that makes a closing checkable at all.
    """
    if not text:
        return []
    if not (_FORWARD_LOOKING.search(text) or _NAMES_A_CONSEQUENCE.search(text)):
        return []
    if _governing_subject(text) != "level":
        return []

    for figure in figures or []:
        field = _field_of(figure)
        if field in DIFFERENCE_FIELDS:
            return [
                f"{where}: proposes a future reading {_threshold_word(text)} "
                f"{field!r}, but that figure is a difference between two things "
                f"— a gap, spread, margin, deviation or change — not a level "
                f"one reading can be compared against. State the threshold in "
                f"the same quantity you are watching, or name the release "
                f"without a number"
            ]
    return []


def _field_of(figure) -> str | None:
    """``signal_field``, whether the figure is a dict or a dataclass."""
    if isinstance(figure, Mapping):
        return figure.get("signal_field")
    return getattr(figure, "signal_field", None)


def _threshold_word(text: str) -> str:
    found = _THRESHOLD_ON_A_LEVEL.search(text)
    return found.group(0).lower() if found else "beyond"


def _unit_of(figure) -> str | None:
    """``unit``, whether the figure is a dict or a dataclass."""
    if isinstance(figure, Mapping):
        return figure.get("unit")
    return getattr(figure, "unit", None)


def _magnitudes(figure) -> tuple[str, ...]:
    """How this figure's number may appear in prose, longest form first.

    ``rendered_as`` is the writer's own account of what it typed, so it is
    tried first and stripped of any trailing per-cent sign — that sign is the
    thing under examination and must not be part of what we search for. The
    value is the fallback at the two precisions the pipeline offers a writer:
    :func:`units.display_value` rounds to two places before showing it, and the
    exact value is what ``figures_traceable`` matches.
    """
    out: list[str] = []
    rendered = str(getattr(figure, "rendered_as", "") or "").strip()
    if isinstance(figure, Mapping):
        rendered = str(figure.get("rendered_as") or "").strip()
    if rendered:
        out.append(rendered.rstrip("%").strip())
    value = figure.get("value") if isinstance(figure, Mapping) else getattr(figure, "value", None)
    if value is not None:
        number = float(value)
        for candidate in (f"{number:g}", f"{abs(number):g}", f"{abs(number):.2f}"):
            out.append(candidate)
    # Longest first so "0.475" is tried before "0.47" and the narrower match
    # cannot claim a prefix of the wider one.
    return tuple(sorted({m for m in out if m}, key=len, reverse=True))


def _percent_sign_after(magnitude: str) -> re.Pattern[str]:
    """``5.5%``, and not the ``5.5%`` inside ``15.5%``.

    The lookbehind is the whole correctness of this: without it a figure of 5.5
    matches inside 15.5, 25.5 and 105.5, and the check reports a fault in a
    sentence that never mentioned it.
    """
    return re.compile(rf"(?<![\d.]){re.escape(magnitude)}\s*%")


def percentage_point_problems(text: str, figures, *, where: str = "body") -> list[str]:
    """A distance across a rate series written with a per-cent sign.

    THE PUBLISHED CASE. Three articles carried one, all on ``cumulative_change``:

        "The cumulative change of 5.5% year on year indicates a strong upward
         trend in the housing market"

    The rate ran from 5.4% to 10.9%. The distance is 5.5 PERCENTAGE POINTS and
    the change is 101.9%, so the sentence understates it eighteenfold. The other
    two understate by 62x and 4x.

    Every existing check passed and was right to. ``figures_traceable`` traced
    5.5 to ``cumulative_change``, and that field holds 5.5; ``no_invented_numbers``
    found nothing invented. The number was real and the unit attached to it was
    false, which is the third member of the family this repo keeps finding —
    the contract protects figures, not what surrounds them. The first two were a
    wrong SUBJECT, from a shared cache key, and a wrong RENDERING, "4653
    thousand" for 4.65 million.

    READ OFF THE FIGURE, NOT THE PROSE. The rule fires on ``unit``, which
    ``generator.py`` sets from :func:`units.unit_for_field` and never from the
    model, so it cannot be beaten by a phrasing nobody imagined. A word list of
    "cumulative change of" would have missed the deviation, margin and spread
    forms of the identical fault, and the corpus sweep that found this used the
    declared field precisely because a regex over two phrasings found a third of
    what was there.

    A LEVEL IS UNTOUCHED, and that is the control worth stating. ``latest_value``
    on the same series is a genuine rate reading, so "10.9%" in the very same
    sentence is correct and must stay; and on a price series ``cumulative_change``
    keeps the series unit, so "down 0.1 EUR per kWh" is correct and never reaches
    this rule at all. Both are asserted in the suite.
    """
    if not text:
        return []
    problems: list[str] = []
    for figure in figures or []:
        if _unit_of(figure) != units.PERCENTAGE_POINTS:
            continue
        field_name = _field_of(figure) or "the figure"
        for magnitude in _magnitudes(figure):
            if _percent_sign_after(magnitude).search(text):
                problems.append(
                    f"{where}: writes {magnitude}% for {field_name!r}, which is a "
                    f"distance between two readings of a series that is itself "
                    f"measured in per cent. That distance is in PERCENTAGE POINTS "
                    f"— write '{magnitude} percentage points'. As a per cent it "
                    f"states a different and much smaller change"
                )
                break
    return problems


def _repair_percentage_points(article, report: StyleReport) -> None:
    """Write the percentage points in, on the final attempt.

    ASK FIRST, THEN CORRECT — the shape ``_cut_empty_closings`` uses, and for
    the reason stated there: house style has no rejection path, so an article
    whose attempts have run out publishes with its faults intact.

    But this one CORRECTS where those two CUT, and the difference is not
    stylistic. An empty closing has no right answer to substitute — there is
    nothing to say, which is why it was empty — so deleting it is the only
    move. A false unit has exactly one right answer, and the pipeline already
    knows it: the figure was declared against a field, the field resolves to
    "percentage points", and the substitution is determined. Nothing is lost
    and no attempt is spent.

    That is also why this is not a validator check. ``record_claim_holds`` must
    reject, because a false superlative needs information the writer does not
    have and no rewrite makes it true. Here the writer needs nothing: rejecting
    the article would burn six model calls to obtain a rewrite that can be
    performed directly.

    AMBIGUITY IS LEFT ALONE. If another figure in the same paragraph is written
    with the same digits and is genuinely a per cent, the two occurrences of
    "5.5%" cannot be told apart by their text, and rewriting would risk moving
    the correct one. The advisory still fires, so the fault is reported rather
    than silently passed over.
    """
    for index, block in enumerate(article.body or []):
        text = getattr(block, "text", None)
        figures = list(getattr(block, "figures", None) or ())
        if not text or not figures:
            continue
        for figure in figures:
            if _unit_of(figure) != units.PERCENTAGE_POINTS:
                continue
            for magnitude in _magnitudes(figure):
                pattern = _percent_sign_after(magnitude)
                if not pattern.search(text):
                    continue
                if _shares_a_magnitude(magnitude, figure, figures):
                    break
                text = pattern.sub(f"{magnitude} {units.PERCENTAGE_POINTS}", text)
                block.text = text
                # The declaration follows the prose. ``_after_the_figure`` locates
                # a figure by ``rendered_as``, so leaving "5.5%" here would make
                # that helper stop finding this figure at all — a check quietly
                # skipping rather than passing, which is worse than the fault.
                if getattr(figure, "rendered_as", None):
                    figure.rendered_as = f"{magnitude} {units.PERCENTAGE_POINTS}"
                report.corrections.append(
                    f"body[{index}]: {magnitude}% -> {magnitude} "
                    f"{units.PERCENTAGE_POINTS} ({_field_of(figure)} is a distance "
                    f"across a rate series)"
                )
                break


def _shares_a_magnitude(magnitude: str, figure, figures) -> bool:
    """Is another figure in this block written the same way and truly a per cent?"""
    for other in figures:
        if other is figure:
            continue
        if _unit_of(other) == units.PERCENTAGE_POINTS:
            continue
        if magnitude in _magnitudes(other):
            return True
    return False



def check_prose(text: str, *, where: str = "body") -> list[str]:
    """Style violations in a run of prose. Deterministic, case-insensitive."""
    problems: list[str] = []
    lowered = text.lower()

    if EM_DASH in text:
        problems.append(
            f"{where}: em dash used; house style is an en dash, and sparingly"
        )

    dashes = text.count(EN_DASH) + text.count(EM_DASH)
    if dashes > MAX_DASHES_PER_ARTICLE:
        problems.append(
            f"{where}: {dashes} dashes; commas or a semicolon carry this better"
        )

    for phrase in JOURNALESE:
        if phrase in lowered:
            problems.append(f"{where}: journalese, '{phrase}'")

    for phrase in GENERATED_TELLS:
        if phrase in lowered:
            problems.append(f"{where}: reads as unedited, '{phrase}'")

    for phrase in EMPTY_HEDGES:
        if phrase in lowered:
            problems.append(f"{where}: says nothing, '{phrase}'")

    for phrase in EMPTY_CLOSINGS:
        if phrase in lowered:
            problems.append(
                f"{where}: empty closing, '{phrase}' — name the release and the "
                "reading that would change the conclusion, or end a paragraph earlier"
            )

    phrase = speculative_impact_phrase(text)
    if phrase:
        problems.append(
            f"{where}: speculates about consequences, "
            f"'{phrase}' — the data does not establish who "
            "this lands on or what they will do. Say what the number IS "
            "ABOUT, or cut the sentence"
        )

    unreadable = unreadable_scale_phrase(text)
    if unreadable:
        phrase, smaller = unreadable
        problems.append(
            f"{where}: '{phrase}' makes the reader do the arithmetic — "
            f"write it in {smaller}. The declared figure does not change; "
            "only how the sentence reads does"
        )

    return problems


def review_headline(headline: str) -> tuple[str, list[str], list[str]]:
    """Returns the corrected headline, any violations, and what was corrected."""
    violations: list[str] = []
    corrections: list[str] = []

    fixed = sentence_case(headline)
    if fixed != headline:
        corrections.append(f"headline set in sentence case: {headline!r} -> {fixed!r}")

    violations.extend(check_prose(fixed, where="headline"))

    if fixed.endswith("."):
        corrections.append("headline full stop removed")
        fixed = fixed.rstrip(".")

    return fixed, violations, corrections


def origin_claim_problems(article, *, where_prefix: str = "") -> list[str]:
    """Prose naming where the series begins must agree with what was collected.

    ``#280`` made this possible. The collector now records the true series
    origin before the window is applied, so ``series_start_value`` carries the
    real first period rather than the ``lastTimePeriod`` boundary. A sentence
    saying "since the series began in 2016-Q3" can therefore be compared with
    the article's own recorded fact, deterministically and with no network.

    WHY NO OTHER CHECK SEES THIS
    ----------------------------
    A year is invisible to every numeric gate. ``numeric_scan`` ignores a bare
    four-digit year by design — a period label says *when* and claims nothing
    about magnitude — so "the series began in 2016" carries no token for
    ``no_invented_numbers`` to bind, and ``figures_traceable`` has nothing to
    trace. The origin year was the one number in an article that nothing could
    check. It is now the one number that can be checked exactly.

    WHY THIS CANNOT BE RUN OVER THE ARCHIVE
    ---------------------------------------
    **A self-consistent artefact is not evidence.** Before ``c5afdd0`` this
    field recorded the collector's window boundary — which is the number the
    writer copied into the prose. So an older article's claim agrees with the
    fact that produced it, and this function would return green on the exact
    falsehoods it exists to catch. Measured across the published corpus on
    2026-08-31: **7 of 7 prose origin claims agree with their own recorded
    fact**, including one whose series demonstrably begins twelve years
    earlier. That 7-of-7 is the trap, not a clean bill of health.

    What makes it safe going forward is not a version check but the producer:
    ``series_context`` emits no ``series_start_value`` at all when
    ``series.origin`` is absent, so on current code the fact's *presence*
    implies a real origin. Absence resolves to silence here too — an article
    with nothing recorded is left alone rather than measured against a window
    wearing the series' name.

    Both production callers — the generation loop and ``run.py`` — hold a
    freshly built pack. Point this at stored articles and it becomes a
    green-light generator; the test suite pins that reasoning.
    """
    recorded = _recorded_origin(article)
    if recorded is None:
        return []

    problems: list[str] = []
    for where, text in _prose_units(article, where_prefix):
        for sentence in _SENTENCES.split(text):
            match = _NAMES_THE_ORIGIN.search(sentence)
            if match is None:
                continue
            said = next((g for g in match.groups() if g), None)
            if said is None or _periods_agree(said, recorded):
                continue
            problems.append(
                f"{where}: says the series begins {said!r}, but it was collected "
                f"from {recorded!r}. The window the newsroom fetched is not the "
                f"start of the series — name the period the data actually starts at"
            )
    return problems


def origin_delta_problems(article, *, where_prefix: str = "") -> list[str]:
    """A change measured from somewhere else, attributed to where the series begins.

    THE HALF ``origin_claim_problems`` CANNOT SEE
    ---------------------------------------------
    That check compares the period the prose NAMES with the period that was
    collected. It is exact about *when* and silent about *what*. So a sentence
    naming the right origin and hanging the wrong quantity on it passes:

        "a cumulative change of -0.1 EUR per kWh, or 41.75%, since the series
         began in 2016-S1"

    Published 2026-08-30, corrected 2026-08-31, and the most serious of the
    eleven corrections in the log because it is the only one where a **sign
    inverts**: -41.75% is the change since 2022-S2, and over the span the
    sentence names the price ROSE 48.8%. Every gate passed. Both figures are
    real and both trace — to two different facts, which is
    ``AGENTS.md``'s *"the contract protects figures, not subjects"* arriving one
    step along: it protects figures, not **bases**.

    WHY THIS CAN BE CHECKED AT ALL, AND WHY IT CANNOT REJECT A TRUE SENTENCE
    ------------------------------------------------------------------------
    ``context._placement`` emits three things about the series: a count
    (``readings_in_series``), a level at the origin (``series_start_value``)
    and a previous record. **It computes no change from the origin, anywhere.**
    So there is no true "change since the series began" for a writer to declare:

        stated truthfully  the number is not a signal field
                           -> ``no_invented_numbers`` already refuses it
        stated with a real field   the field is measured from somewhere else
                           -> nothing sees it, which is this function

    The two states are exhaustive, so this is not a heuristic about wording. It
    is the observation that the fact does not exist.

    WHAT IT ABSTAINS ON, MEASURED RATHER THAN IMAGINED
    ---------------------------------------------------
    Three sentences carry a span-change beside an origin and are sound, and all
    three are refused rather than reported:

    * **A superlative bounded by the origin.** In "the highest in the series
      since it began in 2014-Q1" the ``since`` governs the record claim, not a
      figure, and ``record_claim_problems`` already owns that sentence. Detected
      with ``_CLAIMS_A_RECORD`` — the pattern that check uses — rather than with
      a second list of superlatives that could disagree with it.
    * **A superlative standing between the figure and the origin.** "clearing
      the previous high by 0.3, the highest since the series began" is true, and
      an earlier version of this check flagged it. It survived a control only
      by accident: written with the word *record* rather than *previous high*,
      ``_NAMES_THE_ORIGIN`` matched at "record" instead of "series", which put
      the figure outside the span and made a false positive look like a pass.
      So the test is not "is the figure somewhere before the origin" but "is
      there anything between them that re-anchors the ``since``".
    * **A run as long as the series.** Then the run really does start at the
      origin and ``cumulative_change`` really is the change since it. This
      needs no code and originally had some: an explicit guard comparing
      ``streak_length`` with ``readings_in_series`` was written, and then
      measured to be unreachable. ``_without_collisions`` drops a context fact
      whose value a signal field already justifies, and a run spanning the
      series means ``streak_start_value == series_start_value`` — so the origin
      fact is dropped, ``_recorded_origin`` answers ``None``, and this function
      abstains before reading any prose. Measured, detecting the streak rather
      than positing it::

          every reading rising   pack facts []             -> origin None
          one fall near the start pack facts [readings_in_series,
                                              previous_record]

      The guard was deleted rather than kept as belt and braces, because a
      comment describing an unreachable state is a false claim about the code
      that the next reader will believe.

    Measured across the 88 published articles: 7 sentences name a series
    origin, 6 declare a figure, and **1 binds a span-change to the origin — the
    one known-false sentence.** No true sentence in the corpus is touched.

    AN EDITOR, NOT A GATE
    ---------------------
    ``apply_house_style`` has no rejection path: a violation is handed back as a
    revision brief while the writer still has an attempt, and a validated
    article publishes regardless once the attempts run out. So a false positive
    costs one attempt and never an article — which is what makes this
    proportionate where the same rule inside ``validator.py`` would not be.
    """
    recorded = _recorded_origin(article)
    if recorded is None:
        return []

    problems: list[str] = []
    for where, text, figures in _prose_units_with_figures(article, where_prefix):
        declared = {str(getattr(f, "signal_field", "") or ""): f for f in figures}
        for sentence in _SENTENCES.split(text):
            match = _NAMES_THE_ORIGIN.search(sentence)
            if match is None or _CLAIMS_A_RECORD.search(sentence):
                continue
            # Only what the ``since`` could reach back over. A change stated
            # after the origin clause is a separate assertion.
            before = sentence[: match.start()]
            for field_name, measured_from in _SPAN_CHANGE_FIELDS.items():
                figure = declared.get(field_name)
                if figure is None:
                    continue
                tail = _after_the_figure(figure, before)
                # Nothing between the figure and the origin phrase may
                # re-anchor the "since". "0.3, THE HIGHEST since the series
                # began" bounds a superlative, not the change, and firing on it
                # would reject a true sentence.
                if tail is None or _SUPERLATIVE.search(tail):
                    continue
                problems.append(
                    f"{where}: attributes {field_name!r} to where the series "
                    f"begins, but it is measured from {measured_from!r} — the "
                    f"series begins {recorded!r} and no change from there is "
                    "collected. Name the period this change is measured over"
                )
    return problems


#: A superlative standing between a figure and an origin phrase, which means
#: the origin is bounding the superlative. Built from the same vocabulary
#: ``_CLAIMS_A_RECORD`` uses, so the two cannot come to disagree about what a
#: superlative is.
_SUPERLATIVE: Final[re.Pattern[str]] = re.compile(
    r"\b(?:" + _SUPERLATIVE_WORDS + r")\b", re.IGNORECASE
)


def _after_the_figure(figure, text: str) -> str | None:
    """The prose between a declared figure and the end of ``text``.

    ``None`` when the figure is not written there at all — which is the common
    case and means the sentence never put this number in front of the origin.

    Matched on ``rendered_as`` when the writer supplied it, because that is the
    form it actually put on the page — ``0.13 EUR per kWh`` rather than
    ``0.13``. The bare value is the fallback, so a figure declared without a
    rendering is still found rather than silently skipped.
    """
    rendered = str(getattr(figure, "rendered_as", "") or "").strip()
    if not rendered:
        value = getattr(figure, "value", None)
        if value is None:
            return None
        rendered = f"{float(value):g}"
    index = text.rfind(rendered)
    if index < 0:
        return None
    return text[index + len(rendered) :]


def _recorded_origin(article) -> str | None:
    """The collected first period, or ``None`` when nothing was recorded."""
    provenance = getattr(article, "provenance", None)
    if not isinstance(provenance, Mapping):
        return None
    context = provenance.get("context")
    if not isinstance(context, Mapping):
        return None
    for fact in context.get("facts") or ():
        if isinstance(fact, Mapping) and fact.get("field") == "series_start_value":
            period = fact.get("period")
            return period if isinstance(period, str) and period.strip() else None
    return None


def _prose_units(article, prefix: str = ""):
    """Every unit of prose we wrote, as ``(location, text)``."""
    for name in ("headline", "dek"):
        text = getattr(article, name, None)
        if text:
            yield f"{prefix}{name}", text
    for index, block in enumerate(article.body or []):
        if getattr(block, "text", None):
            yield f"{prefix}body[{index}]", block.text


def _prose_units_with_figures(article, prefix: str = ""):
    """Body prose with the figures declared alongside it.

    Body blocks only. A headline and a dek carry no ``figures``, so a check that
    needs a declared field has nothing to read there — and yielding them with an
    empty list would let a later reader believe they had been examined.
    """
    for index, block in enumerate(article.body or []):
        text = getattr(block, "text", None)
        if text:
            yield f"{prefix}body[{index}]", text, list(getattr(block, "figures", None) or ())


#: Fields whose value is a distance travelled BETWEEN TWO POINTS IN TIME, and
#: the field naming where that span starts. These are the six a sentence can
#: misattribute to the series origin, because each is a change *since* some
#: period and none of those periods is the origin.
#:
#: Deliberately narrower than "every field that is a difference".
#: ``distance_from_threshold`` is measured from a line we chose, ``deviation``
#: from a multi-year average and ``spread`` from another country — none has a
#: start period, so none can be read as "the change since X". Including them
#: would widen the reach without adding a claim the rule is actually about.
#:
#: ``newsroom/tests/pipeline/test_origin_delta.py`` asserts every
#: ``(detector, field)`` in ``FIELD_MEANINGS`` is classified here or explicitly
#: set aside, so a new field cannot arrive unjudged — the enumeration is the
#: check, not a list someone remembers to update.
_SPAN_CHANGE_FIELDS: Final[dict[str, str]] = {
    "margin": "previous_record_value",
    "margin_pct": "previous_record_value",
    "cumulative_change": "streak_start_value",
    "cumulative_change_pct": "streak_start_value",
    "change": "previous_value",
    "change_pct": "previous_value",
}


#: Month names as the writer spells them, so "August 2021" can be compared with
#: the collector's "2021-08".
_MONTHS: Final[dict[str, str]] = {
    m.lower(): f"{i:02d}"
    for i, m in enumerate(
        (
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ),
        start=1,
    )
}

#: A period label in any shape either side writes: 2016-Q3, 2021-S1, 2021-08,
#: 2026-04-29, "August 2021", or a bare year.
_PERIOD_TOKEN: Final[str] = (
    r"(?:\d{4}-Q[1-4]|\d{4}-S[12]|\d{4}-W\d{1,2}|\d{4}-\d{2}(?:-\d{2})?|"
    r"(?:" + "|".join(_MONTHS) + r")\s+\d{4}|\d{4})"
)

#: Prose that names where the series STARTS, which is a different claim from an
#: ordinary comparison basis. "since 2019" says what a figure is measured
#: against; "since the series began in 2019" asserts a fact about the data's
#: extent, and that fact is now collected and checkable.
#:
#: The origin word must sit beside the series word. Requiring both is what
#: keeps this off "the highest since 2019", which names no origin and is the
#: comparison basis the validator already governs.
_NAMES_THE_ORIGIN: Final[re.Pattern[str]] = re.compile(
    r"\b(?:series|record|history)\b(?:[^.]|\.(?=\d)){0,40}?"
    r"\b(?:began|begins|beginning|started|starts|starting|runs?\s+back)\b"
    r"(?:[^.]|\.(?=\d)){0,20}?(" + _PERIOD_TOKEN + r")"
    r"|\b(?:began|begins|started|starts|runs?\s+back)\b(?:[^.]|\.(?=\d)){0,24}?"
    r"\b(?:series|record|history)\b(?:[^.]|\.(?=\d)){0,24}?(" + _PERIOD_TOKEN + r")",
    re.IGNORECASE,
)


def _normalise_period(text: str) -> str | None:
    """A period label reduced to something two spellings can be compared on.

    "August 2021" and "2021-08" are the same period written by a writer and by
    a collector. Reducing both to ``2021-08`` is what stops the check firing on
    a difference in spelling, which would be a false positive on correct prose.
    """
    text = text.strip()
    month = re.match(r"^(" + "|".join(_MONTHS) + r")\s+(\d{4})$", text, re.IGNORECASE)
    if month:
        return f"{month.group(2)}-{_MONTHS[month.group(1).lower()]}"
    return text.upper()


def _periods_agree(said: str, recorded: str) -> bool:
    """Whether prose and record name the same period.

    Deliberately generous on precision and strict on the year. A writer may say
    "2021" for a series starting "2021-08" — less precise, not wrong — and
    demanding the exact label would reject correct prose. A different *year* is
    a different claim, and that is the fault this exists to catch.
    """
    a, b = _normalise_period(said), _normalise_period(recorded)
    if a is None or b is None:
        return True
    if a == b:
        return True
    year_a = re.match(r"^(\d{4})", a)
    year_b = re.match(r"^(\d{4})", b)
    if not year_a or not year_b:
        return True
    if year_a.group(1) != year_b.group(1):
        return False
    # Same year. A bare year on either side is a coarser way of saying the same
    # thing; two different sub-year labels disagree.
    return len(a) == 4 or len(b) == 4 or a == b


def apply_house_style(
    article,
    *,
    cut_empty_closings: bool = False,
    cut_speculative_impact: bool = False,
    repair_percentage_points: bool = False,
) -> StyleReport:
    """Copy-edit an article in place and report what is left.

    Corrections are applied; violations are recorded and returned separately,
    because the two are not the same kind of thing. A correction is done and
    needs nobody's attention. A violation is prose only the writer can fix, and
    knowing which is which is what lets the generation loop feed the second kind
    back while the writer still has an attempt left to act on it.

    Nothing here rewrites a figure — ``sentence_case`` refuses to touch any
    token containing a digit, so the validator's traceability guarantee is
    unaffected.

    Duck-typed rather than importing ``Article``: this module is imported by
    the generator, and the generator is imported by everything else.
    """
    report = StyleReport()

    fixed, violations, corrections = review_headline(article.headline or "")
    if fixed != article.headline:
        article.headline = fixed
    report.corrections.extend(corrections)
    report.violations.extend(violations)
    # The headline is where the false record claim actually shipped, so it is
    # checked here rather than only in the body scan below.
    report.violations.extend(record_claim_problems(article.headline or "", where="headline"))

    # Whole-article, because it reads the article's own collected origin rather
    # than the prose in front of it. Every unit is scanned inside.
    report.violations.extend(origin_claim_problems(article))
    # Its sibling, and the two are not redundant: the first asks whether the
    # prose names the right period, the second whether the quantity hung on it
    # was measured from there. The electricity article got both wrong and only
    # the second inverted a sign.
    report.violations.extend(origin_delta_problems(article))

    if article.dek:
        report.violations.extend(check_prose(article.dek, where="dek"))
        report.violations.extend(record_claim_problems(article.dek, where="dek"))

    # BEFORE the per-block scan below, not after, so a paragraph that is cut is
    # not also reported as a violation the desk should act on. The desk would
    # otherwise be handed a note naming prose that no longer exists — the same
    # dishonest artefact ``_revalidate`` was written to prevent one layer out.
    if cut_speculative_impact:
        _cut_speculative_impact(article, report)

    # Same ordering, same reason: correct the unit first, then scan, so the
    # advisory below describes the prose as it now stands. A repaired sentence
    # must not also be reported as faulty.
    if repair_percentage_points:
        _repair_percentage_points(article, report)

    for index, block in enumerate(article.body or []):
        if block.text:
            report.violations.extend(check_prose(block.text, where=f"body[{index}]"))
            # A distance across a rate series written with a per-cent sign.
            # Advisory while the writer still has an attempt, corrected outright
            # above when it does not — the same ask-first shape as the two cuts,
            # except that this one has a right answer to substitute.
            report.violations.extend(
                percentage_point_problems(
                    block.text,
                    getattr(block, "figures", None),
                    where=f"body[{index}]",
                )
            )
            # Sentence by sentence: a paragraph may state the record in one
            # sentence and its window in the next, and reading the paragraph
            # whole would accept that. It is a reader's sentence that has to be
            # true, not their paragraph.
            for sentence in _SENTENCES.split(block.text):
                report.violations.extend(
                    record_claim_problems(sentence, where=f"body[{index}]")
                )

    # And how it ends, which is a different question from how it reads. Applied
    # to the last prose paragraph only: a forward reference in the middle of a
    # piece — "the figure is released quarterly" — is ordinary reporting.
    #
    # ASK FIRST, THEN CUT. ``cut_empty_closings`` is set by the generator on the
    # final attempt only, so the shape is: hand it back while the writer still
    # has an attempt to spend, and delete the paragraph if it never converges.
    #
    # Neither half is sufficient alone. Asking is not, because three strategies
    # have now failed — a blacklist, which lost to paraphrase across ten of ten
    # articles; a structural check, which the model satisfied by swapping WILL
    # for WOULD in three of three; and revised prompt guidance — and because
    # house style adds no rejection path, so a validated article publishes once
    # its attempts run out, style faults and all. A check the model can outlast
    # is bounded by the retry budget rather than by its own correctness.
    #
    # But cutting alone would throw away the good outcome. A model that fixes
    # the closing when told gives us a real one, which beats no closing; the
    # attempts were going to be spent regardless. So the cut is the floor, not
    # the policy, and the guidance already names it: "if none of these produces
    # a sentence worth reading, end the article one paragraph earlier."
    if cut_empty_closings:
        _cut_empty_closings(article, report)
    else:
        prose = [
            (index, block.text)
            for index, block in enumerate(article.body or [])
            if getattr(block, "type", None) == "paragraph" and block.text
        ]
        if prose:
            last_index, last_text = prose[-1]
            report.violations.extend(closing_problems(last_text, where=f"body[{last_index}]"))

    # Whether or not the closing was cut, and always on whatever paragraph the
    # article now ends on. This is advisory rather than a cut: at one
    # occurrence in twenty-seven it does not earn one, and a named threshold is
    # what makes a closing checkable at all — deleting it would remove the
    # good version along with the bad.
    ending = [
        (index, block)
        for index, block in enumerate(article.body or [])
        if getattr(block, "type", None) == "paragraph" and block.text
    ]
    if ending:
        last_index, last_block = ending[-1]
        report.violations.extend(
            threshold_subject_problems(
                last_block.text,
                getattr(last_block, "figures", None),
                where=f"body[{last_index}]",
            )
        )

    return report


#: A cut can expose another empty closing beneath it. Bounded so that a body of
#: nothing but formula cannot loop, and so an article is never reduced to none.
_MAX_CLOSING_CUTS = 3

#: The same bound, for the same reason. Measured over the 25 published tier A
#: originals, no article carried more than one of these.
_MAX_IMPACT_CUTS = 2


def _cut_speculative_impact(article, report: StyleReport) -> None:
    """Delete paragraphs that assert a consequence the data does not establish.

    ASK FIRST, THEN CUT — the shape ``_cut_empty_closings`` already uses, and
    for the reason stated there: *a check the model can outlast is bounded by
    the retry budget rather than by its own correctness*. That sentence was
    written about the closing and is true of this fault too, which is the
    larger one. It was simply never applied here.

    What that cost, measured over all 25 published tier A originals:

    - **13 of 25** carry a paragraph this module's own ``SPECULATIVE_IMPACT``
      matches — "impacts logistics companies", "directly impacts consumers",
      "impacts employers" — and every one of them published.
    - The desk caught all of them by hand. **17 of 17** of its "ran as filed"
      approvals name this paragraph, and ``desk.py`` instructs it to say *"A
      speculative impact paragraph is a CUT, not a rewrite"* and approve with
      that note. **Nothing anywhere performed the cut.** The desk asked 17
      times and was never once obeyed.
    - So the fault spent the generator's retry budget AND the desk's single
      revision, and published regardless.

    The prompt is not the gap. It already tells the writer, in capitals, that
    "THIS PARAGRAPH SHOULD NOT EXIST — write the piece without it", and the
    plan it belongs to already says to skip any paragraph "for which you were
    given nothing". A fourth restatement would be the strategy this module's
    own comment records failing three times.

    THE CUT IS DELIBERATELY NARROW, and the boundary is measured rather than
    chosen. Of the 14 offending paragraphs:

    ================================  =====  ==========================
    where                             n      cut?
    ================================  =====  ==========================
    figure-free, not the lead         12     yes — withdraws no claim
    carries a figure                   2     no — would delete real work
    the lead paragraph                 0     never eligible
    ================================  =====  ==========================

    A figure-free paragraph makes no numeric claim, so removing it can only
    withdraw prose. The two that carry a figure are left for the desk, which is
    the right place for a judgement about whether the sentence or the figure is
    the point.
    """
    for _ in range(_MAX_IMPACT_CUTS):
        prose = [
            (index, block)
            for index, block in enumerate(article.body or [])
            if getattr(block, "type", None) == "paragraph" and block.text
        ]
        # Never the last surviving paragraph, and never the lead: an article
        # reduced to nothing is a generation failure and must reach the
        # validator looking like one.
        if len(prose) <= 1:
            return

        for index, block in prose[1:]:
            if getattr(block, "figures", None):
                continue
            phrase = speculative_impact_phrase(block.text)
            if phrase is None:
                continue
            del article.body[index]
            report.cuts.append(
                f"body[{index}]: cut a paragraph asserting a consequence the "
                f"data does not establish — {phrase!r} in {block.text[:80]!r}"
            )
            report.corrections.append(
                "removed a paragraph that speculated about who the figure lands on"
            )
            break
        else:
            return


def _cut_empty_closings(article, report: StyleReport) -> None:
    """Delete trailing paragraphs that only promise future information.

    Never removes the last surviving paragraph. An article whose every
    paragraph is an empty closing is a generation failure, not a copy-editing
    one, and it must reach the validator looking like what it is rather than
    being silently emptied.
    """
    for _ in range(_MAX_CLOSING_CUTS):
        prose = [
            (index, block.text)
            for index, block in enumerate(article.body or [])
            if getattr(block, "type", None) == "paragraph" and block.text
        ]
        if not prose:
            return

        last_index, last_text = prose[-1]
        problems = closing_problems(last_text, where=f"body[{last_index}]")
        if not problems:
            return

        if len(prose) == 1:
            # Nothing left to fall back on, so report it instead of cutting.
            report.violations.extend(problems)
            return

        del article.body[last_index]
        report.cuts.append(
            f"body[{last_index}]: cut an empty closing that promised a future "
            f"release would tell us more — {last_text[:80]!r}"
        )
        report.corrections.append("removed a closing paragraph that said nothing")
