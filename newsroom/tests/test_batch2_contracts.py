"""Batch-2 contracts: no repeated paragraphs, and a run that leaves a trace.

Two failures with one shape between them — something that was true about the
pipeline but that nothing could see.

A live tier A article ran six paragraphs on one fact, and every gate passed it
because correctness checks cannot see padding. And on 2026-08-25 the timer fired
on schedule, ran to completion, rejected every original article it wrote, and
nothing anywhere recorded that this had happened.
"""

from __future__ import annotations

import json
import pathlib
import re

import pytest

from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.runreport import LATEST_BLOB, build_run_report, write_run_report
from newsroom.pipeline.safety import validate
from newsroom.validator import CHECK_NAMES

NEWSROOM_DIR = pathlib.Path(__file__).resolve().parents[1]


def _article(*blocks) -> dict:
    """A minimal servable-shaped article carrying the given body blocks."""
    return {
        "id": "01J0",
        "slug": "test",
        "tier": "A",
        "status": "draft",
        "headline": "Estonian inflation eases to its slowest in four years",
        "dek": "The reading sits below every summer since the series turned.",
        "section": "economy",
        "body": list(blocks),
        "persona": {"byline": "Ilze Berzina · AI correspondent, Economy"},
    }


def _repeat_check(article: dict):
    """Run the real gate and hand back the one verdict under test.

    Through ``safety.validate`` rather than the raw validator, so the source
    registry and the persona registry are the live ones and the check is
    exercised exactly as the pipeline exercises it.
    """
    verdict = validate(article, signal={"payload": {}})
    return next(c for c in verdict.checks if c.name == "no_repeated_findings")


def _para(text: str, *fields: str) -> dict:
    return {
        "type": "paragraph",
        "text": text,
        "figures": [
            {"value": 1.0, "signal_field": name, "rendered_as": "1"} for name in fields
        ],
    }


class TestNoParagraphRestatesAnother:
    """The exact live failure, reduced.

        body[0]: "...decreased to 2% in July 2026, compared with the four-year
                  average of 9.62%."
        body[3]: "...significantly below its historical average for this time of
                  year, with the latest figure of 2% compared to the four-year
                  average of 9.62%."

    Both declared ``{latest_value, seasonal_mean}``. Six paragraphs, one fact.
    """

    def test_should_reject_two_paragraphs_resting_on_the_same_figures(self):
        article = _article(
            _para("Inflation eased in July, against the four-year average.",
                  "latest_value", "seasonal_mean"),
            _para("The reading is below its average for this time of year, "
                  "with the latest figure against the four-year average.",
                  "seasonal_mean", "latest_value"),
        )

        result = _repeat_check(article)

        assert not result.passed
        assert "body[1]" in result.detail and "body[0]" in result.detail

    def test_should_allow_the_same_field_beside_a_different_one(self):
        """The neighbours paragraph is a new claim about the same number.

        It is also the paragraph the wire was criticised for never writing, so
        a rule that killed it would be worse than the fault it fixes.
        """
        article = _article(
            _para("Inflation eased in July, against a year earlier.",
                  "latest_value", "year_ago"),
            _para("At that level Estonia sits below Latvia and Lithuania.",
                  "latest_value", "peer_lv", "peer_lt"),
        )

        assert _repeat_check(article).passed

    def test_should_not_collide_paragraphs_that_carry_no_figures(self):
        """Most paragraphs have none, and the prompt asks for exactly that."""
        article = _article(
            _para("Inflation eased in July.", "latest_value"),
            _para("The data does not show what drove the change."),
            _para("Nor does the release settle it."),
        )

        assert _repeat_check(article).passed

    def test_should_be_one_of_the_declared_checks(self):
        assert "no_repeated_findings" in CHECK_NAMES

    def test_should_appear_in_the_schema_enum(self):
        """``CHECK_NAMES`` and the schema must not drift."""
        schema = json.loads(
            (NEWSROOM_DIR / "schemas" / "article.schema.json").read_text(encoding="utf-8")
        )
        enum = schema["properties"]["provenance"]["properties"]["validator"][
            "properties"
        ]["checks"]["items"]["properties"]["name"]["enum"]

        assert "no_repeated_findings" in enum

    def test_should_fail_the_whole_verdict_not_just_the_check(self):
        article = _article(
            _para("Inflation eased against the four-year average.",
                  "latest_value", "seasonal_mean"),
            _para("It is below the four-year average.", "latest_value", "seasonal_mean"),
        )

        verdict = validate(article, signal={"payload": {}})

        assert not verdict.passed
        assert any(
            c.name == "no_repeated_findings" and not c.passed for c in verdict.checks
        )


