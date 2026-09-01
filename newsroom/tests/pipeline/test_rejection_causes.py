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


# ── the closing, structurally ───────────────────────────────────────────

#: Ten consecutive PUBLISHED articles, all post-#82, every one closing on the
#: same skeleton. The banned list contained "will be crucial to assess"; the
#: model wrote "crucial to confirm", "crucial to determine", "crucial to
#: understanding", "essential to determine", "essential to assess" and "will
#: clarify whether". A blacklist does not hold against a paraphrase.
LIVE_FORMULA_CLOSINGS = (
    "The next quarterly report on business registrations will be crucial to "
    "confirm whether this trend continues.",
    "Future releases of the transport services balance will be essential to "
    "determine whether this shift persists.",
    "The next release of construction output figures will be essential to "
    "assess whether the recovery holds.",
    "The next release of inflation data for August 2026 will be crucial to "
    "confirm whether the trend continues.",
    "The next release of producer prices in July 2026 will clarify whether "
    "this trend continues or reverses.",
    "The next retail trade volume release for July 2026 will be crucial to "
    "determine if this upward trend continues.",
    "Upcoming data will provide insights into the sustainability of these "
    "labour cost increases.",
    "Future readings of hourly labour cost will be crucial to understanding "
    "the sustainability of the rise.",
    "Future data releases will be crucial to understanding whether this "
    "divergence is a temporary anomaly.",
    "The upcoming inflation figures for August 2026 will provide further "
    "insights into whether this trend continues.",
)

#: The three shapes the prompt actually asks for. None may be caught.
REAL_CLOSINGS = (
    "A second month below the seasonal mean would make this a contraction "
    "rather than a blip.",
    "The data shows what happened but not why, and nothing in the current "
    "release settles it.",
    "A third quarter of dry bulk above 2019 levels would confirm the shift; "
    "anything lower would not.",
    "Any August reading below the four-year average would end the run.",
    "The release does not establish what drove the change.",
    "If the next print holds above the seasonal mean, then the run is intact.",
)


class TestAClosingMustSayWhatAReadingWouldMean:
    """Whitelist the shape, because blacklisting the phrase provably loses.

    An empty closing makes a claim about the future of INFORMATION — the next
    release will tell us more, which is true of every release ever published.
    A real one makes a claim about the world or states a decision rule: what a
    specific reading would mean, or where the evidence stops. That distinction
    survives paraphrase, because every paraphrase is of the empty half.
    """

    @pytest.mark.parametrize("closing", LIVE_FORMULA_CLOSINGS)
    def test_should_catch_every_published_formula(self, closing):
        from newsroom.pipeline.house_style import closing_problems

        assert closing_problems(closing), (
            "this exact sentence shipped; the check does not see it"
        )

    @pytest.mark.parametrize("closing", REAL_CLOSINGS)
    def test_should_leave_a_real_closing_alone(self, closing):
        from newsroom.pipeline.house_style import closing_problems

        assert closing_problems(closing) == []

    def test_should_only_judge_the_last_paragraph(self):
        """A forward reference mid-article is ordinary reporting.

        "The figure is released quarterly, and the next release covers Q3" is
        a fact about the calendar. The rule is about how a piece STOPS.
        """
        from newsroom.pipeline.house_style import apply_house_style
        from newsroom.pipeline.models import Article, Block

        article = Article(
            id="1", slug="s", tier="A", status="draft",
            headline="Container traffic at Klaipeda reaches a series high",
            section="maritime", created_at="2026-08-26T00:00:00Z", provenance={},
            body=[
                Block(type="paragraph", text=(
                    "Volumes are published quarterly and the next release "
                    "covers the third quarter."
                )),
                Block(type="paragraph", text=(
                    "A third quarter above 2019 levels would confirm the shift."
                )),
            ],
        )

        report = apply_house_style(article)

        assert report.violations == []

    def test_should_catch_it_when_it_is_the_last_paragraph(self):
        from newsroom.pipeline.house_style import apply_house_style
        from newsroom.pipeline.models import Article, Block

        article = Article(
            id="1", slug="s", tier="A", status="draft",
            headline="Container traffic at Klaipeda reaches a series high",
            section="maritime", created_at="2026-08-26T00:00:00Z", provenance={},
            body=[
                Block(type="paragraph", text="Volumes reached a series high."),
                Block(type="paragraph", text=LIVE_FORMULA_CLOSINGS[0]),
            ],
        )

        report = apply_house_style(article)

        assert any("points at a future release" in v for v in report.violations)

    def test_the_prompt_asks_for_the_shape_the_check_tests(self):
        """The guidance and the gate must agree, or the writer is being set up.

        The old wording offered "the Q3 employment figures will show whether
        ..." as a legitimate close, which this check would refuse. Both now
        require the conditional.
        """
        from newsroom.pipeline.safety import persona_for_section
        from newsroom.pipeline.write.prompts import build_system_prompt

        system = build_system_prompt(make_signal(), persona_for_section("economy"))

        assert "NAME THE READING AND WHAT IT WOULD MEAN" in system
        assert "the check is not\nlooking at those words" in system

    def test_the_loop_hands_a_formula_closing_back(self):
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {"text": LIVE_FORMULA_CLOSINGS[8], "figures": []}
        clean = json.loads(json.dumps(GOOD_PAYLOAD))
        clean["blocks"][-1] = {"text": REAL_CLOSINGS[0], "figures": []}
        writer = StubWriter([payload, clean])

        result = generate_article(make_signal(), writer)

        assert result.publishable
        assert result.article.provenance["attempts"] == 2
        assert "points at a future release" in writer.calls[1]["user"]


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


