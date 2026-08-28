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


#: The git revision of the code that is actually running.
#:
#: Set by the deploy workflow from ``github.sha`` immediately after publishing,
#: NOT committed to the tree: a constant in the repository records what someone
#: last typed, which is a different question from what Azure is serving.
#:
#: Deliberately no fallback. A default like "unknown" or a stale build-time
#: constant is a field that always looks plausible, and a provenance stamp that
#: cannot be false is worse than none -- it invites exactly the trust it does
#: not earn. When this is empty the article says so, distinguishably, rather
#: than carrying a placeholder that reads like an answer.
#:
#: There is no platform variable to read instead. ``SCM_COMMIT_ID`` is populated
#: by Kudu for git deployments; this app is published as a zip by
#: ``Azure/functions-action``, and its app settings carry no revision.
REVISION = _setting("NEWSROOM_REVISION")

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

# --- Schedule ---------------------------------------------------------------
# The cron the timer trigger actually binds to. It lived only in a decorator
# argument in ``function_app.py`` while an app setting of the same name sat in
# Azure being ignored, so the deployment looked configured for three runs a day
# and ran once. Read here as well so the run report can state the schedule it
# believes it is on, and a reader comparing that against the timestamps can see
# a disagreement rather than having to guess at one.
SCHEDULE = _setting("NEWSROOM_SCHEDULE", default="0 0 14 * * *")

# The weekly wrap runs on its own cadence and so needs its own setting. The
# daily schedule is already an app setting rather than a decorator constant --
# a lesson learned the hard way when the two disagreed and the deployment
# looked configured for three runs a day while running once -- so a second
# timer sharing the first's setting would reintroduce exactly that gap.
#
# Sunday 15:00 UTC by default: an hour after the daily default, so the week's
# last edition has already published and its findings are in the ledger the
# wrap reads.
WEEKLY_SCHEDULE = _setting("NEWSROOM_WEEKLY_SCHEDULE", default="0 0 15 * * 0")

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

# --- Research ---------------------------------------------------------------
# Research reuses the registered RSS responses already fetched for syndication,
# so it adds no search API call. These ceilings bound both prompt size and cost.
RESEARCH_MAX_ITEMS = int(os.environ.get("NEWSROOM_RESEARCH_MAX_ITEMS", "5"))
RESEARCH_MAX_PER_SOURCE = int(os.environ.get("NEWSROOM_RESEARCH_MAX_PER_SOURCE", "2"))
RESEARCH_MIN_RELEVANCE = int(os.environ.get("NEWSROOM_RESEARCH_MIN_RELEVANCE", "2"))
RESEARCH_MAX_SUMMARY_CHARS = int(
    os.environ.get("NEWSROOM_RESEARCH_MAX_SUMMARY_CHARS", "800")
)
RESEARCH_MAX_AGE_DAYS = int(os.environ.get("NEWSROOM_RESEARCH_MAX_AGE_DAYS", "120"))

# --- Editorial escalation -----------------------------------------------------
# The editor agent handles routine tier B/C decisions itself. These credentials
# are only for the exceptional path where the item is dangerous, harmful or
# inappropriate enough that Andre must be interrupted.
TELEGRAM_BOT_TOKEN = _setting(
    "NEWSROOM_TELEGRAM_BOT_TOKEN", "NAURO_BOT_TOKEN"
)
TELEGRAM_CHAT_ID = _setting("NEWSROOM_TELEGRAM_CHAT_ID", "NAURO_CHAT_ID")


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
