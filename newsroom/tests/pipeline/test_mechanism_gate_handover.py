"""The figure exemption is wider than the rule ``no_unsupported_mechanism`` states.

A HANDOVER, PINNED AS ASSERTIONS RATHER THAN PROSE
---------------------------------------------------
``check_no_unsupported_mechanism``'s docstring says the test is *whether the
thing attributed to is present in the piece's own figures*. The implementation
asks only whether **any** figure is present. This file executes that difference
so the note beside the check is a claim someone can run, not a paragraph that
rots.

The check itself is **not** loosened by anything here, and was measured before
being left alone:

===================================================  ===================
live drafts refused                                   4 of 14, twice
of those refusals, genuinely unsupported              9 of 9
published corpus, provable-revision cohort            1 of 7
attributions inside figure-carrying paragraphs       42
... naming an unobserved property                     1, and it was honest
===================================================  ===================

So the gate has no false positives today and the hole is not being walked
through. Closing it means testing a noun phrase against a set of field names,
which carries false-positive risk the numeric test does not — and a false
positive here costs an article. That is the next brief, not a change made at
the end of a long run.
"""

from __future__ import annotations

from newsroom.validator import ValidationContext, check_no_unsupported_mechanism

#: The sentence a weekly wrap published and was retracted within the hour for.
#: Verbatim from the check's own docstring.
RETRACTED = (
    "This increase in container throughput is significant for Lithuania's "
    "maritime sector, reflecting the growing capacity and efficiency of its "
    "ports."
)

#: A figure for THROUGHPUT — not for capacity, and not for efficiency.
A_THROUGHPUT_FIGURE = [{"value": 1175.0, "signal_field": "latest_value"}]


def verdict(text, figures=None):
    article = {
        "id": "01J0000000000000000000TEST",
        "tier": "A",
        "headline": "A heading",
        "dek": "",
        "body": [{"type": "paragraph", "text": text, "figures": figures or []}],
    }
    return check_no_unsupported_mechanism(
        ValidationContext(article=article, registry=None, personas=None)
    )


class TestTheGapIsRealAndDemonstrable:
    def test_the_retracted_sentence_is_refused_when_it_carries_no_figure(self):
        assert not verdict(RETRACTED).passed

    def test_and_passes_beside_a_figure_for_something_else(self):
        """The handover, in one assertion.

        The paragraph explains *capacity and efficiency* and declares a figure
        for *throughput*. Declaring a figure does not make the attributed thing
        present; it only makes the paragraph ineligible for this gate.

        This test asserts the CURRENT behaviour, so whoever closes the gap gets
        a red test telling them where the note is — rather than a passing suite
        and a paragraph of prose they may never read.
        """
        assert verdict(RETRACTED, A_THROUGHPUT_FIGURE).passed, (
            "the figure exemption has been narrowed — good. Update the "
            "handover in check_no_unsupported_mechanism's docstring and delete "
            "this test."
        )


class TestTheCheckItselfIsSound:
    """Measured, not assumed. These are why it was left alone."""

    def test_it_refuses_an_invented_driver(self):
        assert not verdict("The rise is driven by stronger demand across the region.").passed

    def test_it_refuses_an_invented_consequence(self):
        assert not verdict("The decline could dampen investment in the sector.").passed

    def test_it_allows_an_honest_refusal(self):
        assert verdict("The data does not show what drove the change.").passed

    def test_it_allows_an_attributed_cause(self):
        assert verdict(
            "According to Latvijas Banka, the fall is driven by the tariff change."
        ).passed


class TestThePromptAndTheCheckAgree:
    """An example in guidance is a claim about behaviour. Execute it.

    The recurring failure — a freight VOLUME described as "capacity" — is
    already named in ``write/prompts.py``, verbatim and with that noun, and the
    writer produces it anyway in 4 of 9 sampled refusals. Restating it a fourth
    time is the strategy ``house_style`` records failing three times, so the
    prompt was left alone too. These assertions are what make that defensible:
    the guidance is honest as well as present.
    """

    def test_the_rejected_example_really_is_rejected(self):
        from newsroom.pipeline.safety import persona_for_section
        from newsroom.pipeline.write.prompts import build_system_prompt
        from newsroom.tests.pipeline.conftest import make_signal

        example = "the rise reflects growing capacity at its ports"
        prompt = " ".join(
            build_system_prompt(make_signal(), persona_for_section("economy")).split()
        )

        assert example in prompt
        assert not verdict(example).passed

    def test_the_allowed_examples_really_are_allowed(self):
        assert verdict("the ministry attributes it to the tariff change").passed
        assert verdict("the data does not show what drove the change").passed
