"""A host that serves two publishers must resolve, not disappear.

``ec.europa.eu`` carries Eurostat's dissemination API (tier A data) and the
Commission's Press Corner (tier B narrative). The previous index dropped any
host claimed twice, which is safe in the sense that nothing is mislicensed and
unsafe in the sense that nobody finds out.

Measured on the live articles container, 2026-08-30. Across the five published
articles carrying a causal panel, every document that reached an analyst came
from ``ecb.europa.eu`` or ``bank.lv`` — the two hosts that resolved — and not
once from the Commission, despite ``ec_presscorner`` being configured
``document_fetch_allowed: true`` and its feed answering HTTP 200 with 10 items
in the same sweep. The only visible symptom was ``documents_fetched: 0``, which
is indistinguishable from "no relevant document was published".
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.safety import registry
from newsroom.pipeline.webresearch import _is_fetchable
from newsroom.source_registry import InvalidRegistryError, SourceRegistry


def _source(**overrides):
    base = {
        "id": "example",
        "name": "Example",
        "publisher": "Example",
        "tier": "A",
        "licence": "x",
        "attribution": "x",
        "rewrite_allowed": False,
        "requires_human_approval": False,
    }
    return {**base, **overrides}


def _registry(*sources):
    return SourceRegistry.from_mapping({"version": 1, "sources": list(sources)})


class TestASharedHostResolvesByPath:
    def test_a_collision_without_prefixes_fails_at_load(self) -> None:
        """Loudly, rather than resolving to nothing.

        The failure this replaces was silent and permanent: a source stayed
        configured, stayed enabled, and could never be reached.
        """
        with pytest.raises(InvalidRegistryError, match="path_prefixes"):
            _registry(
                _source(id="data", endpoint="https://example.org/api/v1"),
                _source(id="news", endpoint="https://example.org/press/rss"),
            )

    def test_prefixes_send_each_url_to_its_own_publisher(self) -> None:
        reg = _registry(
            _source(id="data", endpoint="https://example.org/api/v1", path_prefixes=["/api"]),
            _source(id="news", endpoint="https://example.org/press/rss", path_prefixes=["/press"]),
        )

        assert reg.resolve_feed_item({"link": "https://example.org/api/v1/x"}).id == "data"
        assert reg.resolve_feed_item({"link": "https://example.org/press/2026/a"}).id == "news"

    def test_an_unclaimed_path_on_a_shared_host_is_still_dropped(self) -> None:
        # The fail-safe the original ambiguity rule was reaching for, applied
        # per URL instead of to the whole host.
        reg = _registry(
            _source(id="data", endpoint="https://example.org/api/v1", path_prefixes=["/api"]),
            _source(id="news", endpoint="https://example.org/press/rss", path_prefixes=["/press"]),
        )

        with pytest.raises(Exception):
            reg.resolve_feed_item({"link": "https://example.org/something-else"})

    def test_the_longest_prefix_wins(self) -> None:
        reg = _registry(
            _source(id="broad", endpoint="https://example.org/a/feed", path_prefixes=["/a"]),
            _source(
                id="narrow",
                endpoint="https://example.org/a/b/feed",
                path_prefixes=["/a/b"],
            ),
        )

        assert reg.resolve_feed_item({"link": "https://example.org/a/b/c"}).id == "narrow"

    def test_a_prefix_matches_a_segment_not_a_substring(self) -> None:
        # "/api" must not claim "/apiary". A prefix that matched loose text
        # would hand one publisher's licence to another's page.
        reg = _registry(
            _source(id="data", endpoint="https://example.org/api/v1", path_prefixes=["/api"]),
            _source(id="news", endpoint="https://example.org/press/rss", path_prefixes=["/press"]),
        )

        with pytest.raises(Exception):
            reg.resolve_feed_item({"link": "https://example.org/apiary/thing"})

    def test_a_sole_claimant_still_needs_no_prefix(self) -> None:
        # Every existing single-source host keeps working untouched.
        reg = _registry(_source(id="only", endpoint="https://sole.example/feed"))

        assert reg.resolve_feed_item({"link": "https://sole.example/any/path"}).id == "only"

    def test_a_prefix_must_be_a_path(self) -> None:
        with pytest.raises(InvalidRegistryError, match="must start with"):
            _registry(_source(id="x", endpoint="https://e.org/a", path_prefixes=["api"]))


class TestTheLiveRegistryReachesTheCommissionAgain:
    """The documents that answer "why did this move", for these exact series."""

    @pytest.mark.parametrize(
        "url",
        [
            # The monthly release that says WHICH sector moved a producer price
            # index — the question a whole article failed to answer.
            "https://ec.europa.eu/eurostat/web/products-euro-indicators/w/4-03092026-ap",
            # "Passenger cars per 1 000 inhabitants reached 560 in 2022", which
            # is the explanatory piece for the car-ownership article.
            "https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20240117-1",
            "https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1234",
        ],
    )
    def test_commission_narrative_is_resolvable_and_fetchable(self, url: str) -> None:
        source = registry().resolve_feed_item({"link": url})

        assert source.id == "ec_presscorner"
        assert _is_fetchable(source)

    def test_the_eurostat_data_api_is_resolvable_but_never_fetched(self) -> None:
        """Tier A data stays data. Sharing a host must not share a permission."""
        source = registry().resolve_feed_item(
            {
                "link": "https://ec.europa.eu/eurostat/api/dissemination/statistics/"
                "1.0/data/prc_hicp_manr"
            }
        )

        assert source.id == "eurostat"
        assert not _is_fetchable(source)

    def test_an_unregistered_publisher_is_still_refused(self) -> None:
        """The control. Search may only ever widen which page of a known
        publisher is read, never introduce one whose licence nobody assessed.
        """
        with pytest.raises(Exception):
            registry().resolve_feed_item(
                {"link": "https://railway-news.com/skoda-trains-latvia/"}
            )

    def test_an_unclaimed_commission_path_is_refused(self) -> None:
        # Negative control on the same host as the positives above, so a pass
        # cannot come from the whole host being open.
        with pytest.raises(Exception):
            registry().resolve_feed_item({"link": "https://ec.europa.eu/info/anything"})


class TestAPathIsResolvedBeforeItIsTrusted:
    """A prefix test on a raw path tests the string, not the resource.

    Untreated, these resolved to `ec_presscorner` — a tier B source with
    `document_fetch_allowed` — for a page under `/info`. The percent-encoded
    form survives httpx's own RFC 3986 normalisation too, so the post-fetch
    recheck in `webresearch` would not have caught it, and the item built by
    `discover` is never rechecked at all: it would have been published as
    "Source: European Commission" and admitted to `_admissible`'s known
    sources, letting a hypothesis cite the Commission for a page the registry
    never assessed.
    """

    @pytest.mark.parametrize(
        "url",
        [
            "https://ec.europa.eu/commission/presscorner/../../info/anything",
            "https://ec.europa.eu/commission/presscorner/..%2f..%2finfo/anything",
            "https://ec.europa.eu/commission/presscorner/%2e%2e/%2e%2e/info/x",
        ],
    )
    def test_traversal_out_of_a_prefix_is_refused(self, url: str) -> None:
        with pytest.raises(Exception):
            registry().resolve_feed_item({"link": url})

    def test_traversal_that_lands_somewhere_legitimate_resolves_there(self) -> None:
        """Normalisation is not refusal, and this is the difference.

        `/eurostat/api/../web/products-euro-indicators/w/x` addresses a real
        Eurostat editorial page — it is what any server or client would resolve
        it to — so it resolves to the entry that owns that path, rather than to
        the one whose prefix the unnormalised string happened to start with.
        """
        source = registry().resolve_feed_item(
            {
                "link": "https://ec.europa.eu/eurostat/api/../web/"
                "products-euro-indicators/w/x"
            }
        )

        assert source.id == "ec_presscorner"

    def test_the_honest_url_the_traversal_imitates_still_resolves(self) -> None:
        """The positive control on the same host, so the parametrised refusals
        above cannot pass merely because the host stopped resolving."""
        source = registry().resolve_feed_item(
            {"link": "https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1"}
        )

        assert source.id == "ec_presscorner"

    def test_a_backslash_is_refused_rather_than_guessed_at(self) -> None:
        with pytest.raises(Exception):
            registry().resolve_feed_item(
                {"link": "https://ec.europa.eu/commission/presscorner/..\\..\\info/x"}
            )

    def test_a_sole_claimant_that_declared_prefixes_must_still_match(self) -> None:
        """The fail-open next door to the traversal.

        `eurostat` becomes sole claimant of ec.europa.eu the day
        `ec_presscorner` is disabled. Falling back to it would resolve every
        Commission URL to a tier A entry carrying `rewrite_allowed: true` —
        a licence upgrade granted by an unrelated source being switched off.
        """
        reg = _registry(
            _source(id="data", endpoint="https://example.org/api/v1", path_prefixes=["/api"])
        )

        assert reg.resolve_feed_item({"link": "https://example.org/api/x"}).id == "data"
        with pytest.raises(Exception):
            reg.resolve_feed_item({"link": "https://example.org/press/x"})
