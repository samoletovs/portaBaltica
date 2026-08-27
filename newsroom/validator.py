"""The publication gate.

An article is servable only when ``provenance.validator.passed`` is true. This
module produces that verdict, implementing every check in the ``validator.checks``
enum of ``newsroom/schemas/article.schema.json``.

Three properties matter more than any individual check:

* **Fail closed.** A check that cannot be evaluated fails. Missing signal
  payload, missing raw feed item, unregistered source, unexpected exception —
  all of them produce ``passed: false``, never a skipped check. No verdict means
  not servable.
* **Pure.** No network, no Azure, no clock unless one is injected. Everything
  needed to reach a verdict is passed in, so every verdict is reproducible from
  the archived raw material.
* **Honest failure detail.** Every failing check names what it found, because a
  rejection nobody can diagnose becomes a rejection somebody disables.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Final, Mapping, Sequence

from . import numeric_scan
from .persona_rules import AI_DISCLOSURE, PersonaError, PersonaRegistry
from .source_registry import SourceRegistry, SourceRegistryError

logger = logging.getLogger(__name__)

#: The check names, in the order the schema declares them. A test asserts this
#: tuple equals the schema enum, so the two cannot drift apart.
CHECK_NAMES: Final[tuple[str, ...]] = (
    "figures_traceable",
    "no_invented_numbers",
    "snippet_verbatim",
    "no_rewrite_of_restricted_source",
    "byline_discloses_ai",
    "no_lived_experience_claims",
    "attribution_present",
    "comparison_basis_stated",
    "no_repeated_findings",
    "no_unsupported_mechanism",
)

#: How far a declared figure may sit from the signal value it claims to come
#: from: exactly what correct rounding permits at the precision the figure was
#: declared to.
#:
#: This was zero, on the reasoning that "rounding is a rendering concern, handled
#: where prose is compared to figures; a figure itself must be the number the
#: source published". Held against the rest of the pipeline, that made the wire
#: unpublishable. A run on 2026-08-25 selected eight signals, wrote eight
#: articles, spent three drafts on each, and published none — all twenty-four
#: drafts failed here and nowhere else.
#:
#: The reason is not that the model is careless. ``pipeline.units.display_value``
#: rounds every derived field to two decimals *before showing it to the writer*,
#: deliberately, because "five decimal places on a derived ratio is noise that
#: reads as false precision". So the pipeline handed the writer one number and
#: this check demanded another:
#:
#:     shown to the writer      demanded here      rejection
#:     3.19                     3.18801            figure 3.19 does not match
#:     449.09                   449.091            figure 449.09 does not match
#:     6.17                     6.175              figure 6.17 does not match
#:
#: Every article was rejected for using precisely the value it was given. Zero
#: tolerance caught no fabricated number; it caught the pipeline disagreeing with
#: itself, and it cost the entire output while doing so.
#:
#: So the rule is now the same one ``numeric_scan`` already applies between prose
#: and figures: a number must be the source number, written at the precision it
#: was written to. 277.78 for 277.778 passes. 280 for 277.778 does not, and
#: neither does anything else that misstates the source once rounded back.
def figure_value_tolerance(declared: object) -> float:
    """Half a unit in the last decimal place ``declared`` committed to."""
    return numeric_scan.rendering_tolerance(numeric_scan.decimals_written(declared))


SYNDICATED_TIERS: Final[frozenset[str]] = frozenset({"B", "C"})

_TEXT_BLOCK_TYPES: Final[frozenset[str]] = frozenset(
    {"paragraph", "quote", "callout", "list", "table"}
)


class ValidatorError(Exception):
    """Raised by :func:`assert_servable` when an article is not servable."""


@dataclass(frozen=True, slots=True)
class CheckResult:
    """One gate's verdict."""

    name: str
    passed: bool
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"name": self.name, "passed": self.passed}
        if self.detail:
            payload["detail"] = self.detail
        return payload


@dataclass(frozen=True, slots=True)
class ValidatorVerdict:
    """The full verdict, shaped for ``provenance.validator``."""

    passed: bool
    checked_at: str
    checks: tuple[CheckResult, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "checked_at": self.checked_at,
            "checks": [check.to_dict() for check in self.checks],
        }

    def failures(self) -> tuple[CheckResult, ...]:
        return tuple(check for check in self.checks if not check.passed)

    def failure_summary(self) -> str:
        return "; ".join(f"{check.name}: {check.detail}" for check in self.failures())

    def __bool__(self) -> bool:
        return self.passed


