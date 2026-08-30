"""Which house-style checks are enforced, which are advisory, and can they fire.

WHY THIS EXISTS
---------------
``generator.py`` states a real design position: *"house style is an editor, not
a gate"*, so a validated article publishes with its style faults once the
attempts run out. Two faults are exceptions — they are cut on the final attempt
rather than published with a note asking someone to remove them. Everything
else is advisory by default, which is fine as long as somebody has checked
that the advisory ones are not silently accumulating in published work.

Somebody has now. Measured over the 25 published tier A originals, in three
cohorts, because the cohort turned out to be the whole story:

===================== ========== ========== =====================
check                  all 25     v7 only    producing revision
                      134 paras  118 paras   known (26 paras)
===================== ========== ========== =====================
em_dash                    0          0              0
too_many_dashes            0          0              0
journalese                 0          0              0
generated_tells            6          3              1
empty_hedges               5          1              0
empty_closing_phrase       7          1              0
speculative_impact        14         11              2
closing_structural     17 / 25    13 / 21          0 / 5
===================== ========== ========== =====================

``closing_structural`` at 13-of-21 is history, not a live fault: ``c913dc1``
added *both* the empty-closing cut **and** the structural check that finds it,
and 20 of the 25 articles were written before that. Prompt version does not
separate them — ``tierA-depth-v7`` spans the change. ``provenance.revision``
does, and the four revisions behind those five articles were confirmed with
``git merge-base --is-ancestor`` to contain the empty-closing cut and not the
speculative one.

That yields a controlled comparison inside a single cohort: **the check with a
cut fires 0 of 5; the check with none fired 2 of 5.** After both cuts run, no
check fires at all on that cohort (26 paragraphs → 24).

So the six quiet checks are advisory and correctly so, and this file records
that rather than leaving the next run to re-derive it.

THE INVARIANTS
--------------
1. Every check can fire. A rate of zero is only evidence when the alternative —
   that nothing calls it — has been excluded, and those two look identical.
2. Exactly two cuts exist, and the set of faults they remove is asserted as an
   equality rather than a subtraction, so a third cut forces this list to be
   updated instead of the number quietly going up.
"""

from __future__ import annotations

import inspect
import types

import pytest

from newsroom.pipeline import house_style as hs


#: One known positive per check, built FROM the module's own constants wherever
#: there is a list, so a control cannot drift away from the rule it proves
#: reachable. A hand-written copy of a banned phrase is a second list that is
#: free to disagree with the first.
CONTROLS: dict[str, tuple[str, str]] = {
    "em_dash": (f"Prices rose {hs.EM_DASH} sharply in June.", "em dash used"),
    "too_many_dashes": (
        f" {hs.EN_DASH} ".join(["a"] * (hs.MAX_DASHES_PER_ARTICLE + 2)),
        "dashes; commas",
    ),
    "journalese": (f"The minister {hs.JOURNALESE[0]} the plan.", "journalese,"),
    "generated_tells": (
        f"Let us {hs.GENERATED_TELLS[0]} the figures.", "reads as unedited,"
    ),
    "empty_hedges": (f"The rise {hs.EMPTY_HEDGES[0]} demand.", "says nothing,"),
    "empty_closing_phrase": (
        f"The next report {hs.EMPTY_CLOSINGS[0]}.", "empty closing,"
    ),
    # SPECULATIVE_IMPACT is regexes rather than phrases, so the control is
    # assembled from the affected-group vocabulary the pattern itself uses.
    "speculative_impact": (
        f"This decline impacts the {hs._AFFECTED.split('|')[0]}.",
        "speculates about consequences",
    ),
    # The sentence that published. Quoted verbatim rather than reduced,
    # because the point of this control is that the shape reached a reader.
    "unreadable_scale": (
        "Latvia recorded 4653 thousand rail passengers in 2026-Q1.",
        "makes the reader do the arithmetic",
    ),
}

#: Raised by ``closing_problems`` rather than ``check_prose``, and only ever
#: applied to the paragraph a piece ends on.
CLOSING_CONTROL = "The next release will provide further insight into the trend."

LEAD = "Unemployment fell to 6.6% in June, compared with 7.1% a year earlier."
TAIL = "Latvia stood at 6.9% in the same period."


def article_of(*texts):
    return types.SimpleNamespace(
        headline="Estonian unemployment fell to 6.6% in June",
        dek=None,
        body=[
            types.SimpleNamespace(type="paragraph", text=t, figures=[], chart_ref=None)
            for t in texts
        ],
    )


def surviving(article):
    return [b.text for b in article.body if b.type == "paragraph"]


def removed_from(*texts):
    """Which controls a final-attempt pass deletes, in this arrangement."""
    gone = set()
    for name, (control, _) in list(CONTROLS.items()) + [
        ("closing_structural", (CLOSING_CONTROL, ""))
    ]:
        article = article_of(*[t if t is not None else control for t in texts])
        hs.apply_house_style(
            article, cut_empty_closings=True, cut_speculative_impact=True
        )
        if control not in surviving(article):
            gone.add(name)
    return gone


