"""Ten acceptance behaviors and malformed-source cases; no real API calls."""

from __future__ import annotations

import copy
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest

from newsroom.pipeline import international_context as pilot
from newsroom.pipeline.collect import opendata
from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.international import (
    MAX_PAYLOAD_BYTES,
    OWID_METRIC,
    WORLD_BANK_METRIC,
    parse_owid,
    parse_worldbank,
)
from newsroom.pipeline.models import RawItem
from newsroom.pipeline.safety import RewriteNotPermittedError, assert_rewrite_allowed, registry

NOW = datetime(2026, 10, 5, 7, 0, tzinfo=timezone.utc)
RETRIEVED = "2026-10-05T06:30:00Z"
WB_TITLE = "GDP per capita, PPP (constant 2021 international $)"
WB_PATH = "/v2/country/LVA;EST;LTU/indicator/NY.GDP.PCAP.PP.KD"
OWID_PATH = "/grapher/co-emissions-per-capita"


def wb_metadata() -> list[Any]:
    return [
        {"page": 1, "pages": 1, "total": 1},
        [{
            "id": "NY.GDP.PCAP.PP.KD", "name": WB_TITLE,
            "source": {"id": "2", "value": "World Development Indicators"},
            "sourceNote": "GDP per person adjusted for prices using constant 2021 international dollars.",
            "sourceOrganization": "International Comparison Program; Eurostat; OECD; World Bank.",
        }],
    ]


def wb_data() -> list[Any]:
    rows = []
    for code, iso3, name, base in (
        ("EE", "EST", "Estonia", 40.0),
        ("LT", "LTU", "Lithuania", 50.0),
        ("LV", "LVA", "Latvia", 30.0),
    ):
        for year, value in (("2025", base), ("2024", base - 3)):
            rows.append({
                "indicator": {"id": "NY.GDP.PCAP.PP.KD", "value": WB_TITLE},
                "country": {"id": code, "value": name}, "countryiso3code": iso3,
                "date": year, "value": value, "unit": "", "obs_status": "", "footnote": "",
            })
    return [
        {"page": 1, "pages": 1, "total": 6, "sourceid": "2", "lastupdated": "2026-07-13"},
        rows,
    ]


def owid_metadata() -> dict[str, Any]:
    return {
        "chart": {"originalChartUrl": "https://ourworldindata.org/grapher/co-emissions-per-capita"},
        "columns": {"Annual CO2 emissions (per capita)": {
            "shortName": "emissions_total_per_capita", "owidVariableId": 1119914,
            "unit": "tonnes per person", "shortUnit": "t/person", "type": "Numeric",
            "lastUpdated": "2025-11-13",
            "descriptionShort": "CO2 from fossil fuels and industry, but not land-use change.",
            "descriptionKey": "These are territorial emissions, not consumption-based emissions.",
            "citationLong": "Global Carbon Budget (2025); Population sources, processed by Our World in Data.",
        }},
    }


OWID_CSV = (
    "entity,code,year,emissions_total_per_capita\n"
    "Estonia,EST,2024,2.5\n"
    "Latvia,LVA,2024,1.5\n"
    "Lithuania,LTU,2024,3.5\n"
    "Latvia,LVA,2023,1.25\n"
    "Estonia,EST,2023,2.25\n"
    "Lithuania,LTU,2023,3.25\n"
)


def raw(source: str, value: Any, *, suffix: str = "data", csv_body: bool = False) -> RawItem:
    body = value.encode() if csv_body else json.dumps(value).encode()
    host = "api.worldbank.org" if source == "worldbank" else "ourworldindata.org"
    return RawItem(
        source_id=source, url=f"https://{host}/{suffix}", retrieved_at=RETRIEVED,
        content_type="text/csv" if csv_body else "application/json", body=body,
    )


def bank_card(payload: list[Any] | None = None) -> dict[str, Any]:
    collected = parse_worldbank(
        raw("worldbank", payload if payload is not None else wb_data()),
        raw("worldbank", wb_metadata(), suffix="metadata"), end_year=2025,
    )
    return pilot.build_card(collected, end_year=2025)