@dataclass(frozen=True, slots=True)
class ValidationContext:
    """Everything a check is allowed to look at.

    Deliberately explicit: a check cannot reach out for data it was not given,
    which is what makes the verdict reproducible from the blob archive.
    """

    article: Mapping[str, Any]
    registry: SourceRegistry
    personas: PersonaRegistry
    signal: Mapping[str, Any] | None = None
    """The verified signal payload the article was written from. Tier A only."""

    raw_feed_item: Mapping[str, Any] | None = None
    """The stored raw RSS item, for byte-comparison. Tiers B and C."""

    @property
    def tier(self) -> str:
        tier = self.article.get("tier")
        return tier if isinstance(tier, str) else ""

    @property
    def blocks(self) -> tuple[Mapping[str, Any], ...]:
        body = self.article.get("body")
        if not isinstance(body, list):
            return ()
        return tuple(block for block in body if isinstance(block, Mapping))

    @property
    def syndicated(self) -> Mapping[str, Any] | None:
        syndicated = self.article.get("syndicated")
        return syndicated if isinstance(syndicated, Mapping) else None

    @property
    def provenance(self) -> Mapping[str, Any]:
        provenance = self.article.get("provenance")
        return provenance if isinstance(provenance, Mapping) else {}

    def source_ids(self) -> tuple[str, ...]:
        """Every source this article claims to draw on, deduplicated, in order."""
        ids: list[str] = []
        syndicated = self.syndicated
        if syndicated is not None:
            source_id = syndicated.get("source_id")
            if isinstance(source_id, str) and source_id:
                ids.append(source_id)
        for entry in self.provenance.get("sources") or []:
            if not isinstance(entry, Mapping):
                continue
            source_id = entry.get("source_id")
            if isinstance(source_id, str) and source_id and source_id not in ids:
                ids.append(source_id)
        return tuple(ids)

    def generated_prose(self) -> tuple[tuple[str, str], ...]:
        """Prose *we* wrote, as ``(location, text)`` pairs.

        Excludes the syndicated snippet and full text. Those are the outlet's
        own words reproduced verbatim; scanning them for our editorial rules
        would reject correct behaviour and teach everyone to ignore the gate.
        """
        units: list[tuple[str, str]] = []
        if self.tier not in SYNDICATED_TIERS:
            for key in ("headline", "dek"):
                value = self.article.get(key)
                if isinstance(value, str) and value.strip():
                    units.append((key, value))
        for index, block in enumerate(self.blocks):
            text = block.get("text")
            if isinstance(text, str) and text.strip():
                units.append((f"body[{index}]", text))
        return tuple(units)


# ── signal field resolution ─────────────────────────────────────────────

_PATH_SEGMENT_RE: Final[re.Pattern[str]] = re.compile(r"([^.\[\]]+)|\[(\d+)\]")

_MISSING: Final[object] = object()


def resolve_signal_field(signal: Mapping[str, Any] | None, path: str) -> Any:
    """Resolve a dotted ``signal_field`` path against the signal payload.

    Supports ``series.latest.value`` and ``hours[3].price``. Returns a sentinel
    when the path does not resolve; callers treat that as a failure.
    """
    if signal is None or not path:
        return _MISSING

    roots: list[Any] = [signal]
    nested = signal.get("payload")
    if isinstance(nested, Mapping):
        roots.append(nested)

    for root in roots:
        resolved = _walk(root, path)
        if resolved is not _MISSING:
            return resolved
    return _MISSING


def _walk(root: Any, path: str) -> Any:
    current: Any = root
    for match in _PATH_SEGMENT_RE.finditer(path):
        key, index = match.group(1), match.group(2)
        if key is not None:
            if not isinstance(current, Mapping) or key not in current:
                return _MISSING
            current = current[key]
        else:
            if not isinstance(current, Sequence) or isinstance(current, (str, bytes)):
                return _MISSING
            position = int(index)
            if position >= len(current):
                return _MISSING
            current = current[position]
    return current


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


# ── check: figures_traceable ────────────────────────────────────────────


def check_figures_traceable(context: ValidationContext) -> CheckResult:
    """Every declared figure must resolve to the signal payload, and be that
    number written at the precision it was declared to.

    This is the anti-drift check. ``no_invented_numbers`` proves the prose
    matches the figures; this proves the figures match the source. Without both,
    a model can move a number by declaring the moved value.
    """
    name = "figures_traceable"
    figures = [
        (index, figure)
        for index, block in enumerate(context.blocks)
        for figure in (block.get("figures") or [])
        if isinstance(figure, Mapping)
    ]

    if not figures:
        if context.tier == "A" and _has_numeric_prose(context):
            return CheckResult(
                name,
                False,
                "prose contains numbers but the article declares no figures",
            )
        return CheckResult(name, True, "no figures declared")

    if context.signal is None:
        return CheckResult(
            name,
            False,
            f"{len(figures)} figure(s) declared but no signal payload was supplied; "
            "cannot verify traceability",
        )

    problems: list[str] = []
    for index, figure in figures:
        signal_field = figure.get("signal_field")
        if not isinstance(signal_field, str) or not signal_field.strip():
            problems.append(f"body[{index}]: figure {figure.get('value')!r} has no signal_field")
            continue

        resolved = resolve_signal_field(context.signal, signal_field)
        if resolved is _MISSING:
            problems.append(
                f"body[{index}]: signal_field {signal_field!r} does not resolve in the signal payload"
            )
            continue

        resolved_number = _as_number(resolved)
        declared = _as_number(figure.get("value"))
        if resolved_number is None:
            problems.append(
                f"body[{index}]: signal_field {signal_field!r} resolved to non-numeric {resolved!r}"
            )
            continue
        if declared is None:
            problems.append(f"body[{index}]: figure has non-numeric value {figure.get('value')!r}")
            continue

        tolerance = figure_value_tolerance(figure.get("value"))
        if abs(declared - resolved_number) > tolerance:
            problems.append(
                f"body[{index}]: figure {declared!r} does not match "
                f"{signal_field}={resolved_number!r} (tolerance {tolerance:g})"
            )

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, f"{len(figures)} figure(s) traced to the signal payload")


