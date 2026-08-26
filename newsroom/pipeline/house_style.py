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

#: Pointing at a future release, however it is phrased.
_FORWARD_LOOKING = re.compile(
    r"\b(?:next|upcoming|future|forthcoming|coming|subsequent|later)\b"
    r"[^.]{0,60}?\b(?:release|releases|report|reports|reading|readings|data|"
    r"figures|print|prints|statistic|statistics|numbers|settlement|auction|"
    r"update|quarter|month|year)\b"
    r"|\bwill\s+(?:be\s+)?(?:crucial|essential|key|important|critical|vital|"
    r"instrumental|necessary|useful|telling)\b"
    r"|\bwill\s+(?:provide|offer|give|shed|clarify|reveal|determine|confirm|"
    r"indicate|show|tell)\b",
    re.IGNORECASE,
)

#: What makes a forward-looking closing worth reading: it names the reading and
#: what that reading would MEAN. A conditional carries a consequence; the empty
#: formula never does, which is exactly why none of the ten contained one.
_NAMES_A_CONSEQUENCE = re.compile(
    r"\bwould\b"
    r"|\bif\b[^.]{0,80}\b(?:then|that would|it would)\b"
    r"|\bany\s+\w+\s+(?:above|below|under|over)\b",
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


def closing_problems(text: str, *, where: str = "the closing") -> list[str]:
    """Violations in the paragraph a piece ends on.

    Only ever applied to the last paragraph, because the rule is about how an
    article STOPS. A forward reference mid-article — "the figure is released
    quarterly" — is ordinary reporting and must stay legal.
    """
    if not text or not _FORWARD_LOOKING.search(text):
        return []
    if _NAMES_A_CONSEQUENCE.search(text) or _STATES_A_LIMIT.search(text):
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

    for phrase in EMPTY_CLOSINGS:
        if phrase in lowered:
            problems.append(
                f"{where}: empty closing, '{phrase}' — name the release and the "
                "reading that would change the conclusion, or end a paragraph earlier"
            )

    for pattern in SPECULATIVE_IMPACT:
        found = pattern.search(text)
        if found:
            problems.append(
                f"{where}: speculates about consequences, "
                f"'{found.group(0).strip()}' — the data does not establish who "
                "this lands on or what they will do. Say what the number IS "
                "ABOUT, or cut the sentence"
            )
            break

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


def apply_house_style(article) -> StyleReport:
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

    if article.dek:
        report.violations.extend(check_prose(article.dek, where="dek"))

    for index, block in enumerate(article.body or []):
        if block.text:
            report.violations.extend(check_prose(block.text, where=f"body[{index}]"))

    # And how it ends, which is a different question from how it reads. Applied
    # to the last prose paragraph only: a forward reference in the middle of a
    # piece — "the figure is released quarterly" — is ordinary reporting.
    prose = [
        (index, block.text)
        for index, block in enumerate(article.body or [])
        if getattr(block, "type", None) == "paragraph" and block.text
    ]
    if prose:
        last_index, last_text = prose[-1]
        report.violations.extend(closing_problems(last_text, where=f"body[{last_index}]"))

    return report
