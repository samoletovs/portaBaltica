"""Negative fixtures: input the validator MUST reject.

Written before the passing fixtures, on purpose. The failure mode this suite
exists to prevent is a green test that passes because the validator does
nothing, so every test here asserts a *named* check rejected the article — and
by default asserts it was the only check that fired, which means the fixture
isolates the behaviour rather than tripping some unrelated gate.

Each mutation starts from a clean article that
``test_validator_accepts.py`` proves passes all eight checks.
"""

from __future__ import annotations

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


def test_should_reject_a_figure_that_drifted_by_the_smallest_representable_amount(
    tier_a_article: dict[str, Any], signal: dict[str, Any], validate
) -> None:
    signal["payload"]["price"]["latest"] = 142.50000001

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
    tier_a_article["persona"]["byline"] = "Marek Soosaar · Energy correspondent"

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
        "name": "Gintaras Vaitkus",
        "beat": "Maritime & Trade",
        "byline": "Gintaras Vaitkus · AI correspondent, Maritime & Trade",
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
    tier_a_article["body"][1]["text"] += " Marek Soosaar attended the auction in Tallinn."

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