def _has_numeric_prose(context: ValidationContext) -> bool:
    return any(numeric_scan.scan(text) for _, text in context.generated_prose())


# ── check: no_invented_numbers ──────────────────────────────────────────


def check_no_invented_numbers(context: ValidationContext) -> CheckResult:
    """Every numeric token in our prose must trace to a declared figure.

    Body blocks are checked against their own ``figures``, because a number
    justified three paragraphs away is not really justified. The headline and
    dek are checked against the union of all figures, since they summarise the
    whole article.
    """
    name = "no_invented_numbers"
    all_figures: list[Mapping[str, Any]] = [
        figure
        for block in context.blocks
        for figure in (block.get("figures") or [])
        if isinstance(figure, Mapping)
    ]

    problems: list[str] = []
    checked = 0

    for location, text in context.generated_prose():
        if location.startswith("body["):
            index = int(location[5:-1])
            block = context.blocks[index]
            figures: Sequence[Mapping[str, Any]] = [
                figure for figure in (block.get("figures") or []) if isinstance(figure, Mapping)
            ]
        else:
            figures = all_figures

        tokens = numeric_scan.scan(text)
        checked += len(tokens)
        unjustified = [
            token for token in tokens if not numeric_scan.is_justified(token, figures)
        ]
        if unjustified:
            problems.append(f"{location}: {numeric_scan.describe(unjustified)} not in figures")

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, f"{checked} numeric token(s) all traced to declared figures")


# ── check: snippet_verbatim ─────────────────────────────────────────────

_RAW_TEXT_KEYS: Final[tuple[str, ...]] = (
    "description",
    "summary",
    "full_text",
    "content",
    "content:encoded",
)


def check_snippet_verbatim(context: ValidationContext) -> CheckResult:
    """A syndicated snippet must byte-match the stored raw feed item.

    Byte equality, not "close enough". A single altered character is the
    difference between quoting an outlet's own syndication snippet — which DSM
    Art. 15 carves out — and publishing a derived work, which it does not.
    """
    name = "snippet_verbatim"
    syndicated = context.syndicated
    tier = context.tier

    if syndicated is None:
        if tier in SYNDICATED_TIERS:
            return CheckResult(name, False, f"tier {tier} article has no syndicated block")
        return CheckResult(name, True, "not applicable: no syndicated content")

    if tier not in SYNDICATED_TIERS:
        return CheckResult(
            name, False, f"tier {tier} article carries a syndicated block; tiers must not mix"
        )

    if syndicated.get("snippet_is_verbatim") is not True:
        return CheckResult(
            name,
            False,
            "syndicated.snippet_is_verbatim is not true; the ingester did not assert verbatim copy",
        )

    reproduced = [
        (key, value)
        for key in ("snippet", "full_text")
        if isinstance(value := syndicated.get(key), str) and value
    ]
    if not reproduced:
        return CheckResult(name, False, f"tier {tier} article reproduces no snippet or full text")

    if tier == "C" and not any(key == "snippet" for key, _ in reproduced):
        return CheckResult(name, False, "tier C article has no snippet")

    if tier == "C" and any(key == "full_text" for key, _ in reproduced):
        return CheckResult(
            name,
            False,
            "tier C article carries full_text; only the outlet's RSS description may be shown",
        )

    if context.raw_feed_item is None:
        return CheckResult(
            name,
            False,
            "no raw feed item supplied; cannot prove the snippet is verbatim",
        )

    raw_candidates: dict[str, bytes] = {}
    for key in _RAW_TEXT_KEYS:
        value = context.raw_feed_item.get(key)
        if isinstance(value, str) and value:
            raw_candidates[key] = value.encode("utf-8")

    if not raw_candidates:
        return CheckResult(
            name, False, "raw feed item carries no description to compare the snippet against"
        )

    problems: list[str] = []
    for key, value in reproduced:
        encoded = value.encode("utf-8")
        if key == "snippet":
            raw = raw_candidates.get("description") or raw_candidates.get("summary")
            if raw is None:
                problems.append("raw feed item has no <description> to compare the snippet against")
                continue
            if encoded != raw:
                problems.append(
                    f"snippet does not byte-match the raw <description> "
                    f"({len(encoded)} bytes vs {len(raw)}); first difference at "
                    f"offset {_first_difference(encoded, raw)}"
                )
        elif encoded not in raw_candidates.values():
            problems.append("full_text does not byte-match any stored raw field")

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, "syndicated text byte-matches the stored raw feed item")


