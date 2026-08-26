"""Collector tests — archiving, caching, conditional requests and backoff.

No real network calls: ``httpx.MockTransport`` serves every response.
"""

from __future__ import annotations

import json

import httpx
import pytest

from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.opendata import EurostatDataset, parse_elering, parse_jsonstat


class RecordingArchive:
    """Archive double that records the order it was called in."""

    def __init__(self) -> None:
        self.stored: list[bytes] = []

    async def store(self, item):
        self.stored.append(item.body)
        return f"raw-feeds/{item.archive_name}"


def client_for(handler, tmp_path, archive=None, **kwargs) -> tuple[CollectorHttp, RecordingArchive]:
    archive = archive or RecordingArchive()
    transport = httpx.MockTransport(handler)
    http = CollectorHttp(
        archive,
        client=httpx.AsyncClient(transport=transport),
        state=ConditionalState(tmp_path / "state.json"),
        sleep=_no_sleep,
        **kwargs,
    )
    return http, archive


async def _no_sleep(_seconds):
    return None


class TestArchiveBeforeParse:
    async def test_should_archive_the_body_before_returning_it(self, tmp_path):
        def handler(request):
            return httpx.Response(200, content=b"<rss>payload</rss>")

        http, archive = client_for(handler, tmp_path)
        async with http:
            result = await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert archive.stored == [b"<rss>payload</rss>"]
        assert result.item is not None
        assert result.item.body == b"<rss>payload</rss>"

    async def test_should_not_archive_anything_when_the_fetch_fails(self, tmp_path):
        def handler(request):
            return httpx.Response(404)

        http, archive = client_for(handler, tmp_path)
        async with http:
            result = await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert archive.stored == []
        assert not result.ok
        assert result.skipped_reason == "fetch_failed"

    async def test_archived_name_is_stable_for_identical_bytes(self, tmp_path):
        from newsroom.pipeline.models import RawItem

        item = RawItem(
            source_id="lsm_en",
            url="https://x.invalid/rss",
            retrieved_at="2026-08-24T11:00:00Z",
            content_type="application/rss+xml",
            body=b"same",
        )
        other = RawItem(
            source_id="lsm_en",
            url="https://x.invalid/rss",
            retrieved_at="2026-08-24T11:00:00Z",
            content_type="application/rss+xml",
            body=b"same",
        )

        assert item.archive_name == other.archive_name
        assert item.digest == other.digest

    async def test_should_write_the_local_mirror_to_disk(self, tmp_path):
        from newsroom.pipeline.models import RawItem

        archive = RawArchive(local_dir=tmp_path / "raw", account_url="")
        item = RawItem(
            source_id="lsm_en",
            url="https://x.invalid/rss",
            retrieved_at="2026-08-24T11:00:00Z",
            content_type="application/rss+xml",
            body=b"archived bytes",
        )

        reference = await archive.store(item)

        assert reference.startswith("raw-feeds/")
        assert archive.read(item.archive_name) == b"archived bytes"


