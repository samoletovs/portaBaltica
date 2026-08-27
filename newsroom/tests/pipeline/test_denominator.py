"""The EU reading is offered only when it moved the other way.

A denominator earns a sentence when it *changes the reading*, not when it
differs. "Unemployment fell to 6.7% while the EU average rose" is a different
story; "6.7%, against an EU average of 6.1%" is a footnote wearing a
sentence's clothes.

Measured over 114 country-month comparisons on four monthly Eurostat
indicators before any of this was built:

    offer whenever the direction differs   61%    boilerplate
    offer on genuinely opposite movement   29%    one article in three

The gap between those two numbers is the EU aggregate being flat. It is a
27-country average published to one decimal, so most months it does not move
at the precision we are given, and "Latvia rose, the EU was flat" scores as a
divergence while telling a reader almost nothing.

**Every fixture below is real.** The values are live Eurostat `une_rt_m`
(unemployment, seasonally adjusted, total, both sexes) as published, not
numbers chosen to make a rule look good. Between 2025-06 and 2026-06 the EU
sat at 6.0 for eleven of thirteen months, which is exactly why the naive rule
misfires and why these fixtures are worth more than tidy ones.
"""

from __future__ import annotations

from newsroom.pipeline.context import build_context
from newsroom.pipeline.write import prompts

from .conftest import make_signal, series_from

# ── real Eurostat une_rt_m, 2026-01 through 2026-06 ─────────────────────
PERIODS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
LATVIA = [6.8, 6.7, 6.6, 6.5, 6.5, 6.8]
EU = [6.0, 6.1, 6.0, 6.0, 6.0, 6.0]


def latvia(periods=PERIODS, values=LATVIA):
    return series_from(list(values), geography="LV", periods=list(periods))


def europe(periods=PERIODS, values=EU):
    return series_from(list(values), geography="EU27_2020", periods=list(periods))


def signal_at(period: str, value: float):
    return make_signal(
        detector="sharp_move",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="LV",
        period=period,
        value=value,
        unit="%",
        section="labour",
    )


def denominators(pack):
    return [fact for fact in pack.facts if fact.kind == "denominator"]


class TestItIsOfferedWhenTheEuMovedTheOtherWay:
    def test_a_real_divergence_produces_the_fact(self) -> None:
        """2026-01 → 2026-02: Latvia 6.8 → 6.7, the EU 6.0 → 6.1.

        The one genuine opposite movement in thirteen months of this series,
        and it is the sentence worth writing: unemployment fell here while it
        rose across the union.
        """
        pack = build_context(signal_at("2026-02", 6.7), [latvia(), europe()])

        facts = denominators(pack)
        assert len(facts) == 1
        assert facts[0].field == "denominator_eu"
        assert facts[0].value == 6.1
        assert facts[0].period == "2026-02"

    def test_the_label_says_which_way_the_eu_went(self) -> None:
        """A bare number invites the writer to assume it agrees."""
        pack = build_context(signal_at("2026-02", 6.7), [latvia(), europe()])

        assert "rose over the same period" in denominators(pack)[0].label

    def test_it_is_a_traceable_field_like_any_other(self) -> None:
        """It inherits `figures_traceable`; it is not a prose hint."""
        fact = denominators(build_context(signal_at("2026-02", 6.7), [latvia(), europe()]))[0]
        record = fact.provenance_record()

        assert record["kind"] == "denominator"
        assert record["geography"] == "EU27_2020"
        assert record["source_id"] == "eurostat"