def _first_difference(left: bytes, right: bytes) -> int:
    for index, (a, b) in enumerate(zip(left, right)):
        if a != b:
            return index
    return min(len(left), len(right))


# ── check: no_rewrite_of_restricted_source ──────────────────────────────


def check_no_rewrite_of_restricted_source(context: ValidationContext) -> CheckResult:
    """No generated prose may exist for a source we may not rewrite.

    The single check the legal position rests on. It is deliberately blunt: if
    any cited source has ``rewrite_allowed: false``, the article may contain no
    body prose, no dek, no byline and no model attribution at all.
    """
    name = "no_rewrite_of_restricted_source"
    source_ids = context.source_ids()

    if not source_ids:
        return CheckResult(name, False, "article cites no source; content without provenance is dropped")

    restricted: list[str] = []
    for source_id in source_ids:
        try:
            source = context.registry.get(source_id)
        except SourceRegistryError as exc:
            return CheckResult(name, False, str(exc))
        if not source.rewrite_allowed:
            restricted.append(source.id)

    if not restricted:
        return CheckResult(
            name, True, f"all cited sources permit original writing: {', '.join(source_ids)}"
        )

    problems: list[str] = []
    label = ", ".join(restricted)

    for index, block in enumerate(context.blocks):
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            problems.append(f"body[{index}] contains generated prose")

    dek = context.article.get("dek")
    if isinstance(dek, str) and dek.strip():
        problems.append("article carries a dek, which is generated prose")

    if context.article.get("persona") is not None:
        problems.append("article carries a byline for work we did not write")

    model = context.provenance.get("model")
    if model is not None:
        problems.append(f"provenance records a generating model ({model!r})")

    # A rewritten headline is a rewrite. Checked only when the raw item is
    # available; when it is not, snippet_verbatim already fails the article.
    raw_title = (context.raw_feed_item or {}).get("title")
    headline = context.article.get("headline")
    if isinstance(raw_title, str) and isinstance(headline, str):
        if headline.encode("utf-8") != raw_title.encode("utf-8"):
            problems.append(
                f"headline {headline!r} does not byte-match the feed title {raw_title!r}"
            )

    if problems:
        return CheckResult(name, False, f"restricted source(s) {label}: " + "; ".join(problems))
    return CheckResult(name, True, f"no generated prose for restricted source(s) {label}")


# ── check: byline_discloses_ai ──────────────────────────────────────────


def check_byline_discloses_ai(context: ValidationContext) -> CheckResult:
    """Tier A must carry a disclosed AI byline; tiers B and C must carry none."""
    name = "byline_discloses_ai"
    persona = context.article.get("persona")
    tier = context.tier

    if tier in SYNDICATED_TIERS:
        if persona is not None:
            return CheckResult(
                name,
                False,
                f"tier {tier} article carries a byline; we did not write it, so no correspondent may claim it",
            )
        return CheckResult(name, True, f"tier {tier} correctly carries no byline")

    if not isinstance(persona, Mapping):
        return CheckResult(name, False, "tier A article has no persona block, so no disclosed byline")

    persona_id = persona.get("id")
    if not isinstance(persona_id, str):
        return CheckResult(name, False, f"persona id {persona_id!r} is not a string")

    try:
        expected = context.personas.get(persona_id)
    except PersonaError as exc:
        return CheckResult(name, False, str(exc))

    byline = persona.get("byline")
    if not isinstance(byline, str) or not byline.strip():
        return CheckResult(name, False, f"persona {persona_id!r} has no byline")

    if AI_DISCLOSURE not in byline:
        return CheckResult(name, False, f"byline {byline!r} does not contain {AI_DISCLOSURE!r}")

    if byline != expected.byline:
        return CheckResult(
            name,
            False,
            f"byline {byline!r} is not the canonical byline {expected.byline!r}; "
            "bylines are built by persona_rules, never written by a model",
        )

    return CheckResult(name, True, f"byline discloses AI authorship: {byline!r}")


# ── check: no_lived_experience_claims ───────────────────────────────────


def check_no_lived_experience_claims(context: ValidationContext) -> CheckResult:
    """Our prose may not claim visiting, interviewing, witnessing or phoning."""
    name = "no_lived_experience_claims"
    problems: list[str] = []

    for location, text in context.generated_prose():
        for code, span in context.personas.find_forbidden_claims(text):
            problems.append(f"{location}: {span!r} ({code})")

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, "no claims of lived experience found")


# ── check: attribution_present ──────────────────────────────────────────


