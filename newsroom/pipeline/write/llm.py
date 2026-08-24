"""The model client.

``gpt-4o-mini`` on the shared ``foundrylab-aiservices`` account in
``swedencentral``, reached with :class:`~azure.identity.DefaultAzureCredential`.
There is no API key anywhere in this project and no app setting that could hold
one — managed identity in the Function App, developer identity locally.

:class:`LlmWriter` is a protocol rather than a concrete class so the test suite
can substitute :class:`StubWriter` and never touch Azure.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, Protocol, Sequence

from newsroom.pipeline import config

log = logging.getLogger(__name__)


class LlmWriter(Protocol):
    """Anything that can turn a pair of prompts into a JSON object."""

    model_name: str

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        ...


@lru_cache(maxsize=1)
def _client() -> Any:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
    from openai import AzureOpenAI

    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    )
    return AzureOpenAI(
        azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
        api_version=config.AZURE_OPENAI_API_VERSION,
        azure_ad_token_provider=token_provider,
        timeout=90.0,
        # One transport retry. Regeneration after a *validator* rejection is a
        # separate concern handled in generator.py, which re-prompts once with
        # the validator's own complaint. This setting is only about the network.
        max_retries=1,
    )


class AzureOpenAIWriter:
    """Production writer."""

    def __init__(self, deployment: str | None = None) -> None:
        self.deployment = deployment or config.AZURE_OPENAI_DEPLOYMENT
        self.model_name = self.deployment

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        response = _client().chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.25,
            max_tokens=max_tokens,
        )
        self.model_name = f"{response.model}"
        usage = getattr(response, "usage", None)
        if usage is not None:
            log.info(
                "generation used %s prompt + %s completion tokens",
                usage.prompt_tokens,
                usage.completion_tokens,
            )
        content = response.choices[0].message.content or "{}"
        return json.loads(content)


class StubWriter:
    """Test double. Returns a canned payload and records what it was asked.

    Accepts a sequence of payloads to model a writer that responds differently
    to a revision request than to the original brief. The last payload repeats
    once the sequence is exhausted, so a single-payload stub behaves exactly as
    before and a two-payload stub exercises the revision path.
    """

    def __init__(
        self,
        payload: dict[str, Any] | Sequence[dict[str, Any]],
        model_name: str = "stub-model",
    ) -> None:
        payloads = [payload] if isinstance(payload, dict) else list(payload)
        if not payloads:
            raise ValueError("StubWriter needs at least one payload")
        self.payloads = payloads
        self.payload = payloads[0]
        self.model_name = model_name
        self.calls: list[dict[str, Any]] = []

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        self.calls.append({"system": system, "user": user, "max_tokens": max_tokens})
        index = min(len(self.calls) - 1, len(self.payloads) - 1)
        return self.payloads[index]
