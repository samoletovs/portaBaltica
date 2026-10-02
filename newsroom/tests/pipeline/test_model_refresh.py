"""The writer transport must not admit truncated JSON or buy a premium tier."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from newsroom.pipeline.write import llm


def reply(
    *, model: str = "gpt-6-luna-2026-09-22", content: str | None = '{"headline":"Synthetic"}',
    finish: str = "stop", refusal: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(model=model, usage=None, choices=[SimpleNamespace(
        finish_reason=finish, message=SimpleNamespace(content=content, refusal=refusal),
    )])


@pytest.mark.parametrize(("model", "token_key", "extra_key", "extra_value"), [
    ("gpt-6-luna", "max_completion_tokens", "reasoning_effort", "none"),
    ("gpt-4.1", "max_tokens", "temperature", 0.25),
    ("gpt-4o-mini", "max_tokens", "temperature", 0.25),
])
def test_writer_sends_the_exact_existing_ceiling_with_compatible_parameters(
    monkeypatch: pytest.MonkeyPatch, model: str, token_key: str,
    extra_key: str, extra_value: str | float,
) -> None:
    client = Mock()
    client.chat.completions.create.return_value = reply(model=model)
    monkeypatch.setattr(llm, "_client", lambda: client)
    writer = llm.AzureOpenAIWriter(model)
    assert writer.complete_json(system="JSON only", user="Synthetic", max_tokens=400) == {
        "headline": "Synthetic",
    }
    options = client.chat.completions.create.call_args.kwargs
    assert options["model"] == model
    assert options[token_key] == 400
    assert options[extra_key] == extra_value
    assert ("max_tokens" in options) != ("max_completion_tokens" in options)
    assert ("temperature" in options) != ("reasoning_effort" in options)
    assert options["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize("response", [
    reply(finish="length"), reply(finish="content_filter"), reply(refusal="Refused"),
    reply(content=None), reply(content="[]"), reply(content="{broken"),
    reply(model="gpt-4o-mini"),
    SimpleNamespace(model="gpt-6-luna", usage=None, choices=[]),
])
def test_unusable_or_wrong_model_output_never_reaches_the_publishing_pipeline(
    monkeypatch: pytest.MonkeyPatch, response: SimpleNamespace,
) -> None:
    client = Mock()
    client.chat.completions.create.return_value = response
    monkeypatch.setattr(llm, "_client", lambda: client)
    with pytest.raises((ValueError, TypeError)):
        llm.AzureOpenAIWriter("gpt-6-luna").complete_json(
            system="JSON only", user="Synthetic", max_tokens=2000,
        )
    client.chat.completions.create.assert_called_once()


@pytest.mark.parametrize("deployment", ["gpt-6-sol", "misleading-alias"])
def test_no_implicit_premium_switch_or_unknown_alias(deployment: str) -> None:
    with pytest.raises(ValueError, match="same-named actual model"):
        llm.AzureOpenAIWriter(deployment)


@pytest.mark.parametrize("cap", [0, -1, 8193, True])
def test_bad_ceiling_fails_before_contacting_azure(monkeypatch: pytest.MonkeyPatch, cap: int) -> None:
    client = Mock()
    monkeypatch.setattr(llm, "_client", client)
    with pytest.raises(ValueError, match="ceiling"):
        llm.AzureOpenAIWriter("gpt-6-luna").complete_json(
            system="JSON", user="Synthetic", max_tokens=cap,
        )
    client.assert_not_called()
