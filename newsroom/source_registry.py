"""Source registry — the legal spine of the newsroom.

Loads and validates ``newsroom/sources.yaml``. Every piece of ingested content
must map to an entry here; content from an unregistered source is dropped.

The registry refuses to load a file that violates the tier contract. That is
deliberate: a misconfiguration should take the build down at import time rather
than quietly widen what the pipeline is permitted to republish. The single most
important rule it enforces is that a tier C source can never carry
``rewrite_allowed: true`` — see the DSM Art. 15 note in ``sources.yaml``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final, Iterator, Mapping
from urllib.parse import urlparse

import yaml

logger = logging.getLogger(__name__)

DEFAULT_SOURCES_PATH: Final[Path] = Path(__file__).resolve().parent / "sources.yaml"

VALID_TIERS: Final[frozenset[str]] = frozenset({"A", "B", "C"})

#: Tiers whose content we may never rewrite or paraphrase. Tier B is included
#: because the README's tier table says "Never" for it too: the licence permits
#: reproduction, and we take that permission verbatim-only so there is no
#: distortion risk to argue about.
NO_REWRITE_TIERS: Final[frozenset[str]] = frozenset({"B", "C"})


class SourceRegistryError(Exception):
    """Base class for registry failures. Always fatal — the registry fails closed."""


class InvalidRegistryError(SourceRegistryError):
    """``sources.yaml`` is malformed or violates the tier contract."""


class UnregisteredSourceError(SourceRegistryError):
    """Content was resolved to a source that is not in the registry.

    Raised rather than returned. There is no permissive default: unregistered
    content is dropped, and callers must not be able to ignore that by
    forgetting to check a return value.
    """


@dataclass(frozen=True, slots=True)
class Source:
    """A single registered source and the permissions attached to it."""

    id: str
    name: str
    publisher: str
    tier: str
    licence: str
    attribution: str
    rewrite_allowed: bool
    requires_human_approval: bool
    endpoint: str | None = None
    country: str | None = None
    max_snippet_source: str | None = None
    cache_ttl_minutes: int | None = None
    enabled: bool = True
    verified: str | None = None
    notes: str | None = None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def is_original_data(self) -> bool:
        """True for tier A: structured open data we write our own analysis from."""
        return self.tier == "A"

    @property
    def is_syndicated(self) -> bool:
        """True for tiers B and C: somebody else's words, reproduced or linked."""
        return self.tier in NO_REWRITE_TIERS


@dataclass(frozen=True, slots=True)
class UnavailableSource:
    """A source researched and found unusable. Kept so nobody re-researches it."""

    id: str
    name: str
    reason: str
    action: str | None = None


