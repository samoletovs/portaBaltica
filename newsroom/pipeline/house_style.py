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

    if article.dek:
        report.violations.extend(check_prose(article.dek, where="dek"))

    # BEFORE the per-block scan below, not after, so a paragraph that is cut is
    # not also reported as a violation the desk should act on. The desk would
    # otherwise be handed a note naming prose that no longer exists — the same
    # dishonest artefact ``_revalidate`` was written to prevent one layer out.
    if cut_speculative_impact:
        _cut_speculative_impact(article, report)

    for index, block in enumerate(article.body or []):
        if block.text:
            report.violations.extend(check_prose(block.text, where=f"body[{index}]"))

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