def check_attribution_present(context: ValidationContext) -> CheckResult:
    """Tier B and C must carry their source's registered attribution string."""
    name = "attribution_present"
    tier = context.tier

    if tier not in SYNDICATED_TIERS:
        source_ids = context.source_ids()
        if not source_ids:
            return CheckResult(name, False, "article cites no source")
        for source_id in source_ids:
            try:
                context.registry.get(source_id)
            except SourceRegistryError as exc:
                return CheckResult(name, False, str(exc))
        return CheckResult(
            name, True, f"tier {tier or '?'} cites registered source(s): {', '.join(source_ids)}"
        )

    syndicated = context.syndicated
    if syndicated is None:
        return CheckResult(name, False, f"tier {tier} article has no syndicated block")

    source_id = syndicated.get("source_id")
    if not isinstance(source_id, str) or not source_id:
        return CheckResult(name, False, "syndicated block names no source_id")

    try:
        source = context.registry.get(source_id)
    except SourceRegistryError as exc:
        return CheckResult(name, False, str(exc))

    attribution = syndicated.get("attribution")
    if not isinstance(attribution, str) or not attribution.strip():
        return CheckResult(name, False, f"tier {tier} article carries no attribution string")

    if attribution != source.attribution:
        return CheckResult(
            name,
            False,
            f"attribution {attribution!r} does not match the registered "
            f"{source.attribution!r} for {source_id!r}",
        )

    original_url = syndicated.get("original_url")
    if not isinstance(original_url, str) or not original_url.strip():
        return CheckResult(name, False, "syndicated block carries no original_url to link back to")

    return CheckResult(name, True, f"attributed to {attribution!r} with a link back")


# ── check: comparison_basis_stated ──────────────────────────────────────

_CHANGE_INDICATORS: Final[re.Pattern[str]] = re.compile(
    r"\b(?:rose|rise[sn]?|rising|fell|fall(?:s|en|ing)?|climb(?:ed|s|ing)?|"
    r"drop(?:ped|s|ping)?|increase[sd]?|increasing|decrease[sd]?|decreasing|"
    r"grew|grow(?:s|ing|th)?|shr[au]nk|shrunken|shrink(?:s|ing)?|"
    r"gain(?:ed|s)?|lost|doubled|tripled|halved|"
    r"jump(?:ed|s)?|surge[sd]?|slump(?:ed|s)?|slid|slide[sd]?|"
    r"widen(?:ed|s)?|narrow(?:ed|s)?|accelerat(?:ed|es)|slow(?:ed|s)|"
    r"decline[sd]?|declining|improve[ds]?|deteriorat(?:ed|es)|"
    r"higher|lower|stronger|weaker|cheaper|dearer)\b",
    re.IGNORECASE,
)

#: "up 12%" describes a change; "up to eight articles" does not.
_DIRECTIONAL_WITH_NUMBER: Final[re.Pattern[str]] = re.compile(
    r"\b(?:up|down)\s+(?!to\b)(?:by\s+)?[€$£]?\d",
    re.IGNORECASE,
)

_BASIS_PATTERNS: Final[tuple[re.Pattern[str], ...]] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bcompared\s+(?:with|to)\b",
        r"\bagainst\s+(?:the\s+)?\w+",
        r"\bversus\b|\bvs\.?\b",
        r"\bthan\b",
        r"\b(?:year|month|quarter|week|day)[-\s]on[-\s](?:year|month|quarter|week|day)\b",
        r"\b(?:y/y|m/m|q/q|yoy|mom)\b",
        r"\ba\s+(?:year|month|week|quarter|decade)\s+(?:earlier|ago|before)\b",
        r"\blast\s+(?:year|month|week|quarter)\b",
        r"\bthe\s+same\s+(?:month|period|week|quarter|day|year|hour)\b",
        r"\bthe\s+(?:previous|preceding|prior)\s+\w+",
        r"\bsince\b",
        r"\bfrom\b[^.]{1,60}?\bto\b",
        r"\brelative\s+to\b",
        r"\bbaseline\b|\bclimatological\b|\blong[-\s]run\b|\blong[-\s]term\s+(?:average|normal|mean)\b",
        r"\bnormal\s+for\b",
        r"\baverage\s+(?:for|over|of)\b",
        r"\bover\s+the\s+(?:past|last|previous)\b",
        r"\b\d+[-\s]year\s+(?:average|mean|normal|trend)\b",
        r"\bon\s+the\s+(?:year|month|week|day)\b",
        r"\bpre-\s?\d{4}\b",
        r"\bbetween\b[^.]{1,60}?\band\b",
        r"\brecord\s+(?:high|low)\b",
    )
)


