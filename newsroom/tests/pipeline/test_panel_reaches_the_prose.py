"""The causal panel's work, measured where it either reaches a reader or does not.

WHY THIS FILE
-------------
The panel was added as stage 6b and no run-level instrument was told. Measured
on master immediately before the change these tests defend, a run carrying one
admissible hypothesis, two analysts consulted and three candidates discarded
reported::

    0 series, 0 signals, 0 selected, 0 context fact(s), 0 document(s) read,
    0 mechanism(s), 0 published, 0 rejected, ...

Not a wrong number — no number at all. ``summary()`` enumerates every
enrichment stage that explains a *thin* wire and stopped one short of the newest
one, and ``build_run_report`` had no key for it either.

The half that matters more is downstream of that. An article that names no
cause has two entirely different explanations:

  * the panel proposed nothing admissible — the wire being honest;
  * the panel filed causes and the correspondent used none — the stage paid for
    in model calls and dropped at the last seam.

``provenance.hypotheses`` recorded which, per article, since the panel shipped.
Nothing read it. So the two produced the same artefact and the same counts, and
the only way to tell them apart was to open individual articles by hand — which
is how the original "the data does not show what drove the change" complaint
had to be diagnosed in the first place.

WHAT THESE TESTS ARE NOT
------------------------
They do not assert that an article *must* state a cause. Nothing rejects an
article for staying silent and nothing should: a validator that fires on a true
sentence is a worse defect than the thinness it was aimed at. These assert only
that the two states are distinguishable by someone reading ``runs/latest.json``.
"""

from __future__ import annotations

from newsroom.pipeline.hypothesis import Hypothesis, HypothesisPanel
from newsroom.pipeline.run import RunReport
from newsroom.pipeline.runreport import build_run_report
from newsroom.validator import states_a_panel_cause

ANALYST = "the newsroom's AI household economist"

#: Attributed to the panellist, marked unconfirmed, and disclosing the analyst
#: as AI — the three clauses ``_is_hedged_desk_hypothesis`` requires, in the
#: wording ``HypothesisPanel.prompt_section`` tells the writer to use.
STATED = (
    f"{ANALYST} says the rise is likely driven by households moving off fixed "
    "tariffs, though this data cannot confirm it."
)

#: The ending the panel was built to replace. Figure-free, honest, and — until
#: this measurement existed — indistinguishable from the sentence above in
#: every number the newsroom published.
SILENT = (
    "The data does not show what drove the change in home energy inflation, "
    "and no specific causes can be confirmed."
)


def _hypothesis() -> Hypothesis:
    return Hypothesis(
        claim="households moved off fixed tariffs",
        lens="household",
        analyst=ANALYST,
        discipline="household economics",
        basis="domain_knowledge",
        attribution=ANALYST,
        strength="likely",
        testable_with="a supplier-switching series",
    )


def _article(text: str, *, with_panel: bool = True) -> dict:
    provenance: dict = {"attempts": 1}
    if with_panel:
        provenance["hypotheses"] = HypothesisPanel(
            hypotheses=(_hypothesis(),),
            consulted=(ANALYST, "the newsroom's AI political economist"),
            discarded=("a claim carrying a quantity",),
        ).to_provenance()
    return {
        "slug": "home-energy",
        "tier": "A",
        "provenance": provenance,
        "body": [{"type": "paragraph", "text": text}],
    }


class Article:
    """A published article, as thin as the report's duck-typing allows."""

    def __init__(self, document: dict):
        self._document = document
        self.slug = document["slug"]
        self.section = "economy"
        self.provenance = document["provenance"]

    def to_json(self) -> dict:
        return self._document


class Generated:
    def __init__(self, article: Article):
        self.article = article
        self.publishable = True


class Run:
    """Enough of ``RunReport`` for :func:`build_run_report`."""

    def __init__(self, published, panels=None):
        self.published = list(published)
        self.generated = [Generated(a) for a in self.published]
        self.panels = panels or {}
        self.rejected: list = []
        self.desk: list = []
        self.errors: list = []
        self.syndicated: list = []
        self.style_notes: list = []
        self.signals: list = []
        self.syndication_skipped = 0

    def summary(self) -> str:
        return ""


# ── the predicate ───────────────────────────────────────────────────────


def test_a_cause_offered_in_the_briefs_own_wording_is_counted():
    assert states_a_panel_cause(_article(STATED))


def test_the_ending_the_panel_replaces_is_not_counted():
    """The negative control, on the same object as the positive one.

    Same panel provenance, same article shape, one paragraph swapped. A probe
    that returned ``False`` for both would be reporting a broken traversal and
    a silent article identically, which is the fault this module measures
    arriving inside the instrument that measures it.
    """
    assert not states_a_panel_cause(_article(SILENT))


def test_no_panel_means_no_cause_to_have_stated():
    """``False`` here is "there was nothing to state", not "it was dropped".

    The run report keeps the two apart by counting this article out of
    ``articles_offered_a_cause`` entirely rather than into its shortfall.
    """
    assert not states_a_panel_cause(_article(STATED, with_panel=False))


