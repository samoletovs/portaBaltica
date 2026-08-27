"""The data the pipeline passes between stages.

Two objects matter most:

``Signal``
    What stage 2 emits. It is the *only* thing that authorises an article. A
    signal always names its ``comparison_basis`` — what the value is measured
    against — because an unanchored change is not a finding, and the validator
    rejects prose that describes a change without one.

``Article``
    What stage 6 publishes, shaped by ``newsroom/schemas/article.schema.json``.

``Signal.fields`` is the contract with the language model. It is a flat mapping
of name -> number. The model is handed exactly these numbers and every ``Figure``
it emits must bind to one of these keys via ``signal_field``. There is no path
by which a number reaches an article without passing through here.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Mapping, Sequence

Tier = Literal["A", "B", "C"]
Status = Literal["draft", "pending_approval", "published", "rejected", "corrected", "retracted"]

SECTIONS = (
    "economy",
    "trade",
    "government",
    "labour",
    "energy",
    "property",
    "environment",
    "maritime",
    "business",
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(moment: datetime) -> str:
    """RFC3339 with a ``Z`` suffix, which is what the schema's date-time wants."""
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class SourceRef:
    """Where a number came from, recorded at retrieval time."""

    source_id: str
    retrieved_at: str
    dataset: str | None = None
    dataset_version: str | None = None
    url: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"source_id": self.source_id, "retrieved_at": self.retrieved_at}
        if self.dataset:
            out["dataset"] = self.dataset
        if self.dataset_version:
            out["dataset_version"] = self.dataset_version
        if self.url:
            out["url"] = self.url
        return out


def _quantise(value: float) -> float:
    """Round a computed figure to the precision it is displayed at.

    `{:g}` renders at most six significant digits, which is what the model
    is shown, so storing more precision than that guarantees a mismatch the
    model cannot avoid. Rounding here keeps the stored value and the rendered
    value identical.
    """
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return value
    return float(f"{float(value):.6g}")


@dataclass(frozen=True)
class Signal:
    """A deterministic finding in a time series. No model produced this.

    ``score`` is newsworthiness in ``[0, 1]``. Each detector documents how it
    builds its own score; all of them combine *magnitude* (how big the move is)
    with *rarity* (how unusual it is for this particular series). A big move in
    a series that always makes big moves is not news, and the scores reflect
    that.
    """

    detector: str
    metric: str
    metric_label: str
    geography: str
    period: str
    value: float
    unit: str
    comparison_basis: str
    score: float
    section: str
    fields: Mapping[str, float]
    sources: Sequence[SourceRef]
    context: Mapping[str, str] = field(default_factory=dict)
    #: Dashboard indicator id for the chart that backs this finding.
    #:
    #: Carried from the series rather than derived from ``metric``. The two are
    #: not the same vocabulary: the metric is ``unemployment_rate``, the chart
    #: is ``unemployment``, and using the metric produced articles whose chart
    #: request answered 400. See test_chart_ref_contract.py.
    chart_ref: str | None = None
    #: Per-field unit overrides, for fields whose unit is not the series unit.
    #:
    #: The context pack merges figures from *other* series into ``fields`` —
    #: inflation alongside a labour cost, a spread alongside a price. Labelling
    #: those with ``self.unit`` is exactly the bug ``units.py`` was written to
    #: stop, one namespace further out: it would print "3.1 EUR per hour" for an
    #: inflation rate. Empty for a signal a detector built on its own.
    field_units: Mapping[str, str | None] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not 0.0 <= self.score <= 1.0:
            raise ValueError(f"score out of range: {self.score}")
        if self.section not in SECTIONS:
            raise ValueError(f"unknown section: {self.section}")
        if not self.comparison_basis.strip():
            raise ValueError("a signal must name what its value is measured against")
        if not self.sources:
            raise ValueError("a signal must carry at least one source reference")

        # Quantise the verified figures to the precision they are shown at.
        #
        # Detectors compute values like 10.869999999999976. The prompt renders
        # that as "10.87", the model can only echo what it was shown, and the
        # validator then compares 10.87 against the raw float with a tolerance
        # of exactly zero — so a correct article is rejected for a floating
        # point artefact nobody can see. An end-to-end run against live
        # Eurostat and Elering data rejected two of two articles on precisely
        # this, alongside genuine catches.
        #
        # Zero tolerance in the validator is right and must not be loosened:
        # it is what makes "every figure traces to a dataset" a fact rather
        # than an approximation. The fix belongs here, by making the stored
        # value identical to the displayed one, so prompt and verdict agree by
        # construction instead of by luck.
        object.__setattr__(
            self, "fields", {k: _quantise(v) for k, v in self.fields.items()}
        )
        object.__setattr__(self, "value", _quantise(self.value))

    @property
    def id(self) -> str:
        """Stable across runs for the same finding, so reruns do not duplicate."""
        raw = f"{self.detector}|{self.metric}|{self.geography}|{self.period}|{self.value:.6g}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "detector": self.detector,
            "metric": self.metric,
            "metric_label": self.metric_label,
            "geography": self.geography,
            "period": self.period,
            "value": self.value,
            "unit": self.unit,
            "comparison_basis": self.comparison_basis,
            "score": round(self.score, 4),
            "section": self.section,
            "fields": {k: v for k, v in self.fields.items()},
            "context": dict(self.context),
            "sources": [s.to_json() for s in self.sources],
        }


