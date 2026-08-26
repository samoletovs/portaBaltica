"""The three things the rejection forensics found, pinned.

A pass over 200 rejected blobs from 24-26 Aug produced a histogram nobody could
have guessed:

    validator kill (attempts exhausted)   41   52%
      no_invented_numbers alone           16
      comparison_basis_stated alone       12
    desk reject                           36   46%
      unsupported assertions about
      causation or impact                 24   <- 30% of ALL rejections

So the single largest cause of an article dying is the writer appending a
paragraph about who a statistic affects, which it has no source for. Second is
a numeric false positive on a label rather than a data value.

None of this was visible without downloading and parsing every blob, which is
the third thing fixed here.
"""

from __future__ import annotations

import json
import logging
import pathlib

import pytest
from jsonschema import Draft202012Validator

from newsroom import numeric_scan
from newsroom.pipeline.house_style import check_prose
from newsroom.pipeline.models import Block
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.pipeline.write.reconcile import _matching_fields, reconcile_block
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

logging.disable(logging.CRITICAL)

NEWSROOM = pathlib.Path(__file__).resolve().parents[2]


# ── 3.5 the speculative impact paragraph ────────────────────────────────

#: Verbatim from the corpus, or reduced from it.
KILLED_ARTICLES = (
    "This increase in construction output directly impacts the construction "
    "sector and real estate developers.",
    "This decline impacts manufacturers directly, as tighter margins may lead "
    "to reduced investment in production capabilities and innovation.",
    "The change may lead to reduced hiring across the economy.",
    "Lower prices could put pressure on producers.",
    "The reading poses challenges for exporters.",
    "This has implications for households already facing higher bills.",
)

#: Sentences that must survive. The wire exists to write these.
MUST_SURVIVE = (
    "This is what an Estonian employer pays for an hour of work, before any of "
    "it reaches a worker's bank account.",
    "The data does not show what drove the change.",
    # The negative control. A bare "impact" is ordinary English and the rule
    # must not be a word-match.
    "The impact of the storm on generation was recorded separately.",
    "Employers have paid more for an hour of work every year since the series began.",
    "A second month below the seasonal mean would make this a contraction rather than a blip.",
    "Klaipeda handled more dry bulk than any quarter since 2019.",
)


class TestTheParagraphThatKillsMostArticles:
    @pytest.mark.parametrize("sentence", KILLED_ARTICLES)
    def test_should_catch_a_speculative_consequence(self, sentence):
        problems = check_prose(sentence)

        assert problems, (
            "this construction accounts for 30% of every tier A rejection and "
            "the deterministic gate does not see it"
        )
        assert "speculates about consequences" in problems[0]

    @pytest.mark.parametrize("sentence", MUST_SURVIVE)
    def test_should_leave_honest_prose_alone(self, sentence):
        assert check_prose(sentence) == [], (
            "a rule that eats legitimate prose costs more than the fault it fixes"
        )

    def test_should_be_caught_in_the_loop_not_at_the_desk(self):
        """Free, and while the writer can still act on it.

        Catching it at the desk costs a full revision cycle -- a fresh
        generation plus two more editor reads -- and usually the article. The
        generation loop already treats a style violation like a validator
        failure, so this is a substring match away from being free.
        """
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {
            "text": KILLED_ARTICLES[0],
            "figures": [],
        }
        clean = json.loads(json.dumps(GOOD_PAYLOAD))
        clean["blocks"][-1] = {
            "text": "The next monthly release is what would overturn it.",
            "figures": [],
        }
        writer = StubWriter([payload, clean])

        result = generate_article(make_signal(), writer)

        assert result.publishable
        assert result.article.provenance["attempts"] == 2
        assert "speculates about consequences" in writer.calls[1]["user"]

    def test_the_prompt_forbids_it_too(self):
        from newsroom.pipeline.safety import persona_for_section
        from newsroom.pipeline.write.prompts import build_system_prompt

        system = build_system_prompt(make_signal(), persona_for_section("economy"))

        assert "NEVER WRITE THAT A STATISTIC IMPACTS OR AFFECTS ANYONE" in system

    def test_the_desk_treats_it_as_a_cut_rather_than_a_rejection(self):
        """Sharpening the desk added rejections, not articles.

        The desk was already refusing these at 30%, on pieces whose figures
        were sound -- one carried cross-country comparison and history and was
        better than several that ran. A speculative paragraph is removable, so
        the desk is now told to approve and say so rather than send it back.
        """
        from newsroom.pipeline.desk import SYSTEM_PROMPT

        assert "A speculative impact paragraph is a CUT, not a rewrite" in SYSTEM_PROMPT
        assert "APPROVE it with the note" in SYSTEM_PROMPT


# ── 3.6 the numeric false positive on a label ───────────────────────────