class TestItIsWithheldTheOtherSeventyOnePercent:
    """The companion the offer tests need.

    `len(facts) == 1` is satisfied by a rule that fires on everything. These
    assert the fact is *absent*, and each one is a real month from the same
    real series — so between them they prove the gate can be both open and
    shut on data nobody tuned.
    """

    def test_nothing_when_both_fell(self) -> None:
        """2026-02 → 2026-03: Latvia 6.7 → 6.6, the EU 6.1 → 6.0."""
        pack = build_context(signal_at("2026-03", 6.6), [latvia(), europe()])

        assert denominators(pack) == []

    def test_nothing_when_the_eu_did_not_move(self) -> None:
        """2026-05 → 2026-06: Latvia 6.5 → 6.8, the EU 6.0 → 6.0.

        The excluded third. "Latvia rose while the EU held steady" is the
        sentence most likely to be true and hollow, because a flat aggregate
        is usually an artefact of averaging 27 countries rather than a fact
        about Europe.
        """
        pack = build_context(signal_at("2026-06", 6.8), [latvia(), europe()])

        assert denominators(pack) == []

    def test_nothing_when_the_country_did_not_move(self) -> None:
        """2026-04 → 2026-05: Latvia 6.5 → 6.5. Nothing to contrast."""
        pack = build_context(signal_at("2026-05", 6.5), [latvia(), europe()])

        assert denominators(pack) == []

    def test_nothing_when_there_is_no_eu_series(self) -> None:
        pack = build_context(signal_at("2026-02", 6.7), [latvia()])

        assert denominators(pack) == []

    def test_nothing_for_a_signal_about_the_eu_itself(self) -> None:
        """A reference geography is never a subject, so it has no denominator."""
        eu_signal = make_signal(
            detector="sharp_move",
            metric="unemployment_rate",
            metric_label="unemployment rate",
            geography="EU27_2020",
            period="2026-02",
            value=6.1,
            unit="%",
            section="labour",
        )
        pack = build_context(eu_signal, [latvia(), europe()])

        assert denominators(pack) == []


class TestThePeriodsAreMatchedByNameNotByPosition:
    def test_a_lagging_eu_series_produces_nothing(self) -> None:
        """The hazard the wrap's period gate already taught us.

        Comparing "the last two readings of each series" would contrast a
        Latvian February with an EU December whenever the aggregate lags —
        traceable, uninvented, and false. Here the EU series stops in
        December, so February has no EU counterpart and the fact is withheld
        rather than fabricated from whatever is newest.
        """
        lagging = europe(periods=["2025-11", "2025-12"], values=[6.0, 6.1])
        pack = build_context(signal_at("2026-02", 6.7), [latvia(), lagging])

        assert denominators(pack) == []

    def test_it_uses_the_signals_own_previous_period(self) -> None:
        """A gap in the country's series must not silently widen the window."""
        gapped = latvia(periods=["2026-01", "2026-02"], values=[6.8, 6.7])
        pack = build_context(signal_at("2026-02", 6.7), [gapped, europe()])

        facts = denominators(pack)
        assert len(facts) == 1
        assert facts[0].period == "2026-02"


class TestFlatIsDefinedByTheSourceNotByTaste:

    def test_the_threshold_is_half_the_reported_precision(self) -> None:
        """Why 0.05, statable to a reader who asks.

        Eurostat publishes this series to one decimal, so a move of 0.04 is
        not a small change — it is no *reported* change. Half the last
        significant digit is the line, and it is derived from the values
        rather than fixed, because 0.05 is a real move on a rate, noise on an
        index around 100, and nothing at all on cargo tonnes.
        """
        from newsroom.pipeline.context import _reported_quantum

        assert _reported_quantum([6.0, 6.1, 6.2]) == 0.05
        assert _reported_quantum([6.00, 6.01]) == 0.005
        assert _reported_quantum([100.0, 101.0]) == 0.5

    def test_a_move_below_the_quantum_is_not_a_movement(self) -> None:
        """Two decimals: a 0.004 EU move is invisible at that precision."""
        country = series_from([6.80, 6.70], geography="LV", periods=["2026-01", "2026-02"])
        europe_ = series_from(
            [6.000, 6.004], geography="EU27_2020", periods=["2026-01", "2026-02"]
        )
        pack = build_context(signal_at("2026-02", 6.70), [country, europe_])

        assert denominators(pack) == []


class TestItReachesTheWriter:
    """The fact is useless if the prompt never shows it.

    `render_context` walks an explicit tuple of kinds. A new kind that is not
    added to that tuple is built, merged into `Signal.fields`, and silently
    dropped on the way to the model — correct code on a path nobody calls,
    which is the shape of defect this repo produced three times in one day.
    It was missing from the tuple when this test was written.
    """

    def test_the_prompt_carries_the_eu_reading(self) -> None:
        signal = signal_at("2026-02", 6.7)
        pack = build_context(signal, [latvia(), europe()])
        rendered = prompts._context_section(pack, signal)

        assert "denominator_eu" in rendered
        assert "MOVED THE OTHER WAY" in rendered

    def test_the_prompt_says_nothing_when_the_fact_is_withheld(self) -> None:
        signal = signal_at("2026-06", 6.8)
        rendered = prompts._context_section(build_context(signal, [latvia(), europe()]), signal)

        assert "denominator_eu" not in rendered
