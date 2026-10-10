import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import azure.functions as func
import pytest
from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError, ResourceModifiedError, ResourceNotFoundError

from newsroom import feedback


class Blob:
    def __init__(self, container, name):
        self.container, self.name = container, name

    def get_blob_properties(self):
        if self.name not in self.container.items:
            raise ResourceNotFoundError("missing")
        item = self.container.items[self.name]
        return SimpleNamespace(
            metadata=dict(item["metadata"]), etag=item["etag"], last_modified=item["last_modified"],
        )

    def upload_blob(self, data, *, overwrite, metadata, **kwargs):
        assert overwrite is False
        if self.container.fail:
            raise RuntimeError("storage unavailable")
        if self.name in self.container.items:
            raise ResourceExistsError("exists")
        try:
            record = json.loads(data)
            modified = datetime.fromisoformat(record["created_at"].replace("Z", "+00:00"))
        except (TypeError, KeyError, json.JSONDecodeError):
            modified = datetime.now(timezone.utc)
        self.container.items[self.name] = {
            "data": data, "metadata": dict(metadata), "etag": 1, "options": kwargs,
            "last_modified": modified,
        }
        return {"etag": "1"}

    def set_blob_metadata(self, metadata, *, etag, match_condition):
        assert match_condition == MatchConditions.IfNotModified
        item = self.container.items[self.name]
        if self.container.race:
            self.container.race = False
            item["metadata"]["count"] = str(feedback.DAILY_ATTEMPTS)
            item["etag"] += 1
        if item["etag"] != etag:
            raise ResourceModifiedError("changed")
        item["metadata"] = dict(metadata)
        item["etag"] += 1


class Container:
    def __init__(self):
        self.items = {}
        self.access = None
        self.fail = False
        self.race = False

    def get_container_properties(self):
        return {"public_access": self.access}

    def get_blob_client(self, name):
        return Blob(self, name)

    def list_blobs(self, *, name_starts_with, include):
        assert include == ["metadata"]
        return [
            SimpleNamespace(name=name, metadata=dict(item["metadata"]), last_modified=item["last_modified"])
            for name, item in self.items.items() if name.startswith(name_starts_with)
        ]


class Service:
    def __init__(self, slug="test-article"):
        self.private = Container()
        self.article = {
            "slug": slug, "status": "published", "tier": "A",
            "provenance": {"validator": {"passed": True}},
        }

    def get_container_client(self, name):
        if name == feedback.CONTAINER:
            return self.private
        assert name == feedback.config.ARTICLES_CONTAINER
        return self

    def download_blob(self, name):
        if self.article is None:
            raise ResourceNotFoundError("missing article")
        assert name == f"{self.article['slug']}.json"
        return SimpleNamespace(readall=lambda: json.dumps(self.article).encode())


def payload(**changes):
    return {
        "id": str(uuid4()), "slug": "test-article", "kind": "issue", "rating": 4,
        "message": "Please clarify this source.", "contact": "reader@example.test", **changes,
    }


def request(body, content_type="application/json", method="POST", url="https://example.test/api/article-feedback"):
    return func.HttpRequest(
        method=method, url=url,
        headers={"content-type": content_type},
        body=body if isinstance(body, bytes) else json.dumps(body).encode(),
    )


def test_receipts_are_private_durable_minimal_and_idempotent():
    service = Service()
    store = feedback.FeedbackStore(service)
    incoming = payload(ip="192.0.2.1", user_agent="do not retain")
    now = datetime(2026, 9, 13, tzinfo=timezone.utc)
    assert store.submit(incoming, now=now) == incoming["id"]
    name = f"submissions/{incoming['id']}.json"
    original = dict(service.private.items[name])
    record = json.loads(original["data"])
    assert set(record) == {"id", "slug", "kind", "rating", "message", "contact", "created_at", "expires_at"}
    assert record["expires_at"] == "2026-12-12T00:00:00Z"
    assert original["options"]["content_settings"].cache_control == "no-store"
    assert store.submit(incoming, now=datetime(2026, 9, 14, tzinfo=timezone.utc)) == incoming["id"]
    assert service.private.items[name] == original


def test_reusing_an_id_for_different_feedback_cannot_overwrite_it():
    service = Service()
    store = feedback.FeedbackStore(service)
    incoming = payload()
    store.submit(incoming)
    with pytest.raises(feedback.FeedbackProblem) as failure:
        store.submit({**incoming, "message": "Different text."})
    assert failure.value.status == 409
    assert json.loads(service.private.items[f"submissions/{incoming['id']}.json"]["data"])["message"] == incoming["message"]


@pytest.mark.parametrize("access", ["blob", "container"])
def test_a_public_container_is_never_a_feedback_sink(access):
    service = Service()
    service.private.access = access
    with pytest.raises(RuntimeError, match="private"):
        feedback.FeedbackStore(service).submit(payload())
    assert service.private.items == {}


