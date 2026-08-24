"""Stage 4 — write.

The only stage that involves a language model, and the most tightly constrained.
"""

from __future__ import annotations

from newsroom.pipeline.write.generator import GenerationResult, generate_article
from newsroom.pipeline.write.llm import AzureOpenAIWriter, LlmWriter, StubWriter

__all__ = [
    "AzureOpenAIWriter",
    "GenerationResult",
    "LlmWriter",
    "StubWriter",
    "generate_article",
]
