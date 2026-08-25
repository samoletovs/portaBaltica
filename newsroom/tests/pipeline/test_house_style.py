"""House style is enforced, not suggested.

A rule that lives only in a prompt is followed most of the time. These tests
exist so the rules are facts about what can be published.

Every case here is drawn from copy that actually shipped, so the fixtures are
the real defects rather than invented ones.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.house_style import (
    EM_DASH,
    EN_DASH,
    check_prose,
    review_headline,
    sentence_case,
)


class TestSentenceCase:
    def test_fixes_the_headline_that_shipped(self) -> None:
        # This ran on the front page.
        assert sentence_case("Estonia's Unemployment Rate Declines to 6.6% in June 2026") == (
            "Estonia's unemployment rate declines to 6.6% in June 2026"
        )

    def test_keeps_the_country_capitalised(self) -> None:
        assert sentence_case("Latvian Wage Growth Outpaced Inflation Again").startswith("Latvian")

    def test_leaves_a_sentence_case_headline_alone(self) -> None:
        original = "Estonian day-ahead prices went negative for six hours on Sunday"

        assert sentence_case(original) == original

    def test_never_alters_a_figure(self) -> None:
        # Numbers belong to the validator. If this module can touch one, the
        # traceability guarantee is gone.
        headline = "Coal Through Riga Fell 12.4% To 1.9M Tonnes In June 2026"

        result = sentence_case(headline)

        for token in ("12.4%", "1.9M", "2026"):
            assert token in result, f"{token} was altered by sentence casing"

    def test_preserves_acronyms(self) -> None:
        result = sentence_case("Latvian GDP Growth Slows While HICP Inflation Holds Steady")

        assert "GDP" in result
        assert "HICP" in result

    def test_preserves_months_and_places(self) -> None:
        result = sentence_case("Riga Port Volumes Recovered Through August And September")

        assert "Riga" in result
        assert "August" in result
        assert "September" in result

    @pytest.mark.parametrize(
        "short",
        ["Inflation slows", "GDP falls again", "Riga port reopens"],
    )
    def test_leaves_short_headlines_alone(self, short: str) -> None:
        assert sentence_case(short) == short


class TestDashes:
    def test_rejects_the_em_dash(self) -> None:
        # The single strongest surface signal of unedited generated copy.
        problems = check_prose(f"Unemployment fell {EM_DASH} the lowest since 2019.")

        assert any("em dash" in p for p in problems)

    def test_accepts_one_en_dash(self) -> None:
        assert check_prose(f"Unemployment fell {EN_DASH} its lowest since 2019.") == []

    def test_rejects_prose_that_dashes_about(self) -> None:
        text = (
            f"Prices rose {EN_DASH} sharply {EN_DASH} in June, and wages {EN_DASH} "
            f"which lag {EN_DASH} did not."
        )

        problems = check_prose(text)

        assert any("dashes" in p for p in problems)


class TestRegister:
    @pytest.mark.parametrize("phrase", ["slammed", "dubbed", "sparked", "hit out at"])
    def test_rejects_journalese(self, phrase: str) -> None:
        problems = check_prose(f"The minister {phrase} the proposal.")

        assert any("journalese" in p for p in problems)

    @pytest.mark.parametrize(
        "phrase",
        ["It is worth noting", "Moreover", "a testament to", "various factors"],
    )
    def test_rejects_the_generated_register(self, phrase: str) -> None:
        problems = check_prose(f"{phrase} that the rate declined.")

        assert any("unedited" in p for p in problems)

    def test_rejects_hedges_that_say_nothing(self) -> None:
        # Straight from the article on the site: "This shift may be attributed
        # to various factors, including seasonal employment trends."
        problems = check_prose(
            "This shift may be attributed to various factors, including seasonal trends."
        )

        assert problems, "the vaguest sentence on the site passed the style check"

    @pytest.mark.parametrize(
        "sentence",
        [
            # Every one of these is a cause that names nothing, and every one
            # came from a draft the editor sent back for "vague assertions
            # about causation". The prompt asks the writer to avoid them; this
            # makes it deterministic rather than a request.
            "The spread widened on market dynamics.",
            "The rise stems from underlying pressures in the labour market.",
            "The fall reflects broader economic conditions.",
            "The change follows broader trends across the region.",
            "The increase is driven by a range of factors.",
            "The drop is the result of several factors.",
        ],
    )
    def test_rejects_causes_that_name_nothing(self, sentence: str) -> None:
        assert check_prose(sentence), f"empty causal phrase passed the style check: {sentence!r}"

    def test_saying_the_data_does_not_show_a_cause_is_publishable(self) -> None:
        # The honest alternative must not itself be flagged, or the writer has
        # nowhere to go and hedges again.
        assert not check_prose("The data does not show what drove the change.")

    def test_passes_clean_wire_copy(self) -> None:
        clean = (
            "Estonian unemployment fell to 6.6% in June, from 7.1% in the same month "
            "a year earlier. It is the lowest June reading since 2019."
        )

        assert check_prose(clean) == []


class TestReviewHeadline:
    def test_returns_the_correction_it_made(self) -> None:
        fixed, violations, corrections = review_headline(
            "Estonia's Unemployment Rate Declines to 6.6% in June 2026"
        )

        assert fixed == "Estonia's unemployment rate declines to 6.6% in June 2026"
        assert corrections, "a silent correction leaves no audit trail"
        assert violations == []

    def test_strips_a_trailing_full_stop(self) -> None:
        fixed, _, corrections = review_headline("Inflation slows in Latvia.")

        assert fixed == "Inflation slows in Latvia"
        assert corrections

    def test_reports_journalese_in_a_headline(self) -> None:
        _, violations, _ = review_headline("Minister slammed over budget")

        assert any("journalese" in v for v in violations)
