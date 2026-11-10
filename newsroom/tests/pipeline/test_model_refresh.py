"""The writer transport must not admit truncated JSON or buy a premium tier."""

import re
from pathlib import Path
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


def test_writer_sends_the_exact_existing_ceiling_with_compatible_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = Mock()
    client.chat.completions.create.return_value = reply()
    monkeypatch.setattr(llm, "_client", lambda: client)
    writer = llm.AzureOpenAIWriter("gpt-6-luna")
    assert writer.complete_json(system="JSON only", user="Synthetic", max_tokens=400) == {
        "headline": "Synthetic",
    }
    client.chat.completions.create.assert_called_once_with(
        model="gpt-6-luna",
        messages=[
            {"role": "system", "content": "JSON only"},
            {"role": "user", "content": "Synthetic"},
        ],
        response_format={"type": "json_object"},
        max_completion_tokens=400,
        temperature=0.25,
        reasoning_effort="none",
    )
    assert writer.model_name == "gpt-6-luna-2026-09-22"


def test_retiring_writer_deployments_fail_before_contacting_azure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = Mock()
    monkeypatch.setattr(llm, "_client", client)
    for deployment in (
        "gpt-4.1", "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano",
        "o3", "o3-mini", "o4-mini",
    ):
        with pytest.raises(ValueError) as error:
            llm.AzureOpenAIWriter(deployment)
        assert str(error.value) == "Writer deployment must be a supported, same-named actual model"
    client.assert_not_called()


def test_infrastructure_admits_only_the_live_luna_deployment() -> None:
    template = (Path(__file__).resolve().parents[3] / "infrastructure" / "main.bicep").read_text(
        encoding="utf-8",
    )
    code = re.sub(r"//[^\n]*", "", template)
    match = re.search(
        r"@allowed\(\[([^\]]*)\]\)\s*param openAiDeployment string = '([^']+)'",
        code,
    )
    assert match is not None
    assert re.findall(r"'([^']+)'", match[1]) == ["gpt-6-luna"]
    assert match[2] == "gpt-6-luna"


def test_identity_probe_sends_the_luna_request_with_its_existing_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from infrastructure.verify import function_app as probe

    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://synthetic.invalid/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-6-luna")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    monkeypatch.setattr(probe, "_credential", Mock())
    monkeypatch.setattr(probe, "get_bearer_token_provider", Mock())
    client = Mock()
    response = reply(content="Estonia, Latvia and Lithuania.")
    response.usage = SimpleNamespace(prompt_tokens=20, completion_tokens=8)
    client.chat.completions.create.return_value = response
    factory = Mock(return_value=client)
    monkeypatch.setattr(probe, "AzureOpenAI", factory)

    result = probe._check_foundry()

    client.chat.completions.create.assert_called_once_with(
        model="gpt-6-luna",
        messages=[
            {"role": "system", "content": "You are a deployment smoke test. Answer in one short sentence."},
            {"role": "user", "content": (
                "Name the three Baltic states and confirm you were reached "
                "using a managed identity rather than an API key."
            )},
        ],
        max_completion_tokens=80,
        temperature=0,
        reasoning_effort="none",
    )
    assert factory.call_args.kwargs["api_version"] == "2024-10-21"
    assert factory.call_args.kwargs["azure_endpoint"] == "https://synthetic.invalid/"
    assert result["status"] == "PASS"
    assert result["deployment"] == "gpt-6-luna"
    assert result["usage"] == {"prompt_tokens": 20, "completion_tokens": 8}


def test_identity_probe_refuses_retiring_deployments_before_authentication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from infrastructure.verify import function_app as probe

    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://synthetic.invalid/")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    credential = Mock(side_effect=AssertionError("Must not authenticate"))
    monkeypatch.setattr(probe, "_credential", credential)
    for deployment in ("gpt-4.1", "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"):
        monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", deployment)
        with pytest.raises(ValueError) as error:
            probe._check_foundry()
        assert str(error.value) == "Identity check deployment must be gpt-6-luna"
    credential.assert_not_called()


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
