"""Positive fixtures: clean articles must clear every gate.

These exist to keep the rejection tests honest. If the control condition did not
pass, a rejection test would prove nothing — the validator could be rejecting
everything.
"""

from __future__ import annotations

from typing import Any

from newsroom.validator import (
    CHECK_NAMES,
    assert_servable,
    is_servable,
    stamp_verdict,
    validate_article,
)

from .conftest import assert_all_passed


def test_should_accept_a_fully_traceable_tier_a_article(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    verdict = validate(tier_a_article, signal=signal)

    assert_all_passed(verdict)
    assert len(verdict.checks) == len(CHECK_NAMES)


def test_should_accept_a_later_unquantified_reference_to_an_established_change(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """Prose an editor would actually pass.

    The first block quantifies the move and names the basis. A later paragraph
    then refers back to "the decline" without restating "compared with a year
    earlier" — because repeating the basis in every paragraph is how you write
    a spreadsheet, not an article, and because a sentence carrying no figure
    cannot mislead the reader about what it is measured against.

    This is the shape the model kept producing and the validator kept
    rejecting, which is why a production run published nothing.
    """
    tier_a_article["body"][1]["text"] = "The decline was broad-based across the region."
    tier_a_article["body"][1]["figures"] = []

    verdict = validate(tier_a_article, signal=signal)

    assert_all_passed(verdict)


def test_should_accept_a_verbatim_tier_c_link_out_card(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_all_passed(verdict)


def test_should_accept_a_verbatim_tier_b_press_release(
    tier_b_article: dict[str, Any], ec_raw_item: dict[str, Any], validate
) -> None:
    verdict = validate(tier_b_article, raw_feed_item=ec_raw_item)

    assert_all_passed(verdict)


def test_should_report_every_check_named_in_the_schema(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    verdict = validate(tier_a_article, signal=signal)

    assert tuple(check.name for check in verdict.checks) == CHECK_NAMES


def test_should_accept_a_correctly_rounded_rendering_of_a_traceable_figure(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The signal carries 142.5; the prose may render it "143" at zero decimals.
    signal["payload"]["price"]["latest"] = 142.5
    tier_a_article["body"][0]["text"] = (
        "Latvian day-ahead electricity settled at 143 euros per megawatt-hour, "
        "12.0% higher than the same day a year earlier, when it cleared at 127.2 euros."
    )
    tier_a_article["dek"] = (
        "The day-ahead average reached 143 euros per megawatt-hour, "
        "12.0% higher than the same day a year earlier."
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_all_passed(verdict)


def test_should_accept_a_figure_rendered_with_a_scale_word(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    signal["payload"]["allocation"] = 1_200_000_000.0
    tier_a_article["section"] = "government"
    tier_a_article["persona"] = {
        "id": "irbene",
        "name": "Rasa Petrauskaitė",
        "beat": "Government, EU & Society",
        "byline": "Rasa Petrauskaitė · AI correspondent, Government, EU & Society",
    }
    tier_a_article["headline"] = "Baltic grid allocation reaches EUR 1.2 billion"
    tier_a_article["dek"] = "The committed allocation is €1.2 billion, against nothing a decade earlier."
    tier_a_article["body"] = [
        {
            "type": "paragraph",
            "text": (
                "The instrument commits €1.2 billion, higher than the same programme "
                "a year earlier."
            ),
            "figures": [
                {"value": 1_200_000_000.0, "unit": "EUR", "signal_field": "allocation"}
            ],
        }
    ]

    verdict = validate(tier_a_article, signal=signal)

    assert_all_passed(verdict)


# ── the render-time gate ────────────────────────────────────────────────


def test_should_treat_an_article_with_a_passing_stamped_verdict_as_servable(
    tier_a_article: dict[str, Any], signal: dict[str, Any], registry, personas
) -> None:
    verdict = validate_article(
        tier_a_article, registry=registry, personas=personas, signal=signal
    )
    stamp_verdict(tier_a_article, verdict)

    assert is_servable(tier_a_article) is True
    assert_servable(tier_a_article)


def test_should_stamp_a_verdict_shaped_like_the_schema(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    verdict = validate(tier_a_article, signal=signal)
    payload = verdict.to_dict()

    assert set(payload) == {"passed", "checked_at", "checks"}
    assert payload["checked_at"].endswith("Z")
    assert all(set(check) <= {"name", "passed", "detail"} for check in payload["checks"])