# ── 3.7 the cut ────────────────────────────────────────────────────────────


class TestAnEmptyClosingIsCutRatherThanRewritten:
    """The fourth iteration, and the first that does not ask the model.

    Three strategies have failed against a live model. A blacklist lost to
    paraphrase across ten of ten articles. A structural check was satisfied by
    swapping WILL for WOULD in three of three. Revised prompt guidance did not
    help either, because ``generate_article`` publishes a validated article once
    its attempts run out -- house style adds no rejection path, so a check the
    model can outlast is bounded by the retry budget rather than by its own
    correctness.

    So the last attempt deletes the paragraph. Asking still happens first,
    because a model that fixes the closing gives us a real one and the attempts
    were going to be spent anyway.
    """

    def _article(self, *texts):
        from newsroom.pipeline.models import Article, Block

        return Article(
            id="1", slug="s", tier="A", status="draft",
            headline="Container traffic at Klaipeda reaches a series high",
            section="maritime", created_at="2026-08-26T00:00:00Z", provenance={},
            body=[Block(type="paragraph", text=t) for t in texts],
        )

    def test_the_paragraph_is_gone(self):
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article("Volumes reached a series high.", LIVE_FORMULA_CLOSINGS[0])

        report = apply_house_style(article, cut_empty_closings=True)

        assert len(article.body) == 1
        assert article.body[0].text == "Volumes reached a series high."
        assert report.cuts and "empty closing" in report.cuts[0]

    def test_asking_comes_first_so_a_good_rewrite_is_still_possible(self):
        """Without the flag it is reported, not cut. The generator sets the flag
        only on the final attempt, so the writer gets its chances."""
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article("Volumes reached a series high.", LIVE_FORMULA_CLOSINGS[0])

        report = apply_house_style(article)

        assert len(article.body) == 2, "cut on an attempt the writer could still use"
        assert any("points at a future release" in v for v in report.violations)

    def test_the_last_paragraph_is_never_taken(self):
        """An article of nothing but formula is a generation failure, not a
        copy-editing one. Emptying it would hide that from the validator."""
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article(LIVE_FORMULA_CLOSINGS[0])

        report = apply_house_style(article, cut_empty_closings=True)

        assert len(article.body) == 1
        assert not report.cuts
        assert any("points at a future release" in v for v in report.violations)

    def test_a_real_closing_survives_the_cut(self):
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article("Volumes reached a series high.", REAL_CLOSINGS[0])

        report = apply_house_style(article, cut_empty_closings=True)

        assert len(article.body) == 2
        assert not report.cuts

    def test_a_second_empty_closing_underneath_is_also_taken(self):
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article(
            "Volumes reached a series high.",
            LIVE_FORMULA_CLOSINGS[0],
            LIVE_FORMULA_CLOSINGS[1],
        )

        apply_house_style(article, cut_empty_closings=True)

        assert len(article.body) == 1

    def test_the_loop_cuts_when_the_writer_never_converges(self):
        """End to end. The writer returns the same formula every time, which is
        what it actually did in production, and the article publishes without
        the paragraph rather than with it."""
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {"text": LIVE_FORMULA_CLOSINGS[4], "figures": []}
        writer = StubWriter([json.loads(json.dumps(payload)) for _ in range(3)])

        result = generate_article(make_signal(), writer)

        assert result.publishable, "a formulaic closing must not spike the article"
        texts = [b.text for b in result.article.body if b.type == "paragraph"]
        assert LIVE_FORMULA_CLOSINGS[4] not in texts, "the empty closing was published"
        assert texts, "the article was emptied"

    def test_the_verdict_describes_the_article_that_remains(self):
        """A cut invalidates the stored verdict, which was computed against
        prose that is now gone. Re-running it keeps provenance honest."""
        payload = json.loads(json.dumps(GOOD_PAYLOAD))
        payload["blocks"][-1] = {"text": LIVE_FORMULA_CLOSINGS[4], "figures": []}
        writer = StubWriter([json.loads(json.dumps(payload)) for _ in range(3)])

        result = generate_article(make_signal(), writer)

        assert result.article.provenance["validator"]["passed"] is True
        assert result.verdict.passed


