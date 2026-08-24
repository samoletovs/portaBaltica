"""Runtime configuration.

Everything is read from the environment with a safe default, so the test suite
never needs Azure and a local run only needs ``az login``.

No connection strings appear anywhere in this project. Blob and Azure OpenAI are
both reached with :class:`azure.identity.DefaultAzureCredential`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

NEWSROOM_DIR = Path(__file__).resolve().parent.parent

# --- Azure OpenAI (foundrylab shared account, swedencentral) ----------------
AZURE_OPENAI_ENDPOINT = os.environ.get(
    "AZURE_OPENAI_ENDPOINT",
    "https://foundrylab-aiservices.cognitiveservices.azure.com/",
)
AZURE_OPENAI_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21")
AZURE_OPENAI_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")

# --- Storage ----------------------------------------------------------------
# Raw items are archived here *before* anything parses them, so a validator
# failure downstream is always reproducible from the bytes we actually received.
#
# TWO NAMES FOR EACH SETTING, ON PURPOSE.
#
# The infrastructure and pipeline workstreams were built in parallel and did
# not agree on env-var names: Bicep provisions BLOB_ACCOUNT_URL and
# NEWSROOM_CONTAINER_ARTICLES, while this module was written expecting
# NEWSROOM_STORAGE_ACCOUNT_URL and NEWSROOM_ARTICLES_CONTAINER. Nothing failed
# loudly — the Function would have deployed, started, found an empty account
# URL, written to no blob at all, and left the front page saying "nothing to
# report" forever. A silent seam is worse than a crash.
#
# The deployed names win, because they are in IaC and already provisioned. The
# older names stay as a fallback so a local run or an older environment keeps
# working, and so this fix cannot itself break anything.
def _setting(*names: str, default: str = "") -> str:
    """First non-empty value among ``names``, else ``default``."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


STORAGE_ACCOUNT_URL = _setting("BLOB_ACCOUNT_URL", "NEWSROOM_STORAGE_ACCOUNT_URL")
RAW_CONTAINER = _setting(
    "NEWSROOM_CONTAINER_RAW_FEEDS", "NEWSROOM_RAW_CONTAINER", default="raw-feeds"
)
ARTICLES_CONTAINER = _setting(
    "NEWSROOM_CONTAINER_ARTICLES", "NEWSROOM_ARTICLES_CONTAINER", default="articles"
)
APPROVALS_CONTAINER = _setting(
    "NEWSROOM_CONTAINER_APPROVALS", "NEWSROOM_APPROVALS_CONTAINER", default="approvals"
)

# Local mirror of the raw archive. Always written; blob is written too when a
# storage account is configured. Keeping the local copy unconditional means the
# reproducibility guarantee does not depend on Azure being reachable.
LOCAL_ARCHIVE_DIR = Path(
    os.environ.get("NEWSROOM_LOCAL_ARCHIVE", NEWSROOM_DIR.parent / ".newsroom-archive")
)

# --- Good-citizen HTTP ------------------------------------------------------
USER_AGENT = os.environ.get(
    "NEWSROOM_USER_AGENT",
    "portaBaltica-newsroom/0.1 (+https://portabaltica.naurolabs.com; contact: sam@naurolabs.com)",
)
HTTP_TIMEOUT_SECONDS = float(os.environ.get("NEWSROOM_HTTP_TIMEOUT", "30"))
HTTP_MAX_RETRIES = int(os.environ.get("NEWSROOM_HTTP_RETRIES", "3"))
HTTP_BACKOFF_SECONDS = float(os.environ.get("NEWSROOM_HTTP_BACKOFF", "1.5"))


@dataclass(frozen=True)
class RankingPolicy:
    """How many articles a day is allowed to produce.

    ``max_articles`` is a ceiling, never a target. ``min_score`` is the quality
    floor: a signal below it is dropped even if that leaves the day empty.
    Padding a quiet day up to a quota is the textbook definition of Google's
    "scaled content abuse", so the pipeline has no mechanism to do it.
    """

    max_articles: int = 8
    min_score: float = 0.55
    max_per_metric: int = 1


DEFAULT_RANKING = RankingPolicy(
    max_articles=int(os.environ.get("NEWSROOM_MAX_ARTICLES", "8")),
    min_score=float(os.environ.get("NEWSROOM_MIN_SCORE", "0.55")),
    max_per_metric=int(os.environ.get("NEWSROOM_MAX_PER_METRIC", "1")),
)
