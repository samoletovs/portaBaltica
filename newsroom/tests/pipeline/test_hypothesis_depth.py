"""The causal panel must name a particular, band its confidence, and not
mistake its own repetition for agreement.

Every number quoted here was measured against the 26 hypotheses the panel had
actually published, fetched from the live articles container on 2026-08-30.
That corpus is the reason these tests exist:

    hypotheses published          26
    basis = domain_knowledge      22  (85%)
    discarded by the guard         0  (ever)
    strength = "likely"           19  (73%)
    flagged corroborated          18  (69%)

A guard that has never rejected anything and a confidence scale whose top value
covers three-quarters of its output are both instruments that cannot fail, and
this file is the pair of controls that make them able to.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline import hypothesis as hyp
from newsroom.pipeline.research import ResearchContext

LENS = hyp.LENSES["industry"]

#: The vocabulary of a real finding — Lithuania's passenger cars per thousand
#: inhabitants, the article that produced six generic hypotheses and no
#: rejections.
CARS = frozenset(
    hyp._finding_vocabulary(
        type(
            "S",
            (),
            {
                "metric_label": "Passenger cars per thousand inhabitants",
                "geography": "LT",
                "period": "2025",
                "unit": "cars per thousand inhabitants",
                "section": "trade",
                "detector": "record_extreme",
                "comparison_basis": "the highest in 14 observations since 2010",
            },
        )()
    )
)


def _admissible(raw, *, research: ResearchContext | None = None, vocabulary=CARS):
    return hyp._admissible(raw, LENS, research, vocabulary)


def _claim(text: str, **extra):
    return {"claim": text, "basis": "domain_knowledge", "likelihood": "likely", **extra}


# ── the specificity rule, which the prompt claimed and nothing enforced ──


class TestNamesAParticular:
    """The prompt said vague claims "will be thrown away". Nothing threw them.

    These are the real sentences, copied from the published articles, on both
    sides of the line.
    """

    def test_rejects_the_claim_that_shipped(self) -> None:
        kept, discarded = _admissible(
            [
                _claim(
                    "The increase in passenger cars per thousand inhabitants in "
                    "Lithuania can be attributed to rising disposable incomes and "
                    "improved economic conditions, which have made car ownership "
                    "more accessible to a larger segment of the population."
                )
            ]
        )

        assert kept == []
        assert "names no particular" in discarded[0]

    def test_naming_the_country_the_article_is_about_is_not_a_particular(self) -> None:
        # The trap a bare proper-noun test falls into: the subject of the
        # sentence is capitalised, so the vaguest claim in the corpus would
        # have passed on the strength of the word "Lithuania".
        kept, _ = _admissible([_claim("Lithuanian households simply bought more cars.")])

        assert kept == []

    def test_keeps_a_named_actor(self) -> None:
        kept, _ = _admissible(
            [
                _claim(
                    "Refinery margins at Orlen Lietuva, the country's only refiner, "
                    "lifted the coke and refined petroleum group."
                )
            ]
        )

        assert len(kept) == 1

    def test_keeps_a_dated_policy_because_numeric_scan_masks_bare_years(self) -> None:
        # The one specificity a no-numbers rule must not cost. `numeric_scan`
        # masks a bare year, so this survives the quantity gate — and the year
        # is exactly the particular that makes the claim checkable.
        kept, _ = _admissible(
            [_claim("The excise reform that took effect in 2024 pulled purchases forward.")]
        )

        assert len(kept) == 1

    def test_a_registration_artifact_reads_as_a_particular(self) -> None:
        # Rule 5's answer for this very series: Lithuania's register is not
        # purged of exported and scrapped vehicles. Naming the register is
        # naming a mechanism.
        kept, _ = _admissible(
            [
                _claim(
                    "Vehicles exported or scrapped are slow to leave the national "
                    "Register of Road Vehicles, so the stock is counted long after "
                    "the cars have gone."
                )
            ]
        )

        assert len(kept) == 1

    def test_the_known_false_negative_is_a_choice_and_stays_visible(self) -> None:
        """A true, specific mechanism with no proper noun and no year is lost.

        Pinned rather than hidden, because it is the price of the rule and a
        later reader should be able to see what it costs rather than discover
        it in production. If this ever starts passing, the gate has been
        widened and the widening needs the same measurement the original had.
        """
        kept, discarded = _admissible(
            [
                _claim(
                    "Lithuania's role as a used-car import hub raises registrations "
                    "before vehicles are re-exported."
                )
            ]
        )

        assert kept == []
        assert "names no particular" in discarded[0]


def test_the_gate_cannot_silently_disable_itself() -> None:
    """``vocabulary`` defaults to empty, and an empty vocabulary skips the check.

    That default keeps every existing caller working, and it is exactly the
    shape this codebase warns about: absence resolving to success. If
    ``consult_panel`` ever stopped passing the vocabulary the guard would
    vanish with no failing test and no visible symptom — ``discarded: 0``
    again, meaning nothing rather than meaning nothing was wrong.

    So this asserts the wiring rather than the rule.
    """
    import inspect

    source = inspect.getsource(hyp.consult_panel)

    assert "_finding_vocabulary(signal)" in source
    assert "research, vocabulary" in source


# ── calibrated likelihood ────────────────────────────────────────────────


class TestLikelihoodBands:
    def test_every_band_carries_a_numeric_range(self) -> None:
        for band, (low, high) in hyp.LIKELIHOOD_BANDS.items():
            assert 0 <= low < high <= 100, band

    def test_the_bands_partition_rather_than_nest(self) -> None:
        """The one deliberate departure from IPCC AR6, asserted so it stays one.

        The IPCC's ``likely`` is 66–100% and contains its ``very likely``,
        which is right for a single assessed statement. A reader comparing two
        hypotheses side by side needs them to partition, so these are disjoint.
        """
        edges = sorted(hyp.LIKELIHOOD_BANDS.values())
        for (_, high), (low, _) in zip(edges, edges[1:]):
            assert high == low, f"bands must tile without a gap or an overlap: {edges}"

    def test_records_the_band_and_its_range(self) -> None:
        kept, _ = _admissible(
            [_claim("Orlen Lietuva cut refinery runs for maintenance.", likelihood="very likely")]
        )

        assert kept[0].likelihood == "very likely"
        assert kept[0].likelihood_range == "90–100%"

    def test_a_ruled_out_cause_is_not_offered_to_the_correspondent(self) -> None:
        kept, discarded = _admissible(
            [_claim("Orlen Lietuva cut refinery runs.", likelihood="very unlikely")]
        )

        assert kept == []
        assert "ruling it out" in discarded[0]

    def test_an_unreadable_band_lands_on_the_weakest_publishable_one(self) -> None:
        # Not the permissive end. An unparseable label is a missing value, and
        # a missing value that resolves to "likely" is the freshness bug in
        # another costume.
        kept, _ = _admissible(
            [_claim("Orlen Lietuva cut refinery runs.", likelihood="quite probable indeed")]
        )

        assert kept[0].likelihood == "about as likely as not"

    def test_the_old_self_assigned_strength_cannot_buy_a_calibrated_band(self) -> None:
        """A v1-shaped answer must not arrive wearing confidence it never earned.

        ``strength: "likely"`` was the signal this scale replaced — 19 of 26
        published hypotheses carried it. Falling back to it would reimport the
        uninformative binary through the field meant to fix it.
        """
        kept, _ = _admissible(
            [
                {
                    "claim": "Orlen Lietuva cut refinery runs for maintenance.",
                    "basis": "domain_knowledge",
                    "strength": "likely",
                }
            ]
        )

        assert kept[0].likelihood == "about as likely as not"
        assert kept[0].strength == "possible"

    def test_strength_is_derived_from_the_band_not_read_from_the_model(self) -> None:
        kept, _ = _admissible(
            [
                {
                    "claim": "Orlen Lietuva cut refinery runs for maintenance.",
                    "basis": "domain_knowledge",
                    "likelihood": "very likely",
                    "strength": "possible",
                }
            ]
        )

        assert kept[0].strength == "likely"

    def test_the_scale_travels_with_the_article(self) -> None:
        # A band word means nothing to a reader who cannot see the convention.
        record = hyp.HypothesisPanel().to_provenance()

        assert record["likelihood_scale"]["likely"] == "66–90%"


def test_a_rival_and_a_disconfirming_observation_survive_to_the_brief() -> None:
    kept, _ = _admissible(
        [
            _claim(
                "Orlen Lietuva cut refinery runs for maintenance.",
                rival="Wholesale electricity repricing across the Baltic bidding zones.",
                disconfirmed_by="Refined petroleum flat while the index still rises.",
            )
        ]
    )
    panel = hyp.HypothesisPanel(hypotheses=tuple(kept), consulted=(LENS.title,))
    section = panel.prompt_section()

    assert "rival explanation" in section
    assert "what would kill it" in section
    # The band reaches the writer; the percentage deliberately does not, because
    # a figure in that paragraph is one the pipeline never verified.
    assert "very likely" in section or "likely" in section
    assert "%" not in section


# ── repetition is not agreement ──────────────────────────────────────────


def _hyp(claim: str, lens: str, analyst: str) -> hyp.Hypothesis:
    return hyp.Hypothesis(
        claim=claim,
        lens=lens,
        analyst=analyst,
        discipline=lens,
        basis="domain_knowledge",
        attribution=analyst,
        strength="likely",
        likelihood="likely",
        likelihood_range="66–90%",
    )


class TestCrossLensCollapse:
    #: The three variants the car-ownership article actually published, one per
    #: lens. Three of its fifteen claim-pairs were near-duplicates and all
    #: three were flagged as independently corroborated.
    VARIANTS = (
        _hyp(
            "The increase in passenger cars can be attributed to rising disposable "
            "incomes and improved economic conditions, which have made car ownership "
            "more accessible to a larger segment of the population.",
            "industry",
            "the newsroom's AI industry analyst",
        ),
        _hyp(
            "The increase in passenger cars can be attributed to rising disposable "
            "incomes and improved access to financing options, allowing more "
            "households to purchase vehicles.",
            "household",
            "the newsroom's AI household economist",
        ),
        _hyp(
            "The increase in passenger cars can be attributed to rising disposable "
            "incomes and improved access to financing, which have made car ownership "
            "more attainable for a larger segment of the population.",
            "political_economy",
            "the newsroom's AI political economist",
        ),
    )

    def test_one_prior_written_three_ways_becomes_one_claim(self) -> None:
        collapsed = hyp._collapse_duplicates(self.VARIANTS)

        assert len(collapsed) == 1

    def test_the_survivor_keeps_the_other_analysts_as_corroboration(self) -> None:
        # Genuine agreement must survive the collapse — the point is to stop
        # printing the same sentence three times, not to lose the fact that
        # three lenses reached it.
        collapsed = hyp._collapse_duplicates(self.VARIANTS)

        assert set(collapsed[0].corroborated_by) == {
            "the newsroom's AI household economist",
            "the newsroom's AI political economist",
        }

    def test_an_analyst_never_corroborates_itself(self) -> None:
        collapsed = hyp._collapse_duplicates(self.VARIANTS)

        assert collapsed[0].analyst not in collapsed[0].corroborated_by

    def test_genuinely_different_causes_are_both_kept(self) -> None:
        distinct = (
            _hyp(
                "Refinery margins at Orlen Lietuva lifted the refined petroleum group.",
                "industry",
                "the newsroom's AI industry analyst",
            ),
            _hyp(
                "Vehicles exported or scrapped are slow to leave the national register.",
                "political_economy",
                "the newsroom's AI political economist",
            ),
        )

        assert len(hyp._collapse_duplicates(distinct)) == 2

    def test_corroboration_is_never_inherited_through_a_bridging_claim(self) -> None:
        """`_overlap` is not transitive, so a union imports agreement that is not there.

        A~B and B~C both clear the threshold while A~C is 0.0. Folding B into A
        used to carry C's analyst across, and because `_by_evidence` sorts
        corroboration first, the fabricated agreement was promoted to the head
        of the correspondent's brief — with C's different claim printed
        directly underneath it.
        """
        a = _hyp(
            "Refinery maintenance at Orlen Lietuva reduced refined petroleum output.",
            "industry",
            "industry-analyst",
        )
        b = _hyp(
            "Refinery maintenance at Orlen Lietuva coincided with weaker external "
            "demand across industrial output.",
            "household",
            "household-economist",
        )
        c = _hyp(
            "Weaker external demand cut industrial production; factories closed "
            "pending orders.",
            "political_economy",
            "political-economist",
        )
        # The precondition the bug needed: a real bridge, and no direct link.
        assert hyp._overlap(a.claim, b.claim) >= hyp._CONVERGENCE_THRESHOLD
        assert hyp._overlap(b.claim, c.claim) >= hyp._CONVERGENCE_THRESHOLD
        assert hyp._overlap(a.claim, c.claim) < hyp._CONVERGENCE_THRESHOLD

        collapsed = hyp._collapse_duplicates(hyp._converge((a, b, c)))
        survivor = next(h for h in collapsed if h.analyst == "industry-analyst")

        assert "political-economist" not in survivor.corroborated_by

    def test_the_production_chain_carries_only_measured_agreement(self) -> None:
        # Asserted through the exact composition `consult_panel` uses, because
        # the defect only appeared once `_converge` had run first.
        pair = (
            _hyp(
                "Refinery margins at Orlen Lietuva lifted the refined petroleum group "
                "through the quarter.",
                "industry",
                "industry-analyst",
            ),
            _hyp(
                "Refinery margins at Orlen Lietuva lifted the refined petroleum group "
                "over the same quarter.",
                "household",
                "household-economist",
            ),
        )
        collapsed = hyp._by_evidence(hyp._collapse_duplicates(hyp._converge(pair)))

        assert len(collapsed) == 1
        assert collapsed[0].corroborated_by == ("household-economist",)


def test_discard_reasons_reach_provenance_not_just_a_count() -> None:
    """``discarded: 0`` was consistent with two states and distinguished neither.

    A count says how many; only the reasons say whether the guard was working.
    """
    panel = hyp.HypothesisPanel(discarded=("a claim — names no particular",))
    record = panel.to_provenance()

    assert record["discarded"] == 1
    assert record["discarded_reasons"] == ["a claim — names no particular"]


def test_the_prompt_states_the_rule_the_code_now_enforces() -> None:
    """An example in guidance is a claim about behaviour.

    v1 told the model vague claims "will be thrown away" while nothing threw
    any away — false about its own contract, in the direction that discourages
    correct work. This asserts the prompt and the guard describe one rule.
    """
    prompt = hyp._SYSTEM_TEMPLATE

    assert "ENFORCED" in prompt
    assert "names no particular" in prompt
    for band in hyp.LIKELIHOOD_BANDS:
        assert band in prompt, band


def test_the_measurement_artifact_question_is_asked_of_every_lens() -> None:
    """Rule 5, and the reason it is in the shared template rather than a lens.

    A register purge, a rebased denominator or a reclassification moves a
    series with nothing happening in the world, and it is the leading candidate
    for the very article that produced six hypotheses about disposable income.
    It is not one discipline's job, so it is asked of all of them.
    """
    prompt = hyp._SYSTEM_TEMPLATE

    assert "MEASUREMENT MOVED RATHER THAN THE WORLD" in prompt
    assert "per-capita" in prompt


@pytest.mark.parametrize("section", sorted(hyp.SECTION_PANEL))
def test_every_beat_still_resolves_to_a_panel(section: str) -> None:
    assert hyp.panel_for(section)