class TestTheGuidanceAgreesWithTheCheck:
    """A persona that teaches a closing the check deletes sets the writer up.

    ``closing_move`` for the economy beat used to read "names the specific
    release date and dataset that would confirm or overturn the reading" --
    which is the empty formula, described approvingly, in the instructions the
    writer is given. The check and the guidance have to be the same rule.
    """

    def test_no_persona_teaches_a_closing_the_check_refuses(self):
        import yaml

        from newsroom.pipeline.house_style import closing_problems

        raw = yaml.safe_load(
            (pathlib.Path(__file__).resolve().parents[3] / "newsroom" / "personas.yaml")
            .read_text(encoding="utf-8")
        )
        moves = [
            (spec.get("id") or spec.get("name"), spec["voice"]["closing_move"])
            for spec in (raw.get("personas") or [])
            if isinstance(spec, dict) and spec.get("voice", {}).get("closing_move")
        ]

        assert moves, "no closing_move found; the guard is reading the wrong shape"
        offenders = [(n, m) for n, m in moves if closing_problems(m)]
        assert not offenders, (
            "these personas instruct the writer to produce a closing house style "
            f"would delete: {offenders}"
        )


# ── 3.8 the desk's own guidance ────────────────────────────────────────────


class TestTheAnalystDoesNotSeedTheFormula:
    """The #99 finding, one layer up and confirmed in production.

    The analyst desk was told to file "the named next release or figure that
    would settle it", and its answer is handed to the writer under the heading
    WHAT WOULD SETTLE IT. A live brief read:

        "The next quarterly release of containerised cargo figures for 2026-Q2
         to see if this trend continues."

    and the article closed on almost exactly that. So the formula was not the
    model's invention twice over -- it was requested, in a structured field, and
    passed forward as editorial direction.

    Worse, that string PASSED `closing_problems` at the time: "to see if" uses
    no modal, so none of the informational-promise patterns matched it. The
    check caught the closing the writer built from it and never the seed.
    """

    LIVE_BRIEF = (
        "The next quarterly release of containerised cargo figures for 2026-Q2 "
        "to see if this trend continues."
    )

    def test_the_live_brief_is_now_recognised_as_empty(self):
        from newsroom.pipeline.house_style import closing_problems

        assert closing_problems(self.LIVE_BRIEF)

    def test_an_empty_what_to_watch_never_reaches_the_writer(self):
        """Dropped rather than rewritten, and dropped at the boundary: the desk
        may file what it likes, but the writer is not handed a formula and told
        it is what would settle the question."""
        from newsroom.pipeline.analyst import AnalystBrief

        brief = AnalystBrief(
            expert="e", discipline="d", angle="a", significance="b",
            what_to_watch=self.LIVE_BRIEF,
        )

        assert "WHAT WOULD SETTLE IT" not in brief.prompt_section()

    def test_a_real_one_is_passed_through(self):
        """The check must not silence the field it exists to improve."""
        from newsroom.pipeline.analyst import AnalystBrief

        brief = AnalystBrief(
            expert="e",
            discipline="d",
            angle="a",
            significance="b",
            what_to_watch=(
                "A second quarter above 2691 thousand tonnes would make this a "
                "level shift rather than a spike."
            ),
        )

        prompt = brief.prompt_section()
        assert "WHAT WOULD SETTLE IT" in prompt
        assert "2691" in prompt

    def test_the_desk_is_not_asked_for_a_closing_the_check_deletes(self):
        """Sibling to the persona guard in #99.

        Guidance and gate have to be the same rule wherever the guidance lives.
        `personas.yaml` was one place it did not; the analyst's own JSON
        template was another.
        """
        import pathlib

        from newsroom.pipeline.house_style import closing_problems

        source = (
            pathlib.Path(__file__).resolve().parents[2] / "pipeline" / "analyst.py"
        ).read_text(encoding="utf-8")
        start = source.index('"what_to_watch": "the value')
        instruction = " ".join(source[start : source.index('"caveats"', start)].split())

        assert not closing_problems(instruction), (
            "the analyst is instructed to produce a closing house style deletes"
        )
        assert "NOT merely that a release is due" in instruction


