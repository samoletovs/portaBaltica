"""The desk asked for a cut 17 times. Nothing ever performed it.

WHY THIS EXISTS
---------------
Measured over all 25 published tier A originals:

- **13 of 25** carry a paragraph this repo's own ``SPECULATIVE_IMPACT`` matches
  — "impacts logistics companies", "directly impacts consumers", "impacts
  employers", "impacts manufacturers" — and every one of them published.
- **17 of 17** of the desk's "ran as filed" approvals name that paragraph, and
  ``desk.py`` instructs the desk to say *"A speculative impact paragraph is a
  CUT, not a rewrite"* and approve with that note.
- `MAX_REVISIONS = 1`, and 23 of 24 articles spent their single revision.

So the fault consumed the generator's retry budget **and** the desk's single
revision, and published anyway. ``generator.py`` says why in terms: *"house
style is an editor, not a gate"*, so a validated article publishes once its
attempts run out, style faults and all.

WHAT WAS NOT THE PROBLEM
------------------------
Not the prompt. It already tells the writer, in capitals, that "THIS PARAGRAPH
SHOULD NOT EXIST — write the piece without it", and the plan says to skip any
paragraph "for which you were given nothing". A fourth restatement would be the
strategy ``house_style`` records failing three times: a blacklist beaten by
paraphrase in 10 of 10, a structural check the model beat by swapping WILL for
WOULD in 3 of 3, and revised guidance.

Not the causal panel either. It answers *why a thing happened*; this paragraph
asks *whose money it is*. Routing one into the other would answer a different
question from the one being asked.

The gap was that ``house_style`` already contains the right answer for the
*other* fault it cuts — "ASK FIRST, THEN CUT ... a check the model can outlast
is bounded by the retry budget rather than by its own correctness" — and that
sentence was never applied to the larger fault sitting beside it. The correct
sibling is what made the broken one hard to see.

THE INVARIANT
-------------
On the final attempt, a figure-free paragraph that speculates about
consequences is removed rather than published with a note asking someone to
remove it. Nothing else is touched.
"""

from __future__ import annotations

import json
import types

import pytest

from newsroom.pipeline.house_style import (
    apply_house_style,
    check_prose,
    speculative_impact_phrase,
)
from newsroom.pipeline.write.generator import generate_article
from newsroom.pipeline.write.llm import StubWriter
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.tests.pipeline.test_rejection_causes import GOOD_PAYLOAD


#: Verbatim from articles this wire published. These are the artefact, not a
#: reconstruction of it, and each is the paragraph the desk asked to have cut.
PUBLISHED_OFFENDERS = [
    "This widening gap in road freight logistics primarily impacts logistics "
    "companies and the transport sector, as they navigate these changing "
    "dynamics in regional trade.",
    "This low inflation rate directly impacts consumers, as it suggests more "
    "stable prices for goods and services, potentially leading to increased "
    "purchasing power.",
    "This increase in hourly labour cost impacts employers, as higher costs "
    "can affect their pricing strategies and competitiveness in the market.",
    "This decline impacts manufacturers, as lower prices may lead to reduced "
    "margins.",
    "This price increase impacts energy consumers and businesses alike.",
]


def paragraph(text, figures=()):
    return types.SimpleNamespace(
        type="paragraph", text=text, figures=list(figures), chart_ref=None
    )


def article_of(*blocks, headline="Estonian unemployment fell to 6.6% in June"):
    return types.SimpleNamespace(headline=headline, dek=None, body=list(blocks))


def prose_of(article):
    return [b.text for b in article.body if b.type == "paragraph"]


LEAD = "Estonian unemployment fell to 6.6% in June, compared with 7.1% a year earlier."
PLAIN = "Latvia stood at 6.9% and Lithuania at 7.4% in the same period."


class TestThePublishedParagraphsAreCut:
    @pytest.mark.parametrize("offender", PUBLISHED_OFFENDERS)
    def test_a_published_offender_is_removed_on_the_final_attempt(self, offender):
        article = article_of(paragraph(LEAD), paragraph(PLAIN), paragraph(offender))

        report = apply_house_style(article, cut_speculative_impact=True)

        assert offender not in prose_of(article)
        assert len(report.cuts) == 1
        assert prose_of(article) == [LEAD, PLAIN]

    @pytest.mark.parametrize("offender", PUBLISHED_OFFENDERS)
    def test_the_probe_can_see_it_in_the_first_place(self, offender):
        # An assertion that something is absent needs a companion proving it
        # could have been present. Without this, the test above would pass on
        # prose that never tripped the check at all.
        assert speculative_impact_phrase(offender) is not None