@dataclass(frozen=True)
class RawItem:
    """One retrieved payload, archived byte-for-byte before it is parsed."""

    source_id: str
    url: str
    retrieved_at: str
    content_type: str
    body: bytes
    http_status: int = 200
    from_cache: bool = False
    etag: str | None = None
    last_modified: str | None = None

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.body).hexdigest()

    @property
    def archive_name(self) -> str:
        day = self.retrieved_at[:10]
        stamp = self.retrieved_at.replace(":", "").replace("-", "")
        return f"{day}/{self.source_id}/{stamp}-{self.digest[:12]}.raw"


@dataclass(frozen=True)
class FeedItem:
    """A single syndicated entry.

    There is deliberately no field for a full article body. See
    :mod:`newsroom.pipeline.collect.rss` for why that is a structural property
    of the parser rather than a convention.
    """

    source_id: str
    title: str
    link: str
    description: str
    published: str | None
    guid: str
    raw_blob: str
    retrieved_at: str | None = None


@dataclass
class Figure:
    """A number in the prose, bound to the signal field it came from."""

    value: float
    signal_field: str
    unit: str | None = None
    rendered_as: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"value": self.value, "signal_field": self.signal_field}
        if self.unit:
            out["unit"] = self.unit
        if self.rendered_as:
            out["rendered_as"] = self.rendered_as
        return out


@dataclass
class Block:
    type: str
    text: str | None = None
    chart_ref: str | None = None
    figures: list[Figure] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type}
        if self.text is not None:
            out["text"] = self.text
        if self.chart_ref:
            out["chart_ref"] = self.chart_ref
        if self.figures:
            out["figures"] = [f.to_json() for f in self.figures]
        return out


@dataclass
class Article:
    """The unit of publication. Mirrors ``schemas/article.schema.json``."""

    id: str
    slug: str
    tier: Tier
    status: Status
    headline: str
    section: str
    created_at: str
    provenance: dict[str, Any]
    dek: str | None = None
    body: list[Block] = field(default_factory=list)
    persona: dict[str, Any] | None = None
    syndicated: dict[str, Any] | None = None
    countries: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    published_at: str | None = None
    corrections: list[dict[str, Any]] = field(default_factory=list)
    #: What KIND of thing this is, as against what it is about.
    #:
    #: ``section`` answers "what is this about" and is a real dashboard
    #: section, because the newsroom borrows the dashboard's taxonomy and that
    #: is load-bearing — it is what makes ``ChartEmbed`` and the article → /data
    #: round trip work. A section with no tile behind it would be a hole in the
    #: site's central promise.
    #:
    #: But a weekly wrap filed under ``maritime`` with a maritime byline is a
    #: category error even when its prose is right, and that is what got the
    #: first one retracted: headline, section and byline all said "a maritime
    #: report" about a cross-beat digest, and no reader could have told
    #: otherwise. The two questions were conflated because only one of them had
    #: a field.
    #:
    #: A REAL FIELD, not derived from ``signal_detector``. A derived label is a
    #: second place the truth lives, and the two drift — which is how ``cites``
    #: came to say 8 in one artefact and 3 in another. Written once, read
    #: everywhere.
    #:
    #: ``None`` means an ordinary report, which is almost everything.
    format: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "slug": self.slug,
            "tier": self.tier,
            "status": self.status,
            "headline": self.headline,
            "section": self.section,
            "created_at": self.created_at,
            "provenance": self.provenance,
        }
        if self.dek:
            out["dek"] = self.dek
        if self.body:
            out["body"] = [b.to_json() for b in self.body]
        if self.persona:
            out["persona"] = self.persona
        if self.syndicated:
            out["syndicated"] = self.syndicated
        if self.countries:
            out["countries"] = self.countries
        if self.tags:
            out["tags"] = self.tags
        if self.published_at:
            out["published_at"] = self.published_at
        if self.corrections:
            out["corrections"] = self.corrections
        if self.format:
            out["format"] = self.format
        return out

    @property
    def all_figures(self) -> list[Figure]:
        return [fig for block in self.body for fig in block.figures]