class TestEveryCheckCanFire:
    """A rate of zero means nothing until this passes."""

    @pytest.mark.parametrize("name", sorted(CONTROLS))
    def test_the_control_raises_its_own_check(self, name):
        control, expected = CONTROLS[name]

        problems = hs.check_prose(control)

        assert any(expected in p for p in problems), (
            f"{name} did not fire on its own known positive, so a zero rate for "
            f"it in published output says nothing about the output"
        )

    def test_the_closing_check_can_fire(self):
        assert hs.closing_problems(CLOSING_CONTROL)

    @pytest.mark.parametrize("name", sorted(CONTROLS))
    def test_apply_house_style_actually_reaches_it(self, name):
        # Firing in isolation is not enough: a check nothing calls is
        # indistinguishable from a clean corpus, which is the shape this whole
        # audit was about.
        control, expected = CONTROLS[name]
        article = article_of(LEAD, control)

        report = hs.apply_house_style(article)

        assert any(expected in v for v in report.violations)

    def test_honest_prose_fires_nothing(self):
        # The negative control for all of the above. Without it, a check that
        # fired on everything would pass every test in this class.
        article = article_of(LEAD, TAIL)

        report = hs.apply_house_style(article)

        assert report.violations == []


class TestTheRegistryCoversEveryCheck:
    def test_no_check_prose_violation_is_unregistered(self):
        # Enumerates the subject rather than a copy of it: a check added to
        # ``check_prose`` without a control here changes this count and fails,
        # instead of being silently unproven.
        appends = inspect.getsource(hs.check_prose).count("problems.append(")

        assert appends == len(CONTROLS), (
            f"check_prose raises {appends} kinds of violation but {len(CONTROLS)} "
            f"are registered here. Add a known positive for the new one, or a "
            f"zero rate for it in published output will mean nothing."
        )

    def test_the_closing_check_raises_exactly_one(self):
        # Counting message templates, not ``return`` statements: this function
        # returns early four times to say "this closing is legitimate", and
        # those are not violations.
        source = inspect.getsource(hs.closing_problems)

        assert source.count('f"{where}:') == 1


class TestWhichChecksAreCut:
    """Stated as equalities, so a third cut cannot be added silently."""

    def test_only_two_cuts_exist(self):
        flags = {
            name
            for name in inspect.signature(hs.apply_house_style).parameters
            if name.startswith("cut_")
        }

        assert flags == {"cut_empty_closings", "cut_speculative_impact"}

    def test_mid_article_only_the_speculative_paragraph_is_cut(self):
        # The empty-closing cut is positional — it only ever considers the last
        # paragraph — so a forward-looking sentence in the middle of a piece is
        # ordinary reporting and stays.
        assert removed_from(LEAD, None, TAIL) == {"speculative_impact"}

    def test_as_a_final_paragraph_the_closing_faults_are_cut_too(self):
        assert removed_from(LEAD, None) == {
            "closing_structural",
            "empty_closing_phrase",
            "speculative_impact",
        }

    def test_everything_else_is_advisory(self):
        # The complement, asserted rather than implied. These six are reported
        # to the writer and to the desk and are never removed, which is correct:
        # each is a low-frequency judgement, and none of them fired at all on
        # the cohort whose producing revision is known.
        #
        # ``unreadable_scale`` is deliberately here rather than among the cuts.
        # The paragraph is not wrong — the figure is correct and traces to the
        # source — it is written at a scale a reader must convert, which one
        # rewritten clause fixes. Deleting a true paragraph over a rendering
        # fault would cost more than the fault does.
        every = set(CONTROLS) | {"closing_structural"}

        advisory = every - removed_from(LEAD, None)

        assert advisory == {
            "em_dash",
            "too_many_dashes",
            "journalese",
            "generated_tells",
            "empty_hedges",
            "unreadable_scale",
        }

    def test_the_speculative_cut_leaves_no_note_naming_removed_prose(self):
        control, expected = CONTROLS["speculative_impact"]
        article = article_of(LEAD, control)

        report = hs.apply_house_style(
            article, cut_empty_closings=True, cut_speculative_impact=True
        )

        assert report.cuts
        assert not any(expected in v for v in report.violations)

    def test_the_empty_closing_cut_still_leaves_one(self):
        """A known asymmetry between the two cuts, pinned rather than fixed.

        ``_cut_empty_closings`` runs *after* the per-block scan, so the
        vocabulary hit for the paragraph it removes stays in ``violations`` and
        reaches the desk naming ``body[1]`` — prose that no longer exists.
        ``_cut_speculative_impact`` runs before the scan and does not have this.

        It is asserted rather than described so that fixing it turns this test
        red and forces the note to be deleted. An exemption written as a filter
        would go on passing once it stopped matching anything.
        """
        control, expected = CONTROLS["empty_closing_phrase"]
        article = article_of(LEAD, control)

        report = hs.apply_house_style(
            article, cut_empty_closings=True, cut_speculative_impact=True
        )

        assert report.cuts
        assert any(expected in v for v in report.violations), (
            "the asymmetry is fixed — move this control into "
            "test_the_speculative_cut_leaves_no_note_naming_removed_prose"
        )