class TestAskFirstThenCut:
    """The cut is the floor, not the policy — the shape empty closings use."""

    def test_it_is_handed_back_while_an_attempt_remains(self):
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {"text": PUBLISHED_OFFENDERS[0], "figures": []}
        clean = json.loads(json.dumps(GOOD_PAYLOAD))
        clean["blocks"][-1] = {
            "text": "The next monthly release is what would overturn it.",
            "figures": [],
        }
        writer = StubWriter([payload, clean])

        result = generate_article(make_signal(), writer)

        # Asked, not cut: the writer fixed it, and a real paragraph beats none.
        assert "speculates about consequences" in writer.calls[1]["user"]
        assert result.publishable
        texts = [b.text for b in result.article.body if b.type == "paragraph"]
        assert any("overturn it" in (t or "") for t in texts)

    def test_it_is_cut_when_the_writer_never_converges(self):
        # The published case: the model repeats the fault, the attempts run
        # out, and before this change the paragraph went to the reader with a
        # desk note saying it should not have.
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {"text": PUBLISHED_OFFENDERS[0], "figures": []}
        writer = StubWriter([payload])

        result = generate_article(make_signal(), writer)

        texts = [b.text for b in result.article.body if b.type == "paragraph"]
        assert PUBLISHED_OFFENDERS[0] not in texts
        assert result.publishable, "cutting prose must not cost us the article"

    def test_the_cut_paragraph_is_not_also_reported_to_the_desk(self):
        # A note naming prose that no longer exists is the dishonest artefact
        # ``_revalidate`` exists to prevent one layer out. It also reads to the
        # desk as an unfixed fault, which is how a clean article gets held.
        article = article_of(paragraph(LEAD), paragraph(PUBLISHED_OFFENDERS[1]))

        report = apply_house_style(article, cut_speculative_impact=True)

        assert report.cuts
        assert not any("speculates about consequences" in v for v in report.violations)


class TestWhatItMustNotTouch:
    def test_it_never_cuts_the_lead(self):
        # Measured: 0 of the 14 offending published paragraphs was the lead.
        # The lead carries the finding, and an article without it is not a
        # shorter article, it is a different one.
        article = article_of(paragraph(PUBLISHED_OFFENDERS[0]), paragraph(PLAIN))

        report = apply_house_style(article, cut_speculative_impact=True)

        assert PUBLISHED_OFFENDERS[0] in prose_of(article)
        assert report.cuts == []
        assert any("speculates about consequences" in v for v in report.violations)

    def test_it_never_cuts_a_paragraph_carrying_a_figure(self):
        # 2 of the 14 did. Cutting those withdraws a verified claim and deletes
        # real work, so they are left for the desk, which is the right place
        # for a judgement about whether the sentence or the figure is the point.
        offender = paragraph(
            "The cumulative change of 11.9 EUR per hour affects employers.",
            figures=[{"value": 11.9, "signal_field": "cumulative_change"}],
        )
        article = article_of(paragraph(LEAD), offender)

        report = apply_house_style(article, cut_speculative_impact=True)

        assert offender.text in prose_of(article)
        assert report.cuts == []
        assert any("speculates about consequences" in v for v in report.violations)

    def test_it_never_empties_the_article(self):
        # An article that is nothing but speculation is a generation failure,
        # not a copy-editing one, and must reach the validator looking like it.
        article = article_of(paragraph(PUBLISHED_OFFENDERS[0]))

        report = apply_house_style(article, cut_speculative_impact=True)

        assert prose_of(article) == [PUBLISHED_OFFENDERS[0]]
        assert report.cuts == []

    def test_it_leaves_honest_prose_alone(self):
        # The negative control. A rule that eats legitimate prose costs more
        # than the fault it fixes.
        honest = (
            "This is what an Estonian employer pays for an hour of work, "
            "before any of it reaches a worker's bank account."
        )
        article = article_of(paragraph(LEAD), paragraph(honest))

        report = apply_house_style(article, cut_speculative_impact=True)

        assert prose_of(article) == [LEAD, honest]
        assert report.cuts == []

    def test_nothing_is_cut_unless_the_caller_asks(self):
        # Default off, so the desk-time pass in ``run.py`` still reports rather
        # than silently editing an article it is only meant to read.
        article = article_of(paragraph(LEAD), paragraph(PUBLISHED_OFFENDERS[0]))

        report = apply_house_style(article)

        assert PUBLISHED_OFFENDERS[0] in prose_of(article)
        assert report.cuts == []


class TestOneImplementation:
    def test_the_report_and_the_cut_agree_by_construction(self):
        # Two implementations of "what the fault is" would be free to disagree,
        # and the cut would then remove a paragraph the report did not name, or
        # leave one it did. ``check_prose`` and the cut both call this.
        for offender in PUBLISHED_OFFENDERS:
            phrase = speculative_impact_phrase(offender)
            problems = [
                p for p in check_prose(offender) if "speculates about consequences" in p
            ]

            assert phrase is not None
            assert problems, "check_prose disagrees with the cut about the fault"
            assert repr(phrase) in problems[0]

    def test_a_clean_sentence_yields_no_phrase(self):
        assert speculative_impact_phrase("Unemployment stood at 6.5% in June.") is None
