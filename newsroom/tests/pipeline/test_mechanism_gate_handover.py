"""Regression for the former blanket figure and named-source exemptions."""

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


class TestTheFigureExemptionIsClosed:
    def test_the_retracted_sentence_is_refused_when_it_carries_no_figure(self):
        assert not verdict(RETRACTED).passed

    def test_an_unrelated_throughput_figure_does_not_prove_capacity(self):
        assert not verdict(RETRACTED, A_THROUGHPUT_FIGURE).passed


class TestTheCheckItselfIsSound:
    """Measured, not assumed. These are why it was left alone."""

    def test_it_refuses_an_invented_driver(self):
        assert not verdict("The rise is driven by stronger demand across the region.").passed

    def test_it_refuses_an_invented_consequence(self):
        assert not verdict("The decline could dampen investment in the sector.").passed

    def test_it_allows_an_honest_refusal(self):
        assert verdict("The data does not show what drove the change.").passed

    def test_it_requires_evidence_for_an_attributed_cause(self):
        assert not verdict(
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
        assert not verdict("the ministry attributes it to the tariff change").passed
        assert verdict("the data does not show what drove the change").passed