class TestALabelIsNotAMeasurement:
    """"4-year average" was 8 of 16 ``no_invented_numbers`` kills.

    The basis already spells it -- ``spell_count`` made it "the five-year
    average" -- so the pipeline is clean. The failure is what happens when the
    writer renders it back as "5-year average": ``baseline_years`` is 5 exactly
    and ``deviation`` is 5.4, which rounds to 5, so the token has two parents,
    the reconciler correctly refuses to guess between them, and the article
    dies on a numeral the pipeline itself supplied.
    """

    FIELDS = {
        "latest_value": 23.5,
        "seasonal_mean": 18.1,
        "deviation": 5.4,
        "baseline_years": 5.0,
    }

    def test_a_count_beats_a_measurement_that_merely_rounds_to_it(self):
        token = numeric_scan.scan("the 5-year average")[0]

        matches = _matching_fields(token, self.FIELDS)

        assert [name for name, _ in matches] == ["baseline_years"]

    def test_so_the_reconciler_files_it(self):
        block = Block(
            type="paragraph",
            text="The reading sits above the 5-year average of 18.1 degrees.",
            figures=[],
        )

        reconcile_block(block, self.FIELDS)

        declared = {figure.signal_field for figure in block.figures}
        assert "baseline_years" in declared, "the window size is still undeclarable"
        assert "seasonal_mean" in declared

    def test_a_decimal_token_is_not_captured_by_the_count(self):
        """"5.0" does not match a deviation of 5.4 at all, so there is nothing
        to disambiguate and the count must not be reaching for it."""
        token = numeric_scan.scan("a deviation of 5.4 degrees")[0]

        assert [name for name, _ in _matching_fields(token, self.FIELDS)] == ["deviation"]

    def test_two_plain_fields_are_still_refused(self):
        """The general ambiguity rule is untouched.

        This is master's own ``test_refuses_an_ambiguous_token`` restated: a
        preference between two measurements would be a guess dressed as a
        policy, and only the count/measurement distinction justifies choosing.
        """
        token = numeric_scan.scan("The reading was 100.")[0]

        matches = _matching_fields(token, {"a": 100.0, "b": 100.4})

        assert len(matches) == 2

    def test_a_period_count_is_already_bound(self):
        """"119 earlier periods" -- 7 of 16 -- closed by ``periods_compared``."""
        signal = make_signal(
            comparison_basis=(
                "the median spread of 10.87 EUR/MWh across the 119 earlier "
                "daily readings in the series"
            ),
            fields={"spread": 49.64, "typical_spread": 10.87, "periods_compared": 119.0},
        )
        token = next(
            t for t in numeric_scan.scan(signal.comparison_basis) if t.text == "119"
        )

        assert [n for n, _ in _matching_fields(token, signal.fields)] == ["periods_compared"]


# ── 3.8 the rejection reason, on the artifact ───────────────────────────


class TestARejectedDraftSaysWhyItWasRejected:
    """The forensic pass needed 200 blob downloads because it had to.

    A rejected draft recorded that it had failed and nothing about what failed:
    the verdict is eight checks deep in ``provenance.validator``, and a shape
    failure left no trace there at all. Three days of the wire publishing
    almost nothing went unnoticed for exactly that reason.
    """

    def test_a_validator_kill_names_its_gate_and_checks(self):
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][0]["text"] = "Unemployment reached 47.2% in July."

        article = generate_article(
            make_signal(), StubWriter(payload), max_attempts=1
        ).article

        rejection = article.provenance["rejection"]
        assert article.status == "rejected"
        assert rejection["gate"] == "validator"
        assert "no_invented_numbers" in rejection["checks"]
        assert "47.2" in rejection["detail"]

    def test_a_shape_kill_says_so_rather_than_leaving_no_trace(self):
        article = generate_article(
            make_signal(),
            StubWriter({"headline": "tiny", "dek": None, "blocks": [], "tags": []}),
            max_attempts=1,
        ).article

        rejection = article.provenance["rejection"]
        assert rejection["gate"] == "article_shape"
        assert "headline is 4 characters" in rejection["detail"]

    def test_a_published_article_carries_no_rejection_record(self):
        article = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD)).article

        assert article.status == "published"
        assert "rejection" not in article.provenance


class TestTheSchemaIsActuallyTheContract:
    """It calls itself "the publication contract" and was not one.

    ``attempts``, ``comparison_basis``, ``signal_detector`` and
    ``signal_finding`` were all written into provenance and none was declared,
    so every published article violated the schema under
    ``additionalProperties: false`` — and nothing noticed, because nothing
    validated a real article against it.
    """

    @staticmethod
    def _validator() -> Draft202012Validator:
        schema = json.loads(
            (NEWSROOM / "schemas" / "article.schema.json").read_text(encoding="utf-8")
        )
        return Draft202012Validator(schema)

    def test_a_generated_published_article_validates(self):
        article = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD)).article

        errors = [e.message for e in self._validator().iter_errors(article.to_json())]

        assert errors == []

    def test_a_rejected_draft_validates_apart_from_the_shape_that_failed(self):
        """Its provenance must still be legal, or the audit trail is unreadable."""
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][0]["text"] = "Unemployment reached 47.2% in July."
        article = generate_article(
            make_signal(), StubWriter(payload), max_attempts=1
        ).article

        provenance_errors = [
            e.message
            for e in self._validator().iter_errors(article.to_json())
            if e.absolute_path and e.absolute_path[0] == "provenance"
        ]

        assert provenance_errors == []
