"""Adapter onto the safety workstream's modules.

Everything in :mod:`newsroom.pipeline` reaches the validator, the source
registry, the persona rules and the fencing helpers through this module, so
that the pipeline never reimplements a check the safety workstream owns.

Two things this file exists to absorb:

1. **Import layout.** The safety modules are ``newsroom.validator`` etc. from
   the repository root (tests, local runs), but top-level modules inside the
   deployed Function App where ``newsroom/`` *is* the app root.

2. **Shape.** The safety modules expose class-based registries loaded from
   YAML (``SourceRegistry``, ``PersonaRegistry``) and a ``validate_article``
   that takes both. The pipeline wants a few bound callables. Binding happens
   once here rather than being threaded through every call site.

The registries are loaded lazily and cached: reading and validating both YAML
files on every article would be wasteful, and loading them at import time would
make an unrelated import failure look like a config error.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Mapping

try:  # repository-root layout
    from newsroom import fencing, persona_rules, source_registry, validator
except ImportError:  # pragma: no cover - deployed layout
    import fencing  # type: ignore
    import persona_rules  # type: ignore
    import source_registry  # type: ignore
    import validator  # type: ignore

# ── Fencing ──────────────────────────────────────────────────────────────
# Untrusted text is fenced with a per-call nonce, and the instruction that
# tells the model to treat it as data is generated FROM that fence so it names
# the actual nonce. A generic instruction cannot say which delimiter is
# authoritative, which is exactly the gap an injected "end of fence" exploits.
fence = fencing.fence
FencedContent = fencing.FencedContent
instruction_for = fencing.instruction_for
fence_feed_item = fencing.fence_feed_item
build_untrusted_prompt = fencing.build_untrusted_prompt

Source = source_registry.Source
UnregisteredSourceError = source_registry.UnregisteredSourceError
Persona = persona_rules.Persona
UnknownPersonaError = persona_rules.UnknownPersonaError
Verdict = validator.ValidatorVerdict


class RewriteNotPermittedError(Exception):
    """Raised when the pipeline tries to generate prose for a restricted source.

    The registry answers ``rewrite_allowed`` as a fact; this is the pipeline
    refusing to act against one. It is raised at the point of generation rather
    than left to the validator so a tier C rewrite is never even produced — the
    validator is the backstop, not the only guard.
    """


@lru_cache(maxsize=1)
def registry() -> "source_registry.SourceRegistry":
    """The source registry, loaded once from ``newsroom/sources.yaml``."""
    return source_registry.SourceRegistry.load()


@lru_cache(maxsize=1)
def personas() -> "persona_rules.PersonaRegistry":
    """The correspondent registry, loaded once from ``newsroom/personas.yaml``."""
    return persona_rules.PersonaRegistry.load()


def persona_for_section(section: str) -> Persona:
    """Route a section to its correspondent. Deterministic, so bylines are stable."""
    return personas().persona_for_section(section)


def assert_rewrite_allowed(source_id: str) -> None:
    """Refuse to generate prose for a source whose licence forbids it.

    The registry answers ``rewrite_allowed`` as a fact. This turns that fact
    into a refusal *before* the model is called, so a tier C rewrite is never
    produced in the first place — burning tokens on text we would then have to
    throw away, and creating a window in which it exists on disk.

    The validator still checks the same thing afterwards. Two guards, because
    this one can be bypassed by a new call site and that one cannot.
    """
    if not registry().rewrite_allowed(source_id):
        raise RewriteNotPermittedError(
            f"source {source_id!r} has rewrite_allowed=false "
            f"(tier {registry().tier(source_id)}); generated prose is not permitted. "
            "Syndicate it as a link-out card instead."
        )


def render_byline(persona: Persona) -> str:
    """The disclosed byline. Always contains 'AI correspondent'."""
    return persona.byline


def find_lived_experience_claims(text: str) -> list[tuple[str, str]]:
    """Forbidden first-person / eyewitness claims found in generated prose."""
    return personas().find_forbidden_claims(text)


def voice_card(persona: Persona) -> str:
    """Render a persona's identity and method as prompt text.

    Only voice and expertise are rendered. Nothing here can influence a
    number: the model receives figures separately and the validator checks
    them regardless of which correspondent holds the byline.

    ``expertise`` and ``trained_on`` describe what this correspondent is
    oriented to look for. They are deliberately phrased as competence rather
    than biography — the correspondent has not held a job or been anywhere,
    and telling the model otherwise is how a lived-experience claim ends up in
    the prose and gets the article rejected.
    """
    voice: Mapping[str, Any] = persona.voice or {}

    lines = [f"You are {persona.name}, covering {persona.beat}."]

    if persona.expertise:
        lines.append("Your areas of expertise:")
        lines.extend(f"  - {item}" for item in persona.expertise)

    if persona.trained_on:
        lines.append(f"How you read this material: {persona.trained_on.strip()}")

    for key, label in (
        ("summary", "Voice"),
        ("notices_first", "You notice first"),
        ("sentence_rhythm", "Rhythm"),
        ("characteristic_move", "Characteristic move"),
        ("closing_move", "How you close"),
    ):
        value = voice.get(key)
        if value:
            lines.append(f"{label}: {str(value).strip()}")

    avoid = voice.get("avoid") or []
    if avoid:
        lines.append("Avoid: " + "; ".join(str(a) for a in avoid))

    lines.append(
        "You are an AI system. You have never held a job, attended an "
        "institution, visited anywhere or spoken to anyone. Write from the "
        "supplied data only, and never imply otherwise."
    )
    return "\n".join(lines)


def voice_reminder(persona: Persona) -> str:
    """The voice card again, as instructions, at the end of the system prompt.

    The voice was never missing. ``voice_card`` renders every field
    ``personas.yaml`` defines and has done since the personas landed — and five
    correspondents still wrote indistinguishable prose.

    The reason is placement. The card is a dozen lines at the very top of a
    system prompt that then spends 150 lines on rules which each name a
    consequence: this is checked, that is rejected, the article dies for the
    block that omitted it. Against that, "Patient and long-horizon" reads as
    decoration. The model is not ignoring the voice; it is correctly inferring
    which instructions carry weight.

    So the voice is repeated where the weighted instructions are, in their
    register, at the end where recency works for it rather than against it.
    Nothing new is asserted — every line here is already in the card above —
    which is deliberate: this is an emphasis change, not a second source of
    truth that could drift from ``personas.yaml``.

    Missing fields are skipped rather than rendered empty. A persona with no
    ``closing_move`` is a thin persona, not a broken pipeline, and a test that
    builds a prompt from a partial persona must not crash.
    """
    voice: Mapping[str, Any] = persona.voice or {}

    directions: list[str] = []
    for key, label in (
        ("sentence_rhythm", "RHYTHM"),
        ("characteristic_move", "CHARACTERISTIC MOVE (use it in the body)"),
        ("closing_move", "HOW YOU CLOSE (use it in the final paragraph)"),
    ):
        value = voice.get(key)
        if value:
            directions.append(f"- {label}: {str(value).strip()}")

    avoid = voice.get("avoid") or []
    if avoid:
        directions.append("- AVOID: " + "; ".join(str(a) for a in avoid))

    if not directions:
        return ""

    return "\n".join(
        [
            "VOICE REMINDER — re-read the voice description at the top of this prompt.",
            f"You are {persona.name}, not a generic reporter. Your specific instructions",
            "are:",
            *directions,
            "These are not suggestions. An article that could have been written by any",
            "other correspondent on the roster has failed its voice brief.",
        ]
    )


def validate(
    article: Mapping[str, Any],
    *,
    signal: Mapping[str, Any] | None = None,
    raw_feed_item: Mapping[str, Any] | None = None,
) -> Verdict:
    """Run the full validator with the registries already bound."""
    return validator.validate_article(
        article,
        registry=registry(),
        personas=personas(),
        signal=signal,
        raw_feed_item=raw_feed_item,
    )


__all__ = [
    "FencedContent",
    "Persona",
    "RewriteNotPermittedError",
    "Source",
    "UnknownPersonaError",
    "UnregisteredSourceError",
    "Verdict",
    "assert_rewrite_allowed",
    "build_untrusted_prompt",
    "fence",
    "fence_feed_item",
    "find_lived_experience_claims",
    "instruction_for",
    "persona_for_section",
    "personas",
    "registry",
    "render_byline",
    "validate",
    "voice_card",
    "voice_reminder",
]
