"""Private article feedback. Never publishes a submission or mirrors it locally."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from uuid import UUID

import azure.functions as func
from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError, ResourceModifiedError, ResourceNotFoundError
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

from newsroom.pipeline import config
from newsroom.pipeline.ids import slug_problem
from newsroom.pipeline.models import isoformat

log = logging.getLogger(__name__)
RETENTION_RULE = json.loads(Path(__file__).with_name("feedback-retention.json").read_text())
RETENTION_DAYS = RETENTION_RULE["definition"]["actions"]["baseBlob"]["delete"]["daysAfterModificationGreaterThan"]
CONTAINER = RETENTION_RULE["definition"]["filters"]["prefixMatch"][0].removesuffix("/")
MAX_REQUEST_BYTES = 12288
DAILY_ATTEMPTS = 1000


class FeedbackProblem(Exception):
    def __init__(self, message: str, status: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def validate(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise FeedbackProblem("A JSON object is required.")
    receipt = payload.get("id")
    try:
        parsed_id = UUID(receipt) if isinstance(receipt, str) else None
    except ValueError:
        parsed_id = None
    if parsed_id is None or parsed_id.version != 4 or str(parsed_id) != receipt:
        raise FeedbackProblem("A valid submission reference is required.")
    slug = payload.get("slug")
    if slug_problem(slug) or len(slug) > 250:
        raise FeedbackProblem("A valid article slug is required.")
    kind = payload.get("kind")
    if kind not in ("comment", "issue"):
        raise FeedbackProblem("Feedback type must be comment or issue.")
    message = payload.get("message")
    if not isinstance(message, str) or not 5 <= len(message.strip()) <= 2000:
        raise FeedbackProblem("Feedback must be 5 to 2000 characters.")
    contact = payload.get("contact")
    if contact is not None and (not isinstance(contact, str) or len(contact.strip()) > 200):
        raise FeedbackProblem("Contact must be at most 200 characters.")
    try:
        message.encode("utf-8")
        if contact is not None:
            contact.encode("utf-8")
    except UnicodeEncodeError:
        raise FeedbackProblem("Feedback must contain valid Unicode text.") from None
    return {
        "id": receipt, "slug": slug, "kind": kind, "message": message.strip(),
        "contact": contact.strip() or None if contact is not None else None,
    }


@lru_cache(maxsize=1)
def blob_service() -> BlobServiceClient:
    if not config.STORAGE_ACCOUNT_URL:
        raise RuntimeError("Feedback storage account is not configured.")
    credential = (
        DefaultAzureCredential()
        if os.environ.get("AZURE_FUNCTIONS_ENVIRONMENT") == "Development"
        else ManagedIdentityCredential()
    )
    return BlobServiceClient(
        config.STORAGE_ACCOUNT_URL, credential=credential,
        connection_timeout=5, read_timeout=5, retry_total=0,
    )


class FeedbackStore:
    def __init__(self, service: BlobServiceClient):
        self.service = service
        self.container = service.get_container_client(CONTAINER)

    def _reserve_attempt(self, now: datetime) -> None:
        counter = self.container.get_blob_client(f"limits/{now.date().isoformat()}")
        for _ in range(4):
            try:
                properties = counter.get_blob_properties()
            except ResourceNotFoundError:
                try:
                    counter.upload_blob(b"", overwrite=False, metadata={"count": "1"})
                    return
                except ResourceExistsError:
                    continue
            count = int(properties.metadata["count"])
            if count < 0:
                raise RuntimeError("Invalid feedback quota counter.")
            if count >= DAILY_ATTEMPTS:
                midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                raise FeedbackProblem(
                    "Feedback capacity has been reached. Please try again later.",
                    429, max(1, math.ceil((midnight - now).total_seconds())),
                )
            try:
                counter.set_blob_metadata(
                    {"count": str(count + 1)}, etag=properties.etag,
                    match_condition=MatchConditions.IfNotModified,
                )
                return
            except ResourceModifiedError:
                continue
        raise FeedbackProblem("Feedback is busy. Please retry shortly.", 429, 5)

    def submit(self, payload: dict, *, now: datetime | None = None) -> str:
        payload = validate(payload)
        now = now or datetime.now(timezone.utc)
        if now.utcoffset() is None:
            raise ValueError("Feedback time must include a time zone.")
        now = now.astimezone(timezone.utc)
        if self.container.get_container_properties()["public_access"] is not None:
            raise RuntimeError("Feedback container must be private.")
        self._reserve_attempt(now)
        fingerprint = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        blob = self.container.get_blob_client(f"submissions/{payload['id']}.json")
        try:
            previous = blob.get_blob_properties()
        except ResourceNotFoundError:
            previous = None
        if previous is not None:
            if previous.metadata.get("request_hash") != fingerprint:
                raise FeedbackProblem("This submission reference was already used.", 409)
            return payload["id"]

        try:
            article = json.loads(
                self.service.get_container_client(config.ARTICLES_CONTAINER)
                .download_blob(f"{payload['slug']}.json").readall()
            )
        except ResourceNotFoundError:
            raise FeedbackProblem("This article is not available for feedback.", 404) from None
        if (
            not isinstance(article, dict) or article.get("slug") != payload["slug"]
            or article.get("status") not in ("published", "corrected", "retracted")
            or article.get("tier") not in ("A", "B", "C")
            or article.get("status") == "published"
            and not article.get("provenance", {}).get("validator", {}).get("passed")
        ):
            raise FeedbackProblem("This article is not available for feedback.", 404)

        record = {
            **payload, "created_at": isoformat(now),
            "expires_at": isoformat(now + timedelta(days=RETENTION_DAYS)),
        }
        try:
            # Immutable receipts make retries idempotent and do not reset retention.
            acknowledgement = blob.upload_blob(
                json.dumps(record, ensure_ascii=False).encode("utf-8"), overwrite=False,
                metadata={"request_hash": fingerprint},
                content_settings=ContentSettings(
                    content_type="application/json; charset=utf-8", cache_control="no-store",
                ),
            )
            if not acknowledgement.get("etag"):
                raise RuntimeError("Storage did not acknowledge the feedback write.")
        except ResourceExistsError:
            if blob.get_blob_properties().metadata.get("request_hash") != fingerprint:
                raise FeedbackProblem("This submission reference was already used.", 409) from None
        return payload["id"]


def response(body: dict, status: int, retry_after: int | None = None) -> func.HttpResponse:
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return func.HttpResponse(
        json.dumps(body), status_code=status, mimetype="application/json", headers=headers,
    )


async def handle_feedback(req: func.HttpRequest) -> func.HttpResponse:
    if req.method != "POST":
        result = response({"error": "Method not allowed."}, 405)
        result.headers["Allow"] = "POST"
        return result
    if req.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return response({"error": "Content-Type must be application/json."}, 415)
    raw = req.get_body()
    if len(raw) > MAX_REQUEST_BYTES:
        return response({"error": "Feedback request is too large."}, 413)
    try:
        payload = validate(json.loads(raw))
    except (ValueError, UnicodeDecodeError):
        return response({"error": "Invalid JSON body."}, 400)
    except FeedbackProblem as problem:
        return response({"error": str(problem)}, problem.status)
    try:
        receipt = await asyncio.to_thread(FeedbackStore(blob_service()).submit, payload)
    except FeedbackProblem as problem:
        return response({"error": str(problem)}, problem.status, problem.retry_after)
    except Exception:
        log.exception("Feedback storage failed; receipt not confirmed")
        return response({"error": "Could not confirm feedback was saved. Please retry."}, 503)
    return response({"ok": True, "id": receipt}, 202)
