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

#: A claim that this is the biggest or smallest reading there has ever been.
_CLAIMS_A_RECORD: Final[re.Pattern[str]] = re.compile(
    r"\brecord\s+(?:high|low)\b|\ba\s+record\b|\bset\s+a?\s*record\b|"
    r"\ball[-\s]time\s+(?:high|low)\b|\b(?:highest|lowest)\s+ever\b|"
    r"\bnever\s+been\s+(?:higher|lower)\b|\bon\s+record\b",
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
_BOUNDS_THE_RECORD: Final[re.Pattern[str]] = re.compile(
    r"\bsince\s+\w*\s*\d{4}\b|\bsince\s+(?:the\s+)?(?:series|records?\s+began)\b|"
    r"\b\d[\d,]*\s+(?:observations?|readings?|quarters?|months?|years?|weeks?)\b|"
    r"\b\d+[-\s](?:quarter|year|month|week|day)\b|"
    r"\b(?:of|in)\s+(?:this|the)\s+series\b|\bseries\s+began\b",
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
        f"{where}: claims a record without saying over what window. The series "
        f"is the slice the newsroom fetched, not all of history, so name it — "
        f'"the lowest in the 60 observations since 2021-08" — or drop the word'
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
#: A threshold is only meaningful against the quantity it is a threshold on, so
#: one of these can bound another difference and never a single reading. The
#: distinction is not visible in the prose — both render as a bare number — so
#: it has to be read off the field the figure was declared against.
#:
#: Named per detector family rather than guessed from the name: ``margin`` and
#: ``deviation`` carry no suffix that marks them out, and ``latest_value`` is a
#: level despite sitting beside them in the same figure table.
DIFFERENCE_FIELDS: Final[frozenset[str]] = frozenset({
    "gap", "latest_gap", "early_gap", "recent_gap", "gap_pct",
    "spread", "typical_spread", "spread_pct", "spread_vs_typical",
    "margin", "margin_pct",
    "deviation", "deviation_pct",
    "change", "change_pct", "cumulative_change", "cumulative_change_pct",
    "distance_from_threshold", "widening_ratio",
    "typical_move", "move_vs_typical",
})

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


def apply_house_style(
    article,
    *,
    cut_empty_closings: bool = False,
    cut_speculative_impact: bool = False,
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

    if article.dek:
        report.violations.extend(check_prose(article.dek, where="dek"))
        report.violations.extend(record_claim_problems(article.dek, where="dek"))

    # BEFORE the per-block scan below, not after, so a paragraph that is cut is
    # not also reported as a violation the desk should act on. The desk would
    # otherwise be handed a note naming prose that no longer exists — the same
    # dishonest artefact ``_revalidate`` was written to prevent one layer out.
    if cut_speculative_impact:
        _cut_speculative_impact(article, report)

    for index, block in enumerate(article.body or []):
        if block.text:
            report.violations.extend(check_prose(block.text, where=f"body[{index}]"))
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