def response_for(request: httpx.Request, *, data: list[Any] | None = None) -> httpx.Response:
    if request.url.host == "api.worldbank.org":
        if request.url.path == "/v2/indicator/NY.GDP.PCAP.PP.KD":
            return httpx.Response(200, json=wb_metadata())
        assert request.url.path == WB_PATH
        assert dict(request.url.params) == {
            "format": "json", "source": "2", "date": "2000:2025",
            "per_page": "1000", "page": "1", "footnote": "y",
        }
        return httpx.Response(200, json=data if data is not None else wb_data())
    assert request.url.host == "ourworldindata.org"
    if request.url.path == OWID_PATH + ".metadata.json":
        return httpx.Response(200, json=owid_metadata())
    assert request.url.path == OWID_PATH + ".csv"
    assert dict(request.url.params) == {
        "tab": "chart", "time": "2000..2025", "country": "LVA~EST~LTU",
        "csvType": "filtered", "useColumnShortNames": "true",
    }
    return httpx.Response(200, text=OWID_CSV, headers={"Content-Type": "text/csv"})


async def run_mock(
    tmp_path: Path, handler: Any, *, now: datetime = NOW,
) -> dict[str, Any]:
    archive = RawArchive(local_dir=tmp_path / "raw", account_url="")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with CollectorHttp(
            archive, client=client, state=ConditionalState(tmp_path / "state.json"), max_retries=1,
        ) as http:
            return await pilot.collect_cards(http, now=now)


