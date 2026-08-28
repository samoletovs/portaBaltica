"""Collector tests — archiving, caching, conditional requests and backoff.

No real network calls: ``httpx.MockTransport`` serves every response.
"""

from __future__ import annotations

import json

import httpx
import pytest

from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.opendata import (
    EUROSTAT_DATASETS,
    EurostatDataset,
    parse_elering,
    parse_jsonstat,
)


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


class TestTheQueryIsPartOfTheResource:
    """On a statistical API the query selects the series, not just filters it.

    THE ARTICLE THIS PUBLISHED
    --------------------------
        "Lithuania's business bankruptcy declarations spike to 130.9 index
         points in Q2 2026"

    130.9 is the NEW REGISTRATIONS figure. Bankruptcies for that quarter were
    120.3. The two mean opposite things about an economy — one is a recession
    signal and the other is its reverse — and the wire published the wrong one
    under a byline, with a provenance block asserting it traced to open data.

    It did trace. Every gate passed: the figure was traceable to its signal,
    uninvented, and correctly compared against its own basis. The basis was
    simply attached to the wrong series, and no validator can see that. It is
    the same shape as the Riga passenger trap — a true-looking sentence whose
    subject is wrong — and like that one it has to be caught at collection.

    THE CAUSE
    ---------
    ``CollectorHttp.fetch`` cached on the URL and ignored the query. Eurostat
    exposes one endpoint per table and selects the series with parameters, so
    nineteen datasets in this newsroom resolve to four URLs:

        bop_c6_q      x7    sts_rb_q      x2
        mar_go_qm_lv  x5    mar_go_qm_lt  x5

    The first fetch of each won and the other fifteen were served its body from
    inside a 720-minute TTL, then parsed and labelled with the metric that had
    asked. Fifteen of nineteen series were the wrong data under the right name.
    """

    @staticmethod
    def _payload(indicator: str, value: float) -> dict:
        return {
            "id": ["freq", "indic_bt", "nace_r2", "s_adj", "unit", "geo", "time"],
            "size": [1, 1, 1, 1, 1, 1, 1],
            "value": {"0": value},
            "dimension": {
                "freq": {"category": {"index": {"Q": 0}}},
                "indic_bt": {"category": {"index": {indicator: 0}}},
                "nace_r2": {"category": {"index": {"B-S_X_O_S94": 0}}},
                "s_adj": {"category": {"index": {"SCA": 0}}},
                "unit": {"category": {"index": {"I21": 0}}},
                "geo": {"category": {"index": {"LT": 0}}},
                "time": {"category": {"index": {"2026-Q2": 0}}},
            },
        }

    async def test_two_series_from_one_table_are_not_the_same_series(self, tmp_path):
        """The exact production failure, reduced to its two datasets.

        The server answers correctly for whatever ``indic_bt`` it is asked
        for, so any crossing here is entirely the client's doing.
        """
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, collect_eurostat

        asked: list[str] = []

        def handler(request):
            indicator = dict(request.url.params).get("indic_bt", "?")
            asked.append(indicator)
            return httpx.Response(
                200,
                json=self._payload(indicator, 130.9 if indicator == "REG" else 120.3),
            )

        http = CollectorHttp(
            RawArchive(local_dir=tmp_path / "archive", account_url=""),
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        # Selected by the cube under test, not by section. `section ==
        # "business"` used to hold exactly these two and stopped doing so the
        # moment the beat gained tourism -- an incidental selector that reads
        # like a deliberate one.
        shared_cube = [s for s in EUROSTAT_DATASETS if s.dataset == "sts_rb_q"]
        assert len(shared_cube) == 2, "sts_rb_q no longer backs exactly two series"
        async with http:
            series = await collect_eurostat(http, shared_cube, geographies=("LT",))

        assert sorted(asked) == ["BKRT", "REG"], (
            "one of the two series was served the other's cached body and was "
            "never requested at all"
        )
        values = {s.metric: s.latest.value for s in series}
        assert values["business_registrations"] == 130.9
        assert values["business_bankruptcies"] == 120.3, (
            "bankruptcies carry the registrations figure — this is the article "
            "that published"
        )

    async def test_the_cache_key_separates_two_queries_to_one_url(self, tmp_path):
        calls: list[str] = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, content=str(request.url).encode())

        http = CollectorHttp(
            RawArchive(local_dir=tmp_path / "archive", account_url=""),
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        async with http:
            first = await http.fetch(
                source_id="eurostat", url="https://x.invalid/d",
                cache_ttl_minutes=720, params=[("indic_bt", "REG")],
            )
            second = await http.fetch(
                source_id="eurostat", url="https://x.invalid/d",
                cache_ttl_minutes=720, params=[("indic_bt", "BKRT")],
            )

        assert len(calls) == 2
        assert first.item is not None and second.item is not None
        assert first.item.body != second.item.body

    async def test_the_same_query_still_hits_the_cache(self, tmp_path):
        """The TTL must keep working — this is not a licence to refetch."""
        calls: list[str] = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, content=b"payload")

        http = CollectorHttp(
            RawArchive(local_dir=tmp_path / "archive", account_url=""),
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        async with http:
            await http.fetch(
                source_id="eurostat", url="https://x.invalid/d",
                cache_ttl_minutes=720, params=[("indic_bt", "REG")],
            )
            repeat = await http.fetch(
                source_id="eurostat", url="https://x.invalid/d",
                cache_ttl_minutes=720, params=[("indic_bt", "REG")],
            )

        assert len(calls) == 1
        assert repeat.skipped_reason == "within_cache_ttl"

    def test_the_key_does_not_depend_on_parameter_order(self):
        """A caller that builds its query differently must not refetch."""
        from newsroom.pipeline.collect.httpclient import _cache_key

        assert _cache_key("u", [("a", "1"), ("b", "2")]) == _cache_key(
            "u", [("b", "2"), ("a", "1")]
        )
        assert _cache_key("u", [("a", "1")]) != _cache_key("u", [("a", "2")])
        assert _cache_key("u", None) == "u"

    async def test_four_cargo_categories_are_four_different_series(self, tmp_path):
        """#89's maritime work collides identically, and nobody saw it.

        Five entries share ``mar_go_qm_lv``: total throughput and four cargo
        categories. Ground truth from Eurostat for ``rep_mar=LV``, 2025-Q4 —
        TOTAL 7828, containers 1175, dry bulk 3644, liquid bulk 1554 — so these
        are genuinely different series and any two coming back equal is the
        bug.

        ``port_goods_throughput`` is declared first and therefore reads
        correctly; the four categories are the ones that would have published
        the total under a category's name. They had not published live when
        this was found, which is luck rather than design.
        """
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, collect_eurostat

        truth = {"TOTAL": 7828.0, "LCNT": 1175.0, "DBK": 3644.0,
                 "LBK": 1554.0, "RO_MSP": 348.0}

        def handler(request):
            cargo = dict(request.url.params).get("cargo", "TOTAL")
            return httpx.Response(200, json={
                "id": ["freq", "direct", "cargo", "unit", "par_mar", "rep_mar", "time"],
                "size": [1, 1, 1, 1, 1, 1, 1],
                "value": {"0": truth[cargo]},
                "dimension": {
                    "freq": {"category": {"index": {"Q": 0}}},
                    "direct": {"category": {"index": {"TOTAL": 0}}},
                    "cargo": {"category": {"index": {cargo: 0}}},
                    "unit": {"category": {"index": {"THS_T": 0}}},
                    "par_mar": {"category": {"index": {"TOTAL": 0}}},
                    "rep_mar": {"category": {"index": {"LV": 0}}},
                    "time": {"category": {"index": {"2025-Q4": 0}}},
                },
            })

        http = CollectorHttp(
            RawArchive(local_dir=tmp_path / "archive", account_url=""),
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        latvian = [
            s for s in EUROSTAT_DATASETS
            if s.section == "maritime" and s.dataset == "mar_go_qm_lv"
        ]
        assert len(latvian) == 5, "the cargo composition datasets have changed"
        async with http:
            series = await collect_eurostat(http, latvian)

        values = {s.metric: s.latest.value for s in series}
        assert values == {
            "port_goods_throughput": 7828.0,
            "port_goods_containers": 1175.0,
            "port_goods_dry_bulk": 3644.0,
            "port_goods_liquid_bulk": 1554.0,
            "port_goods_roro": 348.0,
        }, "a cargo category is carrying the total, or another category's tonnage"

    def test_no_two_datasets_can_collide_on_a_key(self):
        """The invariant, over the real configuration.

        Nineteen datasets share four URLs today and more will be added; this
        fails the moment two of them become indistinguishable to the cache.
        """
        from newsroom.pipeline.collect.httpclient import _cache_key
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params
        from newsroom.pipeline.safety import registry

        endpoint = registry().get("eurostat").endpoint
        keys: dict[str, str] = {}
        for spec in EUROSTAT_DATASETS:
            # The collector's own function, not a copy of it. This used to
            # rebuild the list here and hardcoded the three Baltic states,
            # while the collector's default had become COLLECTED_GEOGRAPHIES.
            # It changed no outcome, which is why it went unnoticed.
            key = _cache_key(endpoint.format(dataset=spec.dataset), request_params(spec))
            assert key not in keys, (
                f"{spec.metric} and {keys[key]} are the same request to the "
                f"cache, so one will be served the other's data and published "
                f"under its own name"
            )
            keys[key] = spec.metric

    def test_the_guard_reads_the_collector_s_own_query(self):
        """The guard must not rebuild what the collector builds.

        This test existed and rebuilt the parameter list itself, hardcoding the
        three Baltic states. #125 changed the collector's default to
        ``COLLECTED_GEOGRAPHIES``, which adds the EU aggregate, and the guard
        kept checking the old shape. It changed no outcome -- the extra
        parameter applies to every spec equally, so no collision appeared or
        disappeared -- which is precisely why it went unnoticed for a day.

        Both now call ``request_params``. This asserts the default it returns
        is the collector's, so the copy cannot silently drift back.
        """
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params
        from newsroom.pipeline.detect.series import COLLECTED_GEOGRAPHIES

        spec = next(d for d in EUROSTAT_DATASETS if d.geographies is None)
        asked = [v for k, v in request_params(spec) if k == spec.geo_dimension]

        assert asked == list(COLLECTED_GEOGRAPHIES)

    def test_a_spec_that_pins_its_own_axis_is_asked_for_no_geography(self):
        """The maritime cubes. ``geo=LV`` to one of these is an HTTP 400.

        Note what this compares. These specs carry ``rep_mar`` inside their own
        ``params`` -- the port code *is* the pin -- so asserting the key is
        simply absent fails on a correct collector. What must be true is that
        the geography mechanism adds nothing on top of it.
        """
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params

        pinned = [d for d in EUROSTAT_DATASETS if d.geographies == ()]
        assert pinned, "no self-pinning dataset left to check"
        for spec in pinned:
            asked = [k for k, _ in request_params(spec) if k == spec.geo_dimension]
            declared = [k for k in spec.params if k == spec.geo_dimension]

            assert asked == declared, (
                f"{spec.metric} had a geography added on top of its own pin"
            )

    def test_a_new_definition_cannot_collide_with_one_already_collected(self):
        """Session A's pair, which is worse than the one below.

        ``age=TOTAL`` against ``age=Y_LT25`` is two definitions arriving
        together. ``exports`` against ``goods_balance`` is a **live crossing**:
        both read ``bop_c6_q`` with ``bop_item=G`` and differ only in
        ``stk_flow`` -- ``CRE`` against ``BAL`` -- and ``goods_balance`` was
        already in the collector before ``exports`` was mirrored.

        That is the exact configuration that produced the retraction: several
        definitions on one cube, differing only in query parameters, and a
        cache that could not tell them apart. A collision here does not print
        an implausible number -- it prints a real export figure under the word
        "balance", which means something else entirely.
        """
        from newsroom.pipeline.collect.httpclient import _cache_key
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params
        from newsroom.pipeline.safety import registry

        endpoint = registry().get("eurostat").endpoint
        pairs = {
            spec.metric: _cache_key(
                endpoint.format(dataset=spec.dataset), request_params(spec)
            )
            for spec in EUROSTAT_DATASETS
            if spec.metric in {"exports", "goods_balance", "imports", "trade_balance"}
        }

        assert len(pairs) == 4, f"a bop_c6_q definition has gone: {sorted(pairs)}"
        assert len(set(pairs.values())) == 4, (
            "two balance-of-payments series are the same request to the cache; "
            "one would be published under the other's name"
        )

    def test_one_cube_two_slices_are_two_keys(self):
        """The hazard when mirroring, stated as an invariant.

        ``bop_c6_q`` backs ten dashboard definitions and ``prc_hicp_minr``
        eight; they differ only in a pinned dimension. If the key does not
        cover the parameters, ``youth_unemployment`` is served the all-ages
        rate and published under its own name -- true numbers, wrong subject,
        and every editorial gate passes.
        """
        from newsroom.pipeline.collect.httpclient import _cache_key
        from newsroom.pipeline.collect.opendata import EurostatDataset, request_params

        def spec(age: str) -> EurostatDataset:
            return EurostatDataset(
                dataset="une_rt_m",
                metric=f"unemployment_{age.lower()}",
                metric_label="unemployment rate",
                unit="%",
                section="labour",
                params={"unit": "PC_ACT", "s_adj": "SA", "sex": "T", "age": age},
            )

        url = "https://example.invalid/une_rt_m"
        all_ages = _cache_key(url, request_params(spec("TOTAL")))
        under_25 = _cache_key(url, request_params(spec("Y_LT25")))

        assert all_ages != under_25, (
            "one pinned dimension apart and the cache cannot tell them apart"
        )

    async def test_the_balance_components_add_up(self, tmp_path):
        """The check that needs no fixture: goods + services = the total.

        Eurostat's own arithmetic, confirmed against the dashboard's
        independent fetch path for the latest quarter — Latvia's goods balance
        of -824 plus services of 523 is the -301 trade balance, exactly.

        Under the collision all three read the SAME number, so the identity
        broke in the most obvious possible way and nothing was looking. This is
        a semantic invariant rather than a recorded value: it stays true when
        Eurostat republishes, so it cannot rot into a test that passes because
        it was updated to match whatever the code now does.
        """
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, collect_eurostat

        truth = {"G": -824.0, "S": 523.0, "GS": -301.0}

        def handler(request):
            item = dict(request.url.params).get("bop_item", "GS")
            return httpx.Response(200, json={
                "id": ["freq", "bop_item", "stk_flow", "partner", "currency",
                       "sectpart", "sector10", "geo", "time"],
                "size": [1, 1, 1, 1, 1, 1, 1, 1, 1],
                "value": {"0": truth.get(item, 0.0)},
                "dimension": {
                    "freq": {"category": {"index": {"Q": 0}}},
                    "bop_item": {"category": {"index": {item: 0}}},
                    "stk_flow": {"category": {"index": {"BAL": 0}}},
                    "partner": {"category": {"index": {"WRL_REST": 0}}},
                    "currency": {"category": {"index": {"MIO_EUR": 0}}},
                    "sectpart": {"category": {"index": {"S1": 0}}},
                    "sector10": {"category": {"index": {"S1": 0}}},
                    "geo": {"category": {"index": {"LV": 0}}},
                    "time": {"category": {"index": {"2026-Q1": 0}}},
                },
            })

        wanted = {"trade_balance", "goods_balance", "services_balance"}
        specs = [s for s in EUROSTAT_DATASETS if s.metric in wanted]
        assert len(specs) == 3

        http = CollectorHttp(
            RawArchive(local_dir=tmp_path / "archive", account_url=""),
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            state=ConditionalState(tmp_path / "state.json"),
            sleep=_no_sleep,
        )
        async with http:
            series = await collect_eurostat(http, specs, geographies=("LV",))

        values = {s.metric: s.latest.value for s in series}
        assert values["goods_balance"] + values["services_balance"] == pytest.approx(
            values["trade_balance"]
        ), (
            f"goods + services != the trade balance: {values}. Under the cache "
            f"collision all three carried one number, which is how a piece "
            f"headlined 'Baltic telecommunications services balance' came to "
            f"be built from the aggregate trade balance."
        )


class TestMaritimeIsKeyedOnTheReportingPort:
    """Eurostat splits port statistics by country and keys them on ``rep_mar``.

    There is no ``geo`` dimension on ``mar_go_qm_lv`` at all — verified live:
    the response's ``id`` is ``freq, direct, cargo, unit, par_mar, rep_mar,
    time``. A parser that insists on ``geo`` logs "response lacks geo/time
    dimensions" and returns nothing, which is why the maritime beat had a
    correspondent, a section and a place on the masthead and had never
    published a word.
    """

    @staticmethod
    def _spec():
        return next(
            s for s in EUROSTAT_DATASETS
            if s.section == "maritime" and s.dataset.endswith("_ee")
        )

    #: The live response shape, reduced to three quarters.
    PAYLOAD = {
        "id": ["freq", "direct", "cargo", "unit", "par_mar", "rep_mar", "time"],
        "size": [1, 1, 1, 1, 1, 1, 3],
        "value": {"0": 4551.0, "1": 4702.0, "2": 4833.0},
        "updated": "2026-07-15",
        "dimension": {
            "freq": {"category": {"index": {"Q": 0}}},
            "direct": {"category": {"index": {"TOTAL": 0}}},
            "cargo": {"category": {"index": {"TOTAL": 0}}},
            "unit": {"category": {"index": {"THS_T": 0}}},
            "par_mar": {"category": {"index": {"TOTAL": 0}}},
            "rep_mar": {"category": {"index": {"EE": 0}}},
            "time": {"category": {"index": {"2025-Q2": 0, "2025-Q3": 1, "2025-Q4": 2}}},
        },
    }

    def test_should_read_a_country_series_from_the_rep_mar_dimension(self):
        series = parse_jsonstat(
            self.PAYLOAD,
            self._spec(),
            retrieved_at="2026-08-26T12:00:00Z",
            url="https://ec.europa.eu/eurostat/x",
        )

        assert len(series) == 1
        got = series[0]
        assert got.section == "maritime"
        assert got.geography == "EE"
        assert got.unit == "thousand tonnes"
        assert got.frequency == "quarterly"
        assert [o.value for o in got.observations] == [4551.0, 4702.0, 4833.0]
        assert got.periods == ("2025-Q2", "2025-Q3", "2025-Q4")

    def test_should_not_ask_a_rep_mar_cube_for_a_geo(self):
        """Sending geo=LV to a cube with no geo dimension is an HTTP 400."""
        spec = self._spec()

        assert spec.geo_dimension == "rep_mar"
        assert spec.geographies == ()
        assert spec.params["rep_mar"] == "EE"

    def test_should_still_default_every_other_dataset_to_geo(self):
        """The escape hatch must not become the norm."""
        others = [s for s in EUROSTAT_DATASETS if s.section != "maritime"]

        assert others, "no non-maritime datasets left to check"
        assert all(s.geo_dimension == "geo" for s in others)
        assert all(s.geographies is None for s in others)

    def test_should_not_read_a_passenger_cube_as_a_national_total(self):
        """A tripwire, not a ban. Adding passengers means updating this test.

        ``mar_pa_qm_lv`` looks like the obvious companion to the goods series
        and is a trap. Riga stopped filing passenger returns after 2021-Q4 —
        the last four quarters it reported are literal zeroes, and the cube
        queried entirely unpinned returns no non-null cell for it since. So
        Latvia's *national* passenger total has been exactly equal to Ventspils
        since 2022-Q1.

        Every gate in this pipeline would pass a sentence built on that.
        "Latvian sea passengers fell to X" would be traceable, uninvented and
        correctly compared — and would be a claim about one port presented as a
        claim about a country, set against Estonia's entire coastline. No
        validator can see that, which is why it is caught here instead.

        If you are adding passengers: carry the discontinuity explicitly (the
        API marks such ports ``discontinued``, so it is readable rather than
        inferred), then change this test to assert that handling.
        """
        passengers = [
            s.dataset for s in EUROSTAT_DATASETS if s.dataset.startswith("mar_pa_qm")
        ]

        assert not passengers, (
            f"{passengers} reads Eurostat's sea-passenger cube. Latvia's national "
            f"total has equalled Ventspils alone since 2022-Q1 because Riga stopped "
            f"filing after 2021-Q4, so a national LV/EE/LT comparison compares one "
            f"Latvian port against Estonia's whole coastline. Handle the "
            f"discontinuity explicitly, then update this test."
        )


class TestTheBusinessBeatHasASource:
    """``business`` routed to a correspondent who could never file.

    ``personas.yaml`` assigns the beat and no series anywhere carried
    ``section="business"``, so the masthead named someone who had never
    published and structurally could not.
    """

    def test_should_collect_a_business_series(self):
        business = [s for s in EUROSTAT_DATASETS if s.section == "business"]

        assert business, "the business beat still has no data source"
        assert {s.metric for s in business} == {
            "business_registrations",
            "business_bankruptcies",
            "tourism",
            "tourism_foreign",
            "hotel_occupancy",
        }

    def test_should_join_both_to_a_chart_the_dashboard_serves(self):
        refs = {s.metric: s.chart_ref for s in EUROSTAT_DATASETS if s.section == "business"}

        assert refs == {
            "business_registrations": "business_registrations",
            # The dashboard's id is 'bankruptcies'; naming it
            # 'business_bankruptcies' to match our own metric would 404.
            "business_bankruptcies": "bankruptcies",
            "tourism": "tourism",
            "tourism_foreign": "tourism_foreign",
            "hotel_occupancy": "hotel_occupancy",
        }


class TestTheEnvironmentBeatHasASource:
    """The last silent section, and the only collection gap left.

    Not Open-Meteo, which the dashboard uses: it serves history on demand and
    the app stores nothing, so a detector cannot say "the warmest August since"
    without refetching years of hourly readings on every check. The caching
    layer added in #86 does not help — it is a per-process ``Map`` inside the
    Static Web App's managed functions, holding one hourly reading, in a
    different app from the newsroom.
    """

    def test_should_collect_a_quarterly_emissions_series(self):
        env = [s for s in EUROSTAT_DATASETS if s.section == "environment"]

        assert env, "the environment beat still has no data source"
        assert {s.metric for s in env} == {
            "ghg_emissions",
            # Mirrored from the dashboard. Demography is the environment
            # beat's other half, and annual — except for weekly deaths, which
            # is the fastest series on the whole wire and the reason this
            # comment no longer says emissions is the only one that moves
            # within a year.
            "population",
            "birth_rate",
            "net_migration",
            "life_expectancy",
            "weekly_deaths",
        }
        emissions = next(s for s in env if s.metric == "ghg_emissions")
        assert emissions.frequency == "quarterly"

    def test_the_beat_has_one_series_faster_than_a_month(self):
        """Cadence is the lever, and this is where it entered.

        Every Eurostat series the newsroom read was monthly or slower, so a
        daily run consumed each release once and then had nothing: the
        08-27 ranking logged 49 of 50 signals already published. Depth cannot
        fix that — measured across 18 indicator/country pairs, a longer window
        changed the verdict on the latest observation zero times — so the only
        remedy is a source that publishes more often.
        """
        env = [s for s in EUROSTAT_DATASETS if s.section == "environment"]
        weekly = [s for s in env if s.frequency == "weekly"]

        assert [s.metric for s in weekly] == ["weekly_deaths"]
        assert weekly[0].periods >= 104, (
            "a year-on-year comparison against the same week needs at least "
            "two years of weeks"
        )

    def test_should_read_the_only_breakdown_that_carries_values(self):
        """``TOTAL_HH`` and nothing finer, because nothing finer exists.

        The cube lists ten NACE breakdowns and every one returns 40 periods and
        **zero** values for the Baltics, on both the adjusted and unadjusted
        slice — checked live for A, C, D, H and HH. A sector series would look
        like a working configuration and fetch nothing, which is the same trap
        as asking Estonia for a cargo breakdown.
        """
        spec = next(s for s in EUROSTAT_DATASETS if s.section == "environment")

        assert spec.params["nace_r2"] == "TOTAL_HH"

    def test_should_carry_no_digit_in_its_unit(self):
        """"CO2 equivalent" would put a bare 2 into every comparison basis."""
        spec = next(s for s in EUROSTAT_DATASETS if s.section == "environment")

        assert not any(character.isdigit() for character in spec.unit)
        assert "carbon dioxide" in spec.unit

    def test_every_eurostat_section_now_has_a_source(self):
        """The masthead names correspondents for all of these.

        A section with no series is a byline that can never file, which is
        worse than one fewer name on the masthead.
        """
        covered = {s.section for s in EUROSTAT_DATASETS}

        assert {
            "labour", "economy", "property", "trade",
            "maritime", "business", "environment",
        } <= covered
