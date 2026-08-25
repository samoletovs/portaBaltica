"""A ratio is not a measurement, and a count is not a quantity.

THE SENTENCE THAT SHIPPED
-------------------------
The first original article published after the pipeline was unblocked said:

    The spread of 70.2 EUR/MWh is 3.18801 EUR/MWh higher than the typical
    spread, indicating a notable increase in price volatility.

``spread_vs_typical`` is 70.2 / 22.02 = 3.188 -- a ratio, "3.2 times the usual
spread". The actual difference is 48.18 EUR/MWh. The sentence is wrong in its
unit and wrong in its arithmetic, and it reached a reader.

It was wrong because two places independently applied ``signal.unit`` to every
field: the prompt's figure table and the figure reconciler. Each looked
correct on its own. Both now resolve the unit through one function, so they
cannot disagree.

The five decimal places are the same fault seen from the other side. False
precision on a derived ratio is noise, and it was the first thing a reader
complained about.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.units import display_value, label_for_field, unit_for_field


class TestRatiosAndCountsAreNotMeasurements:
    @pytest.mark.parametrize(
        "field",
        ["spread_vs_typical", "ratio_vs_typical", "deviation_vs_typical", "z_score"],
    )
    def test_a_ratio_carries_no_unit(self, field):
        assert unit_for_field(field, "EUR/MWh") is None, (
            f"{field} is dimensionless; labelling it EUR/MWh publishes a false claim"
        )

    @pytest.mark.parametrize(
        "field", ["periods_compared", "baseline_years", "observations", "sample_size"]
    )
    def test_a_count_carries_no_unit(self, field):
        assert unit_for_field(field, "EUR/MWh") is None

    @pytest.mark.parametrize("field", ["deviation_pct", "spread_pct", "change_percent"])
    def test_a_percentage_is_a_percentage(self, field):
        assert unit_for_field(field, "EUR/MWh") == "%"

    @pytest.mark.parametrize(
        "field", ["spread", "typical_spread", "highest_value", "lowest_value", "latest_value"]
    )
    def test_a_real_measure_keeps_the_series_unit(self, field):
        assert unit_for_field(field, "EUR/MWh") == "EUR/MWh"

    def test_the_exact_field_that_shipped_wrong(self):
        # Named so that deleting the rule fails a test that says why.
        assert unit_for_field("spread_vs_typical", "EUR/MWh") is None


class TestTheWriterIsToldWhatKindOfNumberItIs:
    def test_a_ratio_is_described_as_a_ratio(self):
        label = label_for_field("spread_vs_typical", "EUR/MWh")

        assert "ratio" in label
        assert "EUR/MWh" not in label

    def test_a_count_is_described_as_a_count(self):
        assert "count" in label_for_field("periods_compared", "EUR/MWh")

    def test_a_measure_is_described_by_its_unit(self):
        assert label_for_field("spread", "EUR/MWh") == "EUR/MWh"


class TestPrecisionAReaderCanRead:
    def test_a_ratio_is_not_shown_to_five_decimals(self):
        # "3.18801" was published. It is noise dressed as rigour.
        assert display_value("spread_vs_typical", 3.18801) == "3.19"

    def test_a_count_is_a_whole_number(self):
        assert display_value("periods_compared", 119.0) == "119"
        assert display_value("baseline_years", 4.0) == "4"

    def test_a_measure_keeps_useful_precision(self):
        assert display_value("spread", 70.2) == "70.2"
        assert display_value("typical_spread", 22.02) == "22.02"

    def test_a_measure_is_rounded_not_shown_raw(self):
        # This is the branch a mutation proved was dead: display_value used to
        # ask unit_for_field(name, None), which returns None for every field,
        # so every value took the dimensionless path and the measure path was
        # never reached. The test passed for the wrong reason.
        assert display_value("spread", 6.71378) == "6.71"
        assert display_value("latest_value", 1234.5678) == "1234.57"

    def test_rounding_never_invents_precision(self):
        assert display_value("spread", 6.71378) == "6.71"
