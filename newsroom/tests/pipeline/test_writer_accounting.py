"""Count actual logical calls, not the ordinal on the retained draft."""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from newsroom.pipeline.run import RunReport, _revision_for
from newsroom.pipeline.runreport import build_run_report
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.pipeline.write.generator import GenerationRefused
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD, _EMPTY_CLOSING, _payload_closing


def reported(report):
    return build_run_report(report, trigger="test")["original_articles"]


def test_discarded_retries_count_even_when_the_first_draft_is_kept():
    report = RunReport(writer_attempts=[])
    writer = StubWriter([_payload_closing(_EMPTY_CLOSING), {}, {}])
    result = generate_article(make_signal(), writer, attempt_log=report.writer_attempts)
    report.generated.append(result)

    assert result.publishable
    assert result.article.provenance["attempts"] == 1
    assert len(writer.calls) == 3
    counts = reported(report)
    assert counts["attempts_total"] == 3
    assert counts["attempts_max"] == 3
    assert counts["writer_calls"]["returned"] == 3
    assert counts["writer_calls"]["failed"] == 0


@pytest.mark.parametrize("accepted", [True, False])
def test_desk_attempts_count_whether_the_revision_is_used_or_discarded(accepted):
    report = RunReport(writer_attempts=[])
    result = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD), attempt_log=report.writer_attempts)
    report.generated.append(result)
    before = deepcopy(result.article.provenance)
    payload = deepcopy(GOOD_PAYLOAD)
    if not accepted:
        payload["blocks"][0]["text"] += " There are 99999 people registered."
    writer = StubWriter(payload)

    revision = _revision_for(result, writer, report)(result.article, ["Keep the supported comparison."])

    assert (revision is not None) is accepted
    assert result.article.provenance == before
    counts = reported(report)
    assert counts["attempts_total"] == 1 + len(writer.calls)
    assert counts["writer_calls"]["by_phase"] == {"initial": 1, "desk_revision": 1 if accepted else 3}
    assert counts["writer_calls"]["returned"] == counts["attempts_total"]


class FailingWriter:
    model_name = "offline-failure-control"

    def complete_json(self, **kwargs):
        raise RuntimeError("synthetic writer failure")


def test_a_failed_initial_call_is_counted_without_a_generated_article():
    report = RunReport(writer_attempts=[])
    with pytest.raises(RuntimeError, match="synthetic writer failure"):
        generate_article(make_signal(), FailingWriter(), attempt_log=report.writer_attempts)
    counts = reported(report)
    assert counts["generated"] == 0
    assert counts["attempts_total"] == 1
    assert counts["writer_calls"]["failed"] == 1
    assert counts["writer_calls"]["returned"] == 0


def test_a_failed_desk_call_is_counted_without_replacing_the_original():
    report = RunReport(writer_attempts=[])
    result = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD), attempt_log=report.writer_attempts)
    report.generated.append(result)
    assert _revision_for(result, FailingWriter(), report)(result.article, ["Shorten."]) is None
    assert report.errors
    assert result.publishable
    assert reported(report)["attempts_total"] == 2
    assert reported(report)["writer_calls"]["failed"] == 1


def test_a_refusal_before_the_writer_does_not_consume_an_attempt():
    report = RunReport(writer_attempts=[])
    writer = StubWriter(GOOD_PAYLOAD)
    with pytest.raises(GenerationRefused):
        generate_article(
            make_signal(), writer, editor_notes=["No draft supplied."],
            attempt_log=report.writer_attempts,
        )
    assert writer.calls == []
    assert reported(report)["attempts_total"] == 0
    assert reported(report)["attempts_basis"] == "invocation_ledger"


def test_legacy_report_counts_are_explicitly_incomplete_not_an_empty_ledger():
    result = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD))
    counts = reported(RunReport(generated=[result]))
    assert counts["attempts_total"] == 1
    assert counts["attempts_basis"] == "retained_draft_ordinals"
    assert "writer_calls" not in counts


