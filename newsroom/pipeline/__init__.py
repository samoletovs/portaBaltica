"""The four-stage newsroom pipeline.

``newsroom.pipeline`` holds the ingestion, detection, ranking and generation
code owned by the *pipeline* workstream. The legal/safety gate lives one level
up in ``newsroom/validator.py``, ``persona_rules.py``, ``source_registry.py``
and ``fencing.py`` and is reached through :mod:`newsroom.pipeline.safety`.
"""

__all__: list[str] = []