class TestTheArticleSaysWhichCodeWroteIt:
    """Provenance recorded the model, the prompt version and the time -- and not
    the revision. So "was this generated by the code I think it was?" was
    answered by comparing the article's timestamp against a deploy job's finish
    time, and that inference is wrong for the whole window in which Azure has
    accepted a package and not yet started serving it.

    That window is silent and of unknown length, and it has now produced two
    invalid measurements of this pipeline -- once concluding a merged fix did
    not work when it did.
    """

    def _provenance(self, monkeypatch, revision):
        from newsroom.pipeline import config
        from newsroom.pipeline.write import StubWriter, generate_article

        monkeypatch.setattr(config, "REVISION", revision)
        result = generate_article(make_signal(), StubWriter([GOOD_PAYLOAD]))
        return result.article.provenance

    def test_it_records_the_deployed_revision(self, monkeypatch):
        provenance = self._provenance(monkeypatch, "e6d756a1b2c3")

        assert provenance["revision"] == "e6d756a1b2c3"
        assert "revision_unavailable" not in provenance

    def test_an_unknown_revision_says_so_rather_than_guessing(self, monkeypatch):
        """The failure this must not have.

        A `revision` that degrades to "unknown", or to a constant committed in
        the tree, always looks plausible -- and a provenance stamp that cannot
        be false is worse than none, because it earns trust it has not
        verified. The two states are separate keys so nothing reading the
        artefact can confuse them.
        """
        provenance = self._provenance(monkeypatch, "")

        assert "revision" not in provenance
        assert "NEWSROOM_REVISION is not set" in provenance["revision_unavailable"]

    def test_the_two_keys_are_mutually_exclusive(self, monkeypatch):
        for value in ("abc123", ""):
            provenance = self._provenance(monkeypatch, value)
            assert ("revision" in provenance) != ("revision_unavailable" in provenance)

    def test_both_keys_are_declared_in_the_schema(self):
        """`provenance` sets `additionalProperties: false`, so an undeclared key
        is written happily and then fails the schema on the way out -- which is
        how every published article once violated its own contract."""
        import json
        import pathlib

        schema = json.loads(
            (pathlib.Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json")
            .read_text(encoding="utf-8")
        )
        declared = schema["properties"]["provenance"]["properties"]

        assert "revision" in declared
        assert "revision_unavailable" in declared

    def test_the_revision_is_not_read_from_the_tree(self):
        """A constant committed here would record what someone last typed,
        which is a different question from what Azure is serving."""
        import pathlib

        source = (
            pathlib.Path(__file__).resolve().parents[2] / "pipeline" / "config.py"
        ).read_text(encoding="utf-8")

        assert 'REVISION = _setting("NEWSROOM_REVISION")' in source, (
            "the revision must come from the environment the app runs in"
        )

    def test_the_revision_really_comes_from_the_environment(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """The behaviour, because the assertion above is a substring and a
        substring survives an ADDITION.

        Measured rather than supposed. Appending one line to `config.py`, so
        that the guarded text is still present verbatim:

            REVISION = _setting("NEWSROOM_REVISION")
            REVISION = "deadbeef-not-from-the-environment"

        leaves the substring assertion green -- and the whole newsroom suite
        green, 2749 passed. The shadowed value is what every article would then
        carry, and `provenance.revision` is the one field that says which code
        produced a piece. It was used on 2026-09-01 to prove a timeout fix was
        live; a hardcoded value would have made that proof a formality.

        Reading the environment is trivially testable, so there is no reason
        for the source-text check to be the only one. It stays as a second
        line: it names the specific construction we want, which a behavioural
        test cannot.
        """
        import importlib

        import newsroom.pipeline.config as config

        monkeypatch.setenv("NEWSROOM_REVISION", "b0a7c0ffee")
        reloaded = importlib.reload(config)
        try:
            assert reloaded.REVISION == "b0a7c0ffee", (
                "REVISION did not follow the environment; something in config.py "
                "is overriding it"
            )

            # CONTROL: it must also follow the environment DOWN, or a hardcoded
            # value equal to the fixture would pass the assertion above.
            monkeypatch.delenv("NEWSROOM_REVISION", raising=False)
            assert importlib.reload(config).REVISION == "", (
                "REVISION survived the variable being unset, so it is not "
                "reading it"
            )
        finally:
            # Leave the module as the rest of the suite expects to find it.
            monkeypatch.delenv("NEWSROOM_REVISION", raising=False)
            importlib.reload(config)