class TestProvenanceSurvivesTheProcess:
    """``retrieved_at`` says when the archived bytes were served, and must not drift.

    A verdict is only reproducible from the blob archive if the item rebuilt
    from cache points at the payload it actually came from. ``fetched_at`` is
    the wrong value for that: it is restamped every time the client speaks to
    the server, including on a 304, so a cached item was labelled with the
    moment we asked rather than the moment we were served — off by a second on
    a restart, and by hours after a day of 304s.
    """

    @staticmethod
    def _restartable(handler, tmp_path):
        archive = RawArchive(local_dir=tmp_path / "archive", account_url="")
        state_path = tmp_path / "state.json"

        def build():
            return CollectorHttp(
                archive,
                client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                state=ConditionalState(state_path),
                sleep=_no_sleep,
            )

        return build

    @staticmethod
    def _advance_fetched_at(tmp_path, when: str) -> None:
        """Move only ``fetched_at``, as a later run or a 304 revalidation would."""
        state_path = tmp_path / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        for entry in state.values():
            entry["fetched_at"] = when
        state_path.write_text(json.dumps(state), encoding="utf-8")

    async def test_should_reuse_the_archived_payload_after_a_process_restart(self, tmp_path):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, content=b"cached feed")

        build = self._restartable(handler, tmp_path)

        async with build() as first:
            served = await first.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        # Time passes and the client speaks to the server again, so ``fetched_at``
        # advances. The archived bytes did not change, so ``retrieved_at`` must
        # not. Written into the state file rather than waited for, because the
        # two timestamps are recorded to the second and a same-tick test agrees
        # by luck — which is exactly how this bug survived.
        self._advance_fetched_at(tmp_path, "2099-01-01T00:00:00Z")

        # A new process: nothing in memory, everything from the state file.
        async with build() as second:
            cached = await second.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        assert len(calls) == 1
        assert cached.item is not None
        assert cached.item.body == b"cached feed"
        assert cached.item.from_cache is True
        assert served.item is not None
        assert cached.item.retrieved_at == served.item.retrieved_at
        # And so it resolves to the same archived object, which is the property
        # that actually matters: ``archive_name`` is derived from this
        # timestamp, so a rebuilt item whose timestamp drifted is a provenance
        # record naming a blob that does not exist.
        assert cached.item.archive_name == served.item.archive_name

    async def test_should_recover_the_timestamp_from_a_state_file_that_predates_it(
        self, tmp_path
    ):
        """State files written by earlier runs carry no ``retrieved_at``.

        The archive name is built from the same timestamp, so it can be read
        back out rather than losing the cache entry or inventing a time.
        """
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, content=b"cached feed")

        build = self._restartable(handler, tmp_path)
        async with build() as first:
            served = await first.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        state_path = tmp_path / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        for entry in state.values():
            entry.pop("retrieved_at", None)
            entry["fetched_at"] = "2099-01-01T00:00:00Z"
        state_path.write_text(json.dumps(state), encoding="utf-8")

        async with build() as second:
            cached = await second.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        assert len(calls) == 1
        assert cached.item is not None
        assert served.item is not None
        assert cached.item.retrieved_at == served.item.retrieved_at

    async def test_should_not_move_the_timestamp_when_the_server_says_not_modified(
        self, tmp_path
    ):
        """A 304 means the bytes we hold are current, not that they are new."""
        responses = [
            httpx.Response(200, content=b"cached feed", headers={"etag": "v1"}),
            httpx.Response(304, headers={"etag": "v1"}),
        ]

        def handler(request):
            return responses.pop(0) if responses else httpx.Response(304)

        build = self._restartable(handler, tmp_path)
        async with build() as first:
            served = await first.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )
            revalidated = await first.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )

        assert revalidated.skipped_reason == "not_modified"
        assert served.item is not None and revalidated.item is not None
        assert revalidated.item.retrieved_at == served.item.retrieved_at

        # And it still holds once the in-memory copy is gone and the 304 has
        # pushed ``fetched_at`` an hour past the retrieval.
        self._advance_fetched_at(tmp_path, "2099-01-01T00:00:00Z")
        async with build() as second:
            after_restart = await second.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        assert after_restart.item is not None
        assert after_restart.item.retrieved_at == served.item.retrieved_at


class TestCacheTtl:
    async def test_should_not_request_again_inside_the_ttl(self, tmp_path):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, content=b"payload")

        http, _ = client_for(handler, tmp_path)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60)
            second = await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60
            )

        assert len(calls) == 1
        assert second.skipped_reason == "within_cache_ttl"
        assert second.item is not None
        assert second.item.body == b"payload"
        assert second.item.from_cache is True

    async def test_should_request_again_once_the_ttl_has_expired(self, tmp_path):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, content=b"payload")

        http, _ = client_for(handler, tmp_path)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert len(calls) == 2

    async def test_force_overrides_the_ttl(self, tmp_path):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, content=b"payload")

        http, _ = client_for(handler, tmp_path)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60)
            await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=60, force=True
            )

        assert len(calls) == 2


