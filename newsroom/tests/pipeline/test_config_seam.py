"""The seam between the infrastructure and pipeline workstreams.

These two were built in parallel and did not agree on environment variable
names. Nothing failed loudly: the Function App would have deployed, started
cleanly, read an empty storage account URL, written to no blob at all, and left
the front page saying "Nothing to report yet today" indefinitely. Every check
would have been green.

So the names are pinned here against the values Bicep actually provisions. If
someone renames a setting on either side, this goes red instead of the site
going quietly empty.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import pytest

INFRA_BICEP = Path(__file__).resolve().parents[3] / "infrastructure" / "main.bicep"


def _reload_config(monkeypatch: pytest.MonkeyPatch, **env: str):
    """Reload the config module under a specific environment."""
    for key in (
        "BLOB_ACCOUNT_URL",
        "NEWSROOM_STORAGE_ACCOUNT_URL",
        "NEWSROOM_CONTAINER_ARTICLES",
        "NEWSROOM_ARTICLES_CONTAINER",
        "NEWSROOM_CONTAINER_RAW_FEEDS",
        "NEWSROOM_RAW_CONTAINER",
        "NEWSROOM_CONTAINER_APPROVALS",
    ):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    import newsroom.pipeline.config as config

    return importlib.reload(config)


class TestDeployedNamesAreHonoured:
    """The names Bicep provisions must be the ones the code reads."""

    def test_should_read_the_storage_url_the_infrastructure_provisions(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        config = _reload_config(
            monkeypatch, BLOB_ACCOUNT_URL="https://stexample.blob.core.windows.net/"
        )
        assert config.STORAGE_ACCOUNT_URL == "https://stexample.blob.core.windows.net/"

    def test_should_read_the_container_names_the_infrastructure_provisions(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        config = _reload_config(
            monkeypatch,
            NEWSROOM_CONTAINER_ARTICLES="articles",
            NEWSROOM_CONTAINER_RAW_FEEDS="raw-feeds",
            NEWSROOM_CONTAINER_APPROVALS="approvals",
        )
        assert config.ARTICLES_CONTAINER == "articles"
        assert config.RAW_CONTAINER == "raw-feeds"
        assert config.APPROVALS_CONTAINER == "approvals"

    def test_should_still_accept_the_older_names_for_local_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        config = _reload_config(
            monkeypatch,
            NEWSROOM_STORAGE_ACCOUNT_URL="https://local.blob.core.windows.net/",
            NEWSROOM_ARTICLES_CONTAINER="local-articles",
        )
        assert config.STORAGE_ACCOUNT_URL == "https://local.blob.core.windows.net/"
        assert config.ARTICLES_CONTAINER == "local-articles"

    def test_should_prefer_the_deployed_name_when_both_are_present(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The provisioned value is the one that is actually true in Azure."""
        config = _reload_config(
            monkeypatch,
            BLOB_ACCOUNT_URL="https://deployed.blob.core.windows.net/",
            NEWSROOM_STORAGE_ACCOUNT_URL="https://stale.blob.core.windows.net/",
        )
        assert config.STORAGE_ACCOUNT_URL == "https://deployed.blob.core.windows.net/"

    def test_should_treat_a_blank_setting_as_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An app setting cleared in the portal arrives as '' , not unset."""
        config = _reload_config(
            monkeypatch,
            BLOB_ACCOUNT_URL="   ",
            NEWSROOM_STORAGE_ACCOUNT_URL="https://fallback.blob.core.windows.net/",
        )
        assert config.STORAGE_ACCOUNT_URL == "https://fallback.blob.core.windows.net/"


class TestInfrastructureStillDeclaresThem:
    """Guards the other side of the seam.

    If someone renames a setting in Bicep, the code above would keep passing
    while production silently stopped writing anywhere. These assertions fail
    instead.
    """

    @pytest.mark.parametrize(
        "setting",
        [
            "BLOB_ACCOUNT_URL",
            "NEWSROOM_CONTAINER_ARTICLES",
            "NEWSROOM_CONTAINER_RAW_FEEDS",
            "NEWSROOM_CONTAINER_APPROVALS",
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_DEPLOYMENT",
        ],
    )
    def test_bicep_declares_the_setting_the_code_reads(self, setting: str) -> None:
        # Deliberately NOT skipped when the file is missing. A guard that skips
        # itself when it cannot find what it guards is indistinguishable from a
        # guard that passes, and this one exists precisely because a silent
        # mismatch is the failure mode.
        assert INFRA_BICEP.exists(), (
            f"expected infrastructure/main.bicep at {INFRA_BICEP}; this test "
            "cannot verify the seam without it"
        )
        assert setting in INFRA_BICEP.read_text(encoding="utf-8"), (
            f"{setting} is read by newsroom/pipeline/config.py but no longer appears "
            "in infrastructure/main.bicep. Renaming one side without the other makes "
            "the pipeline write nowhere, silently."
        )


def teardown_module() -> None:
    """Leave the imported config matching the real environment."""
    import newsroom.pipeline.config as config

    importlib.reload(config)
    assert os.environ is not None  # keep the import meaningful to linters