class TestAcceptance:
    def test_01_worldbank_preserves_values_country_mapping_and_price_basis(self) -> None:
        card = bank_card()
        assert card["metric"] == "worldbank_gdp_per_capita_ppp_2021"
        assert card["unit"] == "constant 2021 international dollars per person"
        assert [(c["code"], c["comparison_value"]) for c in card["countries"]] == [
            ("LV", 30.0), ("EE", 40.0), ("LT", 50.0),
        ]
        assert card["source"]["dataset"] == "NY.GDP.PCAP.PP.KD"
        assert card["comparison_period"] == "2025"

    def test_02_owid_preserves_scope_units_and_original_provider(self) -> None:
        collected = parse_owid(
            raw("owid", OWID_CSV, csv_body=True), raw("owid", owid_metadata(), suffix="metadata"),
            end_year=2025,
        )
        card = pilot.build_card(collected, end_year=2025)
        assert card["metric"] == "owid_fossil_co2_per_capita"
        assert card["unit"] == "tonnes CO2 per person"
        assert [c["comparison_value"] for c in card["countries"]] == [1.5, 2.5, 3.5]
        assert card["comparison_period"] == "2024"
        assert "not land-use change" in card["definition"]
        assert "territorial emissions" in card["definition"]
        assert "Global Carbon Budget" in card["original_sources"]
        assert "CC BY 4.0" in card["licence"]

    def test_03_null_is_missing_but_zero_is_a_real_observation(self) -> None:
        payload = wb_data()
        payload[1][0]["value"] = None
        payload[1][1]["value"] = 0
        payload[1][0]["obs_status"] = "unavailable"
        card = bank_card(payload)
        estonia = card["countries"][1]
        assert estonia["observations"][-1] == {
            "period": "2025", "value": None, "status": "missing",
            "source_notes": {"obs_status": "unavailable"},
        }
        assert estonia["observations"][-2]["value"] == 0
        assert estonia["observations"][-2]["status"] == "observed"
        assert estonia["latest"] == {"period": "2024", "value": 0}

    def test_04_comparisons_use_the_latest_common_year_not_mixed_latest_values(self) -> None:
        payload = wb_data()
        payload[1][2]["value"] = None
        card = bank_card(payload)
        assert card["comparison_period"] == "2024"
        assert [c["comparison_value"] for c in card["countries"]] == [27.0, 37.0, 47.0]
        assert [c["latest"]["period"] for c in card["countries"]] == ["2025", "2025", "2024"]
        assert card["comparison_years_behind_window_end"] == 1

    async def test_05_missing_country_prevents_a_successful_comparison(self, tmp_path: Path) -> None:
        payload = wb_data()
        payload[1] = [row for row in payload[1] if row["countryiso3code"] != "LTU"]
        payload[0]["total"] = len(payload[1])
        report = await run_mock(tmp_path, lambda request: response_for(request, data=payload))
        assert report["status"] == "incomplete"
        card = report["cards"][0]
        assert card["status"] == "no_common_period"
        assert card["comparison_period"] is None
        assert all(c["comparison_value"] is None for c in card["countries"])
        assert card["countries"][2]["latest"] is None
        assert all(o["status"] == "missing" for o in card["countries"][2]["observations"])
        assert report["cards"][1]["status"] == "ok"

    def test_06_provenance_resolves_to_exact_data_and_metadata_bytes(self) -> None:
        data = raw("worldbank", wb_data())
        metadata = raw("worldbank", wb_metadata(), suffix="metadata")
        card = pilot.build_card(parse_worldbank(data, metadata, end_year=2025), end_year=2025)
        assert card["source"]["retrieved_at"] == RETRIEVED
        assert card["source_updated"] == "2026-07-13"
        for role, item in (("data", data), ("metadata", metadata)):
            evidence = card["evidence"][role]
            assert evidence["sha256"] == hashlib.sha256(item.body).hexdigest()
            assert evidence["archive_name"] == item.archive_name
            assert evidence["retrieved_at"] == RETRIEVED
            assert evidence["url"] == item.url
        assert "International Comparison Program" in card["original_sources"]

    async def test_07_cached_runs_reuse_original_provenance_without_network(self, tmp_path: Path) -> None:
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(str(request.url))
            return response_for(request)

        first = await run_mock(tmp_path, handler)
        assert len(requests) == 4

        def no_network(_request: httpx.Request) -> httpx.Response:
            pytest.fail("A cached pilot must not issue an HTTP request")

        second = await run_mock(tmp_path, no_network, now=NOW.replace(hour=9))
        assert second["status"] == "ok"
        assert first["generated_at"] != second["generated_at"]
        for original, cached in zip(first["cards"], second["cards"]):
            assert original["source"] == cached["source"]
            for role in ("data", "metadata"):
                assert cached["evidence"][role]["from_cache"] is True
                assert original["evidence"][role]["sha256"] == cached["evidence"][role]["sha256"]
                archive_path = tmp_path / "raw" / cached["evidence"][role]["archive_name"]
                assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == cached["evidence"][role]["sha256"]

    async def test_08_source_failure_is_visible_without_discarding_the_other_source(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture,
    ) -> None:
        caplog.set_level(logging.INFO)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "api.worldbank.org":
                return httpx.Response(403)
            return response_for(request)

        report = await run_mock(tmp_path, handler)
        assert report["status"] == "incomplete"
        assert report["cards"][0]["status"] == "unavailable"
        assert "fetch_failed" in report["cards"][0]["error"]
        assert report["cards"][1]["status"] == "ok"
        assert "worldbank context pilot failed" in caplog.text
        assert "HTTP 403" in caplog.text

    async def test_09_scheduled_collection_stays_closed_after_explicit_promotion(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls = []

        async def existing_source(_http: Any) -> list[Any]:
            calls.append("existing")
            return []

        monkeypatch.setattr(opendata, "collect_elering", existing_source)
        monkeypatch.setattr(opendata, "collect_eurostat", existing_source)
        assert await opendata.collect_open_data(None) == []
        assert calls == ["existing", "existing"]
        for source_id in ("worldbank", "owid"):
            source = registry().get(source_id)
            assert source.enabled is False
            assert source.requires_human_approval is False
            assert_rewrite_allowed(source_id)
        with pytest.raises(RewriteNotPermittedError):
            assert_rewrite_allowed("lsm_en")
        assert WORLD_BANK_METRIC not in {spec.metric for spec in opendata.EUROSTAT_DATASETS}
        assert OWID_METRIC not in {spec.metric for spec in opendata.EUROSTAT_DATASETS}

    async def test_10_capture_persists_cards_locally_even_with_cloud_settings(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(pilot.config, "STORAGE_ACCOUNT_URL", "https://should-not-be-used.invalid")
        monkeypatch.setattr(pilot, "utcnow", lambda: NOW)
        real_http = pilot.CollectorHttp
        archives = []

        def no_cloud(self: RawArchive) -> None:
            assert self._account_url == ""
            archives.append(self)
            return None

        monkeypatch.setattr(RawArchive, "_container_client", no_cloud)
        async with httpx.AsyncClient(transport=httpx.MockTransport(response_for)) as client:
            def local_http(archive: RawArchive, **kwargs: Any) -> CollectorHttp:
                return real_http(archive, client=client, **kwargs)

            monkeypatch.setattr(pilot, "CollectorHttp", local_http)
            result = await pilot.capture(tmp_path / "pilot")
        saved = json.loads((tmp_path / "pilot" / "evidence-cards.json").read_bytes())
        assert saved == result
        assert saved["publication_allowed"] is False
        assert saved["mode"] == "non_publishing_pilot"
        assert saved["countries"] == ["LV", "EE", "LT"]
        assert saved["status"] == "ok"
        assert len(archives) == 4
        assert len(list((tmp_path / "pilot" / "raw").rglob("*.raw"))) == 4
        assert not list(tmp_path.rglob("articles"))


@pytest.mark.parametrize("value", [True, "30", float("nan"), float("inf"), 10**400, -1])
def test_worldbank_rejects_invalid_numeric_values(value: Any) -> None:
    payload = wb_data()
    payload[1][0]["value"] = value
    with pytest.raises(ValueError, match="finite, non-negative"):
        bank_card(payload)


@pytest.mark.parametrize("field,value", [("pages", 2), ("page", 2), ("total", 7)])
def test_worldbank_refuses_partial_pagination(field: str, value: int) -> None:
    payload = wb_data()
    payload[0][field] = value
    with pytest.raises(ValueError, match="incomplete or paginated"):
        bank_card(payload)


@pytest.mark.parametrize("field,value", [
    ("id", "NY.GDP.PCAP.CD"),
    ("name", "GDP per capita, PPP (constant 2017 international $)"),
])
def test_worldbank_rejects_a_different_indicator_or_price_basis(field: str, value: str) -> None:
    metadata = wb_metadata()
    metadata[1][0][field] = value
    with pytest.raises(ValueError, match="identity or PPP price basis"):
        parse_worldbank(raw("worldbank", wb_data()), raw("worldbank", metadata), end_year=2025)


def test_worldbank_rejects_duplicate_cells_even_when_one_is_null() -> None:
    payload = wb_data()
    duplicate = copy.deepcopy(payload[1][0])
    duplicate["value"] = None
    payload[1].append(duplicate)
    payload[0]["total"] += 1
    with pytest.raises(ValueError, match="duplicate"):
        bank_card(payload)


@pytest.mark.parametrize("field,value", [
    ("countryiso3code", "USA"), ("date", "2026"), ("date", "1999"), ("date", "2024-Q1"),
])
def test_worldbank_rejects_unrequested_geography_or_period(field: str, value: str) -> None:
    payload = wb_data()
    payload[1][0][field] = value
    with pytest.raises(ValueError):
        bank_card(payload)


@pytest.mark.parametrize("field,value", [
    ("unit", "tonnes"), ("shortName", "emissions_total"), ("owidVariableId", 999),
    ("descriptionShort", "CO2 emissions including land-use change."),
    ("descriptionKey", "Consumption-based emissions."),
    ("citationLong", "Unreviewed data provider"),
])
def test_owid_rejects_definition_identity_and_unit_drift(field: str, value: Any) -> None:
    metadata = owid_metadata()
    next(iter(metadata["columns"].values()))[field] = value
    with pytest.raises(ValueError):
        parse_owid(raw("owid", OWID_CSV, csv_body=True), raw("owid", metadata), end_year=2025)


@pytest.mark.parametrize("body", [
    OWID_CSV.replace("emissions_total_per_capita", "emissions_total"),
    OWID_CSV + "Estonia,EST,2024,\n",
    OWID_CSV + "United States,USA,2024,10\n",
    OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,EST,2024,1.5"),
    OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,LVA,2024,NaN"),
    OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,LVA,2024,inf"),
    OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,LVA,2024,-1"),
    OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,LVA,2024,1.5,extra"),
])
def test_owid_rejects_malformed_or_mislabelled_csv(body: str) -> None:
    with pytest.raises(ValueError):
        parse_owid(raw("owid", body, csv_body=True), raw("owid", owid_metadata()), end_year=2025)


def test_owid_blank_value_remains_missing() -> None:
    body = OWID_CSV.replace("Latvia,LVA,2024,1.5", "Latvia,LVA,2024,")
    collected = parse_owid(raw("owid", body, csv_body=True), raw("owid", owid_metadata()), end_year=2025)
    card = pilot.build_card(collected, end_year=2025)
    assert card["comparison_period"] == "2023"
    assert card["countries"][0]["observations"][-2]["value"] is None


def test_excessive_payload_fails_explicitly() -> None:
    data = raw("owid", "x" * (MAX_PAYLOAD_BYTES + 1), csv_body=True)
    with pytest.raises(ValueError, match="2 MiB"):
        parse_owid(data, raw("owid", owid_metadata()), end_year=2025)


def test_command_requires_explicit_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    async def unexpected_capture(_directory: Path) -> dict[str, Any]:
        pytest.fail("Without --collect, the command must not fetch data")

    monkeypatch.setattr(pilot, "capture", unexpected_capture)
    with pytest.raises(SystemExit) as exc:
        pilot.main([])
    assert exc.value.code == 2


@pytest.mark.parametrize("status,exit_code", [("ok", 0), ("incomplete", 1)])
def test_command_exit_code_distinguishes_incomplete_evidence(
    status: str, exit_code: int, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def capture(_directory: Path) -> dict[str, Any]:
        return {"status": status, "cards": []}

    monkeypatch.setattr(pilot, "capture", capture)
    assert pilot.main(["--collect", "--directory", str(tmp_path)]) == exit_code
