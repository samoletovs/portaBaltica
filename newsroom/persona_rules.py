"""Persona rules — bylines, routing, and the anti-deception constraints.

Loads ``newsroom/personas.yaml``. Three jobs:

1. Build the byline string. It always renders ``<name> · AI correspondent,
   <beat>``; the disclosure is produced here rather than written by a model, so
   it cannot be phrased away.
2. Expose the deterministic section → persona routing, so bylines stay stable
   per beat.
3. Check a persona's output against the shared ``forbidden_claims`` — chiefly
   claims of lived experience, which a correspondent named after a lighthouse
   obviously cannot make.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final, Iterator, Mapping, Sequence

import yaml

logger = logging.getLogger(__name__)

DEFAULT_PERSONAS_PATH: Final[Path] = Path(__file__).resolve().parent / "personas.yaml"

#: The disclosure token that must appear in every byline. The validator's
#: ``byline_discloses_ai`` check looks for exactly this substring.
AI_DISCLOSURE: Final[str] = "AI correspondent"

#: Separator between the correspondent's name and its disclosure.
BYLINE_SEPARATOR: Final[str] = " · "


class PersonaError(Exception):
    """Base class for persona configuration and compliance failures."""


class InvalidPersonaConfigError(PersonaError):
    """``personas.yaml`` is malformed."""


class UnknownPersonaError(PersonaError):
    """A persona id or section was requested that the registry does not define."""


@dataclass(frozen=True, slots=True)
class ForbiddenClaim:
    """A claim a correspondent may never make, and how to detect it in prose."""

    code: str
    description: str
    pattern: re.Pattern[str]

    def find(self, text: str) -> list[str]:
        """Return the matched spans, verbatim, for use in a rejection detail."""
        return [match.group(0).strip() for match in self.pattern.finditer(text)]


@dataclass(frozen=True, slots=True)
class Persona:
    """One AI correspondent."""

    id: str
    name: str
    beat: str
    sections: tuple[str, ...]
    landmark: str | None = None
    voice: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def byline(self) -> str:
        """``Nida · AI correspondent, Economy & Labour``."""
        return f"{self.name}{BYLINE_SEPARATOR}{AI_DISCLOSURE}, {self.beat}"

    def as_article_persona(self) -> dict[str, str]:
        """The persona block as it appears in an article document."""
        return {"id": self.id, "name": self.name, "beat": self.beat, "byline": self.byline}


# ── Lived-experience detection ──────────────────────────────────────────
#
# The hard part is precision, not recall. "Kolka visited Ventspils" must be
# rejected; "the cargo travelled through Ventspils" must not be, because a
# blanket verb list would flag ordinary maritime prose and train everyone to
# ignore the check. So the patterns require a *newsroom subject* — a first
# person pronoun, "our correspondent", or a persona's own name — within a short
# window before the verb.

#: Subjects that make a following verb a claim about us rather than about the world.
_NEWSROOM_SUBJECT: Final[str] = (
    r"(?:I|we|our\s+(?:reporter|correspondent|team|journalist)s?|"
    r"this\s+(?:reporter|correspondent|portal)|portaBaltica)"
)

#: Verbs that assert lived experience when a newsroom subject performs them.
_EXPERIENCE_VERBS: Final[str] = (
    r"(?:visit|interview|witness|phone|call|attend|travel|tour|"
    r"see|saw|meet|met|saw|watch|observe|hear|ask|speak|spoke|talk|"
    r"stand|walk|drive|fly|sail|photograph|film)"
)

#: Verb tails, longest first so the engine prefers the fuller inflection.
#: ``d`` is present because "phoned" is "phone" + "d" — an early version of this
#: pattern missed it, and the negative fixture for phoning caught the gap.
_VERB_TAIL: Final[str] = r"(?:led|ling|es|ed|ing|s|d|)"

#: Between subject and verb we allow only a few adverbs/auxiliaries, not
#: arbitrary text — otherwise "we publish data that the port visited by ..."
#: would match across a clause boundary.
_SUBJECT_VERB_GAP: Final[str] = (
    r"(?:\s+(?:have|has|had|was|were|am|is|are|also|recently|later|then|"
    r"personally|briefly|just|already|subsequently|once))*\s+"
)

_LIVED_EXPERIENCE_PATTERNS: Final[tuple[tuple[str, str, str], ...]] = (
    (
        "first_person_experience",
        'first-person lived experience, e.g. "I visited", "we spoke to"',
        rf"\b{_NEWSROOM_SUBJECT}{_SUBJECT_VERB_GAP}{_EXPERIENCE_VERBS}{_VERB_TAIL}\b",
    ),
    (
        "claimed_interview",
        "claiming an interview, conversation or on-the-record exchange",
        r"\b(?:in\s+an\s+interview\s+with\s+(?:us|me|this\s+\w+|portaBaltica)|"
        r"told\s+(?:us|me|this\s+(?:reporter|correspondent|portal)|portaBaltica)|"
        r"(?:speaking|spoke|talking|talked)\s+to\s+(?:us|me|this\s+\w+|portaBaltica)|"
        r"(?:we|I)\s+(?:reached|contacted|approached|questioned|doorstepped)\b|"
        r"when\s+(?:we|I)\s+asked\b|"
        r"(?:our|my)\s+(?:interview|conversation|visit|trip|call)\s+with)\b",
    ),
    (
        "claimed_presence",
        "claiming to have been physically present at a place or event",
        r"\b(?:(?:we|I)\s+were\s+(?:there|present|on\s+(?:site|board|the\s+ground))|"
        r"(?:we|I)\s+was\s+(?:there|present)|"
        r"(?:from|at)\s+the\s+(?:quayside|dockside|scene)\s*,\s*(?:we|I)\b|"
        r"(?:our|my)\s+(?:visit|trip|time)\s+(?:to|at|in|aboard)\b|"
        r"reporting\s+from\s+the\s+(?:scene|ground|quayside|port))\b",
    ),
    (
        "claimed_sources",
        'claiming unnamed human sources, e.g. "sources told us"',
        r"\b(?:sources?\s+(?:told|said\s+to|close\s+to\s+the\s+\w+\s+told)\s+"
        r"(?:us|me|this\s+\w+|portaBaltica)|"
        r"(?:we|I)\s+(?:understand|are\s+told|am\s+told)\s+(?:that\b|from\b))",
    ),
)

LIVED_EXPERIENCE_CLAIMS: Final[tuple[ForbiddenClaim, ...]] = tuple(
    ForbiddenClaim(code=code, description=description, pattern=re.compile(pattern, re.IGNORECASE))
    for code, description, pattern in _LIVED_EXPERIENCE_PATTERNS
)


def _persona_name_claim(names: Sequence[str]) -> ForbiddenClaim:
    """A correspondent naming *itself* as the actor of a physical verb.

    ``Kolka visited the port`` is the same lie as ``I visited the port``, just
    in the third person, so the persona names are compiled into the subject
    position too.
    """
    alternation = "|".join(re.escape(name) for name in names) or r"(?!x)x"
    pattern = rf"\b(?:{alternation}){_SUBJECT_VERB_GAP}{_EXPERIENCE_VERBS}{_VERB_TAIL}\b"
    return ForbiddenClaim(
        code="correspondent_lived_experience",
        description="a correspondent named as the actor of a physical or interview verb",
        pattern=re.compile(pattern, re.IGNORECASE),
    )


class PersonaRegistry:
    """In-memory view of ``personas.yaml``."""

    def __init__(
        self,
        personas: Mapping[str, Persona],
        *,
        version: int,
        routing: Mapping[str, str],
        shared: Mapping[str, Any],
    ) -> None:
        self._personas: Mapping[str, Persona] = MappingProxyType(dict(personas))
        self._routing: Mapping[str, str] = MappingProxyType(dict(routing))
        self._shared: Mapping[str, Any] = MappingProxyType(dict(shared))
        self._version = version
        self._claims: tuple[ForbiddenClaim, ...] = (
            *LIVED_EXPERIENCE_CLAIMS,
            _persona_name_claim([persona.name for persona in personas.values()]),
        )

    # ── construction ────────────────────────────────────────────────────

    @classmethod
    def load(cls, path: Path | str | None = None) -> "PersonaRegistry":
        resolved = Path(path) if path is not None else DEFAULT_PERSONAS_PATH
        try:
            text = resolved.read_text(encoding="utf-8")
        except OSError as exc:
            raise InvalidPersonaConfigError(f"cannot read personas at {resolved}: {exc}") from exc

        try:
            document = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise InvalidPersonaConfigError(f"{resolved} is not valid YAML: {exc}") from exc

        if not isinstance(document, Mapping):
            raise InvalidPersonaConfigError(f"{resolved} must contain a YAML mapping")

        logger.debug("loaded %s", resolved)
        return cls.from_mapping(document)

    @classmethod
    def from_mapping(cls, document: Mapping[str, Any]) -> "PersonaRegistry":
        version = document.get("version")
        if not isinstance(version, int):
            raise InvalidPersonaConfigError("personas config must declare an integer `version`")

        raw_personas = document.get("personas")
        if not isinstance(raw_personas, list) or not raw_personas:
            raise InvalidPersonaConfigError("personas config needs a non-empty `personas` list")

        personas: dict[str, Persona] = {}
        for index, entry in enumerate(raw_personas):
            persona = _build_persona(entry, index=index)
            if persona.id in personas:
                raise InvalidPersonaConfigError(f"duplicate persona id {persona.id!r}")
            personas[persona.id] = persona

        raw_routing = document.get("routing")
        if not isinstance(raw_routing, Mapping) or not raw_routing:
            raise InvalidPersonaConfigError("personas config needs a non-empty `routing` map")

        routing: dict[str, str] = {}
        for section, persona_id in raw_routing.items():
            if not isinstance(section, str) or not isinstance(persona_id, str):
                raise InvalidPersonaConfigError("routing keys and values must be strings")
            if persona_id not in personas:
                raise InvalidPersonaConfigError(
                    f"routing sends section {section!r} to unknown persona {persona_id!r}"
                )
            routing[section] = persona_id

        shared = document.get("shared") or {}
        if not isinstance(shared, Mapping):
            raise InvalidPersonaConfigError("`shared` must be a mapping when present")

        declared_suffix = shared.get("byline_suffix")
        if declared_suffix is not None and declared_suffix != AI_DISCLOSURE:
            raise InvalidPersonaConfigError(
                f"shared.byline_suffix must be {AI_DISCLOSURE!r}, got {declared_suffix!r}; "
                "the disclosure token is what the validator looks for"
            )

        return cls(personas, version=version, routing=routing, shared=shared)

    # ── lookup ──────────────────────────────────────────────────────────

    @property
    def version(self) -> int:
        return self._version

    def __len__(self) -> int:
        return len(self._personas)

    def __iter__(self) -> Iterator[Persona]:
        return iter(self._personas.values())

    def __contains__(self, persona_id: object) -> bool:
        return persona_id in self._personas

    def ids(self) -> tuple[str, ...]:
        return tuple(self._personas)

    def get(self, persona_id: str) -> Persona:
        try:
            return self._personas[persona_id]
        except KeyError:
            raise UnknownPersonaError(f"no persona {persona_id!r}") from None

    @property
    def routing(self) -> Mapping[str, str]:
        """Section → persona id. Deterministic, so bylines stay stable per beat."""
        return self._routing

    @property
    def routed_sections(self) -> tuple[str, ...]:
        return tuple(self._routing)

    @property
    def accountable_editor(self) -> str | None:
        editor = self._shared.get("accountable_editor")
        return str(editor) if editor is not None else None

    @property
    def forbidden_claims(self) -> tuple[str, ...]:
        """The declared prose rules, as written in ``personas.yaml``."""
        declared = self._shared.get("forbidden_claims") or []
        return tuple(str(claim) for claim in declared)

    @property
    def required_behaviour(self) -> tuple[str, ...]:
        declared = self._shared.get("required_behaviour") or []
        return tuple(str(item) for item in declared)

    def persona_for_section(self, section: str) -> Persona:
        """Route a section to its correspondent."""
        try:
            persona_id = self._routing[section]
        except KeyError:
            raise UnknownPersonaError(
                f"section {section!r} has no routed correspondent; "
                "every dashboard section must route to a persona"
            ) from None
        return self._personas[persona_id]

    def byline_for(self, persona_id: str) -> str:
        """Build the byline. Never accept one supplied by a model."""
        return self.get(persona_id).byline

    def byline_for_section(self, section: str) -> str:
        return self.persona_for_section(section).byline

    # ── compliance ──────────────────────────────────────────────────────

    def byline_discloses_ai(self, byline: str | None) -> bool:
        """True only when the byline carries the literal disclosure token."""
        return isinstance(byline, str) and AI_DISCLOSURE in byline

    def find_forbidden_claims(self, text: str) -> list[tuple[str, str]]:
        """Return ``(claim_code, matched_text)`` for every violation found.

        Pure and side-effect free; the validator turns the result into a verdict.
        """
        if not text:
            return []
        violations: list[tuple[str, str]] = []
        for claim in self._claims:
            for span in claim.find(text):
                violations.append((claim.code, span))
        return violations

    def validate_output(
        self,
        persona_id: str,
        text: str,
        *,
        byline: str | None = None,
    ) -> tuple[str, ...]:
        """Validate one correspondent's output. Returns human-readable problems.

        An empty tuple means compliant. Unknown personas raise, because an
        article attributed to a correspondent we do not have is not a style
        problem — it is a fabricated byline.
        """
        persona = self.get(persona_id)
        problems: list[str] = []

        expected_byline = persona.byline
        if byline is not None:
            if not self.byline_discloses_ai(byline):
                problems.append(f"byline {byline!r} does not contain {AI_DISCLOSURE!r}")
            elif byline != expected_byline:
                problems.append(f"byline {byline!r} does not match canonical {expected_byline!r}")

        for code, span in self.find_forbidden_claims(text):
            problems.append(f"forbidden claim ({code}): {span!r}")

        return tuple(problems)


def _build_persona(entry: Any, *, index: int) -> Persona:
    if not isinstance(entry, Mapping):
        raise InvalidPersonaConfigError(f"persona #{index} is not a mapping")

    persona_id = entry.get("id")
    if not isinstance(persona_id, str) or not persona_id.strip():
        raise InvalidPersonaConfigError(f"persona #{index} has no usable `id`")

    for required in ("name", "beat"):
        value = entry.get(required)
        if not isinstance(value, str) or not value.strip():
            raise InvalidPersonaConfigError(f"persona {persona_id!r}: `{required}` is required")

    raw_sections = entry.get("sections") or []
    if not isinstance(raw_sections, list) or not raw_sections:
        raise InvalidPersonaConfigError(f"persona {persona_id!r}: `sections` must be a non-empty list")

    voice = entry.get("voice") or {}
    if not isinstance(voice, Mapping):
        raise InvalidPersonaConfigError(f"persona {persona_id!r}: `voice` must be a mapping")

    return Persona(
        id=persona_id,
        name=str(entry["name"]),
        beat=str(entry["beat"]),
        sections=tuple(str(section) for section in raw_sections),
        landmark=str(entry["landmark"]) if entry.get("landmark") is not None else None,
        voice=MappingProxyType(dict(voice)),
    )


__all__ = [
    "AI_DISCLOSURE",
    "BYLINE_SEPARATOR",
    "DEFAULT_PERSONAS_PATH",
    "ForbiddenClaim",
    "InvalidPersonaConfigError",
    "LIVED_EXPERIENCE_CLAIMS",
    "Persona",
    "PersonaError",
    "PersonaRegistry",
    "UnknownPersonaError",
]
