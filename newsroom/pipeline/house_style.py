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
)


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

    @property
    def clean(self) -> bool:
        return not self.violations


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
