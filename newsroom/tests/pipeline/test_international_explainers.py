"""Commissioned comparisons keep factual, editorial and storage gates intact."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest

from newsroom.pipeline import international_explainers as explainers
from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.international import parse_owid, parse_worldbank
from newsroom.pipeline.desk import Finding
from newsroom.pipeline.field_meanings import meaning_for_field, quantity_note
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.safety import persona_for_section
from newsroom.pipeline.vintage import VintageStore
from newsroom.pipeline.write.generator import _article_from_payload
from newsroom.pipeline.write.llm import StubWriter
from newsroom.tests.pipeline.test_international_context import (
    NOW, OWID_CSV, owid_metadata, raw, response_for, wb_data, wb_metadata,
)


def bank_commission(payload: list[Any] | None = None) -> explainers.Commission:
    collected = parse_worldbank(
        raw("worldbank", payload if payload is not None else wb_data()),
        raw("worldbank", wb_metadata(), suffix="metadata"), end_year=2025,
    )
    return explainers.commission(collected, end_year=2025)


def emissions_commission() -> explainers.Commission:
    collected = parse_owid(
        raw("owid", OWID_CSV, csv_body=True),
        raw("owid", owid_metadata(), suffix="metadata"), end_year=2025,
    )
    return explainers.commission(collected, end_year=2025)


def payload(selected: explainers.Commission) -> dict[str, Any]:
    signal = selected.signal
    fields = signal.fields
    return {
        "headline": f"Baltic countries show different annual levels in {signal.period}",
        "dek": "An annual comparison on a shared definition.",
        "blocks": [
            {
                "text": f"In {signal.period}, Latvia recorded {fields['value_lv']:g}.",
                "figures": [{"value": fields["value_lv"], "signal_field": "value_lv"}],
            },
            {
                "text": f"Estonia recorded {fields['value_ee']:g} on the same measure.",
                "figures": [{"value": fields["value_ee"], "signal_field": "value_ee"}],
            },
            {
                "text": f"Lithuania recorded {fields['value_lt']:g} for the same year.",
                "figures": [{"value": fields["value_lt"], "signal_field": "value_lt"}],
            },
            {
                "text": f"The gap between the highest and lowest country was {fields['spread']:g} in {signal.period}.",
                "figures": [{"value": fields["spread"], "signal_field": "spread"}],
            },
        ],
        "tags": ["baltic", "comparison"],
    }


APPROVE = {"decision": "approve", "reason": "The comparison is clear and source-bound.", "notes": []}


def test_commission_is_same_year_and_does_not_claim_a_news_ranking() -> None:
    data = wb_data()
    data[1][2]["value"] = None
    chosen = bank_commission(data)
    assert chosen.signal.period == "2024"
    assert chosen.signal.fields["value_lv"] == 27
    assert chosen.signal.fields["value_ee"] == 37
    assert chosen.signal.fields["value_lt"] == 47
    assert chosen.signal.fields["spread"] == 20
    assert chosen.signal.fields["price_base_year"] == 2021
    assert chosen.signal.field_units["price_base_year"] is None
    assert chosen.signal.score == 0
    assert chosen.signal.detector == "commissioned_comparison"
    assert "not salary" in chosen.signal.context["measurement_scope"]
    assert chosen.signal.sources[1].url.endswith("/metadata")
    assert "not an aggregate" in meaning_for_field(chosen.signal, "spread")
    assert "gap" in quantity_note(chosen.signal).lower()
    finding = Finding(chosen.signal.detector, chosen.signal.comparison_basis, False, commissioned=True)
    assert "not a ranked daily" in finding.strength
    assert "strongest findings" not in finding.strength


def test_missing_common_year_refuses_commission() -> None:
    data = wb_data()
    data[1] = [row for row in data[1] if row["countryiso3code"] != "LTU"]
    data[0]["total"] = len(data[1])
    with pytest.raises(ValueError, match="shared observation year"):
        bank_commission(data)


def test_commissioned_fields_have_distinct_complete_meanings() -> None:
    for chosen in (bank_commission(), emissions_commission()):
        assert quantity_note(chosen.signal)
        meanings = [meaning_for_field(chosen.signal, field) for field in chosen.signal.fields]
        assert all(meanings)
        assert len(set(meanings)) == len(meanings)
        assert all(not re.search(r"\d", meaning.replace(chosen.signal.period, "")) for meaning in meanings)


def test_checked_article_has_frozen_raw_observations_and_no_unresolvable_live_chart() -> None:
    chosen = bank_commission()
    writer = StubWriter([payload(chosen), APPROVE])
    attempts = []
    article = explainers.evaluate_article(chosen, writer, attempts=attempts)
    assert article.status == "published"
    assert article.headline == "Comparing Baltic GDP per person after adjusting for prices in 2025"
    assert article.provenance["validator"]["passed"]
    assert article.provenance["editor"]["decision"] == "approve"
    assert article.provenance["editor"]["model"] == "stub-model"
    assert article.provenance["signal_detector"] == "commissioned_comparison"
    assert all(block.type != "chart" for block in article.body)
    readings = article.provenance["published_observations"]
    assert len(readings) == 4
    assert [(r["geography"], r["value"], r["period"]) for r in readings if r["raw_source"]] == [
        ("LV", 30.0, "2025"), ("EE", 40.0, "2025"), ("LT", 50.0, "2025"),
    ]
    assert sum(r["summary"] for r in readings) == 1
    assert "commissioned annual comparison" in writer.calls[-1]["user"]
    assert len(attempts) == 1


def test_commissioned_headline_does_not_inherit_an_unsupported_record_claim() -> None:
    chosen = emissions_commission()
    draft = payload(chosen)
    draft["headline"] = "Baltic emissions gap reaches its widest ever"
    writer = StubWriter([draft, APPROVE])
    article = explainers.evaluate_article(chosen, writer, attempts=[])
    assert article.status == "published"
    assert article.headline == "Comparing Baltic territorial CO2 emissions per person in 2024"
    assert article.headline in writer.calls[-1]["user"]
    assert "widest ever" not in writer.calls[-1]["user"]


def test_an_editorial_rejection_cannot_publish_a_factually_valid_article() -> None:
    chosen = bank_commission()
    writer = StubWriter([payload(chosen), {"decision": "reject", "reason": "Not useful enough."}])
    article = explainers.evaluate_article(chosen, writer, attempts=[])
    assert article.provenance["validator"]["passed"]
    assert article.status == "rejected"
    assert article.provenance["editor"]["decision"] == "reject"
    assert "published_observations" not in article.provenance


def test_supplied_context_does_not_introduce_an_unverifiable_historical_claim() -> None:
    chosen = bank_commission()
    draft = payload(chosen)
    draft["blocks"].append({"text": " ".join(chosen.context.observations), "figures": []})
    result = _article_from_payload(
        draft, signal=chosen.signal, persona=persona_for_section(chosen.signal.section),
        writer=StubWriter(draft), created_at=NOW.isoformat(), research=None,
        attempts=1, pack=chosen.context, live_chart=False, headline_override=chosen.headline,
    )
    assert result.article.status == "published"
    verdict = result.article.provenance["validator"]
    assert verdict["passed"]
    assert next(check for check in verdict["checks"] if check["name"] == "record_claim_holds")["passed"]


def test_an_invented_number_never_reaches_the_editor() -> None:
    chosen = bank_commission()
    invalid = copy.deepcopy(payload(chosen))
    invalid["blocks"][0]["text"] = "Latvia recorded 987654321."
    writer = StubWriter(invalid)
    article = explainers.evaluate_article(chosen, writer, attempts=[])
    assert article.status == "rejected"
    assert not article.provenance["validator"]["passed"]
    assert "editor" not in article.provenance
    assert len(writer.calls) == 3


async def run_mock(
    tmp_path: Path, writer: StubWriter, *, publish: bool, store: ArticleStore | None = None,
) -> dict[str, Any]:
    archive = RawArchive(local_dir=tmp_path / "raw", account_url="")
    articles = store or ArticleStore(local_dir=tmp_path / "articles", account_url="")
    vintages = VintageStore(local_dir=tmp_path / "articles", account_url="")
    async with httpx.AsyncClient(transport=httpx.MockTransport(response_for)) as client:
        async with CollectorHttp(
            archive, client=client, state=ConditionalState(tmp_path / "state.json"), max_retries=1,
        ) as http:
            return await explainers.run(http, writer, articles, vintages, publish=publish, archive=archive)


async def test_publication_indexes_both_articles_and_repeat_uses_no_writer_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    writer = StubWriter([payload(bank_commission()), APPROVE, payload(emissions_commission()), APPROVE])
    first = await run_mock(tmp_path, writer, publish=True)
    assert first["status"] == "ok"
    assert [row["status"] for row in first["results"]] == ["published", "published"]
    assert [row["period"] for row in first["results"]] == ["2025", "2024"]
    assert first["writer_attempts"]["total"] == 2
    index = json.loads((tmp_path / "articles" / "index.json").read_bytes())
    assert index["count"] == 2
    assert {row["slug"] for row in first["results"]} == {row["slug"] for row in index["articles"]}
    ledger = json.loads((tmp_path / "articles" / "vintages.json").read_bytes())
    assert ledger["count"] == 8
    unused = StubWriter({})
    repeat = await run_mock(tmp_path, unused, publish=True)
    assert [row["status"] for row in repeat["results"]] == ["already_published", "already_published"]
    assert unused.calls == []
    assert json.loads((tmp_path / "articles" / "index.json").read_bytes())["count"] == 2


async def test_preview_never_creates_a_public_index_or_vintage_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    writer = StubWriter([payload(bank_commission()), APPROVE, payload(emissions_commission()), APPROVE])
    report = await run_mock(tmp_path, writer, publish=False)
    assert report["mode"] == "local_preview"
    assert all(row["status"] == "preview" and row["url"] is None for row in report["results"])
    assert not (tmp_path / "articles" / "index.json").exists()
    assert not (tmp_path / "articles" / "vintages.json").exists()


async def test_publication_preserves_preexisting_index_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    older = wb_data()
    for row in older[1]:
        row["date"] = str(int(row["date"]) - 2)
    old_commission = bank_commission(older)
    old_article = explainers.evaluate_article(
        old_commission, StubWriter([payload(old_commission), APPROVE]), attempts=[],
    )
    store = ArticleStore(local_dir=tmp_path / "articles", account_url="")
    await store.put(old_article)
    await store.write_index([old_article])
    writer = StubWriter([payload(bank_commission()), APPROVE, payload(emissions_commission()), APPROVE])
    result = await run_mock(tmp_path, writer, publish=True, store=store)
    assert result["status"] == "ok"
    index = json.loads((tmp_path / "articles" / "index.json").read_bytes())
    assert index["count"] == 3
    assert old_article.slug in {entry["slug"] for entry in index["articles"]}


async def test_publication_promotes_cached_preview_bytes_to_the_configured_archive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    replies = [payload(bank_commission()), APPROVE, payload(emissions_commission()), APPROVE]
    await run_mock(tmp_path, StubWriter(replies), publish=False)
    stored = []
    original = RawArchive.store

    async def record_store(self: RawArchive, item: Any) -> str:
        stored.append(item)
        return await original(self, item)

    monkeypatch.setattr(RawArchive, "store", record_store)
    result = await run_mock(tmp_path, StubWriter(replies), publish=True)
    assert result["status"] == "ok"
    assert len(stored) == 4
    assert all(item.from_cache for item in stored)
    assert [item.source_id for item in stored] == ["worldbank", "worldbank", "owid", "owid"]


async def test_rejected_articles_do_not_reach_the_index_or_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    reject = {"decision": "reject", "reason": "The explanation is not sufficient."}
    writer = StubWriter([payload(bank_commission()), reject, payload(emissions_commission()), reject])
    report = await run_mock(tmp_path, writer, publish=True)
    assert report["status"] == "incomplete"
    assert all(row["status"] == "rejected" for row in report["results"])
    assert not (tmp_path / "articles" / "index.json").exists()
    assert not (tmp_path / "articles" / "vintages.json").exists()


async def test_failed_index_write_is_not_reported_as_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers, "utcnow", lambda: NOW)
    store = ArticleStore(local_dir=tmp_path / "articles", account_url="")

    async def broken_index(_articles: Any) -> str:
        raise OSError("index unavailable")

    monkeypatch.setattr(store, "write_index", broken_index)
    writer = StubWriter([payload(bank_commission()), APPROVE, payload(emissions_commission()), APPROVE])
    report = await run_mock(tmp_path, writer, publish=True, store=store)
    assert report["status"] == "incomplete"
    assert all(row["status"] == "failed" for row in report["results"])
    assert not (tmp_path / "articles" / "index.json").exists()


async def test_live_publication_requires_explicit_storage_and_code_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(explainers.config, "STORAGE_ACCOUNT_URL", "")
    monkeypatch.setattr(explainers.config, "REVISION", "")
    with pytest.raises(ValueError, match="existing storage account and exact NEWSROOM_REVISION"):
        await explainers.execute(tmp_path, publish=True)


def test_cli_requires_a_deliberate_preview_or_publication_choice() -> None:
    with pytest.raises(SystemExit) as exc:
        explainers.main([])
    assert exc.value.code == 2