class SourceRegistry:
    """In-memory view of ``sources.yaml``.

    Construct via :meth:`load` or :meth:`from_mapping`; both validate. A
    registry instance that exists is a registry that passed validation.
    """

    def __init__(
        self,
        sources: Mapping[str, Source],
        *,
        version: int,
        unavailable: Mapping[str, UnavailableSource] | None = None,
    ) -> None:
        self._sources: Mapping[str, Source] = MappingProxyType(dict(sources))
        self._unavailable: Mapping[str, UnavailableSource] = MappingProxyType(
            dict(unavailable or {})
        )
        self._version = version
        self._by_host: Mapping[str, Source] = MappingProxyType(_index_by_host(sources))

    # ── construction ────────────────────────────────────────────────────

    @classmethod
    def load(cls, path: Path | str | None = None) -> "SourceRegistry":
        """Load and validate the registry from a YAML file."""
        resolved = Path(path) if path is not None else DEFAULT_SOURCES_PATH
        try:
            text = resolved.read_text(encoding="utf-8")
        except OSError as exc:
            raise InvalidRegistryError(f"cannot read source registry at {resolved}: {exc}") from exc

        try:
            document = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise InvalidRegistryError(f"{resolved} is not valid YAML: {exc}") from exc

        if not isinstance(document, Mapping):
            raise InvalidRegistryError(f"{resolved} must contain a YAML mapping at the top level")

        logger.debug("loaded source registry from %s", resolved)
        return cls.from_mapping(document)

    @classmethod
    def from_mapping(cls, document: Mapping[str, Any]) -> "SourceRegistry":
        """Validate an already-parsed registry document."""
        version = document.get("version")
        if not isinstance(version, int):
            raise InvalidRegistryError("registry must declare an integer `version`")

        defaults = document.get("defaults") or {}
        if not isinstance(defaults, Mapping):
            raise InvalidRegistryError("`defaults` must be a mapping when present")

        raw_sources = document.get("sources")
        if not isinstance(raw_sources, list) or not raw_sources:
            raise InvalidRegistryError("registry must declare a non-empty `sources` list")

        sources: dict[str, Source] = {}
        for index, entry in enumerate(raw_sources):
            source = _build_source(entry, defaults=defaults, index=index)
            if source.id in sources:
                raise InvalidRegistryError(f"duplicate source id {source.id!r}")
            sources[source.id] = source

        unavailable: dict[str, UnavailableSource] = {}
        for entry in document.get("unavailable") or []:
            if not isinstance(entry, Mapping):
                raise InvalidRegistryError("`unavailable` entries must be mappings")
            entry_id = entry.get("id")
            if not isinstance(entry_id, str) or not entry_id:
                raise InvalidRegistryError("`unavailable` entries need a string id")
            if entry_id in sources:
                raise InvalidRegistryError(
                    f"{entry_id!r} is listed both as an active source and as unavailable"
                )
            unavailable[entry_id] = UnavailableSource(
                id=entry_id,
                name=str(entry.get("name", entry_id)),
                reason=str(entry.get("reason", "")),
                action=_optional_str(entry.get("action")),
            )

        return cls(sources, version=version, unavailable=unavailable)

    # ── lookup ──────────────────────────────────────────────────────────

    @property
    def version(self) -> int:
        return self._version

    def __len__(self) -> int:
        return len(self._sources)

    def __iter__(self) -> Iterator[Source]:
        return iter(self._sources.values())

    def __contains__(self, source_id: object) -> bool:
        return source_id in self._sources

    def get(self, source_id: str) -> Source:
        """Return a registered source, or raise :class:`UnregisteredSourceError`."""
        try:
            return self._sources[source_id]
        except KeyError:
            unavailable = self._unavailable.get(source_id)
            if unavailable is not None:
                raise UnregisteredSourceError(
                    f"source {source_id!r} is explicitly unavailable: {unavailable.reason}"
                ) from None
            raise UnregisteredSourceError(
                f"source {source_id!r} is not in the registry; content from it is dropped"
            ) from None

    def ids(self) -> tuple[str, ...]:
        return tuple(self._sources)

    def by_tier(self, tier: str) -> tuple[Source, ...]:
        return tuple(source for source in self if source.tier == tier)

    def enabled_sources(self) -> tuple[Source, ...]:
        return tuple(source for source in self if source.enabled)

    # ── the two questions the pipeline actually asks ────────────────────

    def rewrite_allowed(self, source_id: str) -> bool:
        """May we generate prose from this source's content?

        Raises for an unknown source rather than returning ``False``: the caller
        has a bug, and silently treating unknown content as merely
        "not rewritable" would let it through the other checks.
        """
        return self.get(source_id).rewrite_allowed

    def tier(self, source_id: str) -> str:
        """Return the source's tier: ``A``, ``B`` or ``C``."""
        return self.get(source_id).tier

    def attribution(self, source_id: str) -> str:
        """The attribution string that tier B/C content must carry."""
        return self.get(source_id).attribution

    def requires_human_approval(self, source_id: str) -> bool:
        return self.get(source_id).requires_human_approval

    # ── feed item resolution ────────────────────────────────────────────

    def resolve_feed_item(self, item: Mapping[str, Any]) -> Source:
        """Resolve a raw feed item to its registered source.

        Accepts an explicit ``source_id``; failing that, matches the host of a
        ``feed_url``/``link``/``url`` field against registered endpoints.
        Raises :class:`UnregisteredSourceError` when neither resolves.
        """
        source_id = item.get("source_id")
        if isinstance(source_id, str) and source_id:
            return self.get(source_id)

        for key in ("feed_url", "feed", "url", "link", "origin"):
            candidate = item.get(key)
            if not isinstance(candidate, str) or not candidate:
                continue
            host = _host_of(candidate)
            if host and host in self._by_host:
                return self._by_host[host]

        raise UnregisteredSourceError(
            "feed item carries no source_id and no URL matching a registered endpoint; dropped"
        )


