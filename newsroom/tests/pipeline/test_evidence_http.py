"""Host binding and handler checks; deployed authentication is verified separately."""

from contextlib import contextmanager
import json
from typing import Iterator
from unittest.mock import AsyncMock, Mock

import azure.functions as func
import pytest

from newsroom import function_app
from newsroom.pipeline.evidence import operations, production


def request() -> func.HttpRequest:
    return func.HttpRequest(method="POST", url="https://example.invalid/api/evidence/collect", body=b"")


def test_archive_only_route_requires_function_auth_and_post() -> None:
    target = next(
        item for item in function_app.app.get_functions()
        if item.get_function_name() == "newsroom_evidence_collect"
    )
    bindings = json.loads(target.get_function_json())["bindings"]
    trigger = next(binding for binding in bindings if binding["type"] == "httpTrigger")
    assert trigger["route"] == "evidence/collect"
    assert trigger["authLevel"].lower() == "function"
    assert [method.lower() for method in trigger["methods"]] == ["post"]


async def test_disabled_archive_operation_never_opens_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEWSROOM_EVIDENCE_ENABLED", "false")
    opener = Mock(side_effect=AssertionError("disabled capture opened storage"))
    monkeypatch.setattr(production, "open_production", opener)

    response = await function_app.newsroom_evidence_collect(request())

    assert response.status_code == 409
    opener.assert_not_called()


@pytest.mark.parametrize(("status", "expected"), [("unchanged", 200), ("failed", 503)])
async def test_handler_reports_the_archive_only_result(
    monkeypatch: pytest.MonkeyPatch, status: str, expected: int,
) -> None:
    service = object()

    @contextmanager
    def opened() -> Iterator[object]:
        yield service

    monkeypatch.setenv("NEWSROOM_EVIDENCE_ENABLED", "true")
    monkeypatch.setattr(production, "open_production", opened)
    collect = AsyncMock(return_value={"status": status})
    monkeypatch.setattr(operations, "collect_only", collect)
    monkeypatch.setattr(function_app, "run_once", AsyncMock(side_effect=AssertionError("paid edition invoked")))

    response = await function_app.newsroom_evidence_collect(request())

    assert response.status_code == expected
    collect.assert_awaited_once_with(service)


async def test_expected_storage_error_is_sanitized_in_http_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEWSROOM_EVIDENCE_ENABLED", "true")
    monkeypatch.setattr(production, "open_production", Mock(side_effect=OSError("private diagnostic details")))

    response = await function_app.newsroom_evidence_collect(request())

    assert response.status_code == 503
    assert b"private diagnostic details" not in response.get_body()
    assert production.PUBLIC_ERROR.encode() in response.get_body()