class TestConditionalRequests:
    async def test_should_replay_the_etag_on_the_next_request(self, tmp_path):
        seen_headers = []

        def handler(request):
            seen_headers.append(dict(request.headers))
            return httpx.Response(200, content=b"payload", headers={"ETag": '"abc123"'})

        http, _ = client_for(handler, tmp_path)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert "if-none-match" not in seen_headers[0]
        assert seen_headers[1]["if-none-match"] == '"abc123"'

    async def test_should_replay_last_modified(self, tmp_path):
        seen_headers = []
        stamp = "Mon, 24 Aug 2026 08:00:00 GMT"

        def handler(request):
            seen_headers.append(dict(request.headers))
            return httpx.Response(200, content=b"payload", headers={"Last-Modified": stamp})

        http, _ = client_for(handler, tmp_path)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert seen_headers[1]["if-modified-since"] == stamp

    async def test_should_treat_304_as_nothing_new_and_archive_nothing(self, tmp_path):
        def handler(request):
            return httpx.Response(304)

        http, archive = client_for(handler, tmp_path)
        async with http:
            result = await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )

        assert result.skipped_reason == "not_modified"
        assert archive.stored == []

    async def test_should_send_an_identifying_user_agent(self, tmp_path):
        seen = []

        def handler(request):
            seen.append(request.headers.get("user-agent"))
            return httpx.Response(200, content=b"payload")

        archive = RecordingArchive()
        transport = httpx.MockTransport(handler)
        http = CollectorHttp(
            archive,
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        # Exercise the real client construction, then swap in the mock transport.
        async with http:
            http._client = httpx.AsyncClient(  # noqa: SLF001 - asserting real default headers
                transport=transport,
                headers={"User-Agent": __import__("newsroom.pipeline.config", fromlist=["x"]).USER_AGENT},
            )
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert "portaBaltica-newsroom" in seen[0]
        assert "http" in seen[0]


class TestBackoff:
    async def test_should_retry_a_retryable_status_and_succeed(self, tmp_path):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            if attempts["n"] < 3:
                return httpx.Response(503)
            return httpx.Response(200, content=b"eventually")

        http, archive = client_for(handler, tmp_path, max_retries=3)
        async with http:
            result = await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )

        assert result.ok
        assert archive.stored == [b"eventually"]

    async def test_should_not_retry_a_client_error(self, tmp_path):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            return httpx.Response(404)

        http, _ = client_for(handler, tmp_path, max_retries=3)
        async with http:
            await http.fetch(source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0)

        assert attempts["n"] == 1

    async def test_should_give_up_after_the_retry_budget(self, tmp_path):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            return httpx.Response(502)

        http, _ = client_for(handler, tmp_path, max_retries=2)
        async with http:
            result = await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )

        assert attempts["n"] == 2
        assert not result.ok

    async def test_should_survive_a_transport_error(self, tmp_path):
        def handler(request):
            raise httpx.ConnectError("no route to host")

        http, _ = client_for(handler, tmp_path, max_retries=2)
        async with http:
            result = await http.fetch(
                source_id="lsm_en", url="https://x.invalid/rss", cache_ttl_minutes=0
            )

        assert not result.ok
        assert result.skipped_reason == "fetch_failed"


class TestEurostatParsing:
    spec = EurostatDataset(
        dataset="une_rt_m",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        unit="%",
        section="labour",
        params={},
    )

    def test_should_drop_periods_missing_from_the_sparse_value_map(self):
        # Eurostat omits an index entirely when there is no observation yet.
        # Reading a missing key as zero would invent a collapse in the data.
        payload = {
            "id": ["geo", "time"],
            "size": [2, 3],
            "dimension": {
                "geo": {"category": {"index": {"LV": 0, "EE": 1}}},
                "time": {"category": {"index": {"2026-05": 0, "2026-06": 1, "2026-07": 2}}},
            },
            "value": {"0": 6.5, "1": 6.6, "3": 6.4, "4": 6.3},
        }

        series = parse_jsonstat(payload, self.spec, retrieved_at="2026-08-24T11:00:00Z", url="u")

        by_geo = {s.geography: s for s in series}
        assert by_geo["LV"].periods == ("2026-05", "2026-06")
        assert by_geo["EE"].periods == ("2026-05", "2026-06")
        assert 0.0 not in by_geo["LV"].values

    def test_should_handle_a_list_form_value_array(self):
        payload = {
            "id": ["geo", "time"],
            "size": [1, 3],
            "dimension": {
                "geo": {"category": {"index": {"LV": 0}}},
                "time": {"category": {"index": {"2026-05": 0, "2026-06": 1, "2026-07": 2}}},
            },
            "value": [6.5, 6.6, None],
        }

        series = parse_jsonstat(payload, self.spec, retrieved_at="2026-08-24T11:00:00Z", url="u")

        assert series[0].periods == ("2026-05", "2026-06")

    def test_should_return_nothing_when_dimensions_are_missing(self):
        assert parse_jsonstat({"id": ["time"], "size": [1]}, self.spec, retrieved_at="t", url="u") == []

    def test_should_carry_the_source_reference_onto_every_series(self):
        payload = {
            "id": ["geo", "time"],
            "size": [1, 2],
            "dimension": {
                "geo": {"category": {"index": {"LV": 0}}},
                "time": {"category": {"index": {"2026-05": 0, "2026-06": 1}}},
            },
            "value": {"0": 6.5, "1": 6.6},
            "updated": "2026-08-01",
        }

        series = parse_jsonstat(payload, self.spec, retrieved_at="2026-08-24T11:00:00Z", url="u")

        assert series[0].source.source_id == "eurostat"
        assert series[0].source.dataset == "une_rt_m"
        assert series[0].source.dataset_version == "2026-08-01"