def check_comparison_basis_stated(context: ValidationContext) -> CheckResult:
    """A described change must name what it is measured against.

    "Electricity prices rose 12%" is not a fact until the reader knows twelve
    per cent against what, so a *quantified* change must carry its basis in the
    same text unit — beside the claim, not three paragraphs below it.

    A change mentioned without a figure is held to a weaker rule: the article
    must state a basis somewhere. "The decline was broad-based" makes no
    numeric claim and cannot mislead anyone about what it is measured against,
    and demanding "compared with a year earlier" in every paragraph that refers
    back to the change produces prose no editor would pass. Requiring it
    article-wide keeps the basis from disappearing altogether.
    """
    name = "comparison_basis_stated"
    problems: list[str] = []
    described = 0
    qualitative_gaps: list[str] = []
    basis_anywhere = False

    for location, text in context.generated_prose():
        has_basis = any(pattern.search(text) for pattern in _BASIS_PATTERNS)
        if has_basis:
            basis_anywhere = True

        if location == "headline":
            # Headlines are capped at 140 characters and conventionally omit the
            # basis; the dek and body carry it. Exempted deliberately, not by
            # oversight.
            continue

        change = _CHANGE_INDICATORS.search(text) or _DIRECTIONAL_WITH_NUMBER.search(text)
        if change is None:
            continue
        described += 1
        if has_basis:
            continue

        if numeric_scan.scan(text):
            problems.append(
                f"{location}: quantifies a change ({change.group(0).strip()!r}) "
                "without naming the comparison basis"
            )
        else:
            qualitative_gaps.append(location)

    if qualitative_gaps and not basis_anywhere:
        problems.append(
            f"{', '.join(qualitative_gaps)}: describes a change and the article "
            "never names the comparison basis"
        )

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, f"{described} described change(s) all state a basis")


# ── check: no_repeated_findings ─────────────────────────────────────────


def check_no_repeated_findings(context: ValidationContext) -> CheckResult:
    """No two paragraphs may rest on the same set of verified figures.

    THE FAILURE THIS CATCHES
    ------------------------
    A live tier A article ran six paragraphs on one fact::

        body[0]: "Estonia's annual consumer price inflation decreased to 2% in
                  July 2026, compared with the four-year average of 9.62%."
        body[3]: "Estonia's inflation rate is significantly below its historical
                  average for this time of year, with the latest figure of 2%
                  compared to the four-year average of 9.62%."

    Both declared ``{latest_value, seasonal_mean}``. It is the same sentence
    twice, and every other gate passed it: the figures were traceable, the
    numbers were not invented, and each paragraph named its comparison basis.
    Correctness checks cannot see padding.

    WHY IT IS A CHECK RATHER THAN AN INSTRUCTION
    --------------------------------------------
    The system prompt has told the writer not to do this since the depth
    rewrite, in a section that opens "the single failure this wire has to stop
    repeating". It does it anyway. But the repetition is not a judgement about
    prose — it is visible in the structured output, because a paragraph that
    restates a finding has to declare the same fields to do it. So it can be
    decided rather than requested.

    THE RULE, AND WHERE ITS EDGES ARE
    ---------------------------------
    Two body paragraphs fail when they declare the **identical, non-empty** set
    of ``signal_field`` names. Deliberately narrow at both ends:

    * **Empty sets never collide.** Most paragraphs carry no figure at all —
      the prompt asks for that explicitly — and the paragraphs doing the
      explaining are exactly the ones that would otherwise all match each other.
    * **A subset is not a repeat.** ``{latest}`` beside ``{latest, peer_lt}``
      is the lead and then the neighbours comparison, which is a different
      claim about the same number and is the paragraph the wire was criticised
      for never writing. Only an exact match fails.

    That leaves one sharp edge, accepted knowingly: two paragraphs that each
    cite ``{latest_value}`` alone and genuinely say different things about it
    are rejected. The prompt's own article plan puts no digits in the later
    paragraphs, so a piece that hits this is already off-plan, and the writer
    is told which two paragraphs collided and can drop the numeral from one of
    them — which is the better paragraph anyway.
    """
    name = "no_repeated_findings"

    seen: dict[frozenset[str], int] = {}
    problems: list[str] = []
    compared = 0

    for index, block in enumerate(context.blocks):
        if block.get("type") not in _TEXT_BLOCK_TYPES:
            continue
        fields = frozenset(
            str(figure.get("signal_field")).strip()
            for figure in (block.get("figures") or [])
            if isinstance(figure, Mapping)
            and isinstance(figure.get("signal_field"), str)
            and str(figure.get("signal_field")).strip()
        )
        if not fields:
            continue
        compared += 1
        first = seen.get(fields)
        if first is None:
            seen[fields] = index
            continue
        problems.append(
            f"body[{index}] rests on the same figures as body[{first}] "
            f"({', '.join(sorted(fields))}) and adds no new evidence"
        )

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(
        name, True, f"{compared} paragraph(s) with figures each rest on a distinct set"
    )


# ── check: no_unsupported_mechanism ─────────────────────────────────────