def _index_by_host(sources: Mapping[str, Source]) -> dict[str, Source]:
    """Map endpoint hosts to sources, so a bare feed URL can be resolved.

    First registration wins, and an ambiguous host is dropped from the index
    entirely rather than resolved arbitrarily — guessing between two sources
    could attach the wrong licence to an item.
    """
    index: dict[str, Source] = {}
    ambiguous: set[str] = set()
    for source in sources.values():
        if not source.endpoint:
            continue
        host = _host_of(source.endpoint)
        if not host:
            continue
        if host in index and index[host].id != source.id:
            ambiguous.add(host)
            continue
        index[host] = source
    for host in ambiguous:
        index.pop(host, None)
    return index


def _host_of(url: str) -> str | None:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower()
    if not host:
        return None
    if "@" in host:
        host = host.rsplit("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]
    return host.removeprefix("www.") or None


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _require_bool(value: Any, *, source_id: str, key: str) -> bool:
    """Demand a real YAML boolean.

    A string ``"false"`` is truthy in Python, so accepting one here would turn a
    typo into permission to rewrite a copyrighted feed.
    """
    if not isinstance(value, bool):
        raise InvalidRegistryError(
            f"source {source_id!r}: `{key}` must be a boolean, got {value!r} "
            f"({type(value).__name__})"
        )
    return value


def _build_source(entry: Any, *, defaults: Mapping[str, Any], index: int) -> Source:
    if not isinstance(entry, Mapping):
        raise InvalidRegistryError(f"source #{index} is not a mapping")

    source_id = entry.get("id")
    if not isinstance(source_id, str) or not source_id.strip():
        raise InvalidRegistryError(f"source #{index} has no usable `id`")

    merged: dict[str, Any] = {**defaults, **entry}

    tier = merged.get("tier")
    if tier not in VALID_TIERS:
        raise InvalidRegistryError(
            f"source {source_id!r}: tier must be one of {sorted(VALID_TIERS)}, got {tier!r}"
        )

    for required in ("name", "publisher", "licence", "attribution"):
        value = merged.get(required)
        if not isinstance(value, str) or not value.strip():
            raise InvalidRegistryError(f"source {source_id!r}: `{required}` is required")

    rewrite_allowed = _require_bool(
        merged.get("rewrite_allowed"), source_id=source_id, key="rewrite_allowed"
    )
    requires_human_approval = _require_bool(
        merged.get("requires_human_approval"),
        source_id=source_id,
        key="requires_human_approval",
    )

    # The invariant the legal position rests on. Enforced at load time so it is
    # impossible to run the pipeline against a registry that has been loosened.
    if tier in NO_REWRITE_TIERS and rewrite_allowed:
        raise InvalidRegistryError(
            f"source {source_id!r}: tier {tier} content may never be rewritten "
            "(EU DSM Directive 2019/790 Art. 15; Google scaled content abuse policy). "
            "`rewrite_allowed` must be false."
        )

    if tier == "C":
        snippet_source = merged.get("max_snippet_source")
        if snippet_source != "rss_description_verbatim":
            raise InvalidRegistryError(
                f"source {source_id!r}: tier C requires "
                "`max_snippet_source: rss_description_verbatim`, got "
                f"{snippet_source!r}"
            )

    enabled = merged.get("enabled", True)
    if not isinstance(enabled, bool):
        raise InvalidRegistryError(f"source {source_id!r}: `enabled` must be a boolean")

    cache_ttl = merged.get("cache_ttl_minutes")
    if cache_ttl is not None and not isinstance(cache_ttl, int):
        raise InvalidRegistryError(f"source {source_id!r}: `cache_ttl_minutes` must be an integer")

    return Source(
        id=source_id,
        name=str(merged["name"]),
        publisher=str(merged["publisher"]),
        tier=str(tier),
        licence=str(merged["licence"]),
        attribution=str(merged["attribution"]),
        rewrite_allowed=rewrite_allowed,
        requires_human_approval=requires_human_approval,
        endpoint=_optional_str(merged.get("endpoint")),
        country=_optional_str(merged.get("country")),
        max_snippet_source=_optional_str(merged.get("max_snippet_source")),
        cache_ttl_minutes=cache_ttl,
        enabled=enabled,
        verified=_optional_str(merged.get("verified")),
        notes=_optional_str(merged.get("notes")),
        raw=MappingProxyType(dict(entry)),
    )


__all__ = [
    "DEFAULT_SOURCES_PATH",
    "NO_REWRITE_TIERS",
    "VALID_TIERS",
    "InvalidRegistryError",
    "Source",
    "SourceRegistry",
    "SourceRegistryError",
    "UnavailableSource",
    "UnregisteredSourceError",
]