def test_a_flat_cause_is_not_counted_as_offered_properly():
    """Attributed and explanatory, but asserted rather than proposed.

    ``check_no_unsupported_mechanism`` rejects this, so counting it would put
    the measurement and the gate in disagreement about what a properly offered
    cause is — and a counter that re-derives what it counts is the second
    implementation this repository keeps finding.
    """
    flat = f"{ANALYST} says the rise is driven by households moving off fixed tariffs."
    assert not states_a_panel_cause(_article(flat))


def test_an_undisclosed_analyst_is_not_counted():
    """No "AI", so a reader takes the analyst for someone we telephoned."""
    text = (
        "The newsroom's household economist says the rise is likely driven by "
        "households moving off fixed tariffs, though this data cannot confirm it."
    )
    assert not states_a_panel_cause(_article(text))


def test_a_cause_beside_a_figure_still_counts():
    """The one deliberate divergence from the gate's population.

    ``check_no_unsupported_mechanism`` skips a paragraph carrying figures,
    because a figure makes it traceable and another check owns it. That is
    right for deciding what to reject and wrong for deciding what a reader
    read. Counting the gate's population instead would undercount uptake in
    exactly the direction that reports a problem where there is none.
    """
    document = _article(STATED)
    document["body"][0]["figures"] = [{"value": 4.1, "field": "latest"}]
    assert states_a_panel_cause(document)


def test_a_malformed_article_is_false_rather_than_an_exception():
    assert not states_a_panel_cause({})
    assert not states_a_panel_cause({"provenance": "not a mapping", "body": []})
    assert not states_a_panel_cause(_article(STATED) | {"body": "not a list"})


# ── the run summary ─────────────────────────────────────────────────────


def test_the_thin_wire_summary_names_the_panel():
    """Mutation: drop the candidate-cause clause from ``summary()``.

    It leaves every other count correct and the line perfectly readable, which
    is why it survived a day. The enumeration is of enrichment stages and the
    panel is one.
    """
    report = RunReport()
    report.panels = {
        "s1": HypothesisPanel(hypotheses=(_hypothesis(), _hypothesis())),
        "s2": HypothesisPanel(hypotheses=(_hypothesis(),)),
    }
    assert "3 candidate cause(s)" in report.summary()


def test_the_summary_says_zero_rather_than_omitting_it():
    """A run whose panellists all failed must say so, not go quiet.

    Omitting the clause when the count is zero would make "the panel found
    nothing" and "the panel is not in this line" the same reading, which is the
    collapse the whole change is about.
    """
    assert "0 candidate cause(s)" in RunReport().summary()


# ── the run report ──────────────────────────────────────────────────────


def test_the_report_separates_a_dropped_cause_from_an_absent_one():
    """The two states, in one run, told apart by two numbers.

    Both articles publish. Both have a panel that filed a cause. One used it
    and one closed with the sentence the panel exists to replace, and before
    this block every count in the report was identical for the pair.
    """
    run = Run(
        [Article(_article(STATED)), Article(_article(SILENT))],
        panels={
            "s1": HypothesisPanel(
                hypotheses=(_hypothesis(),), consulted=(ANALYST,), discarded=("a", "b")
            ),
            "s2": HypothesisPanel(hypotheses=(_hypothesis(),), consulted=(ANALYST,)),
        },
    )
    block = build_run_report(run, trigger="timer")["causal_panel"]

    assert block["articles_offered_a_cause"] == 2
    assert block["articles_stating_a_cause"] == 1, (
        "the shortfall is the only place the panel being ignored is visible"
    )
    assert block["hypotheses"] == 2
    assert block["discarded"] == 2
    assert block["consulted"] == 2
    assert block["panels"] == 2


def test_an_article_with_no_panel_is_not_counted_as_a_shortfall():
    """A silent article whose panel filed nothing is the wire being honest.

    Counting it into ``articles_offered_a_cause`` would manufacture a shortfall
    out of the correct outcome, and the number that is supposed to prompt work
    on the prompt would start rising for a reason that needs none.
    """
    run = Run([Article(_article(SILENT, with_panel=False))])
    block = build_run_report(run, trigger="timer")["causal_panel"]
    assert block["articles_offered_a_cause"] == 0
    assert block["articles_stating_a_cause"] == 0


def test_the_report_survives_a_panel_of_the_wrong_shape():
    """This runs at the end of a run that may already have gone wrong.

    A report that raises while explaining a failure turns a bad run into a
    crashed one, which is this module's stated contract rather than
    belt-and-braces.
    """
    run = Run([], panels={"s1": object()})
    run.panels = {"s1": object()}
    document = build_run_report(run, trigger="timer")
    assert document["causal_panel"]["panels"] == 1
    assert document["causal_panel"]["hypotheses"] == 0


def test_an_article_that_cannot_be_serialised_costs_its_own_entry_only():
    class Broken(Article):
        def to_json(self):
            raise RuntimeError("no")

    run = Run([Broken(_article(STATED)), Article(_article(STATED))])
    block = build_run_report(run, trigger="timer")["causal_panel"]
    assert block["articles_stating_a_cause"] == 1
