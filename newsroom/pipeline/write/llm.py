"""The model client.

``gpt-6-luna`` on the shared ``foundrylab-aiservices`` account in
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
_SUPPORTED_MODELS = {"gpt-6-luna", "gpt-4.1", "gpt-4o-mini"}


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
        if self.deployment not in _SUPPORTED_MODELS:
            raise ValueError("Writer deployment must be a supported, same-named actual model")
        self.model_name = self.deployment

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        if type(max_tokens) is not int or not 1 <= max_tokens <= 8192:
            raise ValueError("Writer completion ceiling must be between 1 and 8192 tokens")
        options = (
            {"max_completion_tokens": max_tokens, "reasoning_effort": "none"}
            if self.deployment == "gpt-6-luna"
            else {"max_tokens": max_tokens, "temperature": 0.25}
        )
        response = _client().chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            **options,
        )
        actual_model = str(response.model)
        if actual_model != self.deployment and not actual_model.startswith(self.deployment + "-"):
            raise ValueError("Writer response model does not match the configured deployment")
        self.model_name = actual_model
        usage = getattr(response, "usage", None)
        if usage is not None:
            log.info(
                "generation used %s prompt + %s completion tokens",
                usage.prompt_tokens,
                usage.completion_tokens,
            )
        if not response.choices:
            raise ValueError("Writer returned no completion")
        choice = response.choices[0]
        if choice.finish_reason != "stop" or choice.message.refusal:
            raise ValueError("Writer returned incomplete or refused output")
        content = choice.message.content
        if not content or not content.strip():
            raise ValueError("Writer returned empty output")
        payload = json.loads(content)
        if not isinstance(payload, dict):
            raise TypeError("Writer output must be a JSON object")
        return payload


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