class TestTheWriterIsToldAboutTheRepeat:
    def test_the_prompt_states_the_rule_it_is_now_checked_against(self):
        from newsroom.pipeline.safety import persona_for_section
        from newsroom.pipeline.write.prompts import build_system_prompt
        from newsroom.tests.pipeline.conftest import make_signal

        system = build_system_prompt(make_signal(), persona_for_section("economy"))

        assert "NO PARAGRAPH MAY RESTATE A FACT ALREADY ESTABLISHED" in system
        assert "identical" in system


class TestTheRunLeavesATrace:
    """A run that published nothing was indistinguishable from a timer that
    never fired, because App Insights receives nothing from this app."""

    def test_should_report_a_run_that_published_nothing(self):
        from newsroom.pipeline.run import RunReport

        document = build_run_report(RunReport(), trigger="timer")

        assert document["trigger"] == "timer"
        assert document["counts"]["published"] == 0
        assert document["finished_at"].endswith("Z")

    def test_should_separate_original_articles_from_the_published_count(self):
        """The count that hid the failure.

        On 2026-08-25 every tier A article was rejected and one syndicated card
        published. "1 published" was true and told nobody anything.
        """
        document = build_run_report(_five_rejected_originals(), trigger="timer")

        assert document["counts"]["published"] == 0
        assert document["original_articles"]["generated"] == 5
        assert document["original_articles"]["publishable"] == 0
        assert document["original_articles"]["attempts_total"] == 15

    def test_should_state_the_schedule_it_believes_it_is_on(self):
        """So a reader comparing it against the timestamps can see a
        disagreement rather than having to guess at one."""
        document = build_run_report(_five_rejected_originals(), trigger="manual")

        assert re.match(r"^[\d ,*/-]+$", document["schedule"]), document["schedule"]
        assert document["stale_after_hours"] > 0

    @pytest.mark.anyio
    async def test_should_write_the_latest_and_a_dated_copy(self, tmp_path):
        from newsroom.pipeline.run import RunReport

        store = ArticleStore(local_dir=tmp_path, account_url="")

        await write_run_report(
            RunReport(), trigger="timer", store=store, finished_at="2026-08-26T14:05:12Z"
        )

        written = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*.json"))
        assert written == ["runs/2026-08-26/140512.json", LATEST_BLOB]

    def test_should_never_raise_on_a_half_built_report(self):
        """It runs at the end of a run that may already have gone wrong.

        A reporter that raises while explaining a failure turns a bad run into
        a crashed one.
        """

        class Broken:
            errors = None
            published = None

        document = build_run_report(Broken(), trigger="timer")

        assert document["counts"]["published"] == 0


def _five_rejected_originals():
    class Article:
        slug = "x"
        provenance = {"attempts": 3}

    class Generated:
        publishable = False
        article = Article()

    class Report:
        generated = [Generated() for _ in range(5)]
        published: list = []
        rejected = [Article() for _ in range(5)]
        desk: list = []
        errors: list = []
        syndicated: list = []
        style_notes: list = []
        signals: list = []

        def summary(self):
            return "0 published, 5 rejected"

    return Report()


class TestTheScheduleSettingIsHonoured:
    """``NEWSROOM_SCHEDULE`` was set in Azure to three runs a day and the
    decorator hardcoded one. A knob that silently does nothing makes a
    deployment look configured when it is not."""

    def test_the_timer_reads_the_app_setting(self):
        source = (NEWSROOM_DIR / "function_app.py").read_text(encoding="utf-8")

        assert "schedule=config.SCHEDULE" in source, (
            "the timer hardcodes its cron again; the app setting is inert"
        )

    def test_the_timer_does_not_use_host_interpolation(self):
        """``%NEWSROOM_SCHEDULE%`` looks equivalent and is not.

        The host resolves ``%NAME%`` against application settings and has no
        default syntax, so on an app where the setting is missing the trigger
        binding fails and the function never registers — a publish that exits
        zero while leaving the wire dead. Reading the same setting from the
        environment in Python keeps the knob and keeps a working default.
        """
        source = (NEWSROOM_DIR / "function_app.py").read_text(encoding="utf-8")

        assert "%NEWSROOM_SCHEDULE%" not in source.replace(
            "``%NEWSROOM_SCHEDULE%``", ""
        ), "host interpolation cannot fall back, so a missing setting kills the timer"

    def test_config_supplies_a_working_default(self, monkeypatch):
        import importlib

        from newsroom.pipeline import config

        monkeypatch.delenv("NEWSROOM_SCHEDULE", raising=False)
        reloaded = importlib.reload(config)
        try:
            assert reloaded.SCHEDULE == "0 0 14 * * *"
        finally:
            importlib.reload(config)

    def test_the_run_report_states_the_same_schedule_the_timer_uses(self):
        """So the report cannot disagree with the trigger about what is in force."""
        from newsroom.pipeline import config
        from newsroom.pipeline.run import RunReport

        assert build_run_report(RunReport(), trigger="timer")["schedule"] == config.SCHEDULE