class TestEleringParsing:
    @staticmethod
    def _payload(day_epoch: int):
        # Two complete days at 15-minute resolution for one country.
        points = []
        for offset in range(0, 2 * 24 * 3600, 900):
            points.append({"timestamp": day_epoch + offset, "price": 50.0 + (offset % 3600) / 100})
        return {"success": True, "data": {"lv": points, "ee": [], "lt": []}}

    def test_should_aggregate_to_daily_mean_and_spread(self):
        # 2026-08-20T00:00:00Z
        payload = self._payload(1787184000)

        series = parse_elering(
            payload, retrieved_at="2026-08-24T11:00:00Z", url="u", geographies=["LV"]
        )

        metrics = {s.metric for s in series}
        assert metrics == {"day_ahead_power_price", "day_ahead_power_spread"}
        mean_series = next(s for s in series if s.metric == "day_ahead_power_price")
        assert len(mean_series) == 2
        spread_series = next(s for s in series if s.metric == "day_ahead_power_spread")
        assert all(v > 0 for v in spread_series.values)

    def test_should_drop_the_current_partial_day(self):
        from newsroom.pipeline.models import utcnow

        today_epoch = int(
            utcnow().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        )
        payload = {
            "success": True,
            "data": {"lv": [{"timestamp": today_epoch + 900, "price": 42.0}]},
        }

        series = parse_elering(
            payload, retrieved_at="2026-08-24T11:00:00Z", url="u", geographies=["LV"]
        )

        assert series == []

    def test_should_ignore_malformed_points(self):
        payload = {
            "success": True,
            "data": {
                "lv": [
                    {"timestamp": 1787184000, "price": 50.0},
                    {"timestamp": 1787184900, "price": None},
                    {"price": 99.0},
                ]
            },
        }

        series = parse_elering(
            payload, retrieved_at="2026-08-24T11:00:00Z", url="u", geographies=["LV"]
        )

        assert next(s for s in series if s.metric == "day_ahead_power_price").values == (50.0,)

    def test_should_return_nothing_for_a_country_with_no_data(self):
        assert (
            parse_elering(
                {"success": True, "data": {}},
                retrieved_at="t",
                url="u",
                geographies=["LV"],
            )
            == []
        )


class TestSourceRegistry:
    def test_should_refuse_an_unregistered_source(self):
        from newsroom.pipeline.safety import assert_rewrite_allowed, UnregisteredSourceError, registry

        with pytest.raises(UnregisteredSourceError):
            registry().get("some-scraper")

    def test_should_explain_why_a_known_unavailable_source_is_refused(self):
        from newsroom.pipeline.safety import assert_rewrite_allowed, UnregisteredSourceError, registry

        with pytest.raises(UnregisteredSourceError, match="502"):
            registry().get("lrt_en")

    def test_should_refuse_to_authorise_rewriting_a_tier_c_source(self):
        from newsroom.pipeline.safety import assert_rewrite_allowed, RewriteNotPermittedError, registry

        with pytest.raises(RewriteNotPermittedError):
            assert_rewrite_allowed("err_en")

    def test_should_authorise_rewriting_an_open_data_source(self):
        from newsroom.pipeline.safety import assert_rewrite_allowed, registry

        # Must not raise, and the source it authorises really is tier A.
        assert_rewrite_allowed("eurostat")
        assert registry().get("eurostat").tier == "A"

    def test_disabled_sources_are_not_collected(self):
        from newsroom.pipeline.safety import assert_rewrite_allowed, registry

        enabled_ids = {s.id for s in registry().enabled_sources()}
        assert "delfi_global" not in enabled_ids

    def test_loading_a_registry_with_a_rewritable_tier_c_source_fails(self, tmp_path):
        from newsroom.source_registry import InvalidRegistryError, SourceRegistry

        bad = tmp_path / "sources.yaml"
        bad.write_text(
            json.dumps(
                {
                    "version": 1,
                    "defaults": {},
                    "sources": [
                        {
                            "id": "bad",
                            "name": "Bad Source",
                            "publisher": "Someone Else",
                            "tier": "C",
                            "rewrite_allowed": True,
                            "requires_human_approval": True,
                            "max_snippet_source": "rss_description_verbatim",
                            "licence": "x",
                            "attribution": "x",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        # Everything else about this source is valid, so the ONLY reason the
        # load may fail is the loosened rewrite_allowed. That is what makes
        # this a test of the guard rather than of the schema in general.
        with pytest.raises(InvalidRegistryError, match="may never be rewritten"):
            SourceRegistry.load(bad)
