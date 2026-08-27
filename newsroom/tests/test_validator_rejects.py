"""Negative fixtures: input the validator MUST reject.

Written before the passing fixtures, on purpose. The failure mode this suite
exists to prevent is a green test that passes because the validator does
nothing, so every test here asserts a *named* check rejected the article — and
by default asserts it was the only check that fired, which means the fixture
isolates the behaviour rather than tripping some unrelated gate.

Each mutation starts from a clean article that
``test_validator_accepts.py`` proves passes every check.
"""

from __future__ import annotations

import copy
from typing import Any

from .conftest import assert_rejected_by

# ── figures_traceable ───────────────────────────────────────────────────


def test_should_reject_a_figure_whose_signal_field_does_not_resolve(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][0]["figures"][0]["signal_field"] = "price.imaginary_field"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_a_figure_that_has_drifted_from_the_source_value(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The prose and the declared figure agree with each other and disagree with
    # the source. Without this check, a model could move any number simply by
    # declaring the moved value.
    signal["payload"]["price"]["latest"] = 139.0

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_a_figure_rounded_to_a_different_number(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The boundary of what "traceable" permits. The article declares 142.5, so
    # it has committed to one decimal place, and one decimal place of 142.56 is
    # 142.6 -- a different number. Half a unit in the last place is the whole
    # allowance, and this is just outside it.
    signal["payload"]["price"]["latest"] = 142.56

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_a_figure_whose_extra_precision_changes_the_claim(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # Declaring more decimals commits to more precision, and is then held to it.
    # 142.55 rounds to 142.5 at one place and would pass as "142.5"; declared as
    # "142.51" it asserts a hundredth the source does not support.
    tier_a_article["body"][0]["figures"][0]["value"] = 142.51
    signal["payload"]["price"]["latest"] = 142.55

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_a_figure_with_no_signal_field_at_all(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    del tier_a_article["body"][0]["figures"][1]["signal_field"]

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_a_signal_field_resolving_to_something_non_numeric(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    signal["payload"]["price"]["latest"] = "142.5"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_when_no_signal_payload_is_supplied_to_verify_against(
    tier_a_article: dict[str, Any], validate
) -> None:
    # Fail closed: unverifiable is not the same as verified.
    verdict = validate(tier_a_article, signal=None)

    assert_rejected_by(verdict, "figures_traceable")


def test_should_reject_numeric_prose_that_declares_no_figures_at_all(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    for block in tier_a_article["body"]:
        del block["figures"]

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "figures_traceable", also={"no_invented_numbers"})


# ── no_invented_numbers ─────────────────────────────────────────────────


def test_should_reject_a_hallucinated_number_added_to_the_prose(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][0]["text"] += " Estonia settled at 118.3 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_a_number_that_drifted_from_its_declared_figure(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][0]["text"] = tier_a_article["body"][0]["text"].replace(
        "12.0% higher", "13.0% higher"
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_a_spelled_out_number_that_no_figure_supports(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # Writing the number as a word is the cheapest way past a digit-only scanner.
    tier_a_article["body"][0]["text"] = (
        "Prices climbed by three percent compared with the same day a year earlier."
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_an_unsupported_number_in_the_headline(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["headline"] = "Latvian power prices settle 19% above last summer"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_a_number_justified_only_by_a_different_blocks_figures(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # 303.5 is declared, but in the next block. A number justified three
    # paragraphs away is not justified where the reader meets it.
    tier_a_article["body"][0]["text"] += " The spread reached 303.5 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_an_unsupported_number_written_with_thousands_separators(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " Total volume reached 1,240,000 megawatt-hours."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_an_unsupported_negative_number(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " One hour cleared at -4.8 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


def test_should_reject_an_unsupported_endpoint_of_a_range(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The low endpoint is declared; the high one is invented.
    tier_a_article["body"][1]["text"] += " Hourly prices ran between 8.4 and 402.6 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_invented_numbers")


# ── snippet_verbatim ────────────────────────────────────────────────────


def test_should_reject_a_snippet_altered_by_a_single_character(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["syndicated"]["snippet"] = lsm_raw_item["description"].replace(
        "4.2%", "4.3%"
    )

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_snippet_differing_only_by_trailing_whitespace(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["syndicated"]["snippet"] = lsm_raw_item["description"] + " "

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_snippet_the_ingester_did_not_assert_as_verbatim(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["syndicated"]["snippet_is_verbatim"] = False

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_tier_c_card_with_no_raw_feed_item_to_check_against(
    tier_c_article: dict[str, Any], validate
) -> None:
    # Fail closed: we cannot prove it is verbatim, so it is not servable.
    verdict = validate(tier_c_article, raw_feed_item=None)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_tier_c_card_carrying_the_full_article_text(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    # Ingesting content:encoded would be republication of a whole copyrighted work.
    tier_c_article["syndicated"]["full_text"] = "The full body of the LSM article."

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_snippet_taken_from_the_article_body_rather_than_the_feed(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["syndicated"]["snippet"] = (
        "Cargo handled at the Freeport of Riga fell 4.2% in July compared with a year "
        "earlier, port statistics show. The decline was driven by lower coal volumes, "
        "which have fallen every month since the start of the year."
    )

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


def test_should_reject_a_tier_c_card_with_no_snippet_at_all(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    del tier_c_article["syndicated"]["snippet"]

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "snippet_verbatim")


# ── no_rewrite_of_restricted_source ─────────────────────────────────────


def test_should_reject_generated_prose_attached_to_a_restricted_source(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["body"] = [
        {
            "type": "paragraph",
            "text": "Cargo volumes at the Freeport of Riga were the subject of the report.",
        }
    ]

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_a_rewritten_headline_on_a_restricted_source(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    # Synonymising a headline is exactly the "automated transformation" Google's
    # scaled content abuse policy names.
    tier_c_article["headline"] = "Riga harbour freight volumes decline during July"

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_a_dek_written_for_a_restricted_source(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["dek"] = "What the latest port statistics mean for Latvian exporters."

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_a_restricted_source_article_that_records_a_generating_model(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["provenance"]["model"] = "gpt-4o-mini@2024-07-18"

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_original_journalism_that_cites_a_restricted_source(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["provenance"]["sources"].append(
        {"source_id": "lsm_en", "retrieved_at": "2026-08-24T13:00:00Z"}
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_generated_prose_attached_to_a_tier_b_press_release(
    tier_b_article: dict[str, Any], ec_raw_item: dict[str, Any], validate
) -> None:
    tier_b_article["body"] = [
        {"type": "paragraph", "text": "The Commission's decision follows a formal notification."}
    ]

    verdict = validate(tier_b_article, raw_feed_item=ec_raw_item)

    assert_rejected_by(verdict, "no_rewrite_of_restricted_source")


def test_should_reject_an_article_citing_a_source_that_is_not_registered(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["provenance"]["sources"][0]["source_id"] = "some_scraped_blog"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(
        verdict, "no_rewrite_of_restricted_source", also={"attribution_present"}
    )


def test_should_reject_an_article_that_cites_no_source_at_all(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["provenance"]["sources"] = []

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(
        verdict, "no_rewrite_of_restricted_source", also={"attribution_present"}
    )


# ── byline_discloses_ai ─────────────────────────────────────────────────


def test_should_reject_a_byline_missing_the_ai_disclosure(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["persona"]["byline"] = "Marek Akmeņrags · Energy correspondent"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "byline_discloses_ai")


def test_should_reject_original_journalism_with_no_byline_at_all(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    del tier_a_article["persona"]

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "byline_discloses_ai")


def test_should_reject_a_byline_naming_a_correspondent_that_does_not_exist(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["persona"]["id"] = "marta"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "byline_discloses_ai")


def test_should_reject_a_human_sounding_byline_even_when_it_discloses_ai(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The Sports Illustrated failure mode. The disclosure token is present, but
    # the name imitates a staff journalist, so it is not the canonical byline.
    tier_a_article["persona"]["byline"] = "Marta Ozola · AI correspondent, Energy & Markets"

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "byline_discloses_ai")


def test_should_reject_a_byline_on_work_we_did_not_write(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["persona"] = {
        "id": "kolka",
        "name": "Gintaras Kolka",
        "beat": "Maritime & Trade",
        "byline": "Gintaras Kolka · AI correspondent, Maritime & Trade",
    }

    verdict = validate(
        tier_c_article,
        raw_feed_item=lsm_raw_item,
    )

    assert_rejected_by(
        verdict, "byline_discloses_ai", also={"no_rewrite_of_restricted_source"}
    )


# ── no_lived_experience_claims ──────────────────────────────────────────


def test_should_reject_a_claim_of_having_visited_somewhere(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " I visited the terminal at Ventspils."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


def test_should_reject_a_claim_of_having_interviewed_someone(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " We spoke to the transmission operator."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


def test_should_reject_a_correspondent_named_as_the_actor_of_a_physical_verb(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # Third person makes it no less false: a lighthouse attended nothing.
    tier_a_article["body"][1]["text"] += " Marek Akmeņrags attended the auction in Tallinn."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


def test_should_reject_a_claim_of_unnamed_human_sources(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " Sources told us the auction cleared early."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


def test_should_reject_a_lived_experience_claim_made_in_the_dek(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["dek"] = "Our correspondent visited the exchange floor to find out."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


def test_should_reject_a_claim_of_having_phoned_an_organisation(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] += " We phoned the regulator for comment."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_lived_experience_claims")


# ── attribution_present ─────────────────────────────────────────────────


def test_should_reject_a_link_out_card_with_no_attribution(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    del tier_c_article["syndicated"]["attribution"]

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "attribution_present")


def test_should_reject_an_attribution_that_does_not_match_the_registry(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    tier_c_article["syndicated"]["attribution"] = "Latvian media"

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "attribution_present")


def test_should_reject_a_link_out_card_with_no_link_back(
    tier_c_article: dict[str, Any], lsm_raw_item: dict[str, Any], validate
) -> None:
    del tier_c_article["syndicated"]["original_url"]

    verdict = validate(tier_c_article, raw_feed_item=lsm_raw_item)

    assert_rejected_by(verdict, "attribution_present")


def test_should_reject_a_press_release_with_the_wrong_attribution(
    tier_b_article: dict[str, Any], ec_raw_item: dict[str, Any], validate
) -> None:
    tier_b_article["syndicated"]["attribution"] = "Source: EU"

    verdict = validate(tier_b_article, raw_feed_item=ec_raw_item)

    assert_rejected_by(verdict, "attribution_present")


# ── comparison_basis_stated ─────────────────────────────────────────────


def test_should_reject_a_change_described_without_a_comparison_basis(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][0]["text"] = (
        "Latvian day-ahead electricity settled at 142.5 euros per megawatt-hour, 12.0% higher."
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "comparison_basis_stated")


def test_should_reject_a_directional_move_with_no_basis(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][0]["text"] = (
        "Latvian day-ahead electricity is up 12.0%, at 142.5 euros per megawatt-hour."
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "comparison_basis_stated")


def test_should_reject_an_unbased_change_in_any_block_not_just_the_first(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    tier_a_article["body"][1]["text"] = "The spread widened to 303.5 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "comparison_basis_stated")


def test_should_reject_a_quantified_change_even_when_another_block_states_the_basis(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """The basis must sit beside the number, not elsewhere in the piece.

    A reader meeting "12.0% higher" mid-article should not have to hunt for
    what it is higher than. This is the rule the qualitative allowance below
    must not be permitted to erode.
    """
    tier_a_article["body"][0]["text"] = (
        "Latvian day-ahead electricity settled at 142.5 euros per megawatt-hour, "
        "compared with a year earlier."
    )
    tier_a_article["body"][1]["text"] = "The spread widened to 303.5 euros."

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "comparison_basis_stated")


def test_should_reject_a_qualitative_change_when_no_block_states_a_basis(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """An unquantified change is allowed to lean on a basis stated elsewhere —
    but only if one actually is stated. With none anywhere, the article never
    tells the reader what moved against what.

    Every numeral is stripped so that only this gate can fail: a fixture that
    also trips the figure checks would prove nothing about this one.
    """
    tier_a_article["headline"] = "Baltic electricity market weakens across the region"
    tier_a_article["dek"] = "Prices declined, with no basis of comparison given."
    for block in tier_a_article["body"]:
        block["text"] = "The market weakened noticeably."
        block["figures"] = []

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "comparison_basis_stated")


# ── no_repeated_findings ────────────────────────────────────────────────
#
# THIS SECTION WAS MISSING. `no_repeated_findings` was added to the contract
# after this file was written -- the module docstring above still said "all
# eight checks" -- and it was the only one of the nine with no negative fixture
# here. It was mentioned in tests four times, all of them incidental.
#
# That is the defect this suite exists to prevent, arriving through the gap the
# suite does not cover: a check nothing proves can reject anything. The meta
# test at the bottom of this file now fails if a tenth check is added the same
# way.


def test_should_reject_two_paragraphs_resting_on_the_same_fields(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The failure in production: the model restates its lead in the closing,
    # citing exactly the same signal fields, and the piece says one thing twice.
    tier_a_article["body"][1] = {
        "type": "paragraph",
        "text": (
            "Prices averaged 142.5 euros per megawatt-hour, up 12.0% on the "
            "same day a year earlier, when the market cleared at 127.2 euros."
        ),
        "figures": copy.deepcopy(tier_a_article["body"][0]["figures"]),
    }

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_repeated_findings")


def test_should_accept_two_paragraphs_that_share_only_some_fields(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """The boundary. Carrying one figure into a paragraph that adds another is
    ordinary reporting -- a piece that may never mention a number twice cannot
    compare anything -- so only an IDENTICAL set is a repetition."""
    tier_a_article["body"][1] = {
        "type": "paragraph",
        "text": (
            "That 142.5 euro average sat against a spread of 303.5 euros "
            "between the cheapest and dearest hour of the day."
        ),
        "figures": [
            {"value": 142.5, "unit": "EUR/MWh", "signal_field": "price.latest"},
            {"value": 303.5, "unit": "EUR/MWh", "signal_field": "spread"},
        ],
    }

    verdict = validate(tier_a_article, signal=signal)

    assert verdict.passed, (
        "a paragraph that reuses one figure and adds another was treated as a "
        f"repetition: {[c.name for c in verdict.failures()]}"
    )


# ── no_unsupported_mechanism ────────────────────────────────────────────
#
# A weekly wrap published, and was retracted within the hour, for a paragraph
# that explained a rise it had no evidence for. All nine checks then in force
# passed it, and passed it VACUOUSLY: the paragraph carries no figures, so
# every numeric gate had nothing to look at.


def test_should_reject_an_explanation_in_a_paragraph_with_no_figures(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    # The retracted sentence, near enough verbatim.
    tier_a_article["body"].append(
        {
            "type": "paragraph",
            "text": (
                "This increase is significant for the maritime sector, "
                "reflecting the growing capacity and efficiency of its ports."
            ),
            "figures": [],
        }
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_unsupported_mechanism")


def test_should_reject_an_invented_consequence(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """`house_style` catches this too, but house style has no rejection path --
    a validated article publishes once its attempts run out, style faults and
    all. An invented consequence is a truth fault, so it needs a gate that
    fails closed."""
    tier_a_article["body"].append(
        {
            "type": "paragraph",
            "text": "The rise could boost the regional economy.",
            "figures": [],
        }
    )

    verdict = validate(tier_a_article, signal=signal)

    assert_rejected_by(verdict, "no_unsupported_mechanism")


def test_should_accept_saying_the_data_does_not_establish_a_cause(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """The sentence the prompt asks for BY NAME, and the reason the check tests
    for a positive attribution rather than for the verb.

    "The data does not show what drove the change" is figure-free and is one of
    the better sentences this wire publishes. A check that rejected it would
    have taught the writer to stop saying the honest thing.
    """
    tier_a_article["body"].append(
        {
            "type": "paragraph",
            "text": "The data does not show what drove the change.",
            "figures": [],
        }
    )

    verdict = validate(tier_a_article, signal=signal)

    assert verdict.passed, [c.name for c in verdict.failures()]


def test_should_accept_an_explanation_a_named_source_is_on_the_record_for(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """The prompt permits this in terms: "use official research context to
    explain plausible causes ... attribute it by name". An attributed cause is
    reporting, not invention."""
    tier_a_article["body"].append(
        {
            "type": "paragraph",
            "text": "According to Eurostat, the change reflects a revision to the method.",
            "figures": [],
        }
    )

    verdict = validate(tier_a_article, signal=signal)

    assert verdict.passed, [c.name for c in verdict.failures()]


def test_should_accept_an_explanation_of_the_figures_the_paragraph_carries(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    """The boundary, and the reason the rule is about evidence rather than
    vocabulary.

    The prompt's own example of bad prose contains "the rise reflects a streak
    of eight consecutive annual increases since 2008" -- same verb as the
    retracted sentence, and grounded, because the streak is in the data. A
    paragraph that declares its evidence may explain what it declares.
    """
    tier_a_article["body"].append(
        {
            "type": "paragraph",
            "text": (
                "The rise reflects a spread of 303.5 euros between the cheapest "
                "and dearest hour."
            ),
            "figures": [{"value": 303.5, "unit": "EUR/MWh", "signal_field": "spread"}],
        }
    )

    verdict = validate(tier_a_article, signal=signal)

    assert verdict.passed, [c.name for c in verdict.failures()]


# ── the meta test ───────────────────────────────────────────────────────


def test_every_check_in_the_contract_has_a_negative_fixture() -> None:
    """Every check must be proven capable of rejecting something.

    A check with no negative fixture is indistinguishable from a check that
    returns ``passed`` unconditionally, and the whole suite stays green either
    way. `no_repeated_findings` sat in exactly that state from the day it was
    added until the day this test was written.

    This is the same defect the lab has now hit four times in one day, in four
    disguises: an invariant test whose corpus omitted three detectors; fixtures
    that were alphabetically lucky; a production verification that read back
    through the store it had written to; and a feed guard filtering on a field
    the data did not carry. All four were GREEN.

    The discipline is not "test more". It is: check that the thing you are
    asserting about can actually be false.
    """
    import pathlib
    import re

    from newsroom.validator import _CHECKS

    suite = pathlib.Path(__file__).read_text(encoding="utf-8")
    covered = set(re.findall(r'assert_rejected_by\(\s*verdict,\s*"([a-z_]+)"', suite))

    missing = sorted(set(_CHECKS) - covered)
    assert not missing, (
        "these checks have no fixture proving they can reject anything, so "
        f"nothing here would notice if they stopped working: {missing}"
    )


def test_every_registered_check_actually_runs() -> None:
    """Two lists, and a check in one and not the other never executes.

    `CHECK_NAMES` is what `validate_article` iterates; `_CHECKS` is the
    registry it looks names up in. `no_unsupported_mechanism` was added to the
    registry, given a negative fixture, and silently never run -- and the
    fixture test above passed throughout, because it reads `_CHECKS`.

    So the guard on the guard had the defect it exists to catch: it asserted a
    property of the registry while the behaviour depends on the other list.
    Seventh instance of one shape in a day.
    """
    from newsroom.validator import CHECK_NAMES, _CHECKS

    assert set(CHECK_NAMES) == set(_CHECKS), (
        "registered but never run: "
        f"{sorted(set(_CHECKS) - set(CHECK_NAMES))}; "
        "run but not registered: "
        f"{sorted(set(CHECK_NAMES) - set(_CHECKS))}"
    )