@pytest.mark.parametrize("fails", [False, True])
async def test_daily_runner_wires_the_ledger_even_when_no_article_is_returned(tmp_path, monkeypatch, fails):
    from newsroom.pipeline import run
    from newsroom.pipeline.analyst import AnalystBrief
    from newsroom.pipeline.hypothesis import HypothesisPanel
    from newsroom.pipeline.publish import ArticleStore

    signal = make_signal()
    monkeypatch.setattr(run, "evidence_enabled", lambda: False)
    monkeypatch.setattr(run, "collect_open_data", AsyncMock(return_value=[]))
    monkeypatch.setattr(run, "detect_all", lambda *a, **kw: [signal])
    monkeypatch.setattr(run, "gate", lambda *a: SimpleNamespace(
        kept=[signal], suppressed=[], summary=lambda: "offline control",
    ))
    monkeypatch.setattr(run, "rank", lambda *a, **kw: SimpleNamespace(selected=[signal]))
    monkeypatch.setattr(run, "deepen_all", AsyncMock(return_value={}))
    monkeypatch.setattr(run, "analyse", lambda *a, **kw: AnalystBrief("", ""))
    monkeypatch.setattr(run, "consult_panel", lambda *a, **kw: HypothesisPanel())
    monkeypatch.setattr(run, "_watch_revisions", AsyncMock())
    monkeypatch.setattr(run, "issue_corrections", AsyncMock(return_value=[]))
    writer = FailingWriter() if fails else StubWriter([
        GOOD_PAYLOAD, {"decision": "approve", "reason": "Supported copy.", "notes": []},
    ])

    report = await run.run_once(
        writer=writer, store=ArticleStore(local_dir=tmp_path, account_url=""),
        http=SimpleNamespace(), include_syndication=False,
    )

    counts = reported(report)
    assert counts["attempts_basis"] == "invocation_ledger"
    assert counts["attempts_total"] == 1
    assert counts["writer_calls"]["failed"] == int(fails)
    assert counts["writer_calls"]["returned"] == int(not fails)
    assert len(report.generated) == int(not fails)
    if not fails:
        assert len(writer.calls) == 2, "the editor call must not be counted as a writer draft"


@pytest.mark.parametrize("fails", [False, True])
async def test_weekly_report_counts_rejected_and_failed_writer_calls(fails):
    from newsroom.pipeline.weekly import write_weekly
    from newsroom.tests.pipeline.test_weekly import NOW, a_week

    rows = a_week()
    store = SimpleNamespace(published_slugs=AsyncMock(return_value={f.slug for f in rows}))
    vintages = SimpleNamespace(load=AsyncMock(return_value=rows))
    writer = FailingWriter() if fails else StubWriter({})

    outcome = await write_weekly(store, writer, vintages=vintages, now=NOW)

    assert outcome.outcome == ("error" if fails else "draft_refused")
    calls = outcome.to_json()["writer_calls"]
    assert calls["total"] == (1 if fails else 3)
    assert calls["failed"] == int(fails)
    assert calls["returned"] == (0 if fails else 3)


async def test_a_quiet_week_has_a_measured_zero_not_an_unavailable_ledger():
    from newsroom.pipeline.weekly import write_weekly
    from newsroom.tests.pipeline.test_weekly import NOW

    store = SimpleNamespace(published_slugs=AsyncMock(return_value=set()))
    outcome = await write_weekly(
        store, FailingWriter(), vintages=SimpleNamespace(load=AsyncMock(return_value=[])), now=NOW,
    )
    assert outcome.outcome == "not_enough_findings"
    assert outcome.to_json()["writer_calls"]["total"] == 0


def test_weekly_desk_callback_keeps_failed_revision_attempts():
    from newsroom.pipeline.weekly import _wrap_revision, collect_week
    from newsroom.tests.pipeline.test_weekly import NOW, a_week
    from newsroom.pipeline.write.accounting import summarize_attempts

    original = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD)).article
    ledger = []
    callback = _wrap_revision(make_signal(), FailingWriter(), collect_week(a_week(), now=NOW), ledger)
    assert callback(original, ["Keep supported copy."]) is None
    assert summarize_attempts(ledger)["by_phase"] == {"initial": 0, "desk_revision": 1}
    assert summarize_attempts(ledger)["failed"] == 1


async def test_invocation_counts_survive_durable_report_readback(tmp_path):
    from newsroom.pipeline.publish import ArticleStore
    from newsroom.pipeline.runreport import write_run_report

    report = RunReport(writer_attempts=[])
    result = generate_article(
        make_signal(), StubWriter([_payload_closing(_EMPTY_CLOSING), {}, {}]),
        attempt_log=report.writer_attempts,
    )
    report.generated.append(result)
    store = ArticleStore(local_dir=tmp_path, account_url="")
    document = await write_run_report(
        report, trigger="test", store=store, finished_at="2026-09-14T12:00:00Z",
    )
    for path in ("runs/latest.json", "runs/2026-09-14/120000.json"):
        saved = await store.read_json(path)
        assert saved == document
        assert saved["original_articles"]["attempts_total"] == 3
        assert saved["original_articles"]["writer_calls"]["returned"] == 3
