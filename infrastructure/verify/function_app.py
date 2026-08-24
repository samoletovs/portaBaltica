"""Managed-identity smoke test for the portaBaltica newsroom Function App.

Proves the two grants made in infrastructure/main.bicep actually work from
inside the deployed app:

  * Cognitive Services OpenAI User on foundrylab-aiservices (cross-RG)
  * Storage Blob Data Contributor on the app's own storage account

Every call authenticates with DefaultAzureCredential, which resolves to the
Function App's system-assigned managed identity. There is no key or connection
string in this file, and there must never be one: foundrylab-aiservices has
disableLocalAuth=true and the storage account has allowSharedKeyAccess=false,
so a key would not work even if someone added it.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import azure.functions as func
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.storage.blob import BlobServiceClient
from openai import AzureOpenAI

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"


def _credential() -> DefaultAzureCredential:
    return DefaultAzureCredential()


def _check_foundry() -> dict:
    """Make a real gpt-4o-mini call over Entra ID and return what it said."""
    endpoint = os.environ["AZURE_OPENAI_ENDPOINT"]
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]
    api_version = os.environ["AZURE_OPENAI_API_VERSION"]

    token_provider = get_bearer_token_provider(_credential(), COGNITIVE_SERVICES_SCOPE)
    client = AzureOpenAI(
        azure_endpoint=endpoint,
        azure_ad_token_provider=token_provider,
        api_version=api_version,
    )

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {
                "role": "system",
                "content": "You are a deployment smoke test. Answer in one short sentence.",
            },
            {
                "role": "user",
                "content": (
                    "Name the three Baltic states and confirm you were reached "
                    "using a managed identity rather than an API key."
                ),
            },
        ],
        max_tokens=80,
        temperature=0,
    )

    return {
        "status": "PASS",
        "endpoint": endpoint,
        "deployment": deployment,
        "model_served": response.model,
        "auth": "Entra ID bearer token from DefaultAzureCredential (no API key)",
        "completion": response.choices[0].message.content,
        "finish_reason": response.choices[0].finish_reason,
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        },
    }


def _check_blob() -> dict:
    """Write a blob to raw-feeds, read it back, delete it."""
    account_url = os.environ["BLOB_ACCOUNT_URL"]
    container = os.environ["NEWSROOM_CONTAINER_RAW_FEEDS"]

    service = BlobServiceClient(account_url, credential=_credential())
    container_client = service.get_container_client(container)

    blob_name = f"_identity-check/{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}.json"
    payload = {
        "probe": "portabaltica-identity-check",
        "written_at": datetime.now(timezone.utc).isoformat(),
    }

    blob = container_client.get_blob_client(blob_name)
    blob.upload_blob(json.dumps(payload).encode("utf-8"), overwrite=True)
    round_tripped = json.loads(blob.download_blob().readall())
    blob.delete_blob()

    containers = sorted(c.name for c in service.list_containers())

    return {
        "status": "PASS",
        "account_url": account_url,
        "auth": "Entra ID via DefaultAzureCredential (allowSharedKeyAccess=false)",
        "wrote_and_read_back": blob_name,
        "round_trip_matches": round_tripped == payload,
        "containers_visible": containers,
    }


@app.route(route="identity-check", methods=["GET"])
def identity_check(req: func.HttpRequest) -> func.HttpResponse:
    """Run both checks and fail loudly if either grant is missing."""
    checks: dict = {}
    failed = False

    for name, probe in (("foundry_openai", _check_foundry), ("blob_storage", _check_blob)):
        try:
            checks[name] = probe()
        except Exception as exc:  # noqa: BLE001 — the error text is the evidence
            failed = True
            logging.exception("identity-check %s failed", name)
            checks[name] = {
                "status": "FAIL",
                "error_type": type(exc).__name__,
                "error": str(exc),
            }

    body = {
        "overall": "FAIL" if failed else "PASS",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "function_app": os.environ.get("WEBSITE_SITE_NAME", "unknown"),
        "checks": checks,
    }

    return func.HttpResponse(
        json.dumps(body, indent=2),
        status_code=500 if failed else 200,
        mimetype="application/json",
    )