#: The grammar of attribution. A CLOSED class, and that is the point.
#:
#: ``SPECULATIVE_IMPACT`` in ``house_style`` pairs a verb with a noun --
#: ``impact`` + *sector*, ``could boost`` + *economy* -- so a phrasing outside
#: that grammar is invisible to it. Probed against five sentences that each
#: assert something unsupported, four escaped::
#:
#:     pass  reflecting the growing capacity and efficiency of its ports
#:     pass  This is significant for the maritime sector
#:     FLAG  which could boost the regional economy
#:     pass  signalling stronger demand across the region
#:     pass  underlining the resilience of the sector
#:
#: The set of things a sentence can attribute is infinite; the set of ways to
#: attribute them is small. So this matches the attribution and never the
#: object, which is what stops it being walked around one synonym at a time.
_ATTRIBUTION = re.compile(
    r"\b(?:reflect(?:s|ing|ed)?|indicat(?:e|es|ing|ed)|highlight(?:s|ing|ed)?"
    r"|underscor(?:e|es|ing|ed)|underlin(?:e|es|ing|ed)|signal(?:s|led|ling|ing)?"
    r"|suggest(?:s|ing|ed)?|demonstrat(?:e|es|ing|ed)"
    r"|point(?:s|ing)\s+to|testament\s+to|attributable\s+to"
    r"|driven\s+by|due\s+to|owing\s+to|thanks\s+to|because\s+of"
    r"|as\s+a\s+result\s+of|stem(?:s|ming)?\s+from|result(?:s|ing)?\s+from)\b"
    r"|\bis\s+(?:a\s+)?(?:sign|evidence|proof)\s+of\b"
    r"|\b(?:is|are|remains)\s+(?:significant|important|crucial|critical|vital|"
    r"notable|encouraging|worrying|concerning)\s+for\b"
    # The consequence forms. `house_style.SPECULATIVE_IMPACT` catches these
    # too, but house style has no rejection path -- a validated article
    # publishes once its attempts run out, style faults and all -- and an
    # invented consequence is a truth fault rather than a matter of taste, so
    # it belongs behind a gate that fails closed.
    r"|\b(?:could|may|might|will|would|should)\s+(?:help\s+)?(?:to\s+)?"
    r"(?:boost|lift|drive|spur|hurt|dampen|strengthen|weaken|support|benefit|"
    r"damage|improve|worsen|ease|accelerate|slow)\b",
    re.IGNORECASE,
)

#: Saying we do NOT know is the sentence the prompt asks for by name, and it
#: has to survive a check aimed at the opposite claim.
_DENIES_A_MECHANISM = re.compile(
    r"\b(?:does|do|did|could|can|will|would)\s+not\b"
    r"|\bcannot\b|\bno\s+(?:evidence|indication|sign)\b"
    r"|\bnothing\s+(?:in|about|here)\b"
    r"|\bnot\s+(?:established|shown|clear|possible)\b"
    r"|\bis\s+unclear\b|\bremains\s+unexplained\b",
    re.IGNORECASE,
)

#: An explanation somebody else is on the record for. The prompt permits this
#: in terms -- "use official research context to explain plausible causes ...
#: attribute it by name" -- so an attributed cause is reporting, not invention.
_ATTRIBUTED_TO_A_SOURCE = re.compile(
    r"\baccording\s+to\b|\bsaid\b|\bsays\b|\bstated\b|\btold\b"
    r"|\bthe\s+(?:bank|ministry|commission|government|office|agency|operator)\b"
    r"|\bEurostat\b|\bthe\s+statistics\s+office\b",
    re.IGNORECASE,
)


def check_no_unsupported_mechanism(context: ValidationContext) -> CheckResult:
    """A paragraph with no figures may not explain why something happened.

    THE FAILURE THIS CATCHES
    ------------------------
    A weekly wrap published, and was retracted within the hour, for this::

        "This increase in container throughput is significant for Lithuania's
         maritime sector, reflecting the growing capacity and efficiency of its
         ports."

    Throughput rising does not show capacity rising -- it is equally consistent
    with heavier use of unchanged capacity -- and it says nothing whatever
    about efficiency. Two claims about the world, neither in the data, on a
    site whose whole proposition is that every figure traces to its dataset.

    All nine checks passed it, and they passed it VACUOUSLY: the paragraph
    carries no figures, so every numeric gate had nothing to look at.

    WHY GROUNDEDNESS, AND WHY FIGURES ARE HOW IT IS MEASURED
    --------------------------------------------------------
    The verb is not the signal. The prompt's own worked example of bad prose
    contains "the rise reflects a streak of eight consecutive annual increases
    since 2008", which uses the same verb as the retracted sentence and is
    *grounded* -- the streak is in the data. What separates them is whether the
    thing attributed to is present in the piece's own figures.

    A paragraph's declared figures are exactly that presence, made machine
    readable. So the rule is: a paragraph that carries evidence may explain
    what it carries; a paragraph that carries none may not explain anything on
    its own authority. It may still deny a mechanism -- "the data does not show
    what drove the change" is figure-free and is one of the better sentences
    this wire publishes -- or report one somebody is named as the source of.

    WHY IT IS A CHECK RATHER THAN AN INSTRUCTION
    --------------------------------------------
    The prompt has forbidden this in terms, by name, including the exact verb
    the retracted article used::

        Never write that a movement "reflects", "indicates", "highlights",
        "underscores" or "points to" something the figures do not establish.

    It did it anyway. Fourth component where the guidance was right and nothing
    enforced it, after the persona closing moves, the analyst's
    ``what_to_watch``, and the prompt's own "same period" requirement.
    """
    name = "no_unsupported_mechanism"
    problems: list[str] = []

    for index, block in enumerate(context.blocks):
        if block.get("type") != "paragraph":
            continue
        text = block.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        if block.get("figures"):
            continue
        found = _ATTRIBUTION.search(text)
        if not found:
            continue
        if _DENIES_A_MECHANISM.search(text) or _ATTRIBUTED_TO_A_SOURCE.search(text):
            continue
        problems.append(
            f"body[{index}]: explains a movement -- {found.group(0).strip()!r} -- "
            "in a paragraph carrying no figure. Say what the data shows, "
            "attribute the explanation to a named source, or say plainly that "
            "the data does not establish a cause"
        )

    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, "no unevidenced explanation")


