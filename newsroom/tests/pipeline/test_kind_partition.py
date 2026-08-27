"""Every fact kind is classified, and the classification is a decision.

`_ground` admits a mechanism only when it names at least one field from a
*different* series, because the analyst's own docstring says a mechanism is
"two verified series and a named relationship between them". `peer`,
`companion` and `denominator` each bring one; `placement` and `trajectory`
describe the finding's own history and do not.

That second half was written as an **absence**: a kind counted as same-series
by not appearing in `_CROSS_SERIES_KINDS`. Which means a sixth `FactKind`
added tomorrow is classified by default, by nobody, and if it genuinely
brought another series then every mechanism grounded in it would be silently
discarded. The symptom is a wire that goes slightly quieter for no reason
anyone can find.

Session A hit the same shape on the dashboard the same afternoon: five
indicators deliberately left uncoloured, the decision recorded in a comment,
and nothing to stop a sixth arriving by accident and being coloured by
direction with nobody having decided anything. Their sentence is the general
form and it is better than either worked example:

    A documented decision that nothing enforces decays into an assumption.

The cost of the two is the same and it is not the mistake itself — both were
correct on the day they were written. It is that **prose describing a check is
the most convincing possible substitute for one**: a reader who wonders whether
the case is handled finds a paragraph saying it was considered, and stops.
"""

from __future__ import annotations

import typing

import pytest

from newsroom.pipeline.analyst import _CROSS_SERIES_KINDS, _SAME_SERIES_KINDS
from newsroom.pipeline.context import FactKind

DECLARED = frozenset(typing.get_args(FactKind))


class TestEveryKindIsClassified:
    def test_the_two_sets_exhaust_factkind(self) -> None:
        """A new kind must be classified deliberately."""
        unclassified = DECLARED - _CROSS_SERIES_KINDS - _SAME_SERIES_KINDS

        assert not unclassified, (
            f"{sorted(unclassified)} is a FactKind that _ground has no opinion "
            f"about. Add it to _CROSS_SERIES_KINDS if it brings another series, "
            f"or to _SAME_SERIES_KINDS if it describes the finding's own. "
            f"Leaving it out is not neutral: it silently counts as same-series, "
            f"and every mechanism grounded in it is discarded."
        )

    def test_neither_set_names_something_that_is_not_a_kind(self) -> None:
        """The other direction: a renamed kind leaves a dead entry behind.

        A stale name in `_CROSS_SERIES_KINDS` matches no fact, so the set looks
        populated while grounding on that kind quietly stops working.
        """
        invented = (_CROSS_SERIES_KINDS | _SAME_SERIES_KINDS) - DECLARED

        assert not invented, (
            f"{sorted(invented)} is classified but is not a FactKind, so it "
            f"matches no fact and the classification does nothing"
        )

    def test_no_kind_is_in_both(self) -> None:
        assert not (_CROSS_SERIES_KINDS & _SAME_SERIES_KINDS)

    def test_both_sets_are_populated(self) -> None:
        """The companion.

        Every assertion above is satisfied by two empty sets and an empty
        `FactKind`. This one fails if the partition has become vacuous — which
        is how a guard over a registry stops guarding without going red.
        """
        assert _CROSS_SERIES_KINDS
        assert _SAME_SERIES_KINDS
        assert len(DECLARED) >= 5


class TestTheClassificationMatchesWhatTheFactsAre:
    """The names are one thing; what the facts actually carry is another."""

    @pytest.mark.parametrize("kind", sorted(_CROSS_SERIES_KINDS))
    def test_a_cross_series_kind_is_built_from_another_series(self, kind: str) -> None:
        """`peer`, `companion` and `denominator` are each built by walking a
        series other than the signal's own, which is checked here by reading
        the context builder rather than by trusting the name."""
        import inspect

        from newsroom.pipeline import context

        builder = {
            "peer": context._peers,
            "companion": context._companions,
            "denominator": context._denominator,
        }[kind]
        source = inspect.getsource(builder)

        assert "by_metric" in source or "by_geography" in source, (
            f"{kind} is classified as cross-series but its builder does not "
            f"look at any series other than the signal's own"
        )

    @pytest.mark.parametrize("kind", sorted(_SAME_SERIES_KINDS))
    def test_a_same_series_kind_is_built_from_the_signals_own_series(
        self, kind: str
    ) -> None:
        import inspect

        from newsroom.pipeline import context

        builder = {"placement": context._placement, "trajectory": context._trajectory}[
            kind
        ]
        parameters = list(inspect.signature(builder).parameters)

        assert parameters == ["signal", "series"], (
            f"{kind} is classified as same-series but its builder takes "
            f"{parameters}, so it may reach beyond the signal's own series"
        )
