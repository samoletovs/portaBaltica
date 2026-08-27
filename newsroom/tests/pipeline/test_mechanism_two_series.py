"""A mechanism resting only on the finding's own fields is the finding restated.

The analyst's module docstring has always said what a mechanism is:

    The remaining ``consistent`` mechanisms are exactly what a data journalist
    is entitled to say: *labour costs rose while unemployment fell, which is
    what a tightening labour market looks like.* **Two verified series and a
    named relationship between them.** Not a guess about the world.

`_ground` enforced the first half — every named field must be verified — and
not the second. So a mechanism naming three of the detector's own fields
passed, and `_MIN_FIELDS_FOR_ESTABLISHED = 2` even promoted it to
``established``, because a count of fields is only a proxy for "two series"
and `(latest_value, streak_length, streak_start_value)` beats that proxy with
three fields drawn from one.

WHAT IT COST
------------
Three articles in one run were rejected for `no_repeated_findings`, every one
of them ``body[3] rests on the same figures as body[0]``, and the fields named
were the signal's own::

    (early_gap, gap)
    (latest_value, streak_length, streak_start_value)
    (latest_value, previous_record_value)

Each link in that chain was doing its job. The analyst admitted a
self-grounded mechanism. The brief told the writer to declare the fields it
rested on — which was itself a fix, for the loop where the writer explained
without figures. The writer declared them. And they were the figures the
opening had already spent.

Every component correct, and the article unpublishable. The cheap end of the
chain is the first link: a mechanism that was never a relationship between two
series should not be offered at all. The prompt already says to end an article
a paragraph early rather than pad it, so the outcome is a shorter piece that
publishes rather than a longer one that does not.

WHICH FACTS COUNT AS A SECOND SERIES
------------------------------------
``peer`` (another country), ``companion`` (another metric) and ``denominator``
(the EU aggregate) each bring a different series. ``placement`` and
``trajectory`` describe the finding's own history, so a mechanism resting only
on those is still a claim about one series.
"""

from __future__ import annotations

from newsroom.pipeline.analyst import _ground

ALLOWED = {
    "latest_value": 16.3,
    "streak_length": 8.0,
    "previous_record": 15.1,
    "companion_unemployment_rate": 6.6,
    "peer_ee": 14.2,
}

CROSS_SERIES = frozenset({"companion_unemployment_rate", "peer_ee"})


def mechanism(*fields: str, claim: str = "costs rose while unemployment fell"):
    return [{"claim": claim, "grounded_in": list(fields), "confidence": "established"}]


class TestAMechanismMustRelateTwoSeries:
    def test_the_signals_own_fields_are_not_a_relationship(self) -> None:
        """The exact shape from the run: three fields, all one series."""
        kept, discarded = _ground(
            mechanism("latest_value", "streak_length", "previous_record"),
            ALLOWED,
            CROSS_SERIES,
        )

        assert kept == []
        assert "restates the opening" in discarded[0]

    def test_the_discard_reason_names_the_fields(self) -> None:
        """A dropped mechanism is logged, so the reason has to be readable."""
        _, discarded = _ground(mechanism("latest_value"), ALLOWED, CROSS_SERIES)

        assert "latest_value" in discarded[0]

    def test_one_cross_series_field_is_enough(self) -> None:
        kept, discarded = _ground(
            mechanism("latest_value", "companion_unemployment_rate"),
            ALLOWED,
            CROSS_SERIES,
        )

        assert len(kept) == 1
        assert discarded == []

    def test_a_lone_cross_series_field_survives_as_consistent(self) -> None:
        """One field is still a correlation with itself for *confidence*.

        The two rules are different axes and both apply: which series the
        fields come from decides whether the mechanism exists, and how many
        there are decides how strongly it may be reported.
        """
        kept, _ = _ground(
            mechanism("companion_unemployment_rate"), ALLOWED, CROSS_SERIES
        )

        assert len(kept) == 1
        assert kept[0].confidence == "consistent"

    def test_two_cross_series_fields_may_be_established(self) -> None:
        kept, _ = _ground(
            mechanism("companion_unemployment_rate", "peer_ee"), ALLOWED, CROSS_SERIES
        )

        assert kept[0].confidence == "established"


class TestTheOlderGuaranteesStillHold:
    """The companion class. This adds a rule; it must not drop the others."""

    def test_an_unverified_field_is_still_refused(self) -> None:
        _, discarded = _ground(
            mechanism("companion_unemployment_rate", "invented_field"),
            ALLOWED,
            CROSS_SERIES,
        )

        assert "names unverified field(s): invented_field" in discarded[0]

    def test_a_mechanism_grounded_in_nothing_is_still_refused(self) -> None:
        _, discarded = _ground(mechanism(), ALLOWED, CROSS_SERIES)

        assert "grounded in nothing" in discarded[0]

    def test_no_cross_series_set_means_the_rule_does_not_apply(self) -> None:
        """A signal with no context pack must not lose every mechanism.

        `_ground` is called with an empty set when there is no pack, and an
        empty set cannot be satisfied — so the rule is skipped rather than
        silently discarding everything. Failing towards the previous behaviour
        matters here: the alternative is a wire that goes quiet for a reason
        nobody can see.
        """
        kept, discarded = _ground(mechanism("latest_value"), ALLOWED)

        assert len(kept) == 1
        assert discarded == []
