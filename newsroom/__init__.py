"""portaBaltica newsroom — content safety and provenance core.

This package is the enforcement layer for the editorial and legal rules set out
in ``newsroom/README.md``. It has no network calls and no Azure dependencies, so
it runs standalone in CI and is unit-testable end to end.

The public modules:

* :mod:`newsroom.source_registry` — loads ``sources.yaml``; the authoritative
  answer to "what are we allowed to do with this content?"
* :mod:`newsroom.persona_rules` — loads ``personas.yaml``; bylines and routing.
* :mod:`newsroom.fencing` — nonce-delimited fencing for untrusted feed content.
* :mod:`newsroom.validator` — the publication gate. Fails closed.
* :mod:`newsroom.pipeline.editor` — the tier B/C AI editor and escalation flow.
"""

from __future__ import annotations

__all__ = [
    "approval",
    "fencing",
    "numeric_scan",
    "persona_rules",
    "source_registry",
    "validator",
]

__version__ = "0.1.0"