@pytest.mark.parametrize("race", [False, True])
def test_the_daily_budget_is_shared_and_cannot_lose_a_concurrent_update(race):
    service = Service()
    now = datetime(2026, 9, 13, 23, 59, 30, tzinfo=timezone.utc)
    name = "limits/2026-09-13"
    service.private.items[name] = {
        "data": b"", "metadata": {"count": str(feedback.DAILY_ATTEMPTS - int(race))}, "etag": 1,
    }
    service.private.race = race
    with pytest.raises(feedback.FeedbackProblem) as failure:
        feedback.FeedbackStore(service).submit(payload(), now=now)
    assert (failure.value.status, failure.value.retry_after) == (429, 30)
    assert list(service.private.items) == [name]


@pytest.mark.parametrize("article", [
    None,
    {"slug": "test-article", "status": "draft", "tier": "A"},
    {"slug": "test-article", "status": "published", "tier": "A", "provenance": {"validator": {"passed": False}}},
])
def test_missing_or_unpublished_articles_do_not_receive_feedback(article):
    service = Service()
    service.article = article
    with pytest.raises(feedback.FeedbackProblem) as failure:
        feedback.FeedbackStore(service).submit(payload())
    assert failure.value.status == 404
    assert not any(name.startswith("submissions/") for name in service.private.items)


@pytest.mark.parametrize("changes", [
    {"id": "bad"}, {"slug": "../private"}, {"slug": ""}, {"kind": "unknown"},
    {"rating": True}, {"rating": 0}, {"rating": 6},
    {"rating": "5"}, {"message": "four"}, {"message": "x" * 2001}, {"contact": "x" * 201}, {"contact": 123},
    {"message": "invalid \ud800"},
])
@pytest.mark.asyncio
async def test_invalid_input_never_reaches_storage(changes, monkeypatch):
    def forbidden():
        pytest.fail("invalid request touched storage")
    monkeypatch.setattr(feedback, "blob_service", forbidden)
    result = await feedback.handle_feedback(request(payload(**changes)))
    assert result.status_code == 400
    assert result.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize(("body", "content_type", "method", "status"), [
    (b"broken", "application/json", "POST", 400),
    (b"[]", "application/json", "POST", 400),
    (b"x" * (feedback.MAX_REQUEST_BYTES + 1), "application/json", "POST", 413),
    (b"{}", "text/plain", "POST", 415),
    (b"{}", "application/json", "PUT", 405),
])
@pytest.mark.asyncio
async def test_http_envelope_is_bounded(body, content_type, method, status):
    result = await feedback.handle_feedback(request(body, content_type, method))
    assert result.status_code == status


@pytest.mark.asyncio
async def test_http_acceptance_requires_a_durable_write(monkeypatch):
    service = Service()
    monkeypatch.setattr(feedback, "blob_service", lambda: service)
    incoming = payload()
    accepted = await feedback.handle_feedback(request(incoming))
    assert accepted.status_code == 202
    assert json.loads(accepted.get_body()) == {
        "ok": True, "id": incoming["id"], "rating": incoming["rating"],
        "summary": {"available": False, "count": None, "average": None},
    }
    assert f"submissions/{incoming['id']}.json" in service.private.items
    service.private.fail = True
    failed = await feedback.handle_feedback(request(payload()))
    assert failed.status_code == 503
    assert incoming["message"].encode() not in failed.get_body()


def test_summary_is_aggregate_only_and_hidden_until_five_ratings():
    service = Service()
    store = feedback.FeedbackStore(service)
    now = datetime(2026, 9, 13, tzinfo=timezone.utc)
    for rating in (1, 2, 3, 4):
        store.submit(payload(rating=rating), now=now)
    assert store.summary("test-article", now=now) == {
        "available": False, "count": None, "average": None,
    }
    store.submit(payload(rating=5), now=now)
    assert store.summary("test-article", now=now) == {
        "available": True, "count": 5, "average": 3.0,
    }
    assert set(store.summary("test-article", now=now)) == {"available", "count", "average"}


@pytest.mark.asyncio
async def test_summary_route_returns_only_the_reader_facing_aggregate(monkeypatch):
    service = Service()
    now = datetime.now(timezone.utc)
    store = feedback.FeedbackStore(service)
    for rating in (1, 2, 3, 4, 5):
        store.submit(payload(rating=rating), now=now)
    monkeypatch.setattr(feedback, "blob_service", lambda: service)
    result = await feedback.handle_feedback(request(
        b"", method="GET", url="https://example.test/api/article-feedback?slug=test-article",
    ))
    assert result.status_code == 200
    assert json.loads(result.get_body()) == {"available": True, "count": 5, "average": 3.0}
    assert result.headers["Cache-Control"] == "no-store"


def test_retention_is_scoped_to_feedback_and_all_copy_kinds_expire():
    rule = feedback.RETENTION_RULE
    assert rule["definition"]["filters"] == {"blobTypes": ["blockBlob"], "prefixMatch": ["feedback/"]}
    assert feedback.RETENTION_DAYS == 90
    actions = rule["definition"]["actions"]
    assert actions["snapshot"]["delete"]["daysAfterCreationGreaterThan"] == feedback.RETENTION_DAYS
    assert actions["version"]["delete"]["daysAfterCreationGreaterThan"] == feedback.RETENTION_DAYS