# ── runner ──────────────────────────────────────────────────────────────

_CHECKS: Final[Mapping[str, Callable[[ValidationContext], CheckResult]]] = {
    "figures_traceable": check_figures_traceable,
    "no_invented_numbers": check_no_invented_numbers,
    "snippet_verbatim": check_snippet_verbatim,
    "no_rewrite_of_restricted_source": check_no_rewrite_of_restricted_source,
    "byline_discloses_ai": check_byline_discloses_ai,
    "no_lived_experience_claims": check_no_lived_experience_claims,
    "attribution_present": check_attribution_present,
    "comparison_basis_stated": check_comparison_basis_stated,
    "no_repeated_findings": check_no_repeated_findings,
    "no_unsupported_mechanism": check_no_unsupported_mechanism,
}


def validate_article(
    article: Mapping[str, Any],
    *,
    registry: SourceRegistry,
    personas: PersonaRegistry,
    signal: Mapping[str, Any] | None = None,
    raw_feed_item: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> ValidatorVerdict:
    """Run every check and return the verdict.

    An exception inside a check becomes a failed check, never a lost one: a
    crash in the gate must not read as permission to publish.
    """
    context = ValidationContext(
        article=article,
        registry=registry,
        personas=personas,
        signal=signal,
        raw_feed_item=raw_feed_item,
    )

    results: list[CheckResult] = []
    for name in CHECK_NAMES:
        check = _CHECKS[name]
        try:
            results.append(check(context))
        except Exception as exc:  # noqa: BLE001 — fail closed on any check error
            logger.exception("check %s raised; failing closed", name)
            results.append(CheckResult(name, False, f"check raised {type(exc).__name__}: {exc}"))

    checked_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return ValidatorVerdict(
        passed=all(result.passed for result in results),
        checked_at=checked_at.isoformat().replace("+00:00", "Z"),
        checks=tuple(results),
    )


def is_servable(article: Mapping[str, Any]) -> bool:
    """Render-time gate: does this article carry a passing verdict?

    Mirrors the frontend's rule. Anything without an explicit ``passed: true``
    is not servable — including an article whose verdict is missing entirely.
    """
    provenance = article.get("provenance")
    if not isinstance(provenance, Mapping):
        return False
    verdict = provenance.get("validator")
    if not isinstance(verdict, Mapping):
        return False
    if verdict.get("passed") is not True:
        return False
    checks = verdict.get("checks")
    if not isinstance(checks, list) or not checks:
        return False
    names = {check.get("name") for check in checks if isinstance(check, Mapping)}
    if set(CHECK_NAMES) - names:
        return False
    return all(
        isinstance(check, Mapping) and check.get("passed") is True for check in checks
    )


def assert_servable(article: Mapping[str, Any]) -> None:
    """Raise :class:`ValidatorError` unless the article carries a passing verdict."""
    if not is_servable(article):
        raise ValidatorError(
            f"article {article.get('id', '<unknown>')!r} has no passing validator verdict; "
            "not servable"
        )


def stamp_verdict(
    article: dict[str, Any],
    verdict: ValidatorVerdict,
) -> dict[str, Any]:
    """Write a verdict into an article's provenance block, in place."""
    provenance = article.setdefault("provenance", {})
    provenance["validator"] = verdict.to_dict()
    return article


__all__ = [
    "CHECK_NAMES",
    "CheckResult",
    "ValidationContext",
    "ValidatorError",
    "ValidatorVerdict",
    "assert_servable",
    "check_attribution_present",
    "check_byline_discloses_ai",
    "check_comparison_basis_stated",
    "check_figures_traceable",
    "check_no_invented_numbers",
    "check_no_lived_experience_claims",
    "check_no_rewrite_of_restricted_source",
    "check_snippet_verbatim",
    "figure_value_tolerance",
    "is_servable",
    "resolve_signal_field",
    "stamp_verdict",
    "validate_article",
]
